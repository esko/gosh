import type { TerminalAdapter, TerminalSubscription } from '../terminal/TerminalAdapter';
import { NasshRuntime } from '../ssh/NasshRuntime';
import { checkMoshPrerequisites } from '../ssh/moshGate';
import type { PwaConnectionSpec, TerminalTransportStatus } from './types';

export type TransportStatusHandler = (status: TerminalTransportStatus, error?: string) => void;

export type TerminalTransport = {
  connect(adapter: TerminalAdapter): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): void;
};

export class EchoTransport implements TerminalTransport {
  private input: TerminalSubscription | null = null;

  constructor(
    private readonly spec: PwaConnectionSpec,
    private readonly onStatus: TransportStatusHandler,
  ) {}

  async connect(adapter: TerminalAdapter): Promise<void> {
    this.onStatus('connecting');
    adapter.write(`\r\n\x1b[1;36miwa-ssh Ghostty echo\x1b[0m\r\nTarget: ${this.spec.username ?? 'user'}@${this.spec.hostname}\r\n\r\n$ `);
    this.input = adapter.onInput((data) => {
      if (data === '\r') {
        adapter.write('\r\n$ ');
      } else if (data === '\u007f') {
        adapter.write('\b \b');
      } else {
        adapter.write(data);
      }
    });
    this.onStatus('connected');
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

export class SshDirectSocketsTransport implements TerminalTransport {
  private session: NasshRuntime | null = null;

  constructor(
    private readonly spec: PwaConnectionSpec,
    private readonly onStatus: TransportStatusHandler,
  ) {}

  async connect(adapter: TerminalAdapter): Promise<void> {
    if (this.spec.protocol === 'mosh') {
      // Surface the specific platform gap (UDP / mosh-client.wasm) through the
      // transport status path. The nassh mosh command-path runtime is not wired
      // yet — tracked in #44 (device-gated acceptance).
      const gate = await checkMoshPrerequisites();
      this.onStatus(
        'error',
        gate.ok
          ? 'Mosh runtime is not implemented yet; SSH is the supported transport (see #44).'
          : gate.message,
      );
      return;
    }

    this.session = new NasshRuntime({
      protocol: 'ssh',
      host: this.spec.hostname,
      port: this.spec.port ?? 22,
      username: this.spec.username ?? '',
      identityId: this.spec.identityId,
      connectionArgs: this.spec.argstr,
      startupCommand: this.spec.startupCommand,
      onStatus: (status, error) => this.onStatus(status, error),
    });
    this.session.attachTerminal(adapter);
    await this.session.connect();
  }

  async disconnect(): Promise<void> {
    await this.session?.disconnect({ reason: 'user' });
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }
}

export function createTransport(spec: PwaConnectionSpec, onStatus: TransportStatusHandler): TerminalTransport {
  return spec.protocol === 'echo' ? new EchoTransport(spec, onStatus) : new SshDirectSocketsTransport(spec, onStatus);
}
