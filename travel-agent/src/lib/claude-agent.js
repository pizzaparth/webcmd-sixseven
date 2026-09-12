// Spawns the `claude` CLI (Claude Code) in non-interactive print mode so
// Claude AI itself drives webcmd — reading live pages, deciding what to
// click/type, adapting to CAPTCHAs or layout changes — instead of any fixed
// script. Uses whatever `claude` auth is already configured on the machine
// (no separate ANTHROPIC_API_KEY needed).
//
// Uses --output-format stream-json so progress prints live as it happens
// (tool calls, assistant text) instead of the terminal sitting silent for
// the whole run — confirmed live 2026-09-12 that plain -p text mode prints
// nothing until the very end, which reads as "hung" on a multi-platform run
// that can genuinely take several minutes.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

function truncate(str, max = 100) {
  const s = typeof str === 'string' ? str : JSON.stringify(str);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Best-effort pretty-print of one `stream-json` event. Never throws. */
function printStreamEvent(event) {
  try {
    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text?.trim()) {
          console.log(block.text.trim());
        } else if (block.type === 'tool_use') {
          const input = block.input?.command || block.input?.prompt || block.input;
          console.log(`  → ${block.name}${input ? `: ${truncate(input, 120)}` : ''}`);
        }
      }
    } else if (event.type === 'result') {
      const cost = event.total_cost_usd != null ? `$${event.total_cost_usd.toFixed(3)}` : 'unknown cost';
      const turns = event.num_turns != null ? `${event.num_turns} turns` : '';
      console.log(`\n[done — ${cost}${turns ? `, ${turns}` : ''}]`);
    }
    // system/user/other event types: intentionally quiet, to keep this readable.
  } catch {
    // Never let a parsing hiccup break the run.
  }
}

/**
 * @param {string} prompt
 * @param {{cwd: string, model?: string, maxBudgetUsd?: number, permissionMode?: string}} opts
 * `permissionMode: 'bypassPermissions'` is required for this to run
 * unattended — there's no human present to answer tool-permission prompts.
 * `maxBudgetUsd` bounds spend on a run that's browsing several real sites;
 * default of 6 is sized for the full flights+trains+cabs+hotels+places run
 * (2 was too tight — confirmed live, a full run hit "Exceeded USD budget (2)"
 * before finishing). Raise it further with `--max-budget-usd` if needed.
 */
export function runClaudeAgent(
  prompt,
  { cwd, model, maxBudgetUsd = 6, permissionMode = 'bypassPermissions' } = {},
) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--permission-mode', permissionMode,
      '--max-budget-usd', String(maxBudgetUsd),
      '--output-format', 'stream-json',
      '--verbose',
    ];
    if (model) args.push('--model', model);

    const child = spawn(CLAUDE_BIN, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        printStreamEvent(JSON.parse(line));
      } catch {
        // Not JSON (shouldn't happen with stream-json, but don't lose output).
        console.log(line);
      }
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      rl.close();
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `claude exited with code ${code}${signal ? ` (signal ${signal})` : ''}. ` +
              `If this was "Exceeded USD budget (${maxBudgetUsd})", re-run with a higher ` +
              `--max-budget-usd (e.g. --max-budget-usd 10), or --skip some categories.`,
          ),
        );
      }
    });
  });
}
