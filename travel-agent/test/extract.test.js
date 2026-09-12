import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPriceCandidates,
  extractTextShortlist,
  looksLikeDeadEnd,
  splitToLines,
} from '../src/lib/extract.js';

test('splitToLines expands snapshot blobs into one entry per visual line', () => {
  // `browser snapshot` returns a few big multi-line strings, not one string
  // per line — without this every "line" is the whole page.
  assert.deepEqual(splitToLines(['a\nb\r\n\n  c  ', 'd']), ['a', 'b', 'c', 'd']);
});

test('extractPriceCandidates pairs a price with the text beside it', () => {
  const [top] = extractPriceCandidates(['₹4,523 IndiGo 06:10 - 07:25 Non-stop']);
  assert.equal(top.price, 4523);
  assert.equal(top.currency, 'INR');
  assert.match(top.title, /IndiGo/);
});

test('extractPriceCandidates sorts cheapest first and dedupes', () => {
  const out = extractPriceCandidates(['₹5,210 Air India', '₹4,523 IndiGo', '₹4,523 IndiGo']);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((c) => c.price), [4523, 5210]);
});

test('extractPriceCandidates recognizes Rs/INR/$ and tags currency', () => {
  assert.equal(extractPriceCandidates(['Rs. 1,500 airport cab'])[0].price, 1500);
  assert.equal(extractPriceCandidates(['INR 900 sleeper'])[0].price, 900);
  assert.equal(extractPriceCandidates(['$120 a night'])[0].currency, 'USD');
});

test('extractPriceCandidates falls back to a neighbouring line for the title', () => {
  const [top] = extractPriceCandidates(['Taj Resort, Candolim', '₹7,800']);
  assert.equal(top.price, 7800);
  assert.equal(top.title, 'Taj Resort, Candolim');
});

test('extractPriceCandidates ignores lines with no usable amount', () => {
  assert.deepEqual(extractPriceCandidates(['Sold out', 'Prices from ₹0', 'free cancellation']), []);
});

test('extractPriceCandidates honours the limit', () => {
  const lines = ['₹100 a', '₹200 b', '₹300 c', '₹400 d'];
  assert.equal(extractPriceCandidates(lines, { limit: 2 }).length, 2);
});

test('looksLikeDeadEnd catches blocked, empty and error pages', () => {
  assert.equal(looksLikeDeadEnd(''), true);
  assert.equal(looksLikeDeadEnd('short'), true);
  // Skyscanner's real bot-check wording — an exact-phrase check missed this.
  assert.equal(looksLikeDeadEnd('Are you a person or a robot? Please confirm to continue browsing.'), true);
  assert.equal(looksLikeDeadEnd('Our systems have detected unusual traffic from your network.'), true);
  assert.equal(looksLikeDeadEnd('₹4,523 IndiGo 06:10 - 07:25 Non-stop, and eleven other flights today'), false);
});

test('extractTextShortlist dedupes and drops too-short and too-long lines', () => {
  const out = extractTextShortlist(['Baga Beach', 'Baga Beach', 'ok', 'x'.repeat(500), 'Dudhsagar Falls'], {
    limit: 5,
  });
  assert.deepEqual(out, ['Baga Beach', 'Dudhsagar Falls']);
});
