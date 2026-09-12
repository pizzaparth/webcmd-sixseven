// Documentation-only JSDoc typedefs — no runtime code. Import these in your
// editor for autocomplete; the actual shapes are produced by orchestrator.js
// and store.js. This is also the reference for Adarsh's website side when
// reading the JSON file written to travel-agent/output/.

/**
 * @typedef {Object} TripIntent
 * @property {string} [raw] Original free-text description, if one was given.
 * @property {string|null} origin
 * @property {string} destination
 * @property {string|null} startDate
 * @property {string|null} endDate
 * @property {number|null} budget
 * @property {string} currency
 * @property {number} travelers
 * @property {string[]} preferences
 */

/**
 * @typedef {Object} ComparisonCandidate
 * @property {string} title
 * @property {number} price
 * @property {string} currency
 * @property {string} rawLine Original text the price/title were parsed from.
 */

/**
 * @typedef {Object} CategoryResult
 * @property {string} category "flights" | "trains" | "cabs" | "hotels"
 * @property {string} platform Display name, e.g. "Skyscanner".
 * @property {string} platformId Slug, e.g. "skyscanner".
 * @property {string} url The URL actually opened.
 * @property {string} homepage
 * @property {boolean} usedFallbackHomepage True if no deep link worked and the homepage was opened instead.
 * @property {'HIGH'|'MEDIUM'|'LOW'} confidence How sure the deep-link URL builder is (see sites.js).
 * @property {string} profile webcmd Profile used.
 * @property {string} sessionId webcmd Session id — pass this + profile to reopen/inspect the tab.
 * @property {ComparisonCandidate[]} candidates All price/title candidates found on the page.
 * @property {ComparisonCandidate|null} pick Cheapest candidate — the one shown as "the price" for this platform.
 * @property {string|null} error Set if this category/platform failed; other fields are best-effort in that case.
 * @property {string} fetchedAt ISO timestamp.
 */

/**
 * @typedef {Object} PlacesResult
 * @property {string} query
 * @property {string} url
 * @property {string[]} shortlist
 * @property {string} profile
 * @property {string} sessionId
 * @property {string|null} error
 */

/**
 * @typedef {Object} OpenTabRef
 * @property {string} profile
 * @property {string} sessionId
 * @property {string} category
 * @property {string} platform
 */

/**
 * @typedef {Object} TripData
 * @property {string} schemaVersion
 * @property {string} generatedAt ISO timestamp.
 * @property {TripIntent} intent
 * @property {string} profile
 * @property {CategoryResult[]} results
 * @property {PlacesResult} places
 * @property {OpenTabRef[]} openTabs Every session/tab left open by this run.
 */

export const SCHEMA_VERSION = '1.0.0';
