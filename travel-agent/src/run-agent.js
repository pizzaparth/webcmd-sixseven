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
import { resolveProfile, PERSONAL_PROFILE } from './lib/profile.js';

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
    // Dry run makes zero webcmd calls — resolution is deterministic (no
    // detection needed, see profile.js), so it's safe to show directly.
    const profile = profileFlag || PERSONAL_PROFILE;
    console.log(`  Profile: ${profile}${profileFlag ? '' : ' (account profile — guest if cookie-import setup was never run on this machine)'}`);
    console.log('');
    const prompt = buildAgentPrompt({ intent, profile, tripSlug, outputPath: outputPathForPrompt, skip });
    console.log('--- DRY RUN: prompt that would be sent to `claude -p` (nothing was called) ---\n');
    console.log(prompt);
    return;
  }

  const { profile, source } = await resolveProfile(profileFlag);
  console.log(`  Profile: ${profile}${source === 'personal' ? ' (account profile)' : ''}`);
  console.log('');

  const prompt = buildAgentPrompt({ intent, profile, tripSlug, outputPath: outputPathForPrompt, skip });

  const effectiveBudget = maxBudgetUsd ?? 6;
  console.log(`Handing off to \`claude\` (budget: $${effectiveBudget}) — Claude AI drives webcmd from here, progress streams below...\n`);
  await runClaudeAgent(prompt, {
    cwd: REPO_ROOT,
    model: model || undefined,
    maxBudgetUsd: effectiveBudget,
  });
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
