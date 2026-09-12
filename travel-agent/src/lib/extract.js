// Heuristic, DOM-agnostic extraction. We deliberately do NOT hardcode CSS
// selectors for any of the target sites — those change often and could not
// be verified live in this pass (see README "Confidence levels"). Instead we
// take whatever readable text `browser snapshot --snapshot-mode read`
// returns, flatten it to lines, and look for currency-amount patterns. This
// is noisier than a tuned selector but keeps working when a site's markup
// shifts, and it's honest about being a first pass — refine with real
// selectors once someone can drive an actual browser against the live site.

const PRICE_RE = /(₹|Rs\.?|INR|\$)\s?([\d][\d,]{1,8})(?:\.\d{1,2})?/i;

const NEGATIVE_SIGNALS = [
  'page not found',
  '404',
  'access denied',
  'captcha',
  'or a robot', // catches both "are you a robot" and Skyscanner's actual
  // wording "are you a person or a robot" — confirmed live 2026-09-12 that
  // the exact-phrase check alone missed this and let a bot-check page
  // through as if it were real content.
  'verify you are human',
  'unusual traffic',
  'no results found',
  'something went wrong',
  'service unavailable',
];

/** True if the given text smells like an error/blank/blocked page. */
export function looksLikeDeadEnd(text) {
  if (!text) return true;
  const lower = String(text).toLowerCase();
  if (lower.trim().length < 40) return true;
  return NEGATIVE_SIGNALS.some((signal) => lower.includes(signal));
}

/**
 * `browser snapshot`'s fields (e.g. `tree`) are each one big multi-line
 * string, not one string per visual line — confirmed live 2026-09-12, where
 * skipping this step made every "line" the whole page and every match's
 * "title" collapse to the page's first 140 characters regardless of where
 * the price actually was. Always run flattenStrings() through this before
 * extractPriceCandidates/extractTextShortlist.
 */
export function splitToLines(strings) {
  const out = [];
  for (const value of strings) {
    for (const line of String(value ?? '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

/**
 * Scans an array of text lines (pass them through splitToLines() first) for
 * currency amounts and pairs each with nearby text as a title guess. Returns
 * up to `limit` candidates sorted by ascending price (cheapest first).
 */
export function extractPriceCandidates(lines, { limit = 5 } = {}) {
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    if (!line) continue;
    const match = line.match(PRICE_RE);
    if (!match) continue;

    const amount = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let title = line.replace(PRICE_RE, '').trim();
    if (title.length < 3) {
      title = String(lines[i - 1] ?? lines[i + 1] ?? '').trim();
    }

    const symbol = match[1];
    const currency = symbol === '$' ? 'USD' : 'INR';

    candidates.push({
      title: (title || 'Untitled result').slice(0, 140),
      price: amount,
      currency,
      rawLine: line.slice(0, 200),
    });
  }

  const seen = new Set();
  const deduped = [];
  for (const candidate of candidates.sort((a, b) => a.price - b.price)) {
    const key = `${candidate.price}-${candidate.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

/** Pulls up to `limit` non-trivial, deduplicated lines — used for the
 * places-to-explore shortlist, where we want short text snippets rather
 * than prices. */
export function extractTextShortlist(lines, { limit = 8, minLength = 8, maxLength = 160 } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const line = String(raw ?? '').trim();
    if (line.length < minLength || line.length > maxLength) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}
