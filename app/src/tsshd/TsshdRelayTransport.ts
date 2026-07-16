import type { TerminalSink, TerminalSubscription } from '../terminal/TerminalAdapter';
import type { TerminalTransport, TransportStatusHandler } from '../pwa/transport';
import type { ConnectionIntent } from '../connections/ConnectionIntent';
import { createTsshdSession } from './bootstrap';

export class TsshdRelayTransport implements TerminalTransport {
  private input: TerminalSubscription | null = null;
  private onStatus: TransportStatusHandler;

  constructor(
    private readonly spec: ConnectionIntent,
    onStatus: TransportStatusHandler,
  ) {
    this.onStatus = onStatus;
  }

  async connect(adapter: TerminalSink): Promise<void> {
    this.onStatus('connecting');

    const result = await createTsshdSession(this.spec);

    // Build server info JSON for the relay
    const serverInfo = JSON.stringify(result.params.serverInfo);

    // Spawn relay process (this is a native binary — works on desktop,
    // not in browser. For browser, we'd compile to WASM.)
    const relay = new Worker(
      new URL('./tsshdRelayWorker.ts', import.meta.url),
      { type: 'module' }
    );

    relay.postMessage({ type: 'connect', serverInfo });

    relay.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'output') {
        adapter.write(new Uint8Array(msg.data));
      } else if (msg.type === 'status') {
        this.onStatus(msg.status, msg.error);
      } else if (msg.type === 'error') {
        adapter.write(`\r\n\x1b[33m${msg.msg}\x1b[0m\r\n`);
        this.onStatus('error', msg.msg);
      }
    };

    this.input = adapter.onInput((data) => {
      relay.postMessage({ type: 'input', data });
    });

    relay.onerror = (err) => {
      this.onStatus('error', err.message);
    };
  }

  async disconnect(): Promise<void> {
    this.onStatus('disconnecting');
    this.input?.dispose();
    this.input = null;
    this.onStatus('disconnected');
  }

  dispose(): void {
    this.input?.dispose();
    this.input = null;
  }
}
