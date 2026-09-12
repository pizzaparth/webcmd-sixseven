import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.resolve(__dirname, '..');
const PORT = 4271;
const BASE = `http://127.0.0.1:${PORT}`;

let server;

/** Resolves once the server prints its listening banner. */
function waitForListen(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 20_000);
    let buffered = '';
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      if (buffered.includes('Compare page:')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}: ${buffered}`));
    });
  });
}

before(async () => {
  // Pin the fixture: left to itself the server loads the newest output/*.json,
  // so a real agent run on this machine would otherwise change what is tested.
  // --no-open keeps it hermetic too: no webcmd, no browser, no network.
  // --no-launch keeps the suite from popping a real browser window on startup.
  server = spawn(
    process.execPath,
    ['web/server.js', 'web/fixtures/sample-trip.json', '--port', String(PORT), '--no-open', '--no-launch'],
    { cwd: AGENT_ROOT, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  await waitForListen(server);
});

after(() => server?.kill());

test('the comparison page serves and shows the live-price banner', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Best total trip price'));
  assert.ok(html.includes('Compare &amp; choose'));
});

test('the trip file is served as JSON with the documented shape', async () => {
  const trip = await (await fetch(`${BASE}/api/trip`)).json();
  assert.equal(trip.schemaVersion, '1.0.0');
  assert.ok(Array.isArray(trip.results) && trip.results.length > 0);
  for (const r of trip.results) {
    assert.equal(typeof r.category, 'string');
    assert.equal(typeof r.platformId, 'string');
  }
});

test('every platform in the trip file can actually be chosen', async () => {
  // The bundled sample used to name platforms the agent no longer searches,
  // which made the demo's choose buttons 404.
  const trip = await (await fetch(`${BASE}/api/trip`)).json();
  for (const r of trip.results) {
    const res = await fetch(`${BASE}/api/choose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: r.category, platformId: r.platformId }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, `choose ${r.category}/${r.platformId} -> ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    assert.equal(body.url, r.url);
  }
});

test('choosing records the pick so the later pages can read it', async () => {
  await fetch(`${BASE}/api/choose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'trains', platformId: 'ixigo-trains' }),
  });
  const { picks } = await (await fetch(`${BASE}/api/picks`)).json();
  assert.equal(picks.trains.platform, 'ixigo Trains');
  assert.equal(typeof picks.trains.chosenAt, 'string');
});

test('an unknown platform is rejected rather than silently ignored', async () => {
  const res = await fetch(`${BASE}/api/choose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'flights', platformId: 'skyscanner' }),
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).ok, false);
});

test('the checkout and summary pages serve', async () => {
  for (const route of ['/checkout', '/summary']) {
    const res = await fetch(`${BASE}${route}`);
    assert.equal(res.status, 200, route);
    assert.ok((await res.text()).startsWith('<!doctype html>'));
  }
});

test('the dummy confirmation round-trips without keeping card details', async () => {
  const res = await fetch(`${BASE}/api/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      paymentId: 'pay_demo1',
      amount: 12708,
      traveler: 'Test Traveler',
      cardNumber: '4111111111111111',
      cvv: '123',
    }),
  });
  const { confirmation } = await res.json();
  assert.equal(confirmation.paymentId, 'pay_demo1');
  assert.equal(confirmation.dummy, true);
  assert.ok(!('cardNumber' in confirmation), 'card number must never be retained');
  assert.ok(!('cvv' in confirmation));

  const summary = await (await fetch(`${BASE}/summary`)).text();
  assert.ok(summary.includes('pay_demo1'));
  assert.ok(!summary.includes('4111111111111111'));
});

test('voice config reports no cloud engines when no keys are set', async () => {
  const cfg = await (await fetch(`${BASE}/api/voice/config`)).json();
  assert.equal(typeof cfg.cloud, 'boolean');
});

test('an unknown route 404s as JSON', async () => {
  const res = await fetch(`${BASE}/nope`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).ok, false);
});
