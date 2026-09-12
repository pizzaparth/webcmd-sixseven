// Spawns the `claude` CLI (Claude Code) in non-interactive print mode so
// Claude AI itself drives webcmd — reading live pages, deciding what to
// click/type, adapting to CAPTCHAs or layout changes — instead of any fixed
// script. Uses whatever `claude` auth is already configured on the machine
// (no separate ANTHROPIC_API_KEY needed).

import { spawn } from 'node:child_process';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

/**
 * @param {string} prompt
 * @param {{cwd: string, model?: string, maxBudgetUsd?: number, permissionMode?: string}} opts
 * `permissionMode: 'bypassPermissions'` is required for this to run
 * unattended — there's no human present to answer tool-permission prompts.
 * `maxBudgetUsd` bounds spend on a run that's browsing several real sites.
 */
export function runClaudeAgent(
  prompt,
  { cwd, model, maxBudgetUsd = 2, permissionMode = 'bypassPermissions' } = {},
) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--permission-mode', permissionMode,
      '--max-budget-usd', String(maxBudgetUsd),
    ];
    if (model) args.push('--model', model);

    // stdio: 'inherit' — Claude's output streams straight to the user's
    // terminal, the same as running `claude` by hand.
    const child = spawn(CLAUDE_BIN, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`claude exited with code ${code}${signal ? ` (signal ${signal})` : ''}`));
    });
  });
}
