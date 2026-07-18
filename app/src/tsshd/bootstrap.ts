import { HeadlessTerminalSink } from '../ssh/HeadlessTerminalSink';
import { NasshCommandBridge } from '../ssh/NasshCommandBridge';
import type { ConnectionIntent } from '../connections/ConnectionIntent';
import { isKnownHostReadyForConnect } from '../ssh/nasshKnownHosts';
import { buildTsshdBootstrapCommand, parseTsshdOutput, type TsshdServerInfo } from './bootstrapCommand';
import { TSSHD_DEFAULT_UDP_MODE, type TsshdBootstrapResult, type TsshdUdpMode } from './types';

class CaptureTerminal extends HeadlessTerminalSink {
  constructor() {
    super({ mode: 'capture-tail' });
  }
}

const BENIGN_SSH_NOISE =
  /^(?:hostfile_replace_entries|hostkeys_foreach|update_known_hosts|Warning: Permanently added)\b.*$/gim;

const TSSHD_NOT_FOUND =
  /(?:^|\n)(?:env:|sh:)\s*[^\n]*tsshd[^\n]*(?:not found|No such file)|command not found/i;

export function isTsshdNotFound(output: string): boolean {
  return TSSHD_NOT_FOUND.test(output.replace(BENIGN_SSH_NOISE, ''));
}

async function runTsshdBootstrapPreflight(spec: ConnectionIntent): Promise<void> {
  const host = spec.hostname;
  const port = spec.port ?? 22;
  if (await isKnownHostReadyForConnect(host, port)) return;
  const terminal = new CaptureTerminal();
  const bridge = new NasshCommandBridge({
    protocol: 'ssh',
    host,
    port,
    username: spec.username ?? '',
    identityId: spec.identityId,
    connectionArgs: spec.argstr,
    allowHostKeyTtyResponse: false,
  });
  bridge.attachTerminal(terminal);
  try {
    await bridge.connect();
  } finally {
    await bridge.disconnect().catch(() => undefined);
    bridge.dispose();
    terminal.dispose();
  }
}

export async function createTsshdSession(spec: ConnectionIntent): Promise<TsshdBootstrapResult> {
  await runTsshdBootstrapPreflight(spec);

  const udpMode: TsshdUdpMode = spec.tsshd?.udpMode ?? TSSHD_DEFAULT_UDP_MODE;
  const terminal = new CaptureTerminal();
  const command = buildTsshdBootstrapCommand(udpMode, {
    tsshdPath: spec.tsshd?.tsshdPath,
    tsshdPortRange: spec.tsshd?.tsshdPortRange,
  });
  let resolveServerInfo!: (info: TsshdServerInfo) => void;
  let rejectServerInfo!: (error: Error) => void;
  const serverInfoReady = new Promise<TsshdServerInfo>((resolve, reject) => {
    resolveServerInfo = resolve;
    rejectServerInfo = reject;
  });
  const timeout = window.setTimeout(
    () => rejectServerInfo(new Error('Timed out waiting for tsshd to start. Is tsshd installed on the server?')),
    30_000,
  );

  const subscription = terminal.onOutput((output) => {
    if (isTsshdNotFound(output)) {
      rejectServerInfo(new Error('tsshd not found on the remote host. Install tsshd on the server first (brew install tsshd).'));
      return;
    }
    const parsed = parseTsshdOutput(output, udpMode);
    if (parsed) {
      resolveServerInfo(parsed);
    }
  });

  const bridge = new NasshCommandBridge({
    protocol: 'ssh',
    host: spec.hostname,
    port: spec.port ?? 22,
    username: spec.username ?? '',
    identityId: spec.identityId,
    connectionArgs: spec.argstr,
    startupCommand: command,
    allowHostKeyTtyResponse: false,
  });
  bridge.attachTerminal(terminal);

  try {
    await bridge.connect();
    const serverInfo = await serverInfoReady;
    return {
      host: spec.hostname,
      serverInfo,
    };
  } finally {
    window.clearTimeout(timeout);
    subscription.dispose();
    await bridge.disconnect().catch(() => undefined);
    bridge.dispose();
    terminal.dispose();
  }
}
