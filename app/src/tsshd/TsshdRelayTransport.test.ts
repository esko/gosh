import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSink } from '../terminal/TerminalAdapter';
import { TsshdRelayTransport } from './TsshdRelayTransport';

const writes: Array<string | Uint8Array> = [];
const adapter = {
  write: (data: string | Uint8Array) => writes.push(data),
  onInput: vi.fn(() => ({ dispose: vi.fn() })),
  onResize: vi.fn(() => ({ dispose: vi.fn() })),
  focus: () => {},
  getSize: () => ({ cols: 80, rows: 24, widthPx: 960, heightPx: 576 }),
} satisfies TerminalSink;

describe('TsshdRelayTransport', () => {
  afterEach(() => {
    writes.length = 0;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('surfaces missing Direct Sockets as a visible terminal error', async () => {
    vi.stubGlobal('TCPSocket', undefined);
    vi.stubGlobal('UDPSocket', undefined);
    const onStatus = vi.fn();
    const transport = new TsshdRelayTransport(
      { protocol: 'tsshd', hostname: 'host', username: 'user', args: [] },
      onStatus,
    );

    await expect(transport.connect(adapter)).rejects.toThrow('Direct Sockets (TCPSocket) is unavailable');

    expect(onStatus.mock.calls).toEqual([
      ['connecting'],
      ['error', 'Direct Sockets (TCPSocket) is unavailable. Install as an IWA with direct-sockets permission.'],
    ]);
    expect(writes.join('')).toContain('Direct Sockets (TCPSocket) is unavailable');
    expect(adapter.onInput).not.toHaveBeenCalled();
  });

  it('does not bootstrap or pretend to connect when the native relay cannot run in the IWA', async () => {
    vi.stubGlobal('TCPSocket', function TCPSocket() {});
    vi.stubGlobal('UDPSocket', function UDPSocket() {});
    const onStatus = vi.fn();
    const transport = new TsshdRelayTransport(
      {
        protocol: 'tsshd',
        hostname: 'host',
        username: 'user',
        args: [],
        tsshd: { udpMode: 'QUIC' },
      },
      onStatus,
    );

    await expect(transport.connect(adapter)).rejects.toThrow(
      'tsshd is not available in this browser build: the native QUIC relay cannot run inside an IWA.',
    );

    expect(onStatus.mock.calls).toEqual([
      ['connecting'],
      ['error', 'tsshd is not available in this browser build: the native QUIC relay cannot run inside an IWA.'],
    ]);
    expect(writes.join('')).toContain('native QUIC relay cannot run inside an IWA');
    expect(onStatus).not.toHaveBeenCalledWith('connected');
    expect(adapter.onInput).not.toHaveBeenCalled();
  });

  it('identifies missing UDP Direct Sockets separately from SSH bootstrap support', async () => {
    vi.stubGlobal('TCPSocket', function TCPSocket() {});
    vi.stubGlobal('UDPSocket', undefined);
    const onStatus = vi.fn();
    const transport = new TsshdRelayTransport(
      { protocol: 'tsshd', hostname: 'host', username: 'user', args: [] },
      onStatus,
    );

    await expect(transport.connect(adapter)).rejects.toThrow('Direct Sockets (UDPSocket) is unavailable');
    expect(onStatus).toHaveBeenLastCalledWith(
      'error',
      'Direct Sockets (UDPSocket) is unavailable. Install as an IWA with direct-sockets permission.',
    );
  });

  it('disconnects a failed transport at most once and tolerates repeated dispose', async () => {
    vi.stubGlobal('TCPSocket', undefined);
    vi.stubGlobal('UDPSocket', undefined);
    const onStatus = vi.fn();
    const transport = new TsshdRelayTransport(
      { protocol: 'tsshd', hostname: 'host', username: 'user', args: [] },
      onStatus,
    );
    await transport.connect(adapter).catch(() => undefined);
    onStatus.mockClear();

    await transport.disconnect();
    await transport.disconnect();
    transport.dispose();
    transport.dispose();

    expect(onStatus.mock.calls).toEqual([
      ['disconnecting'],
      ['disconnected'],
    ]);
  });
});
