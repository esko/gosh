const REMOTE_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
const MAX_BOOTSTRAP_SCAN = 1 << 16;
const MAX_UINT64 = 18_446_744_073_709_551_615n;

export type TsshdUdpMode = 'QUIC' | 'KCP';

export type TsshdServerInfo = {
  ServerVer: string;
  Port: number;
  Mode: TsshdUdpMode;
  Pass?: string;
  Salt?: string;
  ServerCert?: string;
  ClientCert?: string;
  ClientKey?: string;
  ProxyKey: string;
  ClientID: string;
  ServerID: string;
  ProxyMode?: string;
  MTU?: number;
};

function validPortRange(value: string): boolean {
  const match = /^(\d{1,5})-(\d{1,5})$/.exec(value);
  if (!match) return false;
  const low = Number(match[1]);
  const high = Number(match[2]);
  return low > 0 && high <= 65_535 && low <= high;
}

function validExecutablePath(value: string): boolean {
  return /^\/[A-Za-z0-9_+./-]+$/.test(value) && !value.includes('/../') && !value.endsWith('/..');
}

export function buildTsshdBootstrapCommand(
  mode: TsshdUdpMode,
  options: { tsshdPath?: string; tsshdPortRange?: string } = {},
): string {
  const path = options.tsshdPath?.trim();
  const range = options.tsshdPortRange?.trim();
  if (path && !validExecutablePath(path)) throw new Error('Invalid tsshd executable path.');
  if (range && !validPortRange(range)) throw new Error('Invalid tsshd UDP port range.');
  const binary = path || 'tsshd';
  const modeArg = mode === 'KCP' ? ' --kcp' : '';
  const portArg = range ? ` --port ${range}` : '';
  return `env PATH=${REMOTE_PATH} sh -c '${binary}${modeArg}${portArg} 2>&1'`;
}

function jsonObjects(value: string): string[] {
  const objects: string[] = [];
  for (let start = value.indexOf('{'); start >= 0; start = value.indexOf('{', start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < value.length; i += 1) {
      const char = value[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        objects.push(value.slice(start, i + 1));
        break;
      }
    }
  }
  return objects;
}

function preserveUint64Ids(json: string): string | null {
  const counts = { ClientID: 0, ServerID: 0 };
  const normalized = json.replace(/"(ClientID|ServerID)"\s*:\s*(?:"(\d+)"|(\d+))/g, (_match, name: keyof typeof counts, quoted, numeric) => {
    counts[name] += 1;
    return `"${name}":"${quoted ?? numeric}"`;
  });
  return counts.ClientID === 1 && counts.ServerID === 1 ? normalized : null;
}

function validUint64(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false;
  try {
    return BigInt(value) <= MAX_UINT64;
  } catch {
    return false;
  }
}

function validHex(value: unknown, options: { lengths?: number[]; max?: number } = {}): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return false;
  if (options.lengths && !options.lengths.includes(value.length)) return false;
  return value.length <= (options.max ?? 16_384);
}

function supportedVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\D.*)?$/.exec(value);
  if (!match) return false;
  const parts = match.slice(1, 4).map(Number);
  return parts[0]! > 0 || parts[1]! > 1 || (parts[1] === 1 && parts[2]! >= 6);
}

function validateServerInfo(value: unknown, expectedMode?: TsshdUdpMode): TsshdServerInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const info = value as Record<string, unknown>;
  if (!supportedVersion(info.ServerVer)) return null;
  if (!Number.isInteger(info.Port) || (info.Port as number) < 1 || (info.Port as number) > 65_535) return null;
  if (info.Mode !== 'KCP' && info.Mode !== 'QUIC') return null;
  if (expectedMode && info.Mode !== expectedMode) return null;
  if (!validHex(info.ProxyKey, { lengths: [32, 48, 64] })) return null;
  if (!validUint64(info.ClientID) || !validUint64(info.ServerID)) return null;
  if (info.ProxyMode !== undefined && info.ProxyMode !== '') return null;
  if (info.MTU !== undefined && (!Number.isInteger(info.MTU) || (info.MTU as number) < 576 || (info.MTU as number) > 65_535)) return null;
  if (info.Mode === 'KCP' && (!validHex(info.Pass) || !validHex(info.Salt))) return null;
  if (info.Mode === 'QUIC' && (!validHex(info.ServerCert) || !validHex(info.ClientCert) || !validHex(info.ClientKey))) return null;
  return info as TsshdServerInfo;
}

export function parseTsshdOutput(output: string, expectedMode?: TsshdUdpMode): TsshdServerInfo | null {
  if (output.length > MAX_BOOTSTRAP_SCAN) output = output.slice(-MAX_BOOTSTRAP_SCAN);
  for (const candidate of jsonObjects(output.replace(/\r/g, ''))) {
    const normalized = preserveUint64Ids(candidate);
    if (!normalized) continue;
    try {
      const info = validateServerInfo(JSON.parse(normalized), expectedMode);
      if (info) return info;
    } catch {
      // Continue scanning: banners and MOTDs can contain unrelated JSON.
    }
  }
  return null;
}
