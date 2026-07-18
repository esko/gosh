import type { AgentControlService } from '../AgentControlService';
import type { AgentEvent } from '../types';
import type { AgentSubscription } from '../AgentEventBus';
import {
  AGENT_EVENT_NOTIFICATION,
  type AgentMethodName,
} from '../protocol/methods';
import {
  AGENT_PAYLOAD_TOO_LARGE,
  AGENT_UNAUTHORIZED,
  RPC_INVALID_REQUEST,
  makeRpcError,
} from '../protocol/errors';
import {
  DEFAULT_MAX_FRAME_BYTES,
  decodeFrames,
  encodeFrame,
  isJsonRpcRequest,
  parseErrorResponse,
} from '../protocol/framing';
import type { JsonRpcId, JsonRpcRequest, JsonRpcResponse } from '../protocol/types';
import { validateRequest } from '../protocol/validate';
import { AuditRing } from '../security/AuditLog';
import { ControlPermissions, DEFAULT_SLOW_SUBSCRIBER_BYTES } from '../security/Permissions';
import { dispatchAgentRpc } from './RpcDispatch';

export const AUTH_METHOD = 'gosh.authenticate' as const;

export type ControlTransport = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
};

export type ControlServerStatus = {
  listening: boolean;
  address: string | null;
  port: number | null;
  connectedClients: number;
  transportAvailable: boolean;
};

type ClientSubscription = {
  subscriptionId: string;
  types?: string[];
};

type ClientState = {
  id: string;
  transport: ControlTransport;
  authenticated: boolean;
  readBuffer: string;
  writeChain: Promise<void>;
  pendingEventBytes: number;
  eventPaused: boolean;
  subscriptions: Map<string, ClientSubscription>;
  closed: boolean;
};

export type ControlServerOptions = {
  service: AgentControlService;
  permissions: ControlPermissions;
  audit?: AuditRing;
  bindAddress?: string;
  maxFrameBytes?: number;
  slowSubscriberBytes?: number;
  onStatusChange?: (status: ControlServerStatus) => void;
  createServerSocket?: () => DirectTcpServerSocket | null;
};

type DirectTcpServerSocket = {
  opened: Promise<{
    readable: ReadableStream<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close(): Promise<void> }>;
    localAddress: string;
    localPort: number;
  }>;
  close(): Promise<void>;
};

let clientCounter = 0;

function nextClientId(): string {
  clientCounter += 1;
  return `client_${clientCounter}`;
}

export function isControlTransportAvailable(): boolean {
  return typeof (globalThis as { TCPServerSocket?: unknown }).TCPServerSocket === 'function';
}

export class ControlServer {
  private readonly service: AgentControlService;
  private readonly permissions: ControlPermissions;
  private readonly audit: AuditRing;
  private readonly bindAddress: string;
  private readonly maxFrameBytes: number;
  private readonly slowSubscriberBytes: number;
  private readonly onStatusChange?: (status: ControlServerStatus) => void;
  private readonly createServerSocket: () => DirectTcpServerSocket | null;

  private serverSocket: DirectTcpServerSocket | null = null;
  private acceptReader: ReadableStreamDefaultReader<{
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    close(): Promise<void>;
  }> | null = null;
  private acceptLoopPromise: Promise<void> | null = null;
  private address: string | null = null;
  private port: number | null = null;
  private readonly clients = new Map<string, ClientState>();
  private eventSub: AgentSubscription | null = null;
  private stopping = false;

  constructor(options: ControlServerOptions) {
    this.service = options.service;
    this.permissions = options.permissions;
    this.audit = options.audit ?? new AuditRing();
    this.bindAddress = options.bindAddress ?? '127.0.0.1';
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.slowSubscriberBytes = options.slowSubscriberBytes ?? DEFAULT_SLOW_SUBSCRIBER_BYTES;
    this.onStatusChange = options.onStatusChange;
    this.createServerSocket =
      options.createServerSocket ??
      (() => {
        const Ctor = (globalThis as { TCPServerSocket?: new (host: string, opts: { localPort?: number }) => DirectTcpServerSocket })
          .TCPServerSocket;
        if (!Ctor) return null;
        return new Ctor(this.bindAddress, { localPort: 0 });
      });
  }

  getStatus(): ControlServerStatus {
    return {
      listening: this.serverSocket !== null,
      address: this.address,
      port: this.port,
      connectedClients: this.clients.size,
      transportAvailable: isControlTransportAvailable(),
    };
  }

  async start(): Promise<{ address: string; port: number }> {
    if (this.serverSocket) {
      if (this.address && this.port) return { address: this.address, port: this.port };
      throw new Error('Control server is already starting');
    }
    const socket = this.createServerSocket();
    if (!socket) throw new Error('TCPServerSocket is unavailable in this environment');
    this.stopping = false;
    this.serverSocket = socket;
    const opened = await socket.opened;
    this.address = opened.localAddress;
    this.port = opened.localPort;
    this.acceptReader = opened.readable.getReader();
    this.eventSub = this.service.subscribe((event) => this.broadcastEvent(event));
    this.acceptLoopPromise = this.acceptLoop();
    this.emitStatus();
    return { address: opened.localAddress, port: opened.localPort };
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.eventSub?.dispose();
    this.eventSub = null;
    if (this.acceptReader) {
      await this.acceptReader.cancel().catch(() => undefined);
      this.acceptReader.releaseLock();
      this.acceptReader = null;
    }
    if (this.serverSocket) {
      await this.serverSocket.close().catch(() => undefined);
      this.serverSocket = null;
    }
    await this.acceptLoopPromise?.catch(() => undefined);
    this.acceptLoopPromise = null;
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((client) => this.closeClient(client)));
    this.address = null;
    this.port = null;
    this.emitStatus();
  }

  /** Test hook: attach a fake byte-stream connection. */
  attachConnection(transport: ControlTransport): string {
    const client: ClientState = {
      id: nextClientId(),
      transport,
      authenticated: false,
      readBuffer: '',
      writeChain: Promise.resolve(),
      pendingEventBytes: 0,
      eventPaused: false,
      subscriptions: new Map(),
      closed: false,
    };
    this.clients.set(client.id, client);
    void this.readConnection(client, transport);
    this.emitStatus();
    return client.id;
  }

  private async acceptLoop(): Promise<void> {
    const reader = this.acceptReader;
    if (!reader) return;
    try {
      while (!this.stopping) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        if (!this.permissions.canAcceptClient(this.clients.size)) {
          await value.close().catch(() => undefined);
          continue;
        }
        const transport: ControlTransport = {
          readable: value.readable,
          writable: value.writable,
          close: () => value.close(),
        };
        this.attachConnection(transport);
      }
    } catch {
      // Server closed.
    }
  }

  private async readConnection(client: ClientState, transport: ControlTransport): Promise<void> {
    const reader = transport.readable.getReader();
    const decoder = new TextDecoder();
    try {
      while (!client.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        client.readBuffer += decoder.decode(value, { stream: true });
        if (unterminatedExceedsLimit(client.readBuffer, this.maxFrameBytes)) {
          await this.sendResponse(client, parseErrorResponse(null, AGENT_PAYLOAD_TOO_LARGE, 'Line exceeds max frame size'));
          break;
        }
        const { decoded, errors, remainder } = decodeFrames(client.readBuffer, this.maxFrameBytes);
        client.readBuffer = remainder;
        for (const err of errors) {
          await this.sendResponse(client, parseErrorResponse(null, err.code, err.message));
        }
        for (const frame of decoded) {
          const responses = await this.handleMessage(client, frame.value);
          for (const response of responses) {
            await this.sendResponse(client, response);
          }
        }
      }
    } catch {
      // Connection dropped.
    } finally {
      reader.releaseLock();
      await this.removeClient(client.id);
      await transport.close().catch(() => undefined);
    }
  }

  private async handleMessage(client: ClientState, value: unknown): Promise<JsonRpcResponse[]> {
    if (!isJsonRpcRequest(value)) {
      const id =
        typeof value === 'object' && value !== null && 'id' in value
          ? (value as { id: JsonRpcId | null }).id
          : null;
      return [
        {
          jsonrpc: '2.0',
          error: makeRpcError(RPC_INVALID_REQUEST, 'Invalid JSON-RPC request'),
          id: id ?? null,
        },
      ];
    }

    const request = value as JsonRpcRequest;
    const method = (request as { method: string }).method;

    if (!this.permissions.allowRequest(client.id)) {
      return [unauthorizedResponse(request.id, 'Rate limit exceeded')];
    }

    if (method === AUTH_METHOD) {
      return [await this.handleAuthenticate(client, request)];
    }

    if (!client.authenticated) {
      return [unauthorizedResponse(request.id)];
    }

    const validated = validateRequest(request);
    if (!validated.ok) {
      this.audit.append({ method, clientId: client.id, ok: false, errorCode: 'invalid-request' });
      return [validated.response];
    }

    const dispatched = await dispatchAgentRpc(
      this.service,
      validated.request.method as AgentMethodName,
      validated.params,
      validated.request.id,
    );

    if (!dispatched.ok) {
      this.audit.append({
        method,
        clientId: client.id,
        ok: false,
        errorCode: String(dispatched.response.error.code),
      });
      return [dispatched.response];
    }

    if (validated.request.method === 'events.subscribe') {
      const result = dispatched.result as { subscriptionId: string; types?: string[] };
      client.subscriptions.set(result.subscriptionId, {
        subscriptionId: result.subscriptionId,
        types: result.types,
      });
    }

    this.audit.append({ method, clientId: client.id, ok: true });
    return [{ jsonrpc: '2.0', result: dispatched.result, id: validated.request.id }];
  }

  private async handleAuthenticate(
    client: ClientState,
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    const params = request.params;
    if (typeof params !== 'object' || params === null || typeof (params as { token?: unknown }).token !== 'string') {
      return {
        jsonrpc: '2.0',
        error: makeRpcError(RPC_INVALID_REQUEST, 'token must be a string'),
        id: request.id,
      };
    }
    const token = (params as { token: string }).token;
    const ok = this.permissions.verifyToken(token);
    client.authenticated = ok;
    this.audit.append({
      method: AUTH_METHOD,
      clientId: client.id,
      ok,
      ...(ok ? {} : { errorCode: 'unauthorized' }),
    });
    if (!ok) return unauthorizedResponse(request.id);
    return { jsonrpc: '2.0', result: { ok: true }, id: request.id };
  }

  private broadcastEvent(event: AgentEvent): void {
    for (const client of this.clients.values()) {
      if (!client.authenticated || client.closed || client.eventPaused || client.subscriptions.size === 0) continue;
      for (const sub of client.subscriptions.values()) {
        if (sub.types && sub.types.length > 0 && !sub.types.includes(event.type)) continue;
        const notification = {
          jsonrpc: '2.0',
          method: AGENT_EVENT_NOTIFICATION,
          params: { subscriptionId: sub.subscriptionId, event },
        };
        let frame: string;
        try {
          frame = encodeFrame(notification, this.maxFrameBytes);
        } catch {
          client.eventPaused = true;
          continue;
        }
        const bytes = new TextEncoder().encode(frame).byteLength;
        if (client.pendingEventBytes + bytes > this.slowSubscriberBytes) {
          client.eventPaused = true;
          continue;
        }
        client.pendingEventBytes += bytes;
        void this.enqueueWrite(client, frame).finally(() => {
          client.pendingEventBytes = Math.max(0, client.pendingEventBytes - bytes);
          if (client.pendingEventBytes < this.slowSubscriberBytes / 2) {
            client.eventPaused = false;
          }
        });
      }
    }
  }

  private async sendResponse(client: ClientState, response: JsonRpcResponse): Promise<void> {
    const frame = encodeFrame(response, this.maxFrameBytes);
    await this.enqueueWrite(client, frame);
  }

  private enqueueWrite(client: ClientState, frame: string): Promise<void> {
    client.writeChain = client.writeChain.then(async () => {
      if (client.closed) return;
      const writer = client.transport.writable.getWriter();
      try {
        await writer.write(new TextEncoder().encode(frame));
      } catch {
        client.closed = true;
      } finally {
        writer.releaseLock();
      }
    });
    return client.writeChain;
  }

  private async removeClient(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;
    await this.closeClient(client);
    this.clients.delete(clientId);
    this.permissions.clearClient(clientId);
    this.emitStatus();
  }

  private async closeClient(client: ClientState): Promise<void> {
    client.closed = true;
    client.subscriptions.clear();
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.getStatus());
  }
}

function unauthorizedResponse(id: JsonRpcId | null, message?: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    error: makeRpcError(AGENT_UNAUTHORIZED, message),
    id,
  };
}

export function unterminatedExceedsLimit(buffer: string, maxBytes: number): boolean {
  if (buffer.includes('\n')) return false;
  return new TextEncoder().encode(buffer).byteLength > maxBytes;
}

/** Exposed for tests. */
export function resetControlServerClientCounter(): void {
  clientCounter = 0;
}
