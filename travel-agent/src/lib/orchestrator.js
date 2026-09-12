// Top-level run: for every category, search every configured provider (see
// sites.js), run the places-to-explore step, and collect everything that
// stayed open along the way. Never calls `session close` — retaining every
// Session/tab it opens is deliberate (see README "Retained sessions").

import { getProviders } from './sites.js';
import { runCategory } from './category.js';
import { runPlaces } from './places.js';

function slugify(str) {
  return (
    String(str)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'trip'
  );
}

export function buildTripSlug(intent, tripName) {
  if (tripName) return slugify(tripName);
  return `${slugify(intent.destination)}-${Date.now()}`;
}

/**
 * @param {{intent: object, profile: string, tripName?: string|null, skip?: string[], dryRun?: boolean}} args
 */
export async function runTrip({ intent, profile, tripName = null, skip = [], dryRun = false }) {
  const tripSlug = buildTripSlug(intent, tripName);
  const providers = getProviders(intent);
  const results = [];
  const openTabs = [];

  for (const category of Object.keys(providers)) {
    if (skip.includes(category)) continue;
    for (const provider of providers[category]) {
      const result = await runCategory({ profile, tripSlug, provider, dryRun });
      results.push(result);
      if (!dryRun && result.sessionId) {
        openTabs.push({ profile, sessionId: result.sessionId, category, platform: result.platform });
      }
    }
  }

  let places = null;
  if (!skip.includes('places')) {
    places = await runPlaces({ profile, tripSlug, intent, dryRun });
    if (!dryRun && places.sessionId) {
      openTabs.push({ profile, sessionId: places.sessionId, category: 'places', platform: 'Google Search' });
    }
  }

  return { tripSlug, results, places, openTabs };
}
