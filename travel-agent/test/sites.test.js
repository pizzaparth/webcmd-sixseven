import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviders, getPlacesQueries, googleSearchUrl } from '../src/lib/sites.js';
import { parseDateFlexible, formatDDMMYYYY, formatISO } from '../src/lib/dates.js';

const intent = (over = {}) => ({
  origin: 'Mumbai',
  destination: 'Goa',
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  travelers: 2,
  currency: 'INR',
  ...over,
});

test('every provider has a homepage to fall back to', () => {
  const providers = getProviders(intent());
  const all = Object.values(providers).flat();
  assert.ok(all.length > 0);
  for (const p of all) {
    assert.ok(p.homepage?.startsWith('https://'), `${p.id} needs an https homepage`);
    assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(p.confidence), `${p.id} has an odd confidence`);
    assert.equal(typeof p.name, 'string');
  }
});

test('flights deep-link carries the real traveler count, not a hardcoded 1', () => {
  const [flights] = getProviders(intent({ travelers: 3 })).flights;
  assert.match(flights.candidates[0], /\/BOM\/GOI\/12102026\/3\/0\/0\/E$/);
});

test('flights traveler count is clamped to what one ixigo search accepts', () => {
  const [flights] = getProviders(intent({ travelers: 40 })).flights;
  assert.match(flights.candidates[0], /\/9\/0\/0\/E$/);
});

test('flights fall back to the homepage when a city has no IATA code', () => {
  const [flights] = getProviders(intent({ destination: 'Nowhereville' })).flights;
  assert.deepEqual(flights.candidates, []);
  assert.equal(flights.homepage, 'https://www.ixigo.com/flights');
});

test('trains deep-link uses city names and the ixigo date format', () => {
  const [trains] = getProviders(intent()).trains;
  assert.match(trains.candidates[0], /\/train\/Mumbai\/Goa\/12102026$/);
});

test('providers no longer point at Skyscanner, which bot-checks automated visits', () => {
  const all = Object.values(getProviders(intent())).flat();
  assert.ok(!all.some((p) => /skyscanner/i.test(p.id + p.homepage)));
});

test('a missing start date still produces a usable future search date', () => {
  const [flights] = getProviders(intent({ startDate: null })).flights;
  const date = flights.candidates[0].match(/\/(\d{8})\//)[1];
  const [dd, mm, yyyy] = [date.slice(0, 2), date.slice(2, 4), date.slice(4)];
  assert.ok(new Date(`${yyyy}-${mm}-${dd}`).getTime() > Date.now());
});

test('places queries name the destination and encode into a Google URL', () => {
  const [first] = getPlacesQueries(intent());
  assert.match(first, /Goa/);
  assert.equal(googleSearchUrl('things to do in Goa'), 'https://www.google.com/search?q=things%20to%20do%20in%20Goa');
});

test('date helpers round-trip the formats the URL builders need', () => {
  assert.equal(formatDDMMYYYY(parseDateFlexible('2026-10-12')), '12102026');
  assert.equal(formatISO(parseDateFlexible('12/10/2026')), '2026-10-12');
  assert.equal(formatISO(parseDateFlexible('12th October 2026')), '2026-10-12');
  assert.equal(parseDateFlexible('not a date at all'), null);
});
