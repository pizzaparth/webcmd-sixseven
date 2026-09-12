// Which webcmd Profile (browser identity) to use for a run.
//
// A webcmd Profile is normally NOT your regular, already-signed-in desktop
// Chrome — it's an isolated Webcmd-managed Chrome identity that starts
// blank. webcmd does have a real, supported way to bridge that gap though:
// `webcmd setup --browser chrome --chrome-profile <name> --import-chrome-cookies`
// imports a real native Chrome profile's cookies into a webcmd Profile.
// Run on this machine on 2026-09-12 for the real "Default" Chrome profile
// (parthnotparth@gmail.com) — confirmed live: a fresh session under
// `--profile default` opened https://myaccount.google.com/ already signed
// in as "Parth (parthnotparth@gmail.com)", no login prompt. That import
// always lands in webcmd's own implicit **`default`** Profile (not a
// custom alias — an earlier attempt at a separate "parthnotparth.gmail.com"
// alias was a dead end, since webcmd rejects "@" in alias names and the
// import command doesn't target custom aliases anyway; that alias is
// orphaned now, harmless, and no longer used here).
//
// Real implication, not just a convenience: any run using this Profile is
// authenticated as you on whatever was signed in when the cookies were
// imported — not just Google. The prompt's "read-only, no login/checkout"
// hard rules matter more, not less, once a Profile is actually you.

import { ensureProfile } from './webcmd.js';

/** Isolated and blank on every machine — guaranteed no authenticated session, ever. */
export const GUEST_PROFILE = 'travel-agent';

/**
 * webcmd's own implicit Profile. Always exists (nothing to create), so this
 * is always the default choice unless `--profile` is given explicitly.
 * Behaves as your real, authenticated Chrome identity on a machine where
 * the cookie-import setup above has been run (this one has); on a machine
 * where it hasn't, it's simply another blank profile — same as the guest
 * one, just under webcmd's own default name instead of a custom alias.
 */
export const PERSONAL_PROFILE = 'default';

/**
 * @param {string|null} explicitProfile - an explicit `--profile` flag, if given.
 * @returns {Promise<{profile: string, source: 'explicit'|'personal'}>}
 *
 * An explicit `--profile` always wins (and gets created if missing).
 * Otherwise always resolves to PERSONAL_PROFILE ('default') — there's
 * nothing to detect: it always exists, and gracefully degrades to
 * guest-like behavior if this machine's cookie-import setup hasn't been
 * run. Pass `--profile travel-agent` explicitly to force guest behavior
 * even on a machine that has done the import.
 */
export async function resolveProfile(explicitProfile) {
  if (explicitProfile) {
    await ensureProfile(explicitProfile);
    return { profile: explicitProfile, source: 'explicit' };
  }
  return { profile: PERSONAL_PROFILE, source: 'personal' };
}
