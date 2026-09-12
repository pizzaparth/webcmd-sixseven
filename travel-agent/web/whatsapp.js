// WhatsApp channel for the travel concierge — a webhook for the WhatsApp
// Cloud API (Meta). People message the business number, describe a trip,
// get the price comparison as a WhatsApp list, pick platforms, and finish
// with the same dummy checkout the website has. See WHATSAPP.md for setup.
//
// Cloud API surface used (all plain fetch, no SDK):
//   GET  /webhooks/whatsapp   -> verification handshake (hub.challenge echo)
//   POST /webhooks/whatsapp   -> incoming messages (+ delivery statuses, ignored)
//   POST graph.facebook.com/{version}/{PHONE_NUMBER_ID}/messages -> replies
//
// Conversation state lives in memory per sender for the server's lifetime,
// same as the web picks. Nothing is written to disk. No card details are
// ever asked for over chat — payment is simulated with a single tap.

import crypto from 'node:crypto';
import { parseFreeText } from '../src/lib/args.js';
import { parseDateFlexible, formatISO } from '../src/lib/dates.js';
import { groupByCategory, cheapest, bestTotal, formatPrice } from './compare.js';
import { getAnthropic } from './voice/providers.js';

const env = (k) => (process.env[k] || '').trim();
const GRAPH_VERSION = () => env('WHATSAPP_GRAPH_VERSION') || 'v21.0';
const CATEGORY_LABEL = { flights: 'Flights ✈️', trains: 'Trains 🚆', cabs: 'Cabs 🚕', hotels: 'Hotels 🏨' };

export function whatsappConfig() {
  return {
    enabled: Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID') && env('WHATSAPP_VERIFY_TOKEN')),
    signatureCheck: Boolean(env('WHATSAPP_APP_SECRET')),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID') || null,
  };
}

// ------------------------------------------------------------- sending ---

async function graphPost(payload) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION()}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WhatsApp send failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

export const send = {
  text: (to, body) => graphPost({ to, type: 'text', text: { body, preview_url: true } }),
  /** Up to 3 buttons, titles ≤ 20 chars. */
  buttons: (to, body, buttons) =>
    graphPost({
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    }),
  /** Sections of rows (≤ 10 rows total, titles ≤ 24, descriptions ≤ 72). */
  list: (to, { header, body, button = 'Choose', sections }) =>
    graphPost({
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(header ? { header: { type: 'text', text: header.slice(0, 60) } } : {}),
        body: { text: body },
        action: {
          button: button.slice(0, 20),
          sections: sections.map((s) => ({
            title: s.title.slice(0, 24),
            rows: s.rows.map((r) => ({ id: r.id, title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })),
          })),
        },
      },
    }),
  markRead: (messageId) => graphPost({ status: 'read', message_id: messageId }).catch(() => {}),
};

// ------------------------------------------------------ intent parsing ---

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    destination: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    origin: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    startDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    endDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    budget: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    travelers: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
  },
  required: ['destination', 'origin', 'startDate', 'endDate', 'budget', 'travelers'],
  additionalProperties: false,
};

async function parseIntentWithClaude(text) {
  const client = await getAnthropic();
  const today = formatISO(new Date());
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 300,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: INTENT_SCHEMA } },
    system: [
      {
        type: 'text',
        text: `Extract a trip request from a WhatsApp message. Today is ${today}. Cities in title case. Dates as YYYY-MM-DD (assume the next occurrence if no year). Budget as a number in INR. travelers as an integer. Use null for anything not stated. Never invent a destination.`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: text }],
  });
  if (response.stop_reason === 'refusal') return null;
  const json = response.content.find((b) => b.type === 'text')?.text || '{}';
  return JSON.parse(json);
}

/** Free text -> TripIntent (same shape the CLI builds). Claude if configured, else the regex heuristic. */
export async function parseTripMessage(text) {
  let guess = null;
  if (env('ANTHROPIC_API_KEY')) {
    try {
      guess = await parseIntentWithClaude(text);
    } catch (err) {
      console.warn(`[whatsapp] Claude intent parse failed, using heuristic: ${err.message}`);
    }
  }
  if (!guess) guess = parseFreeText(text);
  const toISO = (v) => {
    const d = parseDateFlexible(v);
    return d ? formatISO(d) : null;
  };
  if (!guess.destination) return null;
  return {
    raw: text,
    origin: guess.origin || null,
    destination: guess.destination,
    startDate: toISO(guess.startDate),
    endDate: toISO(guess.endDate),
    budget: Number.isFinite(Number(guess.budget)) && guess.budget ? Number(guess.budget) : null,
    currency: 'INR',
    travelers: Number.isFinite(Number(guess.travelers)) && guess.travelers > 0 ? Number(guess.travelers) : 1,
    preferences: [],
  };
}

// --------------------------------------------------------- formatting ---

function intentSummary(intent) {
  const lines = [`📍 *${intent.origin ? `${intent.origin} → ` : ''}${intent.destination}*`];
  if (intent.startDate) lines.push(`🗓 ${intent.startDate}${intent.endDate ? ` → ${intent.endDate}` : ''}`);
  lines.push(`👥 ${intent.travelers} traveler${intent.travelers === 1 ? '' : 's'}`);
  if (intent.budget) lines.push(`💰 Budget ${formatPrice(intent.budget, intent.currency)}`);
  return lines.join('\n');
}

function resultsSummary(trip) {
  const { total, currency, priced } = bestTotal(trip.results);
  const lines = [];
  for (const [category, rows] of groupByCategory(trip.results)) {
    const best = cheapest(rows);
    lines.push(`*${CATEGORY_LABEL[category] || category}*`);
    for (const r of rows) {
      const price = r.pick ? formatPrice(r.pick.price, r.pick.currency) : 'price not captured';
      const tag = best && r === best && rows.length > 1 ? ' ⭐' : '';
      lines.push(`• ${r.platform}: ${price}${tag}${r.pick?.title ? `\n   _${r.pick.title.slice(0, 60)}_` : ''}`);
    }
  }
  if (priced.length) lines.push(`\n💡 Best total: *${formatPrice(total, currency)}* (cheapest per category)`);
  return lines.join('\n');
}

function picksSummary(session) {
  const cats = Object.keys(session.picks);
  if (!cats.length) return 'No picks yet.';
  let total = 0;
  const lines = cats.map((c) => {
    const p = session.picks[c];
    if (p.price != null) total += p.price;
    return `• ${CATEGORY_LABEL[c] || c}: ${p.platform}${p.price != null ? ` — ${formatPrice(p.price, p.currency)}` : ''}`;
  });
  lines.push(`Total: *${formatPrice(total, 'INR')}*`);
  return lines.join('\n');
}

function choiceList(trip) {
  const sections = [];
  for (const [category, rows] of groupByCategory(trip.results)) {
    sections.push({
      title: (CATEGORY_LABEL[category] || category).replace(/\s\S+$/, ''),
      rows: rows
        .filter((r) => r.url)
        .map((r) => ({
          id: `pick:${category}:${r.platformId}`,
          title: r.platform,
          description: r.pick ? `${formatPrice(r.pick.price, r.pick.currency)} · ${r.pick.title || ''}` : 'Browse on the platform',
        })),
    });
  }
  return sections.filter((s) => s.rows.length).slice(0, 10);
}

function fakeId(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let out = `${prefix}_DEMO`;
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ---------------------------------------------------------- the flow ---

const WELCOME = `👋 Hi! I'm the *Travel Concierge* demo bot.

Tell me about your trip in one message, e.g.:
_"Trip to Goa from Mumbai, 12 Oct to 15 Oct, 2 travelers, budget 30000"_

I'll compare flights, trains, cabs and hotels across real sites, you pick a platform per category, and we finish with a *dummy* checkout — nothing is booked or paid for real.

Type *help* any time, *reset* to start over.`;

/**
 * @param {{
 *   search: (intent) => Promise<{ trip: object, live: boolean }>,
 *   links: { compare: string, checkout: string, summary: string },
 *   onPick?: (category, pick) => void,
 *   onConfirm?: (confirmation) => void,
 * }} deps
 */
export function createWhatsAppBot(deps) {
  const sessions = new Map(); // wa_id -> { state, intent, trip, picks, name, travelers, confirmation, waName }
  const seen = new Set(); // message ids, for Meta's redelivery retries

  function session(from, waName) {
    if (!sessions.has(from)) sessions.set(from, { state: 'idle', picks: {}, waName: waName || null });
    const s = sessions.get(from);
    if (waName && !s.waName) s.waName = waName;
    return s;
  }

  async function sendResults(to, s) {
    await send.text(to, `${s.live ? '✅ Search done.' : 'ℹ️ Using the latest search snapshot.'}\n\n${resultsSummary(s.trip)}`);
    if (s.trip.places?.shortlist?.length) {
      await send.text(to, `🗺 *Things to do in ${s.trip.intent.destination}*\n${s.trip.places.shortlist.slice(0, 5).map((p) => `• ${p}`).join('\n')}\n${s.trip.places.url}`);
    }
    await sendChoices(to, s);
  }

  async function sendChoices(to, s) {
    const sections = choiceList(s.trip);
    if (!sections.length) {
      await send.text(to, 'No platforms with a result to choose from in this search.');
      return;
    }
    await send.list(to, {
      header: 'Choose a platform',
      body: `Pick one platform per category. I'll send you the exact link for each pick.\n\nComparison page: ${deps.links.compare}`,
      button: 'Choose',
      sections,
    });
    s.state = 'results';
  }

  async function handlePick(to, s, category, platformId) {
    const r = (s.trip?.results || []).find((x) => x.category === category && x.platformId === platformId);
    if (!r) {
      await send.text(to, "I couldn't find that option any more — type *choose* to see the list again.");
      return;
    }
    const pick = {
      platformId,
      platform: r.platform,
      url: r.url,
      price: r.pick?.price ?? null,
      currency: r.pick?.currency || 'INR',
      sessionId: r.sessionId || null,
      chosenAt: new Date().toISOString(),
    };
    s.picks[category] = pick;
    deps.onPick?.(category, pick);
    await send.buttons(
      to,
      `✅ *${r.platform}* chosen for ${CATEGORY_LABEL[category] || category}${pick.price != null ? ` at ${formatPrice(pick.price, pick.currency)}` : ''}.\nOpen it here:\n${r.url}\n\n${picksSummary(s)}`,
      [
        { id: 'choose', title: 'Choose more' },
        { id: 'checkout', title: 'Checkout (dummy)' },
      ],
    );
  }

  async function startCheckout(to, s) {
    if (!Object.keys(s.picks).length) {
      await send.text(to, 'Pick at least one platform first — type *choose*.');
      return;
    }
    s.state = 'details_name';
    await send.text(to, `Almost there. This is a *dummy* checkout — no real payment.\n\nWhat name should the booking be under?${s.waName ? ` (Reply *same* for "${s.waName}")` : ''}`);
  }

  async function finishPayment(to, s) {
    let amount = 0;
    for (const p of Object.values(s.picks)) if (p.price != null) amount += p.price;
    const confirmation = {
      paymentId: fakeId('pay'),
      orderId: fakeId('order'),
      amount,
      currency: 'INR',
      method: 'WhatsApp (simulated)',
      traveler: s.name,
      travelers: s.travelers,
      destination: s.intent.destination,
      startDate: s.intent.startDate || '',
      endDate: s.intent.endDate || '',
      confirmedAt: new Date().toISOString(),
      dummy: true,
    };
    s.confirmation = confirmation;
    deps.onConfirm?.(confirmation);
    s.state = 'done';
    const tabs = Object.entries(s.picks).map(([c, p]) => `• ${CATEGORY_LABEL[c] || c}: ${p.platform}\n   ${p.url}`).join('\n');
    await send.buttons(
      to,
      `🎉 *Dummy payment confirmed*\nPayment id: ${confirmation.paymentId}\nAmount: ${formatPrice(amount, 'INR')}\nTraveler: ${s.name} (${s.travelers})\n\n*Your tabs*\n${tabs}\n\nSummary page: ${deps.links.summary}\n\n_No money moved and nothing was booked — this is a demo._`,
      [{ id: 'reset', title: 'New trip' }],
    );
  }

  async function handleMessage(from, waName, msg) {
    const s = session(from, waName);
    let text = '';
    let actionId = null;
    if (msg.type === 'text') text = (msg.text?.body || '').trim();
    else if (msg.type === 'interactive') {
      const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
      actionId = reply?.id || null;
      text = reply?.title || '';
    } else {
      await send.text(from, "I can only read text messages here — describe your trip in words and I'll take it from there.");
      return;
    }
    const lower = text.toLowerCase();

    // Global commands
    if (actionId === 'reset' || /^(reset|restart|start over|new trip)$/.test(lower)) {
      sessions.set(from, { state: 'idle', picks: {}, waName: s.waName });
      await send.text(from, `🔄 Reset.\n\n${WELCOME}`);
      return;
    }
    if (/^(hi|hello|hey|start|menu)$/.test(lower) && ['idle', 'results', 'done'].includes(s.state)) {
      await send.text(from, WELCOME);
      return;
    }
    if (lower === 'help') {
      await send.text(from, `Commands: *choose* (platform list), *checkout*, *web* (links), *reset*.\n\nOr just describe a trip: _"Trip to Jaipur from Delhi, 5 Nov to 8 Nov, 2 travelers, budget 20000"_`);
      return;
    }
    if (lower === 'web') {
      await send.text(from, `🌐 Compare: ${deps.links.compare}\n🧾 Details & payment: ${deps.links.checkout}\n📋 Summary: ${deps.links.summary}`);
      return;
    }
    if (actionId === 'choose' || lower === 'choose') {
      if (!s.trip) await send.text(from, 'No search yet — tell me about your trip first.');
      else await sendChoices(from, s);
      return;
    }
    if (actionId === 'checkout' || lower === 'checkout' || lower === 'pay') {
      if (!s.trip) await send.text(from, 'No search yet — tell me about your trip first.');
      else await startCheckout(from, s);
      return;
    }
    if (actionId?.startsWith('pick:')) {
      const [, category, platformId] = actionId.split(':');
      await handlePick(from, s, category, platformId);
      return;
    }

    switch (s.state) {
      case 'idle':
      case 'results':
      case 'done': {
        const intent = await parseTripMessage(text);
        if (!intent) {
          await send.text(from, `I couldn't spot a destination in that. Try: _"Trip to Goa from Mumbai, 12 Oct to 15 Oct, 2 travelers, budget 30000"_`);
          return;
        }
        s.intent = intent;
        s.state = 'confirm_trip';
        await send.buttons(from, `Here's what I understood:\n\n${intentSummary(intent)}\n\nShall I search?`, [
          { id: 'search', title: 'Search 🔍' },
          { id: 'edit', title: 'Edit ✏️' },
        ]);
        return;
      }
      case 'confirm_trip': {
        if (actionId === 'edit' || lower === 'edit' || lower === 'no') {
          s.state = 'idle';
          await send.text(from, 'Okay — send the trip again with the corrections.');
          return;
        }
        if (actionId === 'search' || /^(search|yes|go|ok|okay|y)$/.test(lower)) {
          s.state = 'searching';
          await send.text(from, '🔍 Searching flights, trains, cabs and hotels… I’ll message you when it’s done (live searches take a couple of minutes).');
          try {
            const { trip, live } = await deps.search(s.intent);
            s.trip = trip;
            s.live = live;
            await sendResults(from, s);
          } catch (err) {
            console.error('[whatsapp] search failed:', err);
            s.state = 'idle';
            await send.text(from, `❌ The search failed (${err.message}). Send the trip again to retry.`);
          }
          return;
        }
        // Treat anything else as a new/edited trip description.
        s.state = 'idle';
        return handleMessage(from, waName, msg);
      }
      case 'searching':
        await send.text(from, '⏳ Still searching — hang on.');
        return;
      case 'details_name': {
        s.name = /^same$/i.test(text) && s.waName ? s.waName : text;
        if (!s.name) {
          await send.text(from, 'Please send a name.');
          return;
        }
        s.state = 'details_travelers';
        await send.text(from, `Thanks, ${s.name}. How many travelers? (Reply *same* for ${s.intent.travelers})`);
        return;
      }
      case 'details_travelers': {
        const n = /^same$/i.test(text) ? s.intent.travelers : parseInt(text.replace(/\D/g, ''), 10);
        if (!(n >= 1 && n <= 20)) {
          await send.text(from, 'Please reply with a number between 1 and 20.');
          return;
        }
        s.travelers = n;
        s.state = 'pay';
        let amount = 0;
        for (const p of Object.values(s.picks)) if (p.price != null) amount += p.price;
        await send.buttons(
          from,
          `🧾 *Dummy payment*\n${picksSummary(s)}\nName: ${s.name} · ${n} traveler${n === 1 ? '' : 's'}\n\nTap Pay to *simulate* a payment of ${formatPrice(amount, 'INR')}. No card details are needed and no money moves.`,
          [
            { id: 'pay_confirm', title: 'Pay (dummy)' },
            { id: 'choose', title: 'Change picks' },
          ],
        );
        return;
      }
      case 'pay': {
        if (actionId === 'pay_confirm' || /^(pay|yes|confirm)$/.test(lower)) {
          await finishPayment(from, s);
          return;
        }
        await send.text(from, 'Tap *Pay (dummy)* to simulate the payment, or type *choose* to change picks.');
        return;
      }
      default:
        s.state = 'idle';
        await send.text(from, WELCOME);
    }
  }

  // --------------------------------------------------------- webhook ---

  function verify(url, res) {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === env('WHATSAPP_VERIFY_TOKEN')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(challenge || '');
      console.log('[whatsapp] webhook verified');
      return;
    }
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('verification failed');
  }

  function validSignature(rawBody, header) {
    const secret = env('WHATSAPP_APP_SECRET');
    if (!secret) return true; // not configured — skip (see WHATSAPP.md, set it for anything public)
    if (!header?.startsWith('sha256=')) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = header.slice(7);
    return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
  }

  /** Handles a POST: acknowledges immediately, processes each message asynchronously. */
  function receive(rawBody, headers, res) {
    if (!validSignature(rawBody, headers['x-hub-signature-256'])) {
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.end('bad signature');
      return;
    }
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    // Meta expects a fast 200; anything slower gets retried.
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');

    if (payload?.object !== 'whatsapp_business_account') return;
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const contactName = value.contacts?.[0]?.profile?.name || null;
        for (const msg of value.messages || []) {
          if (!msg?.id || seen.has(msg.id)) continue;
          seen.add(msg.id);
          if (seen.size > 5000) seen.delete(seen.values().next().value);
          send.markRead(msg.id);
          console.log(`[whatsapp] ${msg.from} (${contactName || 'unknown'}) ${msg.type}: ${msg.text?.body || msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || ''}`);
          handleMessage(msg.from, contactName, msg).catch(async (err) => {
            console.error('[whatsapp] handler error:', err);
            try {
              await send.text(msg.from, `Something went wrong on my side (${err.message}). Type *reset* to start again.`);
            } catch {
              /* nothing more to do */
            }
          });
        }
      }
    }
  }

  return { verify, receive, sessions };
}
