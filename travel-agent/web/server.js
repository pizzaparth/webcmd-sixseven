#!/usr/bin/env node
// Local website server for the hackathon flow. Zero npm dependencies.
//
//   node web/server.js                       # newest output/*.json (or bundled sample)
//   node web/server.js output/goa-123.json   # a specific trip file
//   node web/server.js --no-open             # don't call webcmd; open picks in this browser
//   node web/server.js --port 4173
//
// Serves the price comparison page at http://localhost:<port>/ and, when the
// user clicks "Choose <platform>", opens a tab on that exact result through
// webcmd (a fresh Session per pick, one page each — see src/lib/scripts.js
// for why Sessions hold one page). If webcmd isn't available the response
// carries the URL instead and the page opens it in the user's own browser.
// Picks are kept in memory only, for the summary page later; nothing is
// written to disk.

import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderComparisonPage } from './compare.js';
import { renderCheckoutPage } from './checkout.js';
import { renderSummaryPage } from './summary.js';
import { loadEnv, ENV_FILE } from './env.js';
import { voiceConfig, transcribe, synthesize, interpret } from './voice/providers.js';
import { createSession, browserRun, ensureProfile, checkWebcmdVersion } from '../src/lib/webcmd.js';
import { gotoScript } from '../src/lib/scripts.js';
import { runTrip } from '../src/lib/orchestrator.js';
import { buildTripData, writeTripData } from '../src/lib/store.js';
import { createWhatsAppBot, whatsappConfig } from './whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../output');
const SAMPLE_FILE = path.join(__dirname, 'fixtures/sample-trip.json');

function parseArgs(argv) {
  const opts = { file: null, port: 4173, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--no-open') opts.open = false;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node web/server.js [trip.json] [--port N] [--no-open]');
      process.exit(0);
    } else if (!a.startsWith('-')) opts.file = a;
  }
  return opts;
}

/** Newest output/*.json, else the bundled sample. */
async function pickTripFile(explicit) {
  if (explicit) return { file: path.resolve(explicit), isSample: false };
  let newest = null;
  try {
    for (const name of await readdir(OUTPUT_DIR)) {
      if (!name.endsWith('.json')) continue;
      const full = path.join(OUTPUT_DIR, name);
      const { mtimeMs } = await stat(full);
      if (!newest || mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs };
    }
  } catch {
    // no output dir yet — fall through to the sample
  }
  if (newest) return { file: newest.file, isSample: false };
  return { file: SAMPLE_FILE, isSample: true };
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


async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envInfo = loadEnv();
  const voice = voiceConfig();
  const whatsapp = whatsappConfig();
  const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || `http://127.0.0.1:${opts.port}`;
  const links = { compare: `${baseUrl}/`, checkout: `${baseUrl}/checkout`, summary: `${baseUrl}/summary` };
  const { file, isSample } = await pickTripFile(opts.file);
  const tripSlug = path.basename(file, '.json');
  const sourceLabel = isSample ? 'sample data' : path.relative(process.cwd(), file);

  // In-memory state for the run: the user's picks and the Sessions we opened
  // for them. Discarded when the server exits.
  const picks = new Map(); // category -> { platformId, platform, url, price, currency, sessionId, chosenAt }
  const pickSessions = new Map(); // "category:platformId" -> sessionId
  let confirmation = null; // the dummy checkout's fake confirmation summary (no card/UPI data)

  async function openPick(trip, result) {
    if (!opts.open) return { opened: false, note: 'webcmd disabled with --no-open' };
    const profile = result.profile || trip.profile || 'travel-agent';
    const key = `${result.category}:${result.platformId}`;
    try {
      await ensureProfile(profile);
      let sessionId = pickSessions.get(key);
      if (!sessionId) {
        sessionId = await createSession(profile, `travel-${tripSlug}-pick-${result.category}-${result.platformId}`);
        pickSessions.set(key, sessionId);
      }
      const nav = await browserRun(profile, sessionId, gotoScript(result.url), { timeoutSec: 40 });
      if (nav?.error) throw new Error(nav.error);
      return { opened: true, sessionId, profile, note: `Tab opened via webcmd — session ${sessionId}.` };
    } catch (err) {
      console.warn(`[choose] webcmd could not open ${result.platform}: ${err.message}`);
      return { opened: false, note: 'webcmd unavailable' };
    }
  }

  // WhatsApp users describe their own trip. If webcmd is usable we run the
  // real agent for them (minutes); otherwise they get the loaded trip file
  // as a snapshot so the demo still flows.
  let webcmdOk = false;
  if (opts.open) {
    try {
      await checkWebcmdVersion();
      webcmdOk = true;
    } catch {
      webcmdOk = false;
    }
  }
  const bot = createWhatsAppBot({
    links,
    search: async (intent) => {
      if (webcmdOk) {
        const profile = process.env.WEBCMD_PROFILE || 'travel-agent';
        await ensureProfile(profile);
        const { tripSlug: slug, results, places, openTabs } = await runTrip({ intent, profile, tripName: `wa-${intent.destination}-${Date.now()}` });
        const trip = buildTripData({ intent, profile, results, places, openTabs });
        const written = await writeTripData(trip, { tripSlug: slug });
        console.log(`[whatsapp] live search written to ${written}`);
        return { trip, live: true };
      }
      return { trip: await loadTrip(file), live: false };
    },
    // Mirror the chat's picks/confirmation into the web pages' state so the
    // summary page on the projector follows what happens on the phone.
    onPick: (category, pick) => picks.set(category, pick),
    onConfirm: (c) => {
      confirmation = c;
    },
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const trip = await loadTrip(file); // re-read each time so a re-run of the agent shows up on refresh
        return html(res, 200, renderComparisonPage(trip, { mode: 'server', sourceLabel }));
      }
      if (req.method === 'GET' && url.pathname === '/api/trip') {
        return json(res, 200, await loadTrip(file));
      }
      if (req.method === 'GET' && url.pathname === '/api/picks') {
        return json(res, 200, { picks: Object.fromEntries(picks) });
      }
      if (req.method === 'POST' && url.pathname === '/api/choose') {
        const { category, platformId } = await readBody(req);
        const trip = await loadTrip(file);
        const result = (trip.results || []).find((r) => r.category === category && r.platformId === platformId);
        if (!result) return json(res, 404, { ok: false, error: `No result for ${category}/${platformId}` });
        if (!result.url) return json(res, 400, { ok: false, error: `${result.platform} has no URL to open` });

        const outcome = await openPick(trip, result);
        picks.set(category, {
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
      // ---- WhatsApp Cloud API webhook (see web/whatsapp.js, WHATSAPP.md) ----
      if (url.pathname === '/webhooks/whatsapp') {
        if (!whatsapp.enabled) return json(res, 503, { ok: false, error: 'WhatsApp not configured — set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN in .env' });
        if (req.method === 'GET') return bot.verify(url, res);
        if (req.method === 'POST') return bot.receive(await readRaw(req, { maxBytes: 2 * 1024 * 1024 }), req.headers, res);
      }
      if (req.method === 'GET' && url.pathname === '/checkout') {
        const trip = await loadTrip(file);
        return html(res, 200, renderCheckoutPage(trip, { mode: 'server', picks: Object.fromEntries(picks), voice: voiceConfig() }));
      }
      if (req.method === 'POST' && url.pathname === '/api/confirm') {
        const body = await readBody(req);
        // Keep only the summary fields the summary page needs — never card/UPI details.
        confirmation = {
          paymentId: String(body.paymentId || ''),
          orderId: String(body.orderId || ''),
          amount: Number(body.amount) || 0,
          currency: String(body.currency || 'INR'),
          method: String(body.method || ''),
          traveler: String(body.traveler || ''),
          travelers: Number(body.travelers) || 1,
          destination: String(body.destination || ''),
          startDate: String(body.startDate || ''),
          endDate: String(body.endDate || ''),
          confirmedAt: new Date().toISOString(),
          dummy: true,
        };
        console.log(`[confirm] dummy payment ${confirmation.paymentId} for ${confirmation.traveler || 'traveler'}`);
        return json(res, 200, { ok: true, confirmation });
      }
      if (req.method === 'GET' && url.pathname === '/api/confirm') return json(res, 200, { confirmation });

      // ---- voice agent: cloud engines (see web/voice/providers.js, VOICE.md) ----
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
      if (req.method === 'GET' && url.pathname === '/summary') {
        const trip = await loadTrip(file);
        return html(res, 200, renderSummaryPage(trip, { mode: 'server', picks: Object.fromEntries(picks), confirmation }));
      }
      return json(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      console.error(`[${req.method} ${url.pathname}]`, err);
      return json(res, 500, { ok: false, error: err.message });
    }
  });

  server.listen(opts.port, '127.0.0.1', () => {
    console.log(`Travel Concierge website`);
    console.log(`  Trip file: ${file}${isSample ? ' (bundled sample — run the agent to replace it)' : ''}`);
    console.log(`  Picks open via: ${opts.open ? 'webcmd (falls back to your browser)' : 'your browser (--no-open)'}`);
    console.log(`  Voice agent: browser Web Speech${voice.cloud ? ` + cloud (stt ${voice.stt || '-'}, tts ${voice.tts || '-'}, llm ${voice.llm || '-'})` : ' only — no cloud keys in ' + path.relative(process.cwd(), ENV_FILE) + ' (see VOICE.md)'}`);
    if (envInfo.loaded && envInfo.keys.length) console.log(`  Loaded ${envInfo.keys.length} variable(s) from ${path.relative(process.cwd(), ENV_FILE)}`);
    console.log(`  WhatsApp: ${whatsapp.enabled ? `webhook at ${baseUrl}/webhooks/whatsapp (number id ${whatsapp.phoneNumberId}, signature check ${whatsapp.signatureCheck ? 'on' : 'OFF'}, search ${webcmdOk ? 'live via webcmd' : 'snapshot from trip file'})` : 'off — set WHATSAPP_* in .env (see WHATSAPP.md)'}`);
    console.log(`  Compare page: http://127.0.0.1:${opts.port}/`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
