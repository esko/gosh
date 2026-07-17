import type { TerminalViewport } from '../terminal/TerminalAdapter';
import type { TsshdServerInfo } from './types';

export type TsshdWorkerEvent =
  | { type: 'ready' }
  | { type: 'output'; data: Uint8Array }
  | { type: 'status'; status: 'connecting' | 'connected' | 'disconnected' }
  | { type: 'error'; message: string };

export type TsshdWorkerRequest =
  | { type: 'connect'; host: string; serverInfo: TsshdServerInfo; cols: number; rows: number }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'disconnect' };

export interface TsshdWorkerLike {
  onmessage: ((event: MessageEvent<TsshdWorkerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(request: TsshdWorkerRequest): void;
  terminate(): void;
}

function createBrowserTsshdWorker(): Worker {
  if (import.meta.env.DEV) {
    return new Worker(new URL('/src/tsshd/tsshdRelayWorker.ts', location.origin), { type: 'module', name: 'tsshd-relay' });
  }
  return new Worker(new URL('./tsshdRelayWorker.ts', import.meta.url), { type: 'module', name: 'tsshd-relay' });
}

export function createTsshdWorkerController(onEvent: (event: TsshdWorkerEvent) => void): TsshdWorkerController {
  return new TsshdWorkerController({ createWorker: createBrowserTsshdWorker, onEvent });
}

export class TsshdWorkerController {
  private worker: TsshdWorkerLike | null = null;
  private initializeResolve: (() => void) | null = null;
  private initializeReject: ((error: Error) => void) | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private disconnectResolve: (() => void) | null = null;
  private initializeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private initialized: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private connected = false;
  private disposed = false;

  constructor(private readonly dependencies: {
    createWorker(): TsshdWorkerLike;
    onEvent(event: TsshdWorkerEvent): void;
    initializeTimeoutMs?: number;
    disconnectTimeoutMs?: number;
  }) {}

  initialize(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('TSSHD worker controller was disposed.'));
    this.initialized ??= this.start();
    return this.initialized;
  }

  private start(): Promise<void> {
    const worker = this.dependencies.createWorker();
    this.worker = worker;
    worker.onmessage = (event) => {
      if (this.worker === worker) this.handleEvent(event.data);
    };
    worker.onerror = () => this.fail(new Error('The TSSHD worker stopped unexpectedly.'));
    worker.onmessageerror = () => this.fail(new Error('Unable to decode a TSSHD worker message.'));
    return new Promise<void>((resolve, reject) => {
      this.initializeResolve = () => {
        this.clearInitializeTimer();
        resolve();
      };
      this.initializeReject = (error) => {
        this.clearInitializeTimer();
        reject(error);
      };
      this.initializeTimer = globalThis.setTimeout(
        () => this.fail(new Error('Timed out waiting for the TSSHD worker to initialize.')),
        this.dependencies.initializeTimeoutMs ?? 30_000,
      );
    });
  }

  async connect(host: string, serverInfo: TsshdServerInfo, viewport: TerminalViewport): Promise<void> {
    await this.initialize();
    if (this.disposed || !this.worker) throw new Error('TSSHD worker controller was disposed.');
    const connected = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
    this.worker.postMessage({
      type: 'connect',
      host,
      serverInfo,
      cols: viewport.cols,
      rows: viewport.rows,
    });
    return connected;
  }

  sendInput(data: string): void {
    if (!this.disposed && this.connected) this.worker?.postMessage({ type: 'input', data });
  }

  resize(viewport: TerminalViewport): void {
    if (!this.disposed) this.worker?.postMessage({ type: 'resize', cols: viewport.cols, rows: viewport.rows });
  }

  disconnect(): Promise<void> {
    this.stopping ??= this.stop();
    return this.stopping;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error('TSSHD worker controller was disposed.');
    this.initializeReject?.(error);
    this.connectReject?.(error);
    this.clearPending();
    void this.disconnect();
  }

  private handleEvent(event: TsshdWorkerEvent): void {
    if (!event || typeof event !== 'object') {
      this.fail(new Error('Invalid TSSHD worker event.'));
      return;
    }
    if (event.type === 'ready') {
      this.initializeResolve?.();
      this.initializeResolve = null;
      this.initializeReject = null;
      return;
    }
    if (event.type === 'status' && event.status === 'disconnected') {
      this.connected = false;
      this.disconnectResolve?.();
      if (!this.disposed) this.dependencies.onEvent(event);
      return;
    }
    if (this.disposed) return;
    if (event.type === 'error') {
      this.fail(new Error(event.message || 'TSSHD worker failed.'));
      return;
    }
    this.dependencies.onEvent(event);
    if (event.type === 'status' && event.status === 'connected') {
      this.connected = true;
      this.connectResolve?.();
      this.connectResolve = null;
      this.connectReject = null;
    }
  }

  private fail(error: Error): void {
    if (!this.worker && !this.initializeReject && !this.connectReject) return;
    this.dependencies.onEvent({ type: 'error', message: error.message });
    this.initializeReject?.(error);
    this.connectReject?.(error);
    this.clearPending();
    this.worker?.terminate();
    this.worker = null;
  }

  private clearPending(): void {
    this.clearInitializeTimer();
    this.initializeResolve = null;
    this.initializeReject = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  private clearInitializeTimer(): void {
    if (this.initializeTimer === null) return;
    globalThis.clearTimeout(this.initializeTimer);
    this.initializeTimer = null;
  }

  private async stop(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    const acknowledged = new Promise<void>((resolve) => { this.disconnectResolve = resolve; });
    worker.postMessage({ type: 'disconnect' });
    await Promise.race([
      acknowledged,
      new Promise<void>((resolve) => globalThis.setTimeout(resolve, this.dependencies.disconnectTimeoutMs ?? 1_000)),
    ]);
    this.disconnectResolve = null;
    if (this.worker === worker) this.worker = null;
    worker.terminate();
  }
}
