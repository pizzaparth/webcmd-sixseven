// "Places to explore" step: a plain Google search, following webcmd's own
// documented fast path — try a local `web fetch` first, and only fall back
// to a real browser Session if that's blocked or requires rendering (see
// docs/cli-reference.mdx → "Direct URL Fetch").

import { createSession, browserRun, browserSnapshot, webFetch, flattenStrings } from './webcmd.js';
import { extractTextShortlist, looksLikeDeadEnd, splitToLines } from './extract.js';
import { gotoScript } from './scripts.js';
import { getPlacesQueries, googleSearchUrl } from './sites.js';

function fetchWasBlocked(fetchResult) {
  if (!fetchResult) return true;
  const code = fetchResult.code || fetchResult.error;
  if (typeof code === 'string' && /FETCH_REQUIRES_BROWSER|FETCH_BLOCKED/i.test(code)) return true;
  // Confirmed live 2026-09-12: `webcmd web fetch` on a JS-rendered Google
  // results page returns http 200 with `extractionSource: "fallback"` and a
  // short generic "if you're having trouble..." body — not an explicit
  // blocked/error code, just quietly useless. Treat both signals as blocked.
  if (fetchResult.extractionSource === 'fallback') return true;
  const text = flattenStrings(fetchResult).join('\n');
  if (/FETCH_REQUIRES_BROWSER|FETCH_BLOCKED|having trouble accessing/i.test(text)) return true;
  return false;
}

/**
 * @param {{profile: string, tripSlug: string, intent: object, dryRun: boolean}} args
 * @returns {Promise<import('./types.js').PlacesResult>}
 */
export async function runPlaces({ profile, tripSlug, intent, dryRun }) {
  const query = getPlacesQueries(intent)[0];
  const url = googleSearchUrl(query);
  const sessionName = `travel-${tripSlug}-places`;

  if (dryRun) {
    return { query, url, shortlist: [], profile, sessionId: `<dry-run: ${sessionName}>`, error: null };
  }

  const fetchResult = await webFetch(url);
  if (!fetchWasBlocked(fetchResult)) {
    const text = flattenStrings(fetchResult).join('\n');
    if (!looksLikeDeadEnd(text)) {
      const shortlist = extractTextShortlist(splitToLines(flattenStrings(fetchResult)));
      return { query, url, shortlist, profile, sessionId: null, error: null, source: 'web-fetch' };
    }
  }

  let sessionId;
  try {
    sessionId = await createSession(profile, sessionName);
    await browserRun(profile, sessionId, gotoScript(url), { timeoutSec: 30 });
    const snap = await browserSnapshot(profile, sessionId, 'read');
    const lines = splitToLines(flattenStrings(snap));
    const shortlist = extractTextShortlist(lines);
    return {
      query,
      url,
      shortlist,
      profile,
      sessionId,
      error: shortlist.length ? null : 'No readable results extracted — open the tab to check manually.',
      source: 'browser',
    };
  } catch (err) {
    return { query, url, shortlist: [], profile, sessionId: sessionId || null, error: err.message, source: 'browser' };
  }
}
