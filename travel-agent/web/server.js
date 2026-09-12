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
import { createSession, browserRun, ensureProfile } from '../src/lib/webcmd.js';
import { gotoScript } from '../src/lib/scripts.js';

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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}


async function main() {
  const opts = parseArgs(process.argv.slice(2));
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
      if (req.method === 'GET' && url.pathname === '/checkout') {
        const trip = await loadTrip(file);
        return html(res, 200, renderCheckoutPage(trip, { mode: 'server', picks: Object.fromEntries(picks) }));
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
    console.log(`  Compare page: http://127.0.0.1:${opts.port}/`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
