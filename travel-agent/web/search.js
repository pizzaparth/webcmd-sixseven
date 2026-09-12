// Runs a trip search from the website / WhatsApp by spawning the agent CLI
// as a child process — the same two paths the CLI offers:
//   claude : node src/run-agent.js  (Claude drives webcmd adaptively; needs the `claude` CLI)
//   script : node src/index.js      (deterministic webcmd script)
// Both write output/<slug>.json, which the server then switches to. One
// job at a time; progress lines are kept in memory for the page to poll.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTripSlug } from '../src/lib/orchestrator.js';
import { checkWebcmdVersion } from '../src/lib/webcmd.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(AGENT_DIR, 'output');

/** Which search engines are usable on this machine: { claude, script, mode }. */
export async function detectSearchModes() {
  let script = false;
  try {
    await checkWebcmdVersion();
    script = true;
  } catch {
    script = false;
  }
  let claude = false;
  try {
    await execFileAsync(process.env.CLAUDE_BIN || 'claude', ['--version'], { timeout: 10_000 });
    claude = script; // the Claude path drives webcmd too
  } catch {
    claude = false;
  }
  const want = (process.env.SEARCH_MODE || 'auto').toLowerCase();
  const mode = want === 'claude' ? (claude ? 'claude' : null) : want === 'script' ? (script ? 'script' : null) : claude ? 'claude' : script ? 'script' : null;
  return { claude, script, mode };
}

function intentArgs(intent) {
  const args = ['--to', intent.destination];
  if (intent.origin) args.push('--from', intent.origin);
  if (intent.startDate) args.push('--start-date', intent.startDate);
  if (intent.endDate) args.push('--end-date', intent.endDate);
  if (intent.budget != null) args.push('--budget', String(intent.budget));
  if (intent.travelers) args.push('--travelers', String(intent.travelers));
  return args;
}

export function createSearchRunner() {
  let job = null; // { id, state, mode, intent, slug, file, log: string[], startedAt, finishedAt, error }
  const waiters = [];

  function snapshot() {
    if (!job) return { state: 'idle' };
    const { id, state, mode, intent, slug, file, log, startedAt, finishedAt, error } = job; // (child handle deliberately not exposed)
    return { id, state, mode, intent, slug, file, log: log.slice(-60), startedAt, finishedAt, error };
  }

  function finish(state, error) {
    job.state = state;
    job.error = error || null;
    job.finishedAt = new Date().toISOString();
    for (const w of waiters.splice(0)) (state === 'done' ? w.resolve : w.reject)(state === 'done' ? job : new Error(error));
  }

  /**
   * Starts a search. Rejects if one is already running. Resolves with the
   * job (including `file`) when the agent process exits successfully.
   */
  function start(intent, { mode, tripName = null, skip = [] } = {}) {
    if (job && job.state === 'running') throw new Error('A search is already running — wait for it to finish');
    if (!mode) throw new Error('No search engine available: install webcmd (and optionally the claude CLI) — see README');
    const slug = buildTripSlug(intent, tripName);
    const file = path.join(OUTPUT_DIR, `${slug}.json`);
    const entry = mode === 'claude' ? 'src/run-agent.js' : 'src/index.js';
    const args = [entry, ...intentArgs(intent), '--trip-name', slug];
    if (skip.length) args.push('--skip', skip.join(','));
    job = { id: `search-${Date.now()}`, state: 'running', mode, intent, slug, file, log: [], startedAt: new Date().toISOString(), finishedAt: null, error: null };
    const line = (text) => {
      for (const l of String(text).split(/\r?\n/)) {
        if (!l.trim()) continue;
        job.log.push(l.length > 300 ? `${l.slice(0, 297)}...` : l);
        if (job.log.length > 500) job.log.shift();
        console.log(`[search] ${l}`);
      }
    };
    line(`Starting ${mode} search: node ${args.join(' ')}`);
    const child = spawn(process.execPath, args, { cwd: AGENT_DIR, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    job.child = child;
    // Don't leave an agent run (and its claude/webcmd children) behind if the server dies.
    const killChild = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };
    process.once('exit', killChild);
    child.on('exit', () => process.off('exit', killChild));
    child.stdout.on('data', line);
    child.stderr.on('data', line);
    child.on('error', (err) => finish('error', err.message));
    child.on('exit', (code, signal) => {
      if (code === 0) finish('done');
      else finish('error', `agent exited with code ${code}${signal ? ` (${signal})` : ''} — see log`);
    });
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  }

  /** Stops the running search, if any. */
  function stop() {
    if (job?.state === 'running' && job.child) {
      job.child.kill('SIGTERM');
      return true;
    }
    return false;
  }

  return { start, stop, snapshot, get current() { return job; } };
}
