import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderComparisonPage, groupByCategory, cheapest, bestTotal, formatPrice } from '../web/compare.js';
import { renderCheckoutPage } from '../web/checkout.js';
import { renderSummaryPage } from '../web/summary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = JSON.parse(readFileSync(path.resolve(__dirname, '../web/fixtures/sample-trip.json'), 'utf8'));

const priced = (category, platformId, price) => ({
  category,
  platformId,
  platform: platformId,
  url: `https://example.com/${platformId}`,
  confidence: 'MEDIUM',
  pick: price == null ? null : { title: platformId, price, currency: 'INR' },
  candidates: [],
  error: null,
});

test('groupByCategory returns flights, trains, cabs, hotels in display order', () => {
  const groups = groupByCategory([priced('hotels', 'a', 1), priced('flights', 'b', 2), priced('cabs', 'c', 3)]);
  assert.deepEqual(groups.map(([c]) => c), ['flights', 'cabs', 'hotels']);
});

test('cheapest picks the lowest price and ignores unpriced results', () => {
  const rows = [priced('hotels', 'mmt', 7800), priced('hotels', 'goibibo', null), priced('hotels', 'x', 5200)];
  assert.equal(cheapest(rows).platformId, 'x');
  assert.equal(cheapest([priced('hotels', 'goibibo', null)]), null);
});

test('bestTotal sums the cheapest priced option per category and reports gaps', () => {
  const { total, priced: got, unpriced } = bestTotal([
    priced('flights', 'ixigo-flights', 4523),
    priced('trains', 'ixigo-trains', 385),
    priced('hotels', 'mmt', 7800),
    priced('hotels', 'goibibo', null),
    priced('cabs', 'justdial', null),
  ]);
  assert.equal(total, 4523 + 385 + 7800);
  assert.deepEqual(got.map((p) => p.category), ['flights', 'trains', 'hotels']);
  assert.deepEqual(unpriced, ['cabs']);
});

test('bestTotal is safe on an empty run', () => {
  const { total, priced: got } = bestTotal([]);
  assert.equal(total, 0);
  assert.deepEqual(got, []);
});

test('formatPrice uses the right symbol and returns null for a missing price', () => {
  assert.equal(formatPrice(4523, 'INR'), '₹4,523');
  assert.equal(formatPrice(120, 'USD'), '$120');
  assert.equal(formatPrice(null), null);
});

test('the comparison page renders a choose button per platform in the sample trip', () => {
  const html = renderComparisonPage(SAMPLE, { mode: 'server', sourceLabel: 'sample data' });
  for (const r of SAMPLE.results) {
    assert.ok(
      html.includes(`data-choose="${r.category}:${r.platformId}"`),
      `missing choose button for ${r.category}/${r.platformId}`,
    );
  }
  assert.ok(html.includes('Best total trip price'));
});

test('the comparison page escapes scraped platform text instead of injecting it as markup', () => {
  // Platform names and titles are read off live pages, so they are untrusted.
  const trip = {
    intent: { destination: 'Goa' },
    results: [{ ...priced('flights', 'x', 100), platform: '</script><img src=x onerror=alert(1)>' }],
  };
  const html = renderComparisonPage(trip, { mode: 'static' });
  assert.ok(!html.includes('<img src=x'), 'raw markup leaked into the page');
  // The inline <script> carries the same name as data; it must not be able to
  // close the script element early.
  assert.ok(!html.includes('</script><img'), 'script element can be broken out of');
  assert.ok(html.includes('&lt;/script&gt;&lt;img src=x'));
});

test('a scraped title cannot break out of the summary and checkout inline scripts', () => {
  const picks = { flights: { platform: '</script><img src=x onerror=alert(1)>', price: 100, currency: 'INR' } };
  for (const html of [
    renderSummaryPage(SAMPLE, { mode: 'server', picks }),
    renderCheckoutPage(SAMPLE, { mode: 'server', picks }),
  ]) {
    assert.ok(!html.includes('</script><img'));
  }
});

test('a platform with no URL cannot be chosen', () => {
  const trip = { intent: { destination: 'Goa' }, results: [{ ...priced('hotels', 'goibibo', null), url: null }] };
  const html = renderComparisonPage(trip, { mode: 'server' });
  assert.match(html, /<button[^>]*disabled[^>]*data-choose="hotels:goibibo"/);
});

test('every page renders from the sample trip and shares one template', () => {
  const pages = [
    renderComparisonPage(SAMPLE, { mode: 'server' }),
    renderCheckoutPage(SAMPLE, { mode: 'server' }),
    renderSummaryPage(SAMPLE, { mode: 'server' }),
  ];
  for (const html of pages) {
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('Travel <span>Concierge</span>'), 'page is missing the shared shell');
    // plan.md → Design Template: dark theme, no gradients anywhere.
    assert.ok(!/linear-gradient|radial-gradient/.test(html));
  }
});

test('the checkout page prefills the trip dates it was given', () => {
  const html = renderCheckoutPage(SAMPLE, { mode: 'server' });
  assert.ok(html.includes(`id="startDate" name="startDate" type="date" placeholder="" value="${SAMPLE.intent.startDate}"`));
});
