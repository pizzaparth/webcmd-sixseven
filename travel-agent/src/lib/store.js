// Writes the run's collected data to a JSON file for the website side to
// consume (Adarsh's price-comparison page reads this — see README "Output
// schema"). One file per trip run, named after the trip slug.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.resolve(__dirname, '../../output');

/** @returns {import('./types.js').TripData} */
export function buildTripData({ intent, profile, results, places, openTabs }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    intent,
    profile,
    results,
    places,
    openTabs,
  };
}

export async function writeTripData(tripData, { outDir, tripSlug } = {}) {
  const dir = outDir ? path.resolve(outDir) : DEFAULT_OUT_DIR;
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${tripSlug}.json`);
  await writeFile(filePath, JSON.stringify(tripData, null, 2), 'utf8');
  return filePath;
}
