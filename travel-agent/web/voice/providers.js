// Cloud voice providers for the voice agent (plan.md → "Voice agent
// button"). The browser's Web Speech API is the default and needs none of
// this; these are the "external speech API" upgrade the plan allows for
// when Web Speech's accuracy isn't good enough. Everything here is keyed
// off environment variables (see ../../.env.example and ../../VOICE.md):
//
//   Speech-to-text : Deepgram Nova-3  (DEEPGRAM_API_KEY)   or Groq Whisper (GROQ_API_KEY)
//   Text-to-speech : Deepgram Aura-2  (DEEPGRAM_API_KEY)   or ElevenLabs   (ELEVENLABS_API_KEY)
//   Understanding  : Claude           (ANTHROPIC_API_KEY)  — turns a spoken answer into the field value
//
// Only Node built-ins plus, for the Claude step, the official
// @anthropic-ai/sdk — imported lazily so the rest of the site still runs
// with zero installs when no key is configured.

const env = (k) => (process.env[k] || '').trim();

function pick(explicit, candidates) {
  const want = explicit.toLowerCase();
  if (want && want !== 'auto') {
    const found = candidates.find((c) => c.id === want);
    if (!found) throw new Error(`Unknown provider "${explicit}" — expected one of ${candidates.map((c) => c.id).join(', ')}`);
    return found.ok ? found.id : null;
  }
  return candidates.find((c) => c.ok)?.id || null;
}

/** Which providers are usable right now, given the env. Safe to send to the browser. */
export function voiceConfig() {
  const stt = pick(env('VOICE_STT_PROVIDER'), [
    { id: 'deepgram', ok: Boolean(env('DEEPGRAM_API_KEY')) },
    { id: 'groq', ok: Boolean(env('GROQ_API_KEY')) },
  ]);
  const tts = pick(env('VOICE_TTS_PROVIDER'), [
    { id: 'deepgram', ok: Boolean(env('DEEPGRAM_API_KEY')) },
    { id: 'elevenlabs', ok: Boolean(env('ELEVENLABS_API_KEY')) },
  ]);
  const llm = env('VOICE_LLM_PROVIDER') === 'none' ? null : env('ANTHROPIC_API_KEY') ? 'anthropic' : null;
  return { stt, tts, llm, cloud: Boolean(stt || tts || llm) };
}

async function expectOk(res, label) {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new Error(`${label} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
}

// ---------------------------------------------------------------- STT ---

export async function transcribe(audio, mime = 'audio/webm') {
  const { stt } = voiceConfig();
  if (!stt) throw new Error('No speech-to-text provider configured (set DEEPGRAM_API_KEY or GROQ_API_KEY)');
  return stt === 'deepgram' ? deepgramTranscribe(audio, mime) : groqTranscribe(audio, mime);
}

async function deepgramTranscribe(audio, mime) {
  const params = new URLSearchParams({
    model: env('DEEPGRAM_STT_MODEL') || 'nova-3',
    language: env('VOICE_LANGUAGE') || 'en',
    smart_format: 'true',
    numerals: 'true', // "nine nine nine" -> "999": matters for phone/card fields
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${env('DEEPGRAM_API_KEY')}`, 'Content-Type': mime },
    body: audio,
  });
  await expectOk(res, 'Deepgram STT');
  const data = await res.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '';
}

async function groqTranscribe(audio, mime) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), mime.includes('ogg') ? 'audio.ogg' : 'audio.webm');
  form.append('model', env('GROQ_STT_MODEL') || 'whisper-large-v3-turbo');
  form.append('language', (env('VOICE_LANGUAGE') || 'en').slice(0, 2));
  form.append('response_format', 'json');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('GROQ_API_KEY')}` },
    body: form,
  });
  await expectOk(res, 'Groq STT');
  const data = await res.json();
  return (data?.text || '').trim();
}

// ---------------------------------------------------------------- TTS ---

/** @returns {Promise<{audio: Buffer, mime: string}>} */
export async function synthesize(text) {
  const { tts } = voiceConfig();
  if (!tts) throw new Error('No text-to-speech provider configured (set DEEPGRAM_API_KEY or ELEVENLABS_API_KEY)');
  return tts === 'deepgram' ? deepgramSpeak(text) : elevenLabsSpeak(text);
}

async function deepgramSpeak(text) {
  const params = new URLSearchParams({ model: env('DEEPGRAM_TTS_VOICE') || 'aura-2-thalia-en', encoding: 'mp3' });
  const res = await fetch(`https://api.deepgram.com/v1/speak?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${env('DEEPGRAM_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  await expectOk(res, 'Deepgram TTS');
  return { audio: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' };
}

async function elevenLabsSpeak(text) {
  const voice = env('ELEVENLABS_VOICE_ID') || '21m00Tcm4TlvDq8ikWAM'; // "Rachel", a premade voice on the free plan
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': env('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: env('ELEVENLABS_MODEL') || 'eleven_flash_v2_5' }),
  });
  await expectOk(res, 'ElevenLabs TTS');
  return { audio: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' };
}

// -------------------------------------------------- understanding (LLM) ---

let anthropicClient = null;
/** Lazily-created Anthropic client (shared with the WhatsApp bot's intent parsing). */
export async function getAnthropic() {
  if (anthropicClient) return anthropicClient;
  let mod;
  try {
    mod = await import('@anthropic-ai/sdk');
  } catch {
    throw new Error('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed — run `npm install` in travel-agent/');
  }
  const Anthropic = mod.default;
  anthropicClient = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return anthropicClient;
}

const INTERPRET_SCHEMA = {
  type: 'object',
  properties: {
    value: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'The normalized value for the field, or null if the answer did not contain one.',
    },
    reply: {
      type: 'string',
      description: 'One short spoken sentence back to the user: confirm what was understood, or re-ask clearly if value is null.',
    },
    done: {
      type: 'boolean',
      description: 'True if the user asked to stop or skip this question.',
    },
  },
  required: ['value', 'reply', 'done'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are the voice assistant on a travel demo's checkout form. The user answers one question at a time out loud; you turn the transcript into the exact value the form field needs and say one short sentence back.

Rules for "value":
- name / cardName: the person's name, title case (cardName upper case). Strip filler like "my name is".
- email: a valid email; render spoken "at"/"dot" as @ and . and remove spaces. null if not a valid address.
- phone: digits only, 10-12 digits. Convert spoken numbers ("double nine", "nine eight seven six") to digits. null if fewer than 10 digits.
- travelers: an integer as a string, 1-20.
- method: exactly "card" or "upi".
- cardNumber: exactly 16 digits, no spaces. This is a demo — the user is reading an obviously fake test card (e.g. 4111111111111111). null if not 16 digits.
- expiry: MMYY as 4 digits (e.g. "twelve thirty" -> "1230"; "December 2030" -> "1230").
- cvv: 3 or 4 digits.
- upi: a UPI id like name@provider; render "at" as @.
- startDate / endDate: YYYY-MM-DD.
- notes: free text, or null if the user said none/nothing.
If the user says "same" for cardName, use the traveler name from context. If they say skip/stop/cancel, set done=true.
Keep "reply" under 15 words, natural, no emojis. Never read a full card number back — say "got the test card" instead.`;

/**
 * Turn a transcript into a field value with Claude. Returns
 * { value: string|null, reply: string, done: boolean }.
 */
export async function interpret({ fieldId, question, transcript, context = {} }) {
  const client = await getAnthropic();
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 256,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: INTERPRET_SCHEMA } },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ field: fieldId, question, transcript, context }),
      },
    ],
  });
  if (response.stop_reason === 'refusal') {
    return { value: null, reply: 'Sorry, I could not process that. Please type it in.', done: true };
  }
  const text = response.content.find((b) => b.type === 'text')?.text || '{}';
  const parsed = JSON.parse(text);
  return { value: parsed.value ?? null, reply: parsed.reply || '', done: Boolean(parsed.done) };
}
