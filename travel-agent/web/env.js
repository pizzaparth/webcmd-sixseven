// Minimal .env loader (no dotenv dependency). Reads travel-agent/.env once
// and fills any variable that isn't already set in the real environment —
// real env always wins, so `DEEPGRAM_API_KEY=... node web/server.js` still
// overrides the file. Lines: KEY=value, `#` comments, optional quotes.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ENV_FILE = path.resolve(__dirname, '../.env');

export function loadEnv(file = ENV_FILE) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { loaded: false, keys: [] };
  }
  const keys = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key || process.env[key] !== undefined) continue;
    if (!value) continue; // blank placeholder in .env.example-style files
    process.env[key] = value;
    keys.push(key);
  }
  return { loaded: true, keys };
}
