import { describe, expect, it, vi } from 'vitest';
import { TsshdWorkerController, type TsshdWorkerEvent, type TsshdWorkerLike } from './TsshdWorkerController';

class FakeWorker implements TsshdWorkerLike {
  onmessage: ((event: MessageEvent<TsshdWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  requests: unknown[] = [];
  terminate = vi.fn();
  postMessage(request: unknown): void { this.requests.push(request); }
  emit(event: TsshdWorkerEvent): void { this.onmessage?.({ data: event } as MessageEvent<TsshdWorkerEvent>); }
}

const serverInfo = {
  ServerVer: '0.1.8', Port: 61382, Mode: 'KCP' as const,
  Pass: 'aabb', Salt: 'ccdd', ProxyKey: '0123456789abcdef0123456789abcdef',
  ClientID: '13200128884507580995', ServerID: '14014290635229521621',
};

describe('TsshdWorkerController', () => {
  it('waits for WASM readiness, then connects with byte-exact uint64 IDs', async () => {
    const worker = new FakeWorker();
    const events = vi.fn();
    const controller = new TsshdWorkerController({ createWorker: () => worker, onEvent: events });
    const initialized = controller.initialize();
    worker.emit({ type: 'ready' });
    await initialized;

    const connected = controller.connect('host', serverInfo, { cols: 80, rows: 24, widthPx: 0, heightPx: 0 });
    await Promise.resolve();
    expect(worker.requests[0]).toMatchObject({ type: 'connect', serverInfo: {
      ClientID: '13200128884507580995', ServerID: '14014290635229521621',
    } });
    worker.emit({ type: 'status', status: 'connected' });
    await connected;
    controller.sendInput('λ');
    expect(worker.requests.at(-1)).toEqual({ type: 'input', data: 'λ' });
  });

  it('rejects initialization on worker failure and terminates it', async () => {
    const worker = new FakeWorker();
    const events = vi.fn();
    const controller = new TsshdWorkerController({ createWorker: () => worker, onEvent: events });
    const initialized = controller.initialize();
    worker.onerror?.({} as ErrorEvent);
    await expect(initialized).rejects.toThrow('stopped unexpectedly');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledWith({ type: 'error', message: 'The TSSHD worker stopped unexpectedly.' });
  });

  it('times out a worker that never becomes ready and ignores its late events', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const events = vi.fn();
      const controller = new TsshdWorkerController({
        createWorker: () => worker,
        onEvent: events,
        initializeTimeoutMs: 5,
      });
      const initialized = controller.initialize();
      const rejected = expect(initialized).rejects.toThrow('Timed out waiting for the TSSHD worker to initialize.');

      await vi.advanceTimersByTimeAsync(5);
      await rejected;
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(events).toHaveBeenCalledWith({
        type: 'error',
        message: 'Timed out waiting for the TSSHD worker to initialize.',
      });

      events.mockClear();
      worker.emit({ type: 'ready' });
      worker.emit({ type: 'output', data: new Uint8Array([1]) });
      expect(events).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for disconnect acknowledgement and ignores late events after dispose', async () => {
    const worker = new FakeWorker();
    const events = vi.fn();
    const controller = new TsshdWorkerController({ createWorker: () => worker, onEvent: events, disconnectTimeoutMs: 5 });
    const initialized = controller.initialize();
    worker.emit({ type: 'ready' });
    await initialized;
    const stopping = controller.disconnect();
    expect(worker.requests.at(-1)).toEqual({ type: 'disconnect' });
    worker.emit({ type: 'status', status: 'disconnected' });
    await stopping;
    expect(worker.terminate).toHaveBeenCalledOnce();
    events.mockClear();
    worker.emit({ type: 'output', data: new Uint8Array([1]) });
    expect(events).not.toHaveBeenCalled();
  });
});
