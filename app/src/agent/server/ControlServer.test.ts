import { describe, expect, it } from 'vitest';
import { AgentControlService } from '../AgentControlService';
import { WorkspaceRegistry } from '../WorkspaceRegistry';
import { AGENT_PAYLOAD_TOO_LARGE, AGENT_UNAUTHORIZED } from '../protocol/errors';
import { encodeFrame } from '../protocol/framing';
import { JSONRPC_VERSION } from '../protocol/types';
import { AuditRing } from '../security/AuditLog';
import { ControlPermissions } from '../security/Permissions';
import { AUTH_METHOD, ControlServer, resetControlServerClientCounter, unterminatedExceedsLimit, type ControlTransport } from './ControlServer';

function createService(): AgentControlService {
  const registry = new WorkspaceRegistry({ windowId: 'win_test' });
  registry.openTab({ kind: 'terminal', title: 't' });
  return new AgentControlService({ registry, host: null });
}

function createDuplex(): {
  transport: ControlTransport;
  clientWrite: (obj: unknown) => Promise<void>;
  clientWriteRaw: (text: string) => Promise<void>;
  clientRead: () => Promise<string>;
  close: () => Promise<void>;
} {
  let serverReadController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let clientReadController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const serverReadable = new ReadableStream<Uint8Array>({
    start(controller) {
      serverReadController = controller;
    },
  });
  const clientReadable = new ReadableStream<Uint8Array>({
    start(controller) {
      clientReadController = controller;
    },
  });
  const serverWritable = new WritableStream<Uint8Array>({
    write(chunk) {
      clientReadController?.enqueue(chunk);
    },
  });
  const clientWritable = new WritableStream<Uint8Array>({
    write(chunk) {
      serverReadController?.enqueue(chunk);
    },
  });
  let clientReadBuffer = '';
  const clientRead = async (): Promise<string> => {
    while (!clientReadBuffer.includes('\n')) {
      const reader = clientReadable.getReader();
      const { value, done } = await reader.read();
      reader.releaseLock();
      if (done) break;
      clientReadBuffer += new TextDecoder().decode(value);
    }
    const idx = clientReadBuffer.indexOf('\n');
    const line = clientReadBuffer.slice(0, idx + 1);
    clientReadBuffer = clientReadBuffer.slice(idx + 1);
    return line;
  };
  const transport: ControlTransport = {
    readable: serverReadable,
    writable: serverWritable,
    close: async () => {
      await serverWritable.close().catch(() => undefined);
      await serverReadable.cancel().catch(() => undefined);
    },
  };
  return {
    transport,
    clientWrite: async (obj) => {
      const writer = clientWritable.getWriter();
      await writer.write(new TextEncoder().encode(encodeFrame(obj)));
      writer.releaseLock();
    },
    clientWriteRaw: async (text) => {
      const writer = clientWritable.getWriter();
      await writer.write(new TextEncoder().encode(text));
      writer.releaseLock();
    },
    clientRead,
    close: async () => {
      await clientWritable.close().catch(() => undefined);
      await clientReadable.cancel().catch(() => undefined);
    },
  };
}

function createServer(service: AgentControlService, token = 'pair-token', audit = new AuditRing()) {
  resetControlServerClientCounter();
  return new ControlServer({
    service,
    permissions: new ControlPermissions({ token, maxRequestsPerSecond: 100 }),
    audit,
  });
}

describe('ControlServer', () => {
  it('rejects workspace methods before authentication', async () => {
    const server = createServer(createService());
    const { transport, clientWrite, clientRead, close } = createDuplex();
    server.attachConnection(transport);
    await clientWrite({ jsonrpc: JSONRPC_VERSION, method: 'workspace.listTabs', id: 1 });
    const response = JSON.parse((await clientRead()).trim());
    expect(response.error.code).toBe(AGENT_UNAUTHORIZED);
    await close();
  });

  it('authenticates and dispatches workspace.listTabs', async () => {
    const audit = new AuditRing();
    const server = createServer(createService(), 'pair-token', audit);
    const { transport, clientWrite, clientRead, close } = createDuplex();
    server.attachConnection(transport);

    await clientWrite({ jsonrpc: JSONRPC_VERSION, method: AUTH_METHOD, params: { token: 'pair-token' }, id: 1 });
    expect(JSON.parse((await clientRead()).trim()).result).toEqual({ ok: true });

    await clientWrite({ jsonrpc: JSONRPC_VERSION, method: 'workspace.listTabs', id: 2 });
    const tabs = JSON.parse((await clientRead()).trim());
    expect(tabs.result).toHaveLength(1);
    expect(audit.list().some((entry) => entry.method === 'workspace.listTabs' && entry.ok)).toBe(true);
    await close();
  });

  it('rejects wrong pairing tokens', async () => {
    const server = createServer(createService(), 'expected');
    const { transport, clientWrite, clientRead, close } = createDuplex();
    server.attachConnection(transport);
    await clientWrite({ jsonrpc: JSONRPC_VERSION, method: AUTH_METHOD, params: { token: 'wrong' }, id: 1 });
    expect(JSON.parse((await clientRead()).trim()).error.code).toBe(AGENT_UNAUTHORIZED);
    await close();
  });

  it('rejects oversized decoded frames after auth', async () => {
    const server = new ControlServer({
      service: createService(),
      permissions: new ControlPermissions({ token: 'pair-token' }),
      maxFrameBytes: 200,
    });
    const { transport, clientWrite, clientWriteRaw, clientRead, close } = createDuplex();
    server.attachConnection(transport);
    await clientWrite({ jsonrpc: JSONRPC_VERSION, method: AUTH_METHOD, params: { token: 'pair-token' }, id: 1 });
    await clientRead();
    await clientWriteRaw(`${'a'.repeat(250)}\n`);
    const response = JSON.parse((await clientRead()).trim());
    expect(response.error.code).toBe(AGENT_PAYLOAD_TOO_LARGE);
    await close();
  });

  it('detects unterminated oversize buffers', () => {
    expect(unterminatedExceedsLimit('{"jsonrpc":"2.0"' + 'x'.repeat(32), 16)).toBe(true);
    expect(unterminatedExceedsLimit('{"jsonrpc":"2.0"}\n', 16)).toBe(false);
  });
});
