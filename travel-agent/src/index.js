#!/usr/bin/env node
// Travel Concierge Agent — entry point.
//
// Parses a trip description, then for each category (flights/trains/cabs/
// hotels) uses webcmd to search a real site and open a tab on the best
// result it can find, plus a plain Google search for places to explore.
// Logs a comparison table to the CLI and writes the collected data to
// travel-agent/output/<trip>.json for the website side to consume.
//
// See README.md for setup, usage, and the output schema.

import { parseCliArgs } from './lib/args.js';
import { runTrip } from './lib/orchestrator.js';
import { printComparisonTables, printPlaces, printOpenTabsSummary } from './lib/report.js';
import { buildTripData, writeTripData } from './lib/store.js';
import { checkWebcmdVersion, runDoctor } from './lib/webcmd.js';
import { resolveProfile, PERSONAL_PROFILE, GUEST_PROFILE } from './lib/profile.js';

async function preflight() {
  try {
    await checkWebcmdVersion();
  } catch (err) {
    console.error(`\nCould not run the "webcmd" CLI. Is it installed and on PATH?\n${err.message}\n`);
    console.error('Install it with: npm install -g @agentrhq/webcmd  (see repo README "Quick Start"), then run `webcmd doctor`.');
    process.exit(1);
  }

  try {
    const doctor = await runDoctor();
    const failed =
      doctor && (doctor.ok === false || (typeof doctor.status === 'string' && doctor.status.toLowerCase() !== 'ok'));
    if (failed) {
      console.warn('`webcmd doctor` reported an issue — browser commands below may fail:');
      console.warn(JSON.stringify(doctor, null, 2));
      console.warn('Fix it and re-run, or continue anyway.\n');
    }
  } catch (err) {
    console.warn(`Could not run "webcmd doctor" (continuing anyway): ${err.message}`);
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`\nError: ${err.message}\n`);
    process.exit(1);
    return;
  }

  const { intent, profile: profileFlag, tripName, outDir, skip, dryRun } = parsed;

  console.log('Travel Concierge Agent');
  console.log(`  Destination: ${intent.destination}`);
  if (intent.origin) console.log(`  Origin: ${intent.origin}`);
  if (intent.startDate) console.log(`  Dates: ${intent.startDate}${intent.endDate ? ` -> ${intent.endDate}` : ''}`);
  if (intent.budget != null) console.log(`  Budget: ${intent.currency} ${intent.budget}`);
  console.log(`  Travelers: ${intent.travelers}`);

  let profile;
  if (dryRun) {
    // Dry run makes zero webcmd calls, including `profile list` — so the
    // resolved-at-runtime choice is only described here, not looked up.
    profile = profileFlag || GUEST_PROFILE;
    console.log(
      `  Profile: ${profileFlag || `${PERSONAL_PROFILE} if it exists, else guest "${GUEST_PROFILE}" (resolved at runtime, not looked up in a dry run)`}`,
    );
  } else {
    await preflight();
    const resolved = await resolveProfile(profileFlag);
    profile = resolved.profile;
    const sourceNote =
      resolved.source === 'personal'
        ? ' (your account)'
        : resolved.source === 'guest-fallback'
          ? ' (guest — see README to set up your account)'
          : '';
    console.log(`  Profile: ${profile}${sourceNote}`);
  }
  if (skip.length) console.log(`  Skipping: ${skip.join(', ')}`);
  console.log(dryRun ? '  Mode: DRY RUN (no webcmd commands will run)\n' : '');

  const { tripSlug, results, places, openTabs } = await runTrip({ intent, profile, tripName, skip, dryRun });

  printComparisonTables(results);
  printPlaces(places);

  let outputPath = null;
  if (!dryRun) {
    const tripData = buildTripData({ intent, profile, results, places, openTabs });
    outputPath = await writeTripData(tripData, { outDir, tripSlug });
  }

  printOpenTabsSummary(openTabs, outputPath);

  console.log(
    dryRun
      ? '\nDry run complete — nothing was opened, nothing was written.'
      : '\nDone. Every session/tab above was intentionally left open.',
  );
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
