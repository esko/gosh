import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { GoshControlClient } from '../src/client.js';
import { encodeFrame } from '../src/rpc.js';

type MockSocket = EventEmitter & {
  write: (chunk: string) => boolean;
  setEncoding: (encoding: string) => void;
  destroy: () => void;
};

function createMockSocket(): MockSocket {
  const socket = new EventEmitter() as MockSocket;
  socket.setEncoding = () => undefined;
  socket.write = () => true;
  socket.destroy = () => {
    socket.emit('close');
  };
  return socket;
}

describe('GoshControlClient cancellation', () => {
  it('rejects in-flight requests when the MCP abort signal fires', async () => {
    const socket = createMockSocket();
    const client = GoshControlClient.fromSocket(socket as unknown as Socket, 'token', {
      authenticated: true,
    });
    const controller = new AbortController();

    const pending = client.call('workspace.listTabs', {}, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('GoshControlClient responses', () => {
  it('resolves matching JSON-RPC responses by id', async () => {
    const socket = createMockSocket();
    const client = GoshControlClient.fromSocket(socket as unknown as Socket, 'token', {
      authenticated: true,
    });

    socket.write = (chunk) => {
      const request = JSON.parse(chunk.trim());
      if (request.method === 'gosh.authenticate') {
        socket.emit('data', encodeFrame({ jsonrpc: '2.0', result: { ok: true }, id: request.id }));
        return true;
      }
      if (request.method === 'workspace.listTabs') {
        socket.emit(
          'data',
          encodeFrame({
            jsonrpc: '2.0',
            result: [{ tabId: 'tab_1', title: 'local' }],
            id: request.id,
          }),
        );
      }
      return true;
    };

    const tabs = await client.call('workspace.listTabs', {});
    expect(tabs).toEqual([{ tabId: 'tab_1', title: 'local' }]);
  });
});
