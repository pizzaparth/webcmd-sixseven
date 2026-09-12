// Which webcmd Profile (browser identity) to use for a run. A webcmd
// Profile is NOT your regular, already-signed-in desktop Chrome — it's an
// isolated Webcmd-managed Chrome identity that starts blank and only
// carries login state after someone completes an interactive sign-in
// inside it once (see README "Using your own Chrome identity"). That's why
// every site sees a fresh run as a guest by default.

import { runWebcmd, ensureProfile } from './webcmd.js';

/** Created automatically, never signed into anything — every site sees a guest. */
export const GUEST_PROFILE = 'travel-agent';

/**
 * Meant to represent parthnotparth@gmail.com. webcmd profile aliases can't
 * contain "@" (letters, numbers, ".", "_", "-" only), hence the substitution.
 * Using it only carries real sign-in state after the one-time interactive
 * setup in README "Using your own Chrome identity" has actually been done —
 * creating the alias alone (which resolveProfile does) does not sign it in.
 */
export const PERSONAL_PROFILE = 'parthnotparth.gmail.com';

export async function listProfiles() {
  try {
    const result = await runWebcmd(['profile', 'list', '-f', 'json'], { timeoutMs: 15_000 });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/**
 * @param {string|null} explicitProfile - an explicit `--profile` flag, if given.
 * @returns {Promise<{profile: string, source: 'explicit'|'personal'|'guest-fallback'}>}
 *
 * An explicit `--profile` always wins (and gets created if missing, same as
 * before). Otherwise: use PERSONAL_PROFILE if it already exists (someone has
 * run the one-time sign-in setup for it), else fall back to GUEST_PROFILE.
 */
export async function resolveProfile(explicitProfile) {
  if (explicitProfile) {
    await ensureProfile(explicitProfile);
    return { profile: explicitProfile, source: 'explicit' };
  }

  const profiles = await listProfiles();
  const hasPersonal = profiles.some((p) => p.contextId === PERSONAL_PROFILE || p.alias === PERSONAL_PROFILE);
  if (hasPersonal) {
    return { profile: PERSONAL_PROFILE, source: 'personal' };
  }

  await ensureProfile(GUEST_PROFILE);
  return { profile: GUEST_PROFILE, source: 'guest-fallback' };
}
