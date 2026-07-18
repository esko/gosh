import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { encodeFrame } from './protocol.ts';
import { AUTH_METHOD, GoshControlClient } from './client.ts';

class MockSocket extends EventEmitter {
  written: string[] = [];

  write(data: string): boolean {
    this.written.push(data);
    return true;
  }

  end(): void {
    this.emit('close');
  }
}

function createMockClient() {
  const socket = new MockSocket();
  const client = new GoshControlClient({
    host: '127.0.0.1',
    port: 1,
    token: 'test-token',
    createSocket: () => socket as unknown as import('./client.ts').GoshSocket,
  });
  return { client, socket };
}

describe('GoshControlClient', () => {
  it('encodes authenticate then capabilities requests', async () => {
    const { client, socket } = createMockClient();
    const openPromise = client.open();
    socket.emit('connect');

    await Promise.resolve();
    expect(socket.written).toHaveLength(1);
    const authLine = socket.written[0]!;
    expect(authLine).toContain('"method":"gosh.authenticate"');
    expect(authLine).toContain('"token":"test-token"');

    const authRequest = JSON.parse(authLine.trim());
    socket.emit(
      'data',
      Buffer.from(
        encodeFrame({ jsonrpc: '2.0', result: { ok: true }, id: authRequest.id }),
      ),
    );

    const capsPromise = client.call('gosh.capabilities', {});
    await Promise.resolve();
    expect(socket.written).toHaveLength(2);
    const capsLine = socket.written[1]!;
    const capsRequest = JSON.parse(capsLine.trim());
    expect(capsRequest.method).toBe('gosh.capabilities');
    expect(capsRequest.params.protocolVersion).toBe(1);

    socket.emit(
      'data',
      Buffer.from(
        encodeFrame({
          jsonrpc: '2.0',
          result: { protocolVersion: 1, methods: {} },
          id: capsRequest.id,
        }),
      ),
    );

    await expect(openPromise).resolves.toBeUndefined();
    const caps = await capsPromise;
    expect(caps).toEqual({ protocolVersion: 1, methods: {} });
    client.close();
  });

  it('surfaces JSON-RPC errors as rpc failures', async () => {
    const { client, socket } = createMockClient();
    const openPromise = client.open();
    socket.emit('connect');
    await Promise.resolve();

    const authRequest = JSON.parse(socket.written[0]!.trim());
    socket.emit(
      'data',
      Buffer.from(encodeFrame({ jsonrpc: '2.0', result: { ok: true }, id: authRequest.id })),
    );
    await openPromise;

    const callPromise = client.call('pane.focus', { paneId: 'missing' });
    await Promise.resolve();
    const focusRequest = JSON.parse(socket.written[1]!.trim());
    socket.emit(
      'data',
      Buffer.from(
        encodeFrame({
          jsonrpc: '2.0',
          error: { code: -32602, message: 'Unknown pane: missing', data: { code: 'not-found' } },
          id: focusRequest.id,
        }),
      ),
    );

    await expect(callPromise).rejects.toMatchObject({
      kind: 'rpc',
      code: -32602,
      message: 'Unknown pane: missing',
    });
    client.close();
  });

  it('delivers events.push notifications to handlers', async () => {
    const { client, socket } = createMockClient();
    const openPromise = client.open();
    socket.emit('connect');
    await Promise.resolve();
    const authRequest = JSON.parse(socket.written[0]!.trim());
    socket.emit(
      'data',
      Buffer.from(encodeFrame({ jsonrpc: '2.0', result: { ok: true }, id: authRequest.id })),
    );
    await openPromise;

    const events: unknown[] = [];
    client.onNotification((notification) => {
      if (notification.method === 'events.push') events.push(notification.params);
    });

    socket.emit(
      'data',
      Buffer.from(
        encodeFrame({
          jsonrpc: '2.0',
          method: 'events.push',
          params: { subscriptionId: 'sub_1', event: { seq: 1, type: 'pane.focused' } },
        }),
      ),
    );

    expect(events).toHaveLength(1);
    client.close();
  });
});

describe('encode integration', () => {
  it('uses shared protocol framing for requests', () => {
    const frame = encodeFrame({ jsonrpc: '2.0', method: AUTH_METHOD, params: { token: 'x' }, id: 1 });
    expect(frame.endsWith('\n')).toBe(true);
    expect(JSON.parse(frame.trim()).method).toBe('gosh.authenticate');
  });
});
