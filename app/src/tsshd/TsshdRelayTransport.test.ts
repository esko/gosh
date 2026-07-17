import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSink } from '../terminal/TerminalAdapter';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  initialize: vi.fn(),
  connect: vi.fn(),
  sendInput: vi.fn(),
  resize: vi.fn(),
  disconnect: vi.fn(),
  dispose: vi.fn(),
  onEvent: null as ((event: unknown) => void) | null,
}));

vi.mock('./bootstrap', () => ({ createTsshdSession: mocks.bootstrap }));
vi.mock('./TsshdWorkerController', () => ({
  createTsshdWorkerController: (onEvent: (event: unknown) => void) => {
    mocks.onEvent = onEvent;
    return {
      initialize: mocks.initialize,
      connect: mocks.connect,
      sendInput: mocks.sendInput,
      resize: mocks.resize,
      disconnect: mocks.disconnect,
      dispose: mocks.dispose,
    };
  },
}));

import { TsshdRelayTransport } from './TsshdRelayTransport';

const writes: Array<string | Uint8Array> = [];
const inputDispose = vi.fn();
const resizeDispose = vi.fn();
const adapter = {
  write: (data: string | Uint8Array) => writes.push(data),
  onInput: vi.fn(() => ({ dispose: inputDispose })),
  onResize: vi.fn(() => ({ dispose: resizeDispose })),
  focus: () => {},
  getSize: () => ({ cols: 80, rows: 24, widthPx: 960, heightPx: 576 }),
} satisfies TerminalSink;

const serverInfo = {
  ServerVer: '0.1.8', Port: 61382, Mode: 'KCP' as const,
  Pass: 'aabb', Salt: 'ccdd', ProxyKey: '0123456789abcdef0123456789abcdef',
  ClientID: '13200128884507580995', ServerID: '14014290635229521621',
};

describe('TsshdRelayTransport', () => {
  afterEach(() => {
    writes.length = 0;
    mocks.onEvent = null;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mocks.initialize.mockResolvedValue(undefined);
    mocks.connect.mockImplementation(async () => mocks.onEvent?.({ type: 'status', status: 'connected' }));
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.bootstrap.mockResolvedValue({ host: 'host', serverInfo });
  });

  it('surfaces missing Direct Sockets before creating a worker or bootstrapping SSH', async () => {
    vi.stubGlobal('TCPSocket', undefined);
    vi.stubGlobal('UDPSocket', undefined);
    const onStatus = vi.fn();
    const transport = new TsshdRelayTransport(
      { protocol: 'tsshd', hostname: 'host', username: 'user', args: [] },
      onStatus,
    );

    await expect(transport.connect(adapter)).rejects.toThrow('Direct Sockets (TCPSocket) is unavailable');
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(writes.join('')).toContain('Direct Sockets (TCPSocket) is unavailable');
  });

  it('warms WASM before bootstrap and preserves exact uint64 IDs into the worker', async () => {
    vi.stubGlobal('TCPSocket', function TCPSocket() {});
    vi.stubGlobal('UDPSocket', function UDPSocket() {});
    const sequence: string[] = [];
    mocks.initialize.mockImplementation(async () => { sequence.push('wasm-ready'); });
    mocks.bootstrap.mockImplementation(async () => { sequence.push('bootstrap'); return { host: 'host', serverInfo }; });
    mocks.connect.mockImplementation(async () => { sequence.push('udp-connect'); mocks.onEvent?.({ type: 'status', status: 'connected' }); });
    const onStatus = vi.fn();
    const transport = new TsshdRelayTransport(
      { protocol: 'tsshd', hostname: 'host', username: 'user', args: [] },
      onStatus,
    );

    await transport.connect(adapter);

    expect(sequence).toEqual(['wasm-ready', 'bootstrap', 'udp-connect']);
    expect(mocks.connect).toHaveBeenCalledWith('host', serverInfo, adapter.getSize());
    expect(onStatus).toHaveBeenLastCalledWith('connected');
    expect(adapter.onInput).toHaveBeenCalledOnce();
    expect(adapter.onResize).toHaveBeenCalledOnce();
  });

  it('does not bootstrap when the worker or WASM initialization fails', async () => {
    vi.stubGlobal('TCPSocket', function TCPSocket() {});
    vi.stubGlobal('UDPSocket', function UDPSocket() {});
    mocks.initialize.mockRejectedValue(new Error('TSSHD WASM has invalid content type: text/html.'));
    const onStatus = vi.fn();
    const transport = new TsshdRelayTransport(
      { protocol: 'tsshd', hostname: 'host', username: 'user', args: [] },
      onStatus,
    );

    await expect(transport.connect(adapter)).rejects.toThrow('invalid content type');
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('error', 'TSSHD WASM has invalid content type: text/html.');
  });

  it('terminates subscriptions and controller exactly once on repeated teardown', async () => {
    vi.stubGlobal('TCPSocket', function TCPSocket() {});
    vi.stubGlobal('UDPSocket', function UDPSocket() {});
    const onStatus = vi.fn();
    const transport = new TsshdRelayTransport(
      { protocol: 'tsshd', hostname: 'host', username: 'user', args: [] },
      onStatus,
    );
    await transport.connect(adapter);
    onStatus.mockClear();

    await transport.disconnect();
    await transport.disconnect();
    transport.dispose();
    transport.dispose();

    expect(inputDispose).toHaveBeenCalledOnce();
    expect(resizeDispose).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(onStatus.mock.calls).toEqual([['disconnecting'], ['disconnected']]);
  });
});
