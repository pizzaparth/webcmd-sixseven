// CLI flag parsing (Node's built-in util.parseArgs — no dependency) plus a
// best-effort heuristic parser for a plain-language trip description.
// Flags always win over anything guessed from free text.

import { parseArgs } from 'node:util';

const OPTION_SPEC = {
  from: { type: 'string' },
  origin: { type: 'string' },
  to: { type: 'string' },
  destination: { type: 'string' },
  'start-date': { type: 'string' },
  'end-date': { type: 'string' },
  budget: { type: 'string' },
  currency: { type: 'string' },
  travelers: { type: 'string' },
  profile: { type: 'string' },
  'trip-name': { type: 'string' },
  'out-dir': { type: 'string' },
  skip: { type: 'string' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const MONTH_WORD = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i;

/** Best-effort extraction from a free-text trip description. Never throws. */
export function parseFreeText(text) {
  const guess = {
    destination: null,
    origin: null,
    startDate: null,
    endDate: null,
    budget: null,
    travelers: null,
  };
  if (!text) return guess;

  let m = text.match(/\bto\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/);
  if (m) guess.destination = m[1].trim();

  m = text.match(/\bfrom\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/);
  if (m && !MONTH_WORD.test(m[1])) guess.origin = m[1].trim();

  const dateToken = '\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Za-z]+(?:\\s+\\d{4})?';
  const range = text.match(new RegExp(`(${dateToken})\\s*(?:to|-|–)\\s*(${dateToken})`));
  if (range) {
    guess.startDate = range[1];
    guess.endDate = range[2];
  } else {
    const single = text.match(new RegExp(`\\b(${dateToken})\\b`));
    if (single) guess.startDate = single[1];
  }

  m = text.match(/budget\s*(?:of|:)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+)/i);
  if (m) guess.budget = Number(m[1].replace(/,/g, ''));

  m = text.match(/(\d+)\s*(?:travell?ers?|people|persons|pax|adults)/i);
  if (m) guess.travelers = Number(m[1]);

  return guess;
}

export function printHelp() {
  console.log(`Travel Concierge Agent — usage:

  node src/index.js [free-text trip description] [options]

Example:
  node src/index.js "Trip to Goa from Mumbai, 12 Oct to 15 Oct, budget 30000 for 2 travelers"
  node src/index.js --to Goa --from Mumbai --start-date 2026-10-12 --end-date 2026-10-15 --budget 30000 --travelers 2

Options:
  --from, --origin <city>       Origin city.
  --to, --destination <city>    Destination city. Required (flag or free text).
  --start-date <date>           Trip start date. Accepts YYYY-MM-DD, DD/MM/YYYY, "12 Oct", etc.
  --end-date <date>             Trip end date.
  --budget <amount>             Numeric budget (no currency symbol needed).
  --currency <code>             Default: INR.
  --travelers <n>                Default: 1.
  --profile <name>              webcmd Profile to use. Default: travel-agent.
  --trip-name <slug>             Used to name Sessions and the output file. Default: derived from destination + timestamp.
  --out-dir <path>               Where to write the trip JSON. Default: ./output relative to this script.
  --skip <list>                 Comma-separated categories to skip, e.g. "cabs,hotels".
  --dry-run                     Print the plan (URLs, session names) without calling webcmd at all.
  -h, --help                    Show this help.
`);
}

/** Parses process.argv and free text into one TripIntent-shaped object plus run options. */
export function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTION_SPEC,
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const freeText = positionals.join(' ').trim();
  const guess = parseFreeText(freeText);

  const destination = values.to || values.destination || guess.destination;
  const origin = values.from || values.origin || guess.origin || null;
  const startDate = values['start-date'] || guess.startDate || null;
  const endDate = values['end-date'] || guess.endDate || null;
  const budget = values.budget != null ? Number(values.budget) : guess.budget;
  const travelers = values.travelers != null ? Number(values.travelers) : (guess.travelers || 1);

  if (!destination) {
    printHelp();
    throw new Error(
      'No destination given. Pass --to/--destination <city> or include "to <City>" in the free-text description.',
    );
  }

  const intent = {
    raw: freeText || undefined,
    origin,
    destination,
    startDate,
    endDate,
    budget: Number.isFinite(budget) ? budget : null,
    currency: values.currency || 'INR',
    travelers: Number.isFinite(travelers) && travelers > 0 ? travelers : 1,
    preferences: [],
  };

  const skip = (values.skip || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    intent,
    profile: values.profile || 'travel-agent',
    tripName: values['trip-name'] || null,
    outDir: values['out-dir'] || null,
    skip,
    dryRun: Boolean(values['dry-run']),
  };
}
