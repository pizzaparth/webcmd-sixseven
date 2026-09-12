import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenStrings } from '../src/lib/webcmd.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.resolve(__dirname, '..');

/** resolveWebcmd() memoizes per process, so ask a fresh one each time. */
function describeWith(env) {
  return execFileSync(
    process.execPath,
    ['-e', "import('./src/lib/webcmd.js').then(m => console.log(m.describeWebcmd()))"],
    { cwd: AGENT_ROOT, env: { ...process.env, ...env }, encoding: 'utf8' },
  ).trim();
}

test('a WEBCMD_BIN pointing at a .js entry is run with node', () => {
  // npm's Windows `webcmd.cmd` shim cannot be execFile'd directly (ENOENT),
  // so the resolver runs the package's JS entry point instead of the shim.
  const out = describeWith({ WEBCMD_BIN: 'C:/somewhere/dist/src/main.js' });
  assert.equal(out, 'node C:/somewhere/dist/src/main.js');
});

test('a WEBCMD_BIN pointing at a real executable is used as-is', () => {
  const out = describeWith({ WEBCMD_BIN: '/usr/local/bin/webcmd' });
  assert.equal(out, '/usr/local/bin/webcmd');
});

test('with no override the resolver still yields something runnable', () => {
  const out = describeWith({ WEBCMD_BIN: '' });
  assert.ok(out === 'webcmd' || out.startsWith('node '), `unexpected resolution: ${out}`);
});

test('flattenStrings walks nested snapshot JSON', () => {
  assert.deepEqual(flattenStrings({ a: 'one', b: { c: ['two', 3, null], d: 'three' } }), ['one', 'two', 'three']);
  assert.deepEqual(flattenStrings(null), []);
});
