import {
  clearAgentControlPairing,
  getAgentControlPairing,
  putAgentControlPairing,
  type AgentControlPairingRecord,
} from '../../storage/indexedDb';

export type AgentControlPairingState = {
  enabled: boolean;
  token: string | null;
  enabledAt: number | null;
};

const TOKEN_BYTES = 32;

/** URL-safe base64 without padding — easy to copy from Settings. */
export function generatePairingToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

function toState(record: AgentControlPairingRecord | undefined): AgentControlPairingState {
  if (!record?.enabled || !record.token) {
    return { enabled: false, token: null, enabledAt: null };
  }
  return { enabled: true, token: record.token, enabledAt: record.enabledAt ?? null };
}

export async function loadPairingState(): Promise<AgentControlPairingState> {
  return toState(await getAgentControlPairing());
}

/** Enable external control and mint a fresh pairing token (stored owner-only). */
export async function enablePairing(): Promise<AgentControlPairingState> {
  const token = generatePairingToken();
  const record: AgentControlPairingRecord = { enabled: true, token, enabledAt: Date.now() };
  await putAgentControlPairing(record);
  return toState(record);
}

export async function disablePairing(): Promise<void> {
  await clearAgentControlPairing();
}

/** Rotate the bearer token; disconnects existing clients on next request. */
export async function resetPairingToken(): Promise<AgentControlPairingState> {
  const existing = await getAgentControlPairing();
  if (!existing?.enabled) return enablePairing();
  const token = generatePairingToken();
  const record: AgentControlPairingRecord = {
    enabled: true,
    token,
    enabledAt: existing.enabledAt ?? Date.now(),
  };
  await putAgentControlPairing(record);
  return toState(record);
}

export async function verifyStoredToken(candidate: string): Promise<boolean> {
  const record = await getAgentControlPairing();
  if (!record?.enabled || !record.token) return false;
  return timingSafeEqual(record.token, candidate);
}
