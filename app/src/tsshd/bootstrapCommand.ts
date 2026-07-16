const REMOTE_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';

export function buildTsshdBootstrapCommand(mode: 'QUIC' | 'KCP'): string {
  const tsshdExtra = mode === 'KCP' ? ' --kcp' : '';
  return `env PATH=${REMOTE_PATH} sh -c 'tsshd${tsshdExtra} 2>&1'`;
}

export type TsshdServerInfo = {
  ServerVer?: string;
  ProtoVer?: number;
  Port: number;
  Mode: string;
  Pass?: string;
  Salt?: string;
  ServerCert?: string;
  ClientCert?: string;
  ClientKey?: string;
  ProxyKey: string;
  ClientID: number;
  ServerID: number;
  ProxyMode?: string;
  MTU?: number;
};

export function parseTsshdOutput(output: string): TsshdServerInfo | null {
  const cleaned = output
    .replace(/\r/g, '')
    .replace(/\n/g, '');
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return null;
  const jsonStr = cleaned.substring(jsonStart, jsonEnd + 1);
  try {
    const info = JSON.parse(jsonStr);
    if (typeof info.Port === 'number' && info.Port > 0 && info.Port <= 65535 && typeof info.ProxyKey === 'string') {
      return info;
    }
    return null;
  } catch {
    return null;
  }
}
