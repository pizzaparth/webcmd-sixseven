#!/usr/bin/env node
// Writes standalone pages next to the trip JSON — no server needed.
// "Choose" buttons open the result URL directly; picks and the dummy
// confirmation pass between pages via sessionStorage.
//
//   node web/build.js output/goa-123.json   # -> output/goa-123{.html,.checkout.html,.summary.html}

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderComparisonPage } from './compare.js';
import { renderCheckoutPage } from './checkout.js';
import { renderSummaryPage } from './summary.js';

const [input] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node web/build.js <trip.json>');
  process.exit(1);
}
const trip = JSON.parse(await readFile(input, 'utf8'));
const base = input.replace(/\.json$/i, '');
const name = path.basename(base);
const links = { compare: `${name}.html`, checkout: `${name}.checkout.html`, summary: `${name}.summary.html` };

await writeFile(`${base}.html`, renderComparisonPage(trip, { mode: 'static', sourceLabel: path.basename(input), links }), 'utf8');
await writeFile(`${base}.checkout.html`, renderCheckoutPage(trip, { mode: 'static', links }), 'utf8');
await writeFile(`${base}.summary.html`, renderSummaryPage(trip, { mode: 'static', links }), 'utf8');
console.log(`Wrote ${base}.html, ${base}.checkout.html and ${base}.summary.html`);
