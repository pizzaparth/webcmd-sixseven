import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, parseFreeText } from '../src/lib/args.js';

test('parseFreeText pulls route, dates, budget and travelers out of a description', () => {
  const guess = parseFreeText('Trip to Goa from Mumbai, 12 Oct to 15 Oct, budget 30000 for 2 travelers');
  assert.equal(guess.destination, 'Goa');
  assert.equal(guess.origin, 'Mumbai');
  assert.equal(guess.startDate, '12 Oct');
  assert.equal(guess.endDate, '15 Oct');
  assert.equal(guess.budget, 30000);
  assert.equal(guess.travelers, 2);
});

test('parseFreeText does not mistake a month for an origin city', () => {
  // "from 12 October" is a date range, not a departure city.
  const guess = parseFreeText('Trip to Jaipur from October, 2 people');
  assert.equal(guess.origin, null);
});

test('parseCliArgs normalizes loose dates to YYYY-MM-DD', () => {
  // The checkout page binds these to <input type="date">, which silently
  // blanks anything that is not ISO. A bare "12 Oct" resolves against the
  // current year, so assert the shape rather than a fixed year.
  const { intent } = parseCliArgs(['Trip to Goa from Mumbai, 12 Oct to 15 Oct']);
  assert.match(intent.startDate, /^\d{4}-10-12$/);
  assert.match(intent.endDate, /^\d{4}-10-15$/);
});

test('parseCliArgs accepts several date input formats', () => {
  const { intent } = parseCliArgs(['--to', 'Goa', '--start-date', '12/10/2026', '--end-date', '2026-10-15']);
  assert.equal(intent.startDate, '2026-10-12');
  assert.equal(intent.endDate, '2026-10-15');
});

test('parseCliArgs passes an unparseable date through rather than dropping it', () => {
  const { intent } = parseCliArgs(['--to', 'Goa', '--start-date', 'sometime next spring']);
  assert.equal(intent.startDate, 'sometime next spring');
});

test('explicit flags win over the free-text guess', () => {
  const { intent } = parseCliArgs(['Trip to Goa from Mumbai', '--to', 'Jaipur', '--travelers', '4']);
  assert.equal(intent.destination, 'Jaipur');
  assert.equal(intent.travelers, 4);
});

test('parseCliArgs defaults currency and travelers', () => {
  const { intent } = parseCliArgs(['--to', 'Goa']);
  assert.equal(intent.currency, 'INR');
  assert.equal(intent.travelers, 1);
  assert.equal(intent.budget, null);
});

test('parseCliArgs requires a destination', () => {
  assert.throws(() => parseCliArgs(['--from', 'Mumbai']), /No destination/);
});

test('parseCliArgs splits --skip into a lowercase list', () => {
  const { skip } = parseCliArgs(['--to', 'Goa', '--skip', 'Cabs, hotels']);
  assert.deepEqual(skip, ['cabs', 'hotels']);
});

test('profile is null when --profile is absent so the caller can resolve it', () => {
  assert.equal(parseCliArgs(['--to', 'Goa']).profile, null);
  assert.equal(parseCliArgs(['--to', 'Goa', '--profile', 'travel-agent']).profile, 'travel-agent');
});
