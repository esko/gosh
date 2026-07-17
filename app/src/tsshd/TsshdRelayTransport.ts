import type { TerminalSink, TerminalSubscription } from '../terminal/TerminalAdapter';
import type { TerminalTransport, TransportStatusHandler } from '../pwa/transport';
import type { ConnectionIntent } from '../connections/ConnectionIntent';
import { createTsshdSession } from './bootstrap';
import { createTsshdWorkerController, type TsshdWorkerController, type TsshdWorkerEvent } from './TsshdWorkerController';

const TCP_UNAVAILABLE =
  'Direct Sockets (TCPSocket) is unavailable. Install as an IWA with direct-sockets permission.';
const UDP_UNAVAILABLE =
  'Direct Sockets (UDPSocket) is unavailable. Install as an IWA with direct-sockets permission.';

function directSocketsError(): string | null {
  const directSockets = globalThis as typeof globalThis & { TCPSocket?: unknown; UDPSocket?: unknown };
  if (typeof directSockets.TCPSocket !== 'function') return TCP_UNAVAILABLE;
  if (typeof directSockets.UDPSocket !== 'function') return UDP_UNAVAILABLE;
  return null;
}

export class TsshdRelayTransport implements TerminalTransport {
  private input: TerminalSubscription | null = null;
  private resize: TerminalSubscription | null = null;
  private controller: TsshdWorkerController | null = null;
  private adapter: TerminalSink | null = null;
  private disposed = false;
  private ended = false;
  private surfacedError = false;

  constructor(
    private readonly spec: ConnectionIntent,
    private readonly onStatus: TransportStatusHandler,
  ) {}

  async connect(adapter: TerminalSink): Promise<void> {
    this.disposed = false;
    this.ended = false;
    this.surfacedError = false;
    this.adapter = adapter;
    this.onStatus('connecting');
    try {
      const unavailable = directSocketsError();
      if (unavailable) throw new Error(unavailable);

      const controller = createTsshdWorkerController((event) => this.handleWorkerEvent(event));
      this.controller = controller;
      // The remote daemon only waits briefly for its first UDP packet. Fully
      // initialize and instantiate WASM before starting the SSH bootstrap.
      await controller.initialize();
      if (this.disposed) throw new Error('TSSHD transport was disposed.');

      const session = await createTsshdSession(this.spec);
      if (this.disposed) throw new Error('TSSHD transport was disposed.');

      this.input = adapter.onInput((data) => controller.sendInput(data));
      this.resize = adapter.onResize((viewport) => controller.resize(viewport));
      await controller.connect(session.host, session.serverInfo, adapter.getSize());
    } catch (error) {
      this.releaseSubscriptions();
      this.controller?.dispose();
      this.controller = null;
      if (this.disposed) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.surfaceError(message);
      throw error;
    }
  }

  private handleWorkerEvent(event: TsshdWorkerEvent): void {
    if (this.disposed) return;
    if (event.type === 'output') this.adapter?.write(event.data);
    else if (event.type === 'status') {
      if (event.status === 'connected') this.onStatus('connected');
      else if (event.status === 'disconnected' && !this.ended) {
        this.ended = true;
        this.releaseSubscriptions();
        this.onStatus('disconnected', undefined, { disconnectReason: 'normal-exit' });
      }
    } else if (event.type === 'error') {
      this.surfaceError(event.message);
    }
  }

  private surfaceError(message: string): void {
    if (this.surfacedError || this.disposed) return;
    this.surfacedError = true;
    this.adapter?.write(`\r\n\x1b[33m${message}\x1b[0m\r\n`);
    this.onStatus('error', message);
  }

  private releaseSubscriptions(): void {
    this.input?.dispose();
    this.resize?.dispose();
    this.input = null;
    this.resize = null;
  }

  async disconnect(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.onStatus('disconnecting');
    this.releaseSubscriptions();
    await this.controller?.disconnect();
    this.controller = null;
    this.onStatus('disconnected');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ended = true;
    this.releaseSubscriptions();
    this.controller?.dispose();
    this.controller = null;
    this.adapter = null;
  }
}
