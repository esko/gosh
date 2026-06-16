/**
 * OpenSSH known_hosts line parsing and SHA256 fingerprint helpers.
 */

export type ParsedKnownHostLine = {
  host: string;
  port: number;
  keyType: string;
  base64Key: string;
  opensshLine: string;
};

/** Bracketed `[host]:port` when port ≠ 22, else plain hostname. */
export function formatKnownHostTarget(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

function hostPortFromTarget(target: string): { host: string; port: number } {
  const bracketed = target.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracketed) {
    return { host: bracketed[1]!, port: Number(bracketed[2]) };
  }
  return { host: target, port: 22 };
}

/** Parse a single non-comment, non-hashed known_hosts line. */
export function parseKnownHostsLine(line: string): ParsedKnownHostLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('|')) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 3) return null;

  const [target, keyType, base64Key] = parts;
  if (!target || !keyType || !base64Key) return null;

  const { host, port } = hostPortFromTarget(target);
  return { host, port, keyType, base64Key, opensshLine: trimmed };
}

/** OpenSSH SHA256 fingerprint (`SHA256:…`, no padding). */
export async function fingerprintFromBase64Key(base64Key: string): Promise<string> {
  const binary = atob(base64Key);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=+$/, '');
  return `SHA256:${b64}`;
}

export async function fingerprintFromOpensshLine(line: string): Promise<string | null> {
  const parsed = parseKnownHostsLine(line);
  if (!parsed) return null;
  return fingerprintFromBase64Key(parsed.base64Key);
}

/** Lines in known_hosts that apply to host:port (exact or wildcard hostname). */
export function knownHostLinesForTarget(
  fileText: string,
  host: string,
  port: number,
): ParsedKnownHostLine[] {
  const target = formatKnownHostTarget(host, port);
  const results: ParsedKnownHostLine[] = [];

  for (const line of fileText.split(/\r?\n/)) {
    const parsed = parseKnownHostsLine(line);
    if (!parsed) continue;
    const lineTarget = formatKnownHostTarget(parsed.host, parsed.port);
    if (lineTarget === target || parsed.host === host) {
      results.push(parsed);
    }
  }

  return results;
}
