import { describe, expect, it } from 'vitest';
import { knownHostLinesForSync, knownHostLinesForTarget } from './knownHostFormat';

describe('knownHostLinesForSync', () => {
  const ipLine =
    '192.0.2.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyMaterialForTestPurposesOnly1234567890';

  it('matches an exact hostname marker', () => {
    const file = `host.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyMaterialForTestPurposesOnly1234567890`;
    expect(knownHostLinesForTarget(file, 'host.example', 22)).toHaveLength(1);
    expect(knownHostLinesForSync(file, 'host.example', 22)).toHaveLength(1);
  });

  it('falls back to a single line when the profile hostname differs from the stored IP', () => {
    expect(knownHostLinesForTarget(ipLine, 'host.example', 22)).toHaveLength(0);
    expect(knownHostLinesForSync(ipLine, 'host.example', 22)).toHaveLength(1);
  });

  it('does not guess when multiple unrelated lines exist', () => {
    const file = `${ipLine}\nother.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherKeyMaterialForTestPurposesOnly123456789012`;
    expect(knownHostLinesForSync(file, 'host.example', 22)).toHaveLength(0);
  });
});
