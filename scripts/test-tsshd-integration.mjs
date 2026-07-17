import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const TSSHD = '/opt/homebrew/bin/tsshd';
const TIMEOUT_MS = 30_000;

const version = execSync(`${TSSHD} -V 2>&1`, { encoding: 'utf8', timeout: 10_000 });
console.log(`Version: ${version.trim()}`);

function launchTsshd(args) {
  const cmd = `${TSSHD} ${args} 2>/dev/null & PID=$!; sleep 2; kill $PID 2>/dev/null; wait $PID 2>/dev/null`;
  return execSync(cmd, { encoding: 'utf8', timeout: 10_000 });
}

function parseJson(out) {
  const cleaned = out.replace(/\r/g, '').replace(/\n/g, '');
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
  assert.ok(s >= 0 && e > s, `No JSON: "${out.substring(0, 80)}"`);
  return JSON.parse(cleaned.substring(s, e + 1));
}

const quic = parseJson(launchTsshd(''));
assert.equal(quic.Mode, 'QUIC');
assert.ok(typeof quic.Port === 'number' && quic.Port >= 1);
console.log(`QUIC: port=${quic.Port}`);

const kcp = parseJson(launchTsshd('--kcp'));
assert.equal(kcp.Mode, 'KCP');
assert.ok(typeof kcp.Pass === 'string' && kcp.Pass.length > 0);
console.log(`KCP: port=${kcp.Port}`);

const sshQuic = execSync(
  'ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 localhost "TSSHD_PATH" 2>/dev/null'.replace('TSSHD_PATH', TSSHD),
  { encoding: 'utf8', timeout: TIMEOUT_MS }
);
const quicRemote = parseJson(sshQuic);
assert.ok(quicRemote.ProxyKey.length > 0);
console.log(`SSH→tsshd QUIC: port=${quicRemote.Port}`);

const sshKcp = execSync(
  'ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 localhost "TSSHD_PATH --kcp" 2>/dev/null'.replace('TSSHD_PATH', TSSHD),
  { encoding: 'utf8', timeout: TIMEOUT_MS }
);
const kcpRemote = parseJson(sshKcp);
assert.equal(kcpRemote.Mode, 'KCP');
assert.ok(kcpRemote.Pass.length > 0);
console.log(`SSH→tsshd KCP: port=${kcpRemote.Port}`);

console.log('\nAll tsshd integration tests passed!');
