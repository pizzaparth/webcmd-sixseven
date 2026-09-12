// Target-site definitions: which real platform we search per category, and
// a best-effort deep-link URL builder for each. See README.md → "Confidence
// levels" — this file is the single place to look when a site's markup or
// URL scheme has moved and a candidate needs fixing.
//
// Every provider also carries a plain `homepage`, which the orchestrator
// falls back to if no candidate URL is available or every candidate looks
// like a dead end (see extract.js#looksLikeDeadEnd). That guarantees a tab
// still opens for that platform even when the deep link isn't right yet —
// it just won't have a pre-filled search.

import { parseDateFlexible, formatYYMMDD, formatDDMMYYYY } from './dates.js';

// Bounded, easily-extended lookup for Skyscanner's IATA-code deep links.
// Add more cities as your demo needs them.
const IATA_BY_CITY = {
  mumbai: 'BOM',
  delhi: 'DEL',
  'new delhi': 'DEL',
  bangalore: 'BLR',
  bengaluru: 'BLR',
  goa: 'GOI',
  chennai: 'MAA',
  kolkata: 'CCU',
  hyderabad: 'HYD',
  pune: 'PNQ',
  jaipur: 'JAI',
  kochi: 'COK',
  cochin: 'COK',
  ahmedabad: 'AMD',
  lucknow: 'LKO',
  chandigarh: 'IXC',
  guwahati: 'GAU',
  bhopal: 'BHO',
  indore: 'IDR',
  srinagar: 'SXR',
  varanasi: 'VNS',
  amritsar: 'ATQ',
  dubai: 'DXB',
  singapore: 'SIN',
  london: 'LHR',
  'new york': 'JFK',
  bangkok: 'BKK',
};

function toIata(city) {
  if (!city) return null;
  return IATA_BY_CITY[String(city).trim().toLowerCase()] ?? null;
}

function slugCity(city) {
  return String(city || '').trim().replace(/\s+/g, '-');
}

function cityTitleCase(city) {
  return String(city || '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Returns { flights: [...providers], trains: [...], cabs: [...], hotels: [...] }
 * for the given TripIntent (see types.js). Each provider:
 *   { id, name, category, homepage, confidence, candidates: string[] }
 * `confidence` is HIGH | MEDIUM | LOW — see README for what that means.
 */
export function getProviders(intent) {
  const start = parseDateFlexible(intent.startDate) || new Date(Date.now() + 14 * 86400000);

  const originIata = toIata(intent.origin);
  const destIata = toIata(intent.destination);

  return {
    flights: [
      {
        id: 'skyscanner',
        name: 'Skyscanner',
        category: 'flights',
        homepage: 'https://www.skyscanner.net/',
        // LOW: verified live (2026-09-12) — this deep link redirects straight
        // to Skyscanner's bot-check interstitial ("Are you a person or a
        // robot?"), every time it was tried. The homepage itself loads fine
        // and exposes a real, fillable search form (origin/destination
        // comboboxes, date picker, search button) via an act-mode snapshot —
        // an AI agent should search from there instead of using this URL.
        confidence: 'LOW',
        candidates:
          originIata && destIata
            ? [
                `https://www.skyscanner.net/transport/flights/${originIata.toLowerCase()}/${destIata.toLowerCase()}/${formatYYMMDD(start)}/?adultsv2=${Math.max(1, intent.travelers)}&cabinclass=economy`,
              ]
            : [],
      },
    ],
    trains: [
      {
        id: 'ixigo-trains',
        name: 'ixigo Trains',
        category: 'trains',
        homepage: 'https://www.ixigo.com/trains',
        // MEDIUM: commonly-seen ixigo train search shape (City/City/DDMMYYYY).
        // No CAPTCHA/login wall on search, unlike IRCTC directly.
        confidence: 'MEDIUM',
        candidates:
          intent.origin && intent.destination
            ? [
                `https://www.ixigo.com/search/result/train/${slugCity(cityTitleCase(intent.origin))}/${slugCity(cityTitleCase(intent.destination))}/${formatDDMMYYYY(start)}`,
              ]
            : [],
      },
    ],
    cabs: [
      {
        id: 'justdial',
        name: 'JustDial',
        category: 'cabs',
        homepage: 'https://www.justdial.com/',
        // LOW: JustDial's city/category slug and internal category code are
        // not reliably known without checking a live page — verify/replace
        // this during testing.
        confidence: 'LOW',
        candidates: intent.destination
          ? [`https://www.justdial.com/${slugCity(cityTitleCase(intent.destination))}/Cab-Services`]
          : [],
      },
    ],
    hotels: [
      {
        id: 'makemytrip',
        name: 'MakeMyTrip',
        category: 'hotels',
        homepage: 'https://www.makemytrip.com/hotels/',
        // LOW: MMT's hotel search deep link needs an internal city/"locusId"
        // code we don't have a table for. Opens the homepage; searching by
        // typing into the destination box is a TODO for live testing.
        confidence: 'LOW',
        candidates: [],
      },
      {
        id: 'goibibo',
        name: 'Goibibo',
        category: 'hotels',
        homepage: 'https://www.goibibo.com/hotels/',
        // LOW: same limitation as MakeMyTrip above.
        confidence: 'LOW',
        candidates: [],
      },
    ],
  };
}

/** Search phrases used for the plain-Google places-to-explore step. */
export function getPlacesQueries(intent) {
  const city = intent.destination || 'the destination';
  return [`things to do in ${city}`, `best places to visit in ${city}`];
}

export function googleSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
