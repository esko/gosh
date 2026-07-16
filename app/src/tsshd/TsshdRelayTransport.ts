import type { TerminalSink } from '../terminal/TerminalAdapter';
import type { TerminalTransport, TransportStatusHandler } from '../pwa/transport';
import type { ConnectionIntent } from '../connections/ConnectionIntent';

const TCP_UNAVAILABLE =
  'Direct Sockets (TCPSocket) is unavailable. Install as an IWA with direct-sockets permission.';
const UDP_UNAVAILABLE =
  'Direct Sockets (UDPSocket) is unavailable. Install as an IWA with direct-sockets permission.';
const RELAY_UNAVAILABLE =
  'tsshd is not available in this browser build: the native QUIC/KCP relay cannot run inside an IWA.';

function tsshdUnavailableReason(): string {
  const directSockets = globalThis as typeof globalThis & {
    TCPSocket?: unknown;
    UDPSocket?: unknown;
  };
  if (typeof directSockets.TCPSocket !== 'function') return TCP_UNAVAILABLE;
  if (typeof directSockets.UDPSocket !== 'function') return UDP_UNAVAILABLE;
  return RELAY_UNAVAILABLE;
}

export class TsshdRelayTransport implements TerminalTransport {
  private ended = false;

  constructor(
    private readonly spec: ConnectionIntent,
    private readonly onStatus: TransportStatusHandler,
  ) {}

  async connect(adapter: TerminalSink): Promise<void> {
    this.onStatus('connecting');
    // The committed relay is a native macOS executable. An IWA cannot spawn
    // native processes, and there is no bundled WASM/worker relay. Stop before
    // SSH bootstrap so we neither launch an unusable remote tsshd process nor
    // leave the pane pretending to connect.
    const mode = this.spec.tsshd?.udpMode ?? 'KCP';
    const message = tsshdUnavailableReason().replace('QUIC/KCP', mode);
    adapter.write(`\r\n\x1b[33m${message}\x1b[0m\r\n`);
    this.onStatus('error', message);
    throw new Error(message);
  }

  async disconnect(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.onStatus('disconnecting');
    this.onStatus('disconnected');
  }

  dispose(): void {
    this.ended = true;
  }
}
