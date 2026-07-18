/**
 * Lifecycle bridge between pairing settings and the loopback ControlServer.
 */

import type { AgentControlService } from '../agent/AgentControlService';
import { ControlServer, isControlTransportAvailable, type ControlServerStatus } from '../agent/server/ControlServer';
import { AuditRing } from '../agent/security/AuditLog';
import { ControlPermissions } from '../agent/security/Permissions';
import { disablePairing, enablePairing, loadPairingState, resetPairingToken } from '../agent/security/Pairing';

let server: ControlServer | null = null;
let audit: AuditRing | null = null;
let statusListeners = new Set<(status: ControlServerStatus & { enabled: boolean }) => void>();

function emitStatus(): void {
  const status = getAgentControlServerStatus();
  for (const listener of statusListeners) listener(status);
}

export function getAgentControlAuditLog(): AuditRing {
  audit ??= new AuditRing();
  return audit;
}

export function getAgentControlServerStatus(): ControlServerStatus & { enabled: boolean } {
  const base = server?.getStatus() ?? {
    listening: false,
    address: null,
    port: null,
    connectedClients: 0,
    transportAvailable: isControlTransportAvailable(),
  };
  return {
    ...base,
    transportAvailable: server?.getStatus().transportAvailable ?? isControlTransportAvailable(),
    enabled: server !== null,
  };
}

export function onAgentControlStatusChange(
  listener: (status: ControlServerStatus & { enabled: boolean }) => void,
): () => void {
  statusListeners.add(listener);
  listener(getAgentControlServerStatus());
  return () => statusListeners.delete(listener);
}

export async function syncAgentControlServer(service: AgentControlService): Promise<ControlServerStatus & { enabled: boolean }> {
  const pairing = await loadPairingState();
  if (!pairing.enabled || !pairing.token) {
    await stopAgentControlServer();
    return getAgentControlServerStatus();
  }
  await stopAgentControlServer();
  audit ??= new AuditRing();
  server = new ControlServer({
    service,
    permissions: new ControlPermissions({ token: pairing.token }),
    audit,
    onStatusChange: () => emitStatus(),
  });
  try {
    await server.start();
  } catch (error) {
    server = null;
    throw error;
  }
  emitStatus();
  return getAgentControlServerStatus();
}

export async function stopAgentControlServer(): Promise<void> {
  if (!server) {
    emitStatus();
    return;
  }
  const current = server;
  server = null;
  await current.stop();
  emitStatus();
}

export async function setAgentControlEnabled(
  service: AgentControlService,
  enabled: boolean,
): Promise<{ token: string | null; port: number | null }> {
  if (!enabled) {
    await disablePairing();
    await stopAgentControlServer();
    return { token: null, port: null };
  }
  const pairing = await enablePairing();
  await stopAgentControlServer();
  const status = await syncAgentControlServer(service);
  return { token: pairing.token, port: status.port };
}

export async function rotateAgentControlToken(service: AgentControlService): Promise<string> {
  const pairing = await resetPairingToken();
  await stopAgentControlServer();
  await syncAgentControlServer(service);
  return pairing.token ?? '';
}

/** Update the status pill in the terminal chrome. */
export function mountAgentControlIndicator(host: HTMLElement): () => void {
  const pill = document.createElement('div');
  pill.className = 'agent-control-indicator';
  pill.hidden = true;
  pill.title = 'External agent control';
  host.append(pill);

  const render = (status: ControlServerStatus & { enabled: boolean }): void => {
    if (!status.enabled) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    pill.dataset.connected = status.connectedClients > 0 ? 'true' : 'false';
    const port = status.port ?? '?';
    pill.textContent =
      status.connectedClients > 0
        ? `Agent · ${status.connectedClients} connected · :${port}`
        : `Agent · listening :${port}`;
  };

  const off = onAgentControlStatusChange(render);
  return () => {
    off();
    pill.remove();
  };
}
