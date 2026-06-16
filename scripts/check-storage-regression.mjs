/**
 * Regression checks for identity normalization and known_hosts target matching.
 * Run: npm run check:regression
 */

import { normalizeIdentity, identityExportFlags } from '../app/src/storage/identityNormalize.ts';
import {
  knownHostLineMatchesTarget,
  knownHostLinesForTarget,
  parseKnownHostsLine,
} from '../app/src/ssh/knownHostFormat.ts';

const FORMAT_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function makeEncryptedBlob() {
  const out = new Uint8Array(1 + SALT_BYTES + IV_BYTES + 32);
  out[0] = FORMAT_VERSION;
  return out.buffer;
}

function makeLegacyPlaintextBlob() {
  return new TextEncoder().encode('-----BEGIN OPENSSH PRIVATE KEY-----\n').buffer;
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
}

function checkIdentityNormalization() {
  const encrypted = makeEncryptedBlob();
  const legacy = makeLegacyPlaintextBlob();

  const encryptedIdentity = normalizeIdentity({
    id: 'enc-1',
    label: 'encrypted',
    encryptedPrivateKey: encrypted,
  });
  assert(
    encryptedIdentity.encryptedPrivateKey === encrypted,
    'encrypted identities keep encryptedPrivateKey',
  );
  assert(
    !encryptedIdentity.privateKeyPemBytesDevOnly,
    'encrypted identities must not gain privateKeyPemBytesDevOnly',
  );

  const legacyIdentity = normalizeIdentity({
    id: 'legacy-1',
    label: 'legacy',
    privateKeyPemBytesDevOnly: legacy,
  });
  assert(
    legacyIdentity.privateKeyPemBytesDevOnly === legacy,
    'legacy privateKeyPemBytesDevOnly identities still work',
  );

  const migrated = normalizeIdentity({
    id: 'old-1',
    label: 'pre-webcrypto',
    encryptedPrivateKey: legacy,
  });
  assert(
    migrated.privateKeyPemBytesDevOnly === legacy,
    'pre-WebCrypto plaintext in encryptedPrivateKey migrates to privateKeyPemBytesDevOnly',
  );
  assert(!migrated.encryptedPrivateKey, 'migrated identity drops encryptedPrivateKey alias');

  const exported = identityExportFlags(encryptedIdentity);
  assert(exported.hasEncryptedPrivateKey === true, 'export reports encrypted identities');
  assert(exported.hasLegacyPlaintextKey === false, 'export does not flag encrypted as legacy');
  assert(!('encryptedPrivateKey' in exported), 'export omits raw encryptedPrivateKey bytes');

  const exportedLegacy = identityExportFlags(legacyIdentity);
  assert(exportedLegacy.hasLegacyPlaintextKey === true, 'export reports legacy plaintext keys');
}

function checkKnownHostMatching() {
  const fileText = [
    'example.com ssh-ed25519 AAAAB3NzaC1lZDI1NTE5AAAAIExampleKey22',
    '[example.com]:2222 ssh-ed25519 AAAAB3NzaC1lZDI1NTE5AAAAIExampleKey2222',
    'example.com,192.0.2.10 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB',
    '[example.com]:2222,[192.0.2.10]:2222 ssh-ed25519 AAAAB3NzaC1lZDI1NTE5AAAAIMulti',
    '# comment line',
    '|1|hashedmarker ssh-ed25519 AAAAB3NzaC1lZDI1NTE5AAAAIHashed',
  ].join('\n');

  const port22 = knownHostLinesForTarget(fileText, 'example.com', 22);
  assert(port22.length === 2, 'port 22 matches hostname-only and comma-alias lines');
  assert(
    port22.every((line) => knownHostLineMatchesTarget(line, 'example.com', 22)),
    'port 22 matches only exact host+port markers',
  );
  assert(
    !port22.some((line) => line.opensshLine.includes('ExampleKey2222')),
    'port 22 must not pick up :2222 lines',
  );

  const port2222 = knownHostLinesForTarget(fileText, 'example.com', 2222);
  assert(port2222.length === 2, 'port 2222 matches bracketed and multi-marker lines');
  assert(
    port2222.every((line) => knownHostLineMatchesTarget(line, 'example.com', 2222)),
    'port 2222 matches only exact host+port markers',
  );

  const ip2222 = knownHostLinesForTarget(fileText, '192.0.2.10', 2222);
  assert(ip2222.length === 1, 'comma-separated [host]:port,[ip]:port matches ip:2222');
  assert(
    knownHostLineMatchesTarget(ip2222[0], '192.0.2.10', 2222),
    'ip alias on multi-marker line matches port 2222',
  );

  assert(parseKnownHostsLine('# comment') === null, 'comments are skipped');
  assert(parseKnownHostsLine('|1|abc ssh-ed25519 AAA') === null, 'hashed lines are skipped');

  const noCrossPort = knownHostLinesForTarget(
    'example.com ssh-ed25519 AAAAB3NzaC1lZDI1NTE5AAAAIOnly22\n',
    'example.com',
    2222,
  );
  assert(noCrossPort.length === 0, 'port-22 line does not satisfy connection to :2222');
}

function main() {
  checkIdentityNormalization();
  checkKnownHostMatching();
  if (process.exitCode) {
    console.error('Regression checks failed.');
    process.exit(process.exitCode);
  }
  console.log('Regression checks passed.');
}

main();
