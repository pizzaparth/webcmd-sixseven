// Runs one platform's search for one category (flights/trains/cabs/hotels):
// create a Session, try each candidate deep-link URL in confidence order,
// fall back to the platform's homepage if none of them look right, then
// extract price/title candidates from whatever rendered. The Session/tab is
// never closed — see orchestrator.js / README "Retained sessions".

import { createSession, browserRun, browserSnapshot, flattenStrings } from './webcmd.js';
import { extractPriceCandidates, looksLikeDeadEnd, splitToLines } from './extract.js';
import { gotoScript } from './scripts.js';

/**
 * @param {{profile: string, tripSlug: string, provider: object, dryRun: boolean}} args
 * @returns {Promise<import('./types.js').CategoryResult>}
 */
export async function runCategory({ profile, tripSlug, provider, dryRun }) {
  const category = provider.category;
  const sessionName = `travel-${tripSlug}-${category}-${provider.id}`;
  const fetchedAt = new Date().toISOString();
  const candidateUrls = provider.candidates;

  if (dryRun) {
    return {
      category,
      platform: provider.name,
      platformId: provider.id,
      url: candidateUrls[0] || provider.homepage,
      homepage: provider.homepage,
      usedFallbackHomepage: candidateUrls.length === 0,
      confidence: provider.confidence,
      profile,
      sessionId: `<dry-run: ${sessionName}>`,
      candidates: [],
      pick: null,
      error: null,
      fetchedAt,
      plannedUrls: [...candidateUrls, provider.homepage],
    };
  }

  let sessionId;
  try {
    sessionId = await createSession(profile, sessionName);
  } catch (err) {
    return {
      category,
      platform: provider.name,
      platformId: provider.id,
      url: null,
      homepage: provider.homepage,
      usedFallbackHomepage: false,
      confidence: provider.confidence,
      profile,
      sessionId: null,
      candidates: [],
      pick: null,
      error: `Could not create webcmd session: ${err.message}`,
      fetchedAt,
    };
  }

  const urlsToTry = candidateUrls.length ? [...candidateUrls, provider.homepage] : [provider.homepage];
  let landedUrl = null;
  let usedFallbackHomepage = candidateUrls.length === 0;
  let lastError = null;

  for (let i = 0; i < urlsToTry.length; i++) {
    const url = urlsToTry[i];
    const isLast = i === urlsToTry.length - 1;
    try {
      const nav = await browserRun(profile, sessionId, gotoScript(url), { timeoutSec: 40 });
      if (nav?.error) {
        lastError = nav.error;
        continue;
      }
      const snap = await browserSnapshot(profile, sessionId, 'read');
      const text = flattenStrings(snap).join('\n');
      if (!looksLikeDeadEnd(text) || isLast) {
        landedUrl = nav?.url || url;
        if (candidateUrls.length && i === candidateUrls.length) usedFallbackHomepage = true;
        break;
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  if (!landedUrl) {
    return {
      category,
      platform: provider.name,
      platformId: provider.id,
      url: null,
      homepage: provider.homepage,
      usedFallbackHomepage: true,
      confidence: provider.confidence,
      profile,
      sessionId,
      candidates: [],
      pick: null,
      error: lastError || 'Could not load any candidate or homepage URL.',
      fetchedAt,
    };
  }

  let candidates = [];
  let extractError = null;
  try {
    const snap = await browserSnapshot(profile, sessionId, 'read');
    candidates = extractPriceCandidates(splitToLines(flattenStrings(snap)), { limit: 5 });
  } catch (err) {
    extractError = err.message;
  }

  return {
    category,
    platform: provider.name,
    platformId: provider.id,
    url: landedUrl,
    homepage: provider.homepage,
    usedFallbackHomepage,
    confidence: provider.confidence,
    profile,
    sessionId,
    candidates,
    pick: candidates[0] || null,
    error: candidates.length
      ? null
      : extractError ||
        'No price-like text found on the page — the URL/selectors for this platform likely need tuning (see README).',
    fetchedAt,
  };
}
