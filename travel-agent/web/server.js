#!/usr/bin/env node
// Local website server for the hackathon flow.
//
//   node web/server.js                       # newest output/*.json (or bundled sample)
//   node web/server.js output/goa-123.json   # a specific trip file
//   node web/server.js --no-open             # don't call webcmd; open picks in this browser
//   node web/server.js --no-launch           # don't open the compare page on startup
//   node web/server.js --port 4173
//
// Pages: /  (compare + new search)  /checkout  (details + Razorpay or dummy
// payment)  /summary. State for the run (current trip file, picks, the
// payment confirmation, a running search) is in memory only. Keys for
// Razorpay / voice / WhatsApp come from travel-agent/.env (see .env.example).

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderComparisonPage, bestTotal } from './compare.js';
import { renderCheckoutPage } from './checkout.js';
import { renderSummaryPage } from './summary.js';
import { renderPage, esc } from './template.js';
import { loadEnv, ENV_FILE } from './env.js';
import { voiceConfig, transcribe, synthesize, interpret } from './voice/providers.js';
import { createSession, browserRun, ensureProfile } from '../src/lib/webcmd.js';
import { gotoScript } from '../src/lib/scripts.js';
import { createWhatsAppBot, whatsappConfig, parseTripMessage } from './whatsapp.js';
import { createSearchRunner, detectSearchModes } from './search.js';
import * as rzp from './razorpay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../output');
const SAMPLE_FILE = path.join(__dirname, 'fixtures/sample-trip.json');

function parseArgs(argv) {
  const opts = { file: null, port: 4173, open: true, launch: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--no-open') opts.open = false;
    else if (a === '--no-launch') opts.launch = false;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node web/server.js [trip.json] [--port N] [--no-open] [--no-launch]');
      console.log('  --no-open    do not use webcmd (open picks in this browser; searches disabled)');
      console.log('  --no-launch  do not open the comparison page in your browser on startup');
      process.exit(0);
    } else if (!a.startsWith('-')) opts.file = a;
  }
  return opts;
}

/** Opens `url` in the machine's default browser. Best-effort: never throws. */
function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Headless box or no handler registered — the URL is printed either way.
  }
}

/** All trip files: output/*.json newest first, plus the bundled sample last. */
async function listTripFiles() {
  const files = [];
  try {
    for (const name of await readdir(OUTPUT_DIR)) {
      if (!name.endsWith('.json')) continue;
      const full = path.join(OUTPUT_DIR, name);
      const { mtimeMs } = await stat(full);
      files.push({ file: full, name: name.replace(/\.json$/, ''), mtimeMs, isSample: false });
    }
  } catch {
    // no output dir yet
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  files.push({ file: SAMPLE_FILE, name: 'sample-trip', mtimeMs: 0, isSample: true });
  return files;
}

async function loadTrip(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function html(res, status, markup) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(markup);
}

async function readRaw(req, { maxBytes = 25 * 1024 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  const text = (await readRaw(req, { maxBytes: 1024 * 1024 })).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/** Picks a string-ish field out of a client-supplied object, length-capped. */
const str = (v, max = 200) => (v == null ? '' : String(v).slice(0, max));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envInfo = loadEnv();
  const voice = voiceConfig();
  const whatsapp = whatsappConfig();
  const payments = rzp.razorpayConfig();
  const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || `http://127.0.0.1:${opts.port}`;
  const links = { compare: `${baseUrl}/`, checkout: `${baseUrl}/checkout`, summary: `${baseUrl}/summary` };
  const search = opts.open ? await detectSearchModes() : { claude: false, script: false, mode: null };
  const runner = createSearchRunner();

  // ---- in-memory state for the run (discarded on exit) ----
  const state = {
    file: null,
    isSample: false,
    picks: new Map(), // category -> { platformId, platform, url, price, currency, sessionId, chosenAt }
    pickSessions: new Map(), // "category:platformId" -> webcmd session id
    confirmation: null, // payment confirmation (Razorpay or dummy); never card data beyond network/last4
    orders: new Map(), // razorpay order id -> { amount, details, createdAt }
    paymentLinks: new Map(), // razorpay plink id -> { from (wa id), amount, createdAt }
  };

  async function setTrip(file, { isSample = false, reset = true } = {}) {
    await loadTrip(file); // validate before switching
    state.file = file;
    state.isSample = isSample;
    if (reset) {
      state.picks.clear();
      state.pickSessions.clear();
      state.confirmation = null;
    }
  }

  {
    const all = await listTripFiles();
    const initial = opts.file ? { file: path.resolve(opts.file), isSample: false } : all[0];
    await setTrip(initial.file, { isSample: initial.isSample });
  }

  const sourceLabel = () => (state.isSample ? 'sample data' : path.relative(process.cwd(), state.file));
  const currentTrip = () => loadTrip(state.file);
  const picksObj = () => Object.fromEntries(state.picks);

  /** Amount to charge: total of priced picks, else the banner's best total. Always computed server-side. */
  async function amountDue() {
    let total = 0;
    let priced = 0;
    for (const p of state.picks.values()) if (p.price != null) { total += Number(p.price); priced++; }
    if (priced) return total;
    const trip = await currentTrip();
    return bestTotal(trip.results || []).total;
  }

  async function openPick(trip, result) {
    if (!opts.open) return { opened: false, note: 'webcmd disabled with --no-open' };
    const profile = result.profile || trip.profile || 'travel-agent';
    const key = `${result.category}:${result.platformId}`;
    try {
      await ensureProfile(profile);
      let sessionId = state.pickSessions.get(key);
      if (!sessionId) {
        sessionId = await createSession(profile, `travel-${path.basename(state.file, '.json')}-pick-${result.category}-${result.platformId}`);
        state.pickSessions.set(key, sessionId);
      }
      const nav = await browserRun(profile, sessionId, gotoScript(result.url), { timeoutSec: 40 });
      if (nav?.error) throw new Error(nav.error);
      return { opened: true, sessionId, profile, note: `Tab opened via webcmd — session ${sessionId}.` };
    } catch (err) {
      console.warn(`[choose] webcmd could not open ${result.platform}: ${err.message}`);
      return { opened: false, note: 'webcmd unavailable' };
    }
  }

  /** Runs a search and switches the site to its output. Shared by the page and WhatsApp. */
  function runSearch(intent, extra = {}) {
    // runner.start throws synchronously if a search is already running / no engine.
    const running = runner.start(intent, { mode: search.mode, ...extra });
    return running.then(async (job) => {
      await setTrip(job.file, { isSample: false });
      console.log(`[search] done → now serving ${path.relative(process.cwd(), job.file)}`);
      return job;
    });
  }

  // ---- Razorpay helpers shared by the page, callback, webhook and WhatsApp ----
  async function settlePayment({ paymentId, orderId, amount, details, via }) {
    let payment = null;
    try {
      payment = await rzp.fetchPayment(paymentId);
      if (payment.status === 'authorized') {
        payment = await rzp.capturePayment(paymentId, payment.amount, payment.currency);
      }
    } catch (err) {
      console.warn(`[razorpay] could not fetch/capture ${paymentId}: ${err.message}`);
      payment = { id: paymentId, order_id: orderId, status: 'captured' };
    }
    const confirmation = rzp.buildConfirmation({
      payment,
      orderId,
      amount: amount ?? (payment.amount ? payment.amount / 100 : 0),
      currency: payment.currency || 'INR',
      details,
      picks: picksObj(),
      via,
    });
    state.confirmation = confirmation;
    console.log(`[razorpay] ${confirmation.test ? 'TEST ' : ''}payment ${paymentId} ${confirmation.status} — ${confirmation.method}`);
    return confirmation;
  }

  const bot = createWhatsAppBot({
    links,
    search: async (intent) => {
      if (search.mode) {
        const job = await runSearch(intent);
        return { trip: await loadTrip(job.file), live: true };
      }
      return { trip: await currentTrip(), live: false };
    },
    // Mirror the chat's picks/confirmation into the web pages' state so the
    // summary page on the projector follows what happens on the phone.
    onPick: (category, pick) => state.picks.set(category, pick),
    onConfirm: (c) => {
      state.confirmation = c;
    },
    payments: payments.enabled
      ? {
          test: payments.test,
          createLink: async ({ from, amount, description, customer, referenceId }) => {
            const link = await rzp.createPaymentLink({
              amount,
              description,
              customer,
              referenceId,
              callbackUrl: `${baseUrl}/payments/razorpay/callback`,
              notes: { channel: 'whatsapp', wa_id: from },
            });
            state.paymentLinks.set(link.id, { from, amount, createdAt: Date.now(), referenceId });
            return link;
          },
          checkLink: async (linkId) => {
            const link = await rzp.fetchPaymentLink(linkId);
            if (link.status !== 'paid') return { paid: false, status: link.status };
            const paymentId = link.payments?.[0]?.payment_id;
            const meta = state.paymentLinks.get(linkId) || {};
            const confirmation = await settlePayment({ paymentId, orderId: null, amount: meta.amount ?? link.amount / 100, details: {}, via: 'Payment Link' });
            return { paid: true, confirmation };
          },
        }
      : null,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      // ------------------------------------------------------------ pages ----
      if (req.method === 'GET' && url.pathname === '/') {
        const wanted = url.searchParams.get('trip');
        if (wanted) {
          const match = (await listTripFiles()).find((t) => t.name === wanted);
          if (match && match.file !== state.file) await setTrip(match.file, { isSample: match.isSample });
        }
        const trip = await currentTrip(); // re-read each time so a re-run of the agent shows up on refresh
        return html(
          res,
          200,
          renderComparisonPage(trip, {
            mode: 'server',
            sourceLabel: sourceLabel(),
            trips: (await listTripFiles()).map((t) => ({ name: t.name, isSample: t.isSample, current: t.file === state.file })),
            search: { available: Boolean(search.mode), mode: search.mode, job: runner.snapshot() },
          }),
        );
      }
      if (req.method === 'GET' && url.pathname === '/checkout') {
        const trip = await currentTrip();
        return html(res, 200, renderCheckoutPage(trip, { mode: 'server', picks: picksObj(), voice: voiceConfig(), payments: { provider: payments.enabled ? 'razorpay' : 'dummy', keyId: payments.keyId, test: payments.test } }));
      }
      if (req.method === 'GET' && url.pathname === '/summary') {
        const trip = await currentTrip();
        return html(res, 200, renderSummaryPage(trip, { mode: 'server', picks: picksObj(), confirmation: state.confirmation }));
      }

      // ------------------------------------------------------- trip files ----
      if (req.method === 'GET' && url.pathname === '/api/trip') return json(res, 200, await currentTrip());
      if (req.method === 'GET' && url.pathname === '/api/trips') {
        return json(res, 200, { trips: (await listTripFiles()).map((t) => ({ name: t.name, isSample: t.isSample, current: t.file === state.file })) });
      }
      if (req.method === 'POST' && url.pathname === '/api/trips/select') {
        const { name } = await readBody(req);
        const match = (await listTripFiles()).find((t) => t.name === name);
        if (!match) return json(res, 404, { ok: false, error: `No trip file named ${name}` });
        await setTrip(match.file, { isSample: match.isSample });
        return json(res, 200, { ok: true, name });
      }

      // ----------------------------------------------------------- search ----
      if (req.method === 'GET' && url.pathname === '/api/search/status') {
        return json(res, 200, { available: Boolean(search.mode), mode: search.mode, engines: search, job: runner.snapshot() });
      }
      if (req.method === 'POST' && url.pathname === '/api/search/stop') {
        return json(res, 200, { ok: true, stopped: runner.stop() });
      }
      if (req.method === 'POST' && url.pathname === '/api/search') {
        if (!search.mode) return json(res, 503, { ok: false, error: 'No search engine on this machine — install webcmd (and the claude CLI for the adaptive agent), or run the agent from the CLI and refresh.' });
        const body = await readBody(req);
        let intent = null;
        if (body.text) intent = await parseTripMessage(str(body.text, 500));
        if (!intent && body.destination) {
          intent = {
            raw: str(body.text, 500) || undefined,
            origin: str(body.origin, 60) || null,
            destination: str(body.destination, 60),
            startDate: str(body.startDate, 10) || null,
            endDate: str(body.endDate, 10) || null,
            budget: Number(body.budget) > 0 ? Number(body.budget) : null,
            currency: 'INR',
            travelers: Number(body.travelers) >= 1 ? Math.min(20, Number(body.travelers)) : 1,
            preferences: [],
          };
        }
        if (!intent) return json(res, 400, { ok: false, error: 'Could not find a destination — fill in "To" or describe the trip with "to <City>".' });
        try {
          const wanted = body.mode === 'script' || body.mode === 'claude' ? body.mode : undefined;
          if (wanted && !search[wanted]) return json(res, 400, { ok: false, error: `The ${wanted} engine is not available on this machine` });
          runSearch(intent, wanted ? { mode: wanted } : {}).catch((err) => console.error('[search] failed:', err.message));
        } catch (err) {
          return json(res, 409, { ok: false, error: err.message });
        }
        return json(res, 202, { ok: true, intent, job: runner.snapshot() });
      }

      // ------------------------------------------------------------ picks ----
      if (req.method === 'GET' && url.pathname === '/api/picks') return json(res, 200, { picks: picksObj(), amount: await amountDue() });
      if (req.method === 'POST' && url.pathname === '/api/choose') {
        const { category, platformId } = await readBody(req);
        const trip = await currentTrip();
        const result = (trip.results || []).find((r) => r.category === category && r.platformId === platformId);
        if (!result) return json(res, 404, { ok: false, error: `No result for ${category}/${platformId}` });
        if (!result.url) return json(res, 400, { ok: false, error: `${result.platform} has no URL to open` });
        const outcome = await openPick(trip, result);
        state.picks.set(category, {
          platformId,
          platform: result.platform,
          url: result.url,
          price: result.pick?.price ?? null,
          currency: result.pick?.currency || 'INR',
          sessionId: outcome.sessionId || null,
          chosenAt: new Date().toISOString(),
        });
        console.log(`[choose] ${category} → ${result.platform} (${outcome.opened ? 'opened via webcmd' : 'client opens URL'})`);
        return json(res, 200, { ok: true, opened: outcome.opened, url: result.url, note: outcome.note, sessionId: outcome.sessionId || null });
      }
      if (req.method === 'POST' && url.pathname === '/api/picks/clear') {
        state.picks.clear();
        return json(res, 200, { ok: true });
      }

      // ---------------------------------------------------- dummy payment ----
      if (req.method === 'POST' && url.pathname === '/api/confirm') {
        const body = await readBody(req);
        // Keep only the summary fields the summary page needs — never card/UPI details.
        state.confirmation = {
          provider: 'dummy',
          dummy: true,
          test: false,
          paymentId: str(body.paymentId, 40),
          orderId: str(body.orderId, 40),
          amount: Number(body.amount) || 0,
          currency: str(body.currency, 3) || 'INR',
          method: str(body.method, 80),
          status: 'simulated',
          traveler: str(body.traveler, 80),
          email: str(body.email, 120),
          phone: str(body.phone, 20),
          travelers: Number(body.travelers) || 1,
          destination: str(body.destination, 60),
          startDate: str(body.startDate, 10),
          endDate: str(body.endDate, 10),
          notes: str(body.notes, 500),
          picks: picksObj(),
          confirmedAt: new Date().toISOString(),
        };
        console.log(`[confirm] dummy payment ${state.confirmation.paymentId} for ${state.confirmation.traveler || 'traveler'}`);
        return json(res, 200, { ok: true, confirmation: state.confirmation });
      }
      if (req.method === 'GET' && url.pathname === '/api/confirm') return json(res, 200, { confirmation: state.confirmation });

      // ---------------------------------------------------------- razorpay ----
      if (url.pathname.startsWith('/api/razorpay/') && !payments.enabled) {
        return json(res, 503, { ok: false, error: 'Razorpay not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env (see PAYMENTS.md)' });
      }
      if (req.method === 'POST' && url.pathname === '/api/razorpay/order') {
        const body = await readBody(req);
        const details = {
          traveler: str(body.name, 80), email: str(body.email, 120), phone: str(body.phone, 20),
          travelers: Number(body.travelers) || 1, destination: str(body.destination, 60),
          startDate: str(body.startDate, 10), endDate: str(body.endDate, 10), notes: str(body.notes, 500),
        };
        const amount = await amountDue();
        const trip = await currentTrip();
        const order = await rzp.createOrder({
          amount,
          receipt: `trip-${Date.now()}`,
          notes: { destination: trip.intent?.destination || '', traveler: details.traveler, picks: Object.keys(picksObj()).join(',') || 'none' },
        });
        state.orders.set(order.id, { amount, details, createdAt: Date.now() });
        console.log(`[razorpay] order ${order.id} for ₹${amount} (${payments.test ? 'test mode' : 'LIVE'})`);
        return json(res, 200, {
          ok: true,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          keyId: payments.keyId,
          test: payments.test,
          prefill: { name: details.traveler, email: details.email, contact: details.phone },
          description: `Travel Concierge — ${trip.intent?.destination || 'trip'}`,
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/razorpay/verify') {
        const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = await readBody(req);
        if (!rzp.verifyCheckoutSignature({ orderId, paymentId, signature })) {
          console.warn(`[razorpay] BAD signature for ${orderId}/${paymentId}`);
          return json(res, 400, { ok: false, error: 'Payment signature did not verify' });
        }
        const order = state.orders.get(orderId);
        if (!order) return json(res, 404, { ok: false, error: 'Unknown order — was the server restarted between order and payment?' });
        const confirmation = await settlePayment({ paymentId, orderId, amount: order.amount, details: order.details, via: 'Checkout' });
        return json(res, 200, { ok: true, confirmation });
      }
      if (req.method === 'POST' && url.pathname === '/webhooks/razorpay') {
        const raw = await readRaw(req, { maxBytes: 1024 * 1024 });
        if (!rzp.verifyWebhookSignature(raw, req.headers['x-razorpay-signature'])) {
          res.writeHead(401);
          return res.end('bad signature');
        }
        res.writeHead(200);
        res.end('ok');
        const event = JSON.parse(raw.toString('utf8'));
        console.log(`[razorpay] webhook ${event.event}`);
        if (event.event === 'payment_link.paid') {
          const link = event.payload?.payment_link?.entity;
          const payment = event.payload?.payment?.entity;
          const meta = link && state.paymentLinks.get(link.id);
          if (meta && payment) {
            const confirmation = await settlePayment({ paymentId: payment.id, orderId: null, amount: meta.amount, details: {}, via: 'Payment Link' });
            bot.paymentCompleted(meta.from, confirmation).catch((err) => console.error('[whatsapp] could not notify payment:', err.message));
          }
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/payments/razorpay/callback') {
        // Razorpay redirects the payer here after a Payment Link (WhatsApp flow) is paid.
        const q = url.searchParams;
        const ok = rzp.verifyPaymentLinkSignature({
          linkId: q.get('razorpay_payment_link_id'),
          referenceId: q.get('razorpay_payment_link_reference_id'),
          status: q.get('razorpay_payment_link_status'),
          paymentId: q.get('razorpay_payment_id'),
          signature: q.get('razorpay_signature'),
        });
        let body;
        if (ok && q.get('razorpay_payment_link_status') === 'paid') {
          const meta = state.paymentLinks.get(q.get('razorpay_payment_link_id')) || {};
          const confirmation = await settlePayment({ paymentId: q.get('razorpay_payment_id'), orderId: null, amount: meta.amount, details: {}, via: 'Payment Link' });
          if (meta.from) bot.paymentCompleted(meta.from, confirmation).catch((err) => console.error('[whatsapp] could not notify payment:', err.message));
          body = `<div class="confirm"><div class="row between"><h2>Payment received${confirmation.test ? ' (test mode)' : ''}</h2><span class="badge ok">${confirmation.test ? 'Razorpay test' : 'Paid'}</span></div>
            <dl class="kv"><dt>Payment id</dt><dd>${esc(confirmation.paymentId)}</dd><dt>Amount</dt><dd>₹${esc(confirmation.amount.toLocaleString('en-IN'))}</dd><dt>Method</dt><dd>${esc(confirmation.method)}</dd></dl>
            <p class="small muted">You can go back to WhatsApp — the confirmation is on its way there too.</p></div>`;
        } else {
          body = `<div class="notice">This payment could not be verified${ok ? ` (status: ${esc(q.get('razorpay_payment_link_status') || 'unknown')})` : ' — signature mismatch'}. Nothing was recorded.</div>`;
        }
        return html(res, 200, renderPage({ title: 'Payment', body: `<h1>Razorpay payment</h1>${body}`, activeNav: 'checkout' }));
      }

      // ------------------------------------------------------ voice agent ----
      // Keys stay on this server; the browser only ever talks to these routes.
      if (req.method === 'GET' && url.pathname === '/api/voice/config') return json(res, 200, voiceConfig());
      if (req.method === 'POST' && url.pathname === '/api/voice/stt') {
        const audio = await readRaw(req);
        const mime = (req.headers['content-type'] || 'audio/webm').split(';')[0];
        const transcript = await transcribe(audio, mime);
        console.log(`[voice] stt (${voiceConfig().stt}): "${transcript}"`);
        return json(res, 200, { transcript });
      }
      if (req.method === 'POST' && url.pathname === '/api/voice/tts') {
        const { text } = await readBody(req);
        if (!text || String(text).length > 1000) return json(res, 400, { ok: false, error: 'text required (max 1000 chars)' });
        const { audio, mime } = await synthesize(String(text));
        res.writeHead(200, { 'content-type': mime, 'content-length': audio.length, 'cache-control': 'no-store' });
        return res.end(audio);
      }
      if (req.method === 'POST' && url.pathname === '/api/voice/interpret') {
        const { fieldId, question, transcript, context } = await readBody(req);
        if (!fieldId || !transcript) return json(res, 400, { ok: false, error: 'fieldId and transcript required' });
        const result = await interpret({ fieldId, question, transcript, context });
        console.log(`[voice] interpret ${fieldId}: "${transcript}" -> ${JSON.stringify(result.value)}`);
        return json(res, 200, result);
      }

      // --------------------------------------------------------- whatsapp ----
      if (url.pathname === '/webhooks/whatsapp') {
        if (!whatsapp.enabled) return json(res, 503, { ok: false, error: 'WhatsApp not configured — set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN in .env' });
        if (req.method === 'GET') return bot.verify(url, res);
        if (req.method === 'POST') return bot.receive(await readRaw(req, { maxBytes: 2 * 1024 * 1024 }), req.headers, res);
      }

      return json(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      console.error(`[${req.method} ${url.pathname}]`, err);
      if (!res.headersSent) return json(res, 500, { ok: false, error: err.message });
    }
  });

  server.listen(opts.port, '127.0.0.1', () => {
    const rel = (f) => path.relative(process.cwd(), f);
    console.log(`Travel Concierge website`);
    console.log(`  Trip file: ${rel(state.file)}${state.isSample ? ' (bundled sample — run a search to replace it)' : ''}`);
    console.log(`  Search from the site: ${search.mode ? `${search.mode} (${search.claude ? 'claude+webcmd' : 'webcmd script'})` : 'unavailable — install webcmd' + (opts.open ? '' : ' / remove --no-open')}`);
    console.log(`  Picks open via: ${opts.open ? 'webcmd (falls back to your browser)' : 'your browser (--no-open)'}`);
    console.log(`  Payments: ${payments.enabled ? `Razorpay ${payments.test ? 'TEST mode' : 'LIVE mode'} (${payments.keyId}, webhook secret ${payments.webhookSecret ? 'set' : 'not set'})` : 'dummy widget — set RAZORPAY_KEY_ID/SECRET in .env (see PAYMENTS.md)'}`);
    console.log(`  Voice agent: browser Web Speech${voice.cloud ? ` + cloud (stt ${voice.stt || '-'}, tts ${voice.tts || '-'}, llm ${voice.llm || '-'})` : ' only — no cloud keys in ' + rel(ENV_FILE) + ' (see VOICE.md)'}`);
    console.log(`  WhatsApp: ${whatsapp.enabled ? `webhook at ${baseUrl}/webhooks/whatsapp (number id ${whatsapp.phoneNumberId}, signature check ${whatsapp.signatureCheck ? 'on' : 'OFF'}, search ${search.mode ? `live (${search.mode})` : 'snapshot from trip file'}, payment ${payments.enabled ? 'Razorpay link' : 'simulated'})` : 'off — set WHATSAPP_* in .env (see WHATSAPP.md)'}`);
    if (envInfo.loaded && envInfo.keys.length) console.log(`  Loaded ${envInfo.keys.length} variable(s) from ${rel(ENV_FILE)}`);
    console.log(`  Compare page: http://127.0.0.1:${opts.port}/${opts.launch ? ' (opening in your browser…)' : ''}`);
    if (opts.launch) openInBrowser(`http://127.0.0.1:${opts.port}/`);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
