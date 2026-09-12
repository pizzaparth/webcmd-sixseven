#!/usr/bin/env node
// Travel Concierge Agent — the intended way to run this (see README.md
// "Two ways to run this"): hands one prompt to the `claude` CLI and lets
// Claude AI drive webcmd adaptively — reading live pages, deciding what to
// click/type, adapting to CAPTCHAs or layout changes — instead of running
// src/index.js's fixed script.
//
// Usage:
//   node src/run-agent.js "Trip to Goa from Mumbai, 12 Oct to 15 Oct, budget 30000 for 2 travelers"
//   node src/run-agent.js --to Goa --from Mumbai --start-date 2026-10-12 --budget 30000 --travelers 2
//   node src/run-agent.js --to Goa --from Mumbai --dry-run   # print the prompt, call nothing
//
// Requires:
//   - the `claude` CLI (Claude Code), already signed in — this uses your
//     existing Claude Code auth, no separate ANTHROPIC_API_KEY needed.
//   - the `webcmd-browser` skill installed (`webcmd skills add`).
//   - `webcmd` itself installed and `webcmd doctor` passing.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from './lib/args.js';
import { buildTripSlug } from './lib/orchestrator.js';
import { buildAgentPrompt } from './lib/prompt.js';
import { runClaudeAgent } from './lib/claude-agent.js';
import { resolveProfile, PERSONAL_PROFILE, GUEST_PROFILE } from './lib/profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_OUT_DIR = path.resolve(__dirname, '../output');

async function main() {
  const { intent, profile: profileFlag, tripName, outDir, skip, dryRun, model, maxBudgetUsd } = parseCliArgs(
    process.argv.slice(2),
  );

  const tripSlug = buildTripSlug(intent, tripName);
  const outputDir = outDir ? path.resolve(outDir) : DEFAULT_OUT_DIR;
  const outputPath = path.join(outputDir, `${tripSlug}.json`);
  const outputPathForPrompt = path.relative(REPO_ROOT, outputPath);

  console.log('Travel Concierge Agent (Claude-driven)');
  console.log(`  Destination: ${intent.destination}`);
  if (intent.origin) console.log(`  Origin: ${intent.origin}`);
  console.log(`  Trip slug: ${tripSlug}`);
  console.log(`  Output: ${outputPathForPrompt}`);
  if (skip.length) console.log(`  Skipping: ${skip.join(', ')}`);

  if (dryRun) {
    // Dry run makes zero webcmd calls, including `profile list` — so the
    // resolved-at-runtime choice is only described here, not looked up.
    console.log(
      `  Profile: ${profileFlag || `${PERSONAL_PROFILE} if it exists, else guest "${GUEST_PROFILE}" (resolved at runtime, not looked up in a dry run)`}`,
    );
    console.log('');
    const prompt = buildAgentPrompt({
      intent,
      profile: profileFlag || GUEST_PROFILE,
      tripSlug,
      outputPath: outputPathForPrompt,
      skip,
    });
    console.log('--- DRY RUN: prompt that would be sent to `claude -p` (nothing was called) ---\n');
    console.log(prompt);
    return;
  }

  const { profile, source } = await resolveProfile(profileFlag);
  const sourceNote =
    source === 'personal' ? ' (your account)' : source === 'guest-fallback' ? ' (guest — see README to set up your account)' : '';
  console.log(`  Profile: ${profile}${sourceNote}`);
  console.log('');

  const prompt = buildAgentPrompt({ intent, profile, tripSlug, outputPath: outputPathForPrompt, skip });

  console.log('Handing off to `claude` — Claude AI drives webcmd from here (this can take a while)...\n');
  await runClaudeAgent(prompt, {
    cwd: REPO_ROOT,
    model: model || undefined,
    maxBudgetUsd: maxBudgetUsd ?? 2,
  });
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
