# Voice agent — setup, API keys, and what's free

The voice agent is the 🎤 button on the details + payment page
(`/checkout`). It asks each form field out loud, listens, fills the field,
and moves on. It has two engines behind the same flow
(`web/voice/client.js`):

| Engine | Speech → text | Text → speech | Understanding the answer | Cost | Needs |
| --- | --- | --- | --- | --- | --- |
| **Browser** (default) | Web Speech `SpeechRecognition` | Web Speech `SpeechSynthesis` | Local regex parsers in the page | Free, no keys | Chrome (best), mic permission |
| **Cloud** | Deepgram Nova-3 *or* Groq Whisper | Deepgram Aura-2 *or* ElevenLabs | Claude (`claude-opus-5`, structured output) | Free tiers cover a hackathon many times over | Keys in `travel-agent/.env` |

plan.md recommends Web Speech first and an external API only if accuracy
proves unreliable — that's exactly how this is wired: with no keys the
page uses the browser engine; add keys and an **Engine** picker appears in
the voice panel (Cloud is preselected). Every cloud call falls back to the
browser engine per-step if a request fails, so a dead key never blocks the
demo. Keys never reach the browser — the page only talks to the local
server's `/api/voice/*` routes.

## 1. Setup

```bash
cd travel-agent
npm install                # only needed for the Claude step (@anthropic-ai/sdk)
cp .env.example .env       # then fill in the keys you have (any subset works)
node web/server.js         # prints which engines are configured
```

Open http://127.0.0.1:4173/checkout → 🎤 Voice fill. Chrome will ask for
mic permission the first time. `.env` is gitignored; `.env.example` is the
committed template.

**Recommended minimum for the demo: just `DEEPGRAM_API_KEY` +
`ANTHROPIC_API_KEY`.** One Deepgram key covers both speech-to-text and
text-to-speech; Claude turns messy spoken answers ("uh, two of us",
"twelve slash thirty", "test at demo") into exact field values and says a
short confirmation back.

## 2. Getting each key (and the free usage)

Free-tier figures below were checked on 2026-09-12 — re-check the pricing
pages before relying on them, providers change these.

### Deepgram — speech-to-text + text-to-speech (preferred)

1. Sign up at https://console.deepgram.com (no card needed).
2. Console → **API Keys** → Create key → paste into `DEEPGRAM_API_KEY`.
3. Free usage: **$200 credit on signup, doesn't expire**, usable across
   STT, TTS and their Voice Agent API. Nova-3 STT is ~$0.0043/min
   pay-as-you-go — the whole demo uses cents. (Through 2026-09-12 Deepgram
   also had a promo making its Flux TTS free.)
4. Used as: `POST /v1/listen?model=nova-3&numerals=true` (numerals on so
   "nine nine nine…" comes back as digits) and `POST /v1/speak?model=aura-2-thalia-en`.
   Change models via `DEEPGRAM_STT_MODEL` / `DEEPGRAM_TTS_VOICE`.

Sources: [Deepgram pricing](https://deepgram.com/pricing),
[costbench — Deepgram free plan](https://costbench.com/software/ai-transcription-apis/deepgram/free-plan/),
[TextToLab — Deepgram pricing](https://texttolab.com/blog/deepgram-pricing).

### Groq — speech-to-text alternative (fully free tier)

1. Sign up at https://console.groq.com → **API Keys** → Create → `GROQ_API_KEY`.
2. Free usage: Whisper on the free tier is roughly **20 requests/min,
   2,000 requests/day, 7,200 audio-seconds/hour** — far more than a demo
   needs. No card. Limits are per organization, not per key.
3. Used as: OpenAI-compatible `POST /openai/v1/audio/transcriptions` with
   `whisper-large-v3-turbo` (`GROQ_STT_MODEL`). Groq has no TTS, so pair it
   with Deepgram or ElevenLabs for the voice, or accept browser TTS.
4. To force it when a Deepgram key is also present: `VOICE_STT_PROVIDER=groq`.

Sources: [Groq API free tier limits (2026)](https://www.grizzlypeaksoftware.com/articles/p/groq-api-free-tier-limits-in-2026-what-you-actually-get-uwysd6mb),
[Groq pricing — eesel](https://www.eesel.ai/blog/groq-pricing),
[apio — Groq speech-to-text](https://apio.sh/apis/groq-speech-to-text).

### ElevenLabs — text-to-speech alternative (nicest voices)

1. Sign up at https://elevenlabs.io → profile → **API Keys** → `ELEVENLABS_API_KEY`.
2. Free usage: the Free plan is about **10,000 credits (≈ characters) per
   month, ≈ 10 minutes of audio**, premade voices, API access, no card.
   The whole voice flow speaks ~600 characters per run, so ~15 runs/month.
   No commercial use on the free plan (fine for a hackathon demo).
3. Used as: `POST /v1/text-to-speech/{voice_id}` with `eleven_flash_v2_5`
   (fast, cheap). Default voice is the premade "Rachel"; set
   `ELEVENLABS_VOICE_ID` to any voice id from the Voice Library.
4. To prefer it over Deepgram TTS: `VOICE_TTS_PROVIDER=elevenlabs`.

Sources: [ElevenLabs pricing — BIGVU](https://bigvu.tv/blog/elevenlabs-pricing-2026-plans-credits-commercial-rights-api-costs/),
[FreeAPIHub — free TTS APIs](https://freeapihub.com/blog/best-free-text-to-speech-apis),
[Voice.ai — is ElevenLabs free?](https://voice.ai/hub/tts/elevenlabs-text-to-speech/).

### Anthropic (Claude) — understanding the answers

1. Sign up at https://platform.claude.com → **API Keys** → Create →
   `ANTHROPIC_API_KEY`. (Or, if you have the `ant` CLI: `ant auth login`
   stores a profile the SDK picks up with no env var at all.)
2. Free usage: **new API accounts get a small starter credit (~$5)** to
   test with. Beyond that it's pay-as-you-go — and this use is tiny: each
   spoken answer is one ~400-token request with the system prompt cached,
   so a full voice run costs on the order of a cent on `claude-opus-5`.
   Students/startups/open-source maintainers have larger credit programs.
3. Used as: one `messages.create` per answer with a JSON-schema
   structured output (`{value, reply, done}`) and `effort: "low"`. The
   system prompt (field rules) is cached with `cache_control`.
4. Skip it and keep the local regex parsers with `VOICE_LLM_PROVIDER=none`.

Sources: [Free Anthropic API key & credits — LinkModel](https://www.linkmodel.ai/blog/free-anthropic-api-key),
[How to get an Anthropic API key (2026)](https://creditforstartups.com/resources/anthropic-api-key),
[Claude free credits 2026](https://klymentiev.com/blog/claude-free-credits).

### All-free combinations

| Want | Set |
| --- | --- |
| Zero keys, zero cost | nothing — browser engine |
| Best accuracy, one key | `DEEPGRAM_API_KEY` ($200 credit covers STT + TTS) |
| No-credit-card-ever STT + TTS | `GROQ_API_KEY` + `ELEVENLABS_API_KEY` |
| Robust understanding | add `ANTHROPIC_API_KEY` (starter credit / cents) |

## 3. How the cloud engine works

```
🎤 click → speak(question)            POST /api/voice/tts   → mp3 → <audio>
         → listen()                    mic → MediaRecorder (webm/opus)
                                       simple RMS silence detector stops after ~1s quiet
                                       POST /api/voice/stt   → transcript
         → interpret(field, transcript) POST /api/voice/interpret → {value, reply, done}
         → fill field, speak(reply), next step
```

- `web/voice/providers.js` — the three provider calls (fetch only; the
  Claude step imports `@anthropic-ai/sdk` lazily).
- `web/voice/client.js` — browser code for both engines, inlined into the
  checkout page.
- `web/server.js` — `/api/voice/config|stt|tts|interpret`. `GET
  /api/voice/config` shows what's active.
- `web/env.js` — reads `.env` without a dependency; real environment
  variables win over the file.

Both engines share the same step list (name → phone → travelers → card or
UPI → the matching payment fields) and the same rules: retry up to 3× per
question, skip if still unclear, fields stay hand-editable afterwards.
Nothing spoken is stored: audio is forwarded to the STT provider and
discarded; transcripts live in the page for the run.

## 4. Testing checklist

- [ ] `node web/server.js` prints `Voice agent: browser Web Speech + cloud (...)` with the providers you expect.
- [ ] `curl -s http://127.0.0.1:4173/api/voice/config` shows them.
- [ ] `curl -s -X POST -H 'content-type: application/json' -d '{"text":"Hello from the travel concierge"}' http://127.0.0.1:4173/api/voice/tts -o /tmp/t.mp3 && open /tmp/t.mp3` plays.
- [ ] In Chrome, 🎤 Voice fill with Engine = Cloud: watch the server log for `[voice] stt` / `[voice] interpret` lines.
- [ ] Rehearse in the demo room's noise; if STT keeps missing, raise the `rms > 0.02` threshold in `client.js` or move to the browser engine.

Not yet run live in this repo: the cloud path was built and request shapes
checked, but no provider key was available in the environment that wrote
it — the first real run with keys is the next step.
