// Thin wrapper around the `webcmd` CLI binary. Nothing here talks to a
// browser directly — every call shells out to `webcmd`, which owns the
// actual browser/session lifecycle. See docs/cli-reference.mdx (repo root)
// for the command surface this wraps.
//
// Deliberately zero npm dependencies: only Node built-ins, so this runs
// with nothing installed beyond Node itself and a working `webcmd`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const WEBCMD_BIN = process.env.WEBCMD_BIN || 'webcmd';

export class WebcmdError extends Error {
  constructor(message, { command, stdout, stderr, cause } = {}) {
    super(message, { cause });
    this.name = 'WebcmdError';
    this.command = command;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function tryParseJson(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some subcommands can print a leading log line before the JSON body.
    // Fall back to the last line, which is the most likely JSON payload.
    const lastLine = trimmed.split('\n').pop();
    try {
      return JSON.parse(lastLine);
    } catch {
      return trimmed;
    }
  }
}

/**
 * Run `webcmd <args...>` and parse its stdout as JSON (callers should always
 * pass `-f json`). Throws WebcmdError with stdout/stderr attached on failure.
 */
export async function runWebcmd(args, { timeoutMs = 60_000 } = {}) {
  const command = `${WEBCMD_BIN} ${args.join(' ')}`;
  try {
    const { stdout, stderr } = await execFileAsync(WEBCMD_BIN, args, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (stderr && stderr.trim()) {
      // webcmd may write diagnostics to stderr even on success; surface them
      // quietly rather than failing the call.
      console.error(`[webcmd stderr] ${stderr.trim()}`);
    }
    return tryParseJson(stdout);
  } catch (err) {
    throw new WebcmdError(
      `Command failed: ${command}\n${err.stderr || err.message}`,
      { command, stdout: err.stdout, stderr: err.stderr, cause: err },
    );
  }
}

/** Confirms the `webcmd` binary is on PATH and reachable. */
export async function checkWebcmdVersion() {
  return runWebcmd(['--version'], { timeoutMs: 15_000 });
}

/** Runs `webcmd doctor` — the documented pre-flight check before browser work. */
export async function runDoctor() {
  return runWebcmd(['doctor', '-f', 'json'], { timeoutMs: 30_000 });
}

/**
 * Ensures a Profile exists before it's used. Discovered live (2026-09-12):
 * unlike what docs/cli-reference.mdx implies about local mode lazily
 * creating Profiles, this installed version (0.8.4) requires an explicit
 * `webcmd profile create` first — `--profile <unknown-name>` fails with
 * PROFILE_NOT_FOUND. Safe to call every run: treats "already exists" as success.
 */
export async function ensureProfile(profile) {
  try {
    await runWebcmd(['profile', 'create', profile, '-f', 'json'], { timeoutMs: 15_000 });
  } catch (err) {
    const message = String(err.stdout || err.stderr || err.message || '');
    if (/already exists|ALREADY_EXISTS/i.test(message)) return;
    // Otherwise, don't hide the problem — the next real command will
    // surface it again with more context if it's actually still broken.
    console.warn(`Note: could not confirm/create profile "${profile}": ${err.message}`);
  }
}

/** Creates a named Session inside a Profile; returns its session id. */
export async function createSession(profile, name) {
  const result = await runWebcmd(
    ['--profile', profile, 'session', 'create', name, '-f', 'json'],
    { timeoutMs: 30_000 },
  );
  const id = result?.id ?? result?.session?.id ?? result?.sessionId;
  if (!id) {
    throw new WebcmdError(
      `session create for "${name}" did not return a usable id: ${JSON.stringify(result)}`,
    );
  }
  return id;
}

/** Lists sessions in a Profile. */
export async function listSessions(profile) {
  return runWebcmd(['--profile', profile, 'session', 'list', '-f', 'json'], {
    timeoutMs: 20_000,
  });
}

/** Lists tabs (pages) currently open inside a Session. */
export async function listTabs(profile, session) {
  return runWebcmd(
    ['--profile', profile, '--session', session, 'browser', 'tabs', '-f', 'json'],
    { timeoutMs: 20_000 },
  );
}

/**
 * Runs a small Playwright-style program inside a Session via `browser run`.
 * `code` is the body of an async function with `page`, `context`, `browser`,
 * `console` in scope (per docs/cli-reference.mdx) — it should `return {...}`.
 * We ship the code as a temp file (`--file`) rather than piping stdin, since
 * that keeps this wrapper simple and avoids relying on execFile stdin support.
 */
export async function browserRun(profile, session, code, { timeoutSec = 45 } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'travel-agent-'));
  const file = path.join(dir, 'program.js');
  await writeFile(file, code, 'utf8');
  try {
    return await runWebcmd(
      [
        '--profile', profile,
        '--session', session,
        'browser', 'run',
        '--file', file,
        '--timeout', String(timeoutSec),
        '--no-snapshot-diff',
        '-f', 'json',
      ],
      { timeoutMs: (timeoutSec + 20) * 1000 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Reads page state via `browser snapshot`. mode: 'read' | 'act' | 'tree'. */
export async function browserSnapshot(profile, session, mode = 'read') {
  return runWebcmd(
    [
      '--profile', profile,
      '--session', session,
      'browser', 'snapshot',
      '--snapshot-mode', mode,
      '-f', 'json',
    ],
    { timeoutMs: 30_000 },
  );
}

/**
 * Local HTTP fetch with no browser involved — the fast path webcmd itself
 * recommends trying first for a public URL (docs/cli-reference.mdx, "Direct
 * URL Fetch"). Returns null (never throws) on failure/blocked so callers can
 * fall through to a real browser Session without special-casing errors.
 */
export async function webFetch(url, { timeoutSec = 20 } = {}) {
  try {
    return await runWebcmd(
      ['web', 'fetch', '--url', url, '--timeout', String(timeoutSec), '-f', 'json'],
      { timeoutMs: (timeoutSec + 10) * 1000 },
    );
  } catch {
    return null;
  }
}

/** Recursively flattens every string value found in a JSON-ish structure. */
export function flattenStrings(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) flattenStrings(value[key], out);
    return out;
  }
  return out;
}
