import { connect, type Socket } from 'node:net';
import {
  AGENT_EVENT_NOTIFICATION,
  AGENT_PROTOCOL_VERSION,
  decodeFrames,
  encodeFrame,
  isJsonRpcErrorResponse,
  type AgentMethodName,
  type AgentRpcParams,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol.ts';

/** Transport auth method — source of truth: app/src/agent/server/ControlServer.ts */
export const AUTH_METHOD = 'gosh.authenticate' as const;

export type RpcCallError = {
  kind: 'rpc';
  code: number;
  message: string;
  data?: unknown;
};

export type ProtocolCallError = {
  kind: 'protocol';
  message: string;
  cause?: unknown;
};

export type CallError = RpcCallError | ProtocolCallError;

export type GoshSocket = Pick<Socket, 'write' | 'end' | 'on' | 'once' | 'removeListener'>;

export type GoshControlClientOptions = {
  host: string;
  port: number;
  token: string;
  createSocket?: () => GoshSocket;
};

type PendingRequest = {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: ProtocolCallError) => void;
};

export class GoshControlClient {
  private readonly host: string;
  private readonly port: number;
  private readonly token: string;
  private readonly createSocket: () => GoshSocket;
  private socket: GoshSocket | null = null;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private notificationHandlers = new Set<(notification: JsonRpcNotification) => void>();
  private dataListener: ((chunk: Buffer) => void) | null = null;

  constructor(options: GoshControlClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.token = options.token;
    this.createSocket =
      options.createSocket ??
      (() => connect({ host: this.host, port: this.port }) as unknown as GoshSocket);
  }

  async open(): Promise<void> {
    if (this.socket) return;
    const socket = this.createSocket();
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    this.attachSocket(socket);
    await this.authenticate();
  }

  private attachSocket(socket: GoshSocket): void {
    this.socket = socket;
    this.dataListener = (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      const { decoded, errors, remainder } = decodeFrames<JsonRpcResponse | JsonRpcNotification>(this.buffer);
      this.buffer = remainder;
      if (errors.length > 0) {
        const message = errors.map((err) => err.message).join('; ');
        for (const pending of this.pending.values()) {
          pending.reject({ kind: 'protocol', message });
        }
        this.pending.clear();
      }
      for (const frame of decoded) {
        const value = frame.value;
        if (typeof value === 'object' && value !== null && 'method' in value && !('id' in value)) {
          this.notificationHandlers.forEach((handler) => handler(value as JsonRpcNotification));
          continue;
        }
        const response = value as JsonRpcResponse;
        const id = response.id;
        if (id === null || id === undefined) continue;
        const pending = this.pending.get(id);
        if (!pending) continue;
        this.pending.delete(id);
        pending.resolve(response);
      }
    };
    socket.on('data', this.dataListener);
    socket.on('error', (error) => {
      const protocolError: ProtocolCallError = { kind: 'protocol', message: error.message, cause: error };
      for (const pending of this.pending.values()) pending.reject(protocolError);
      this.pending.clear();
    });
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  async authenticate(): Promise<void> {
    await this.request(AUTH_METHOD, { token: this.token });
  }

  async call<M extends AgentMethodName>(method: M, params: AgentRpcParams[M]): Promise<unknown> {
    if (method === 'gosh.capabilities') {
      const p = params as AgentRpcParams['gosh.capabilities'];
      if (p.protocolVersion === undefined) {
        return this.request(method, { protocolVersion: AGENT_PROTOCOL_VERSION } as AgentRpcParams[M]);
      }
    }
    return this.request(method, params);
  }

  private async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.socket) {
      throw { kind: 'protocol', message: 'Client is not connected' } satisfies ProtocolCallError;
    }
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', method, params, id };
    const frame = encodeFrame(request);
    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.socket!.write(frame);
      } catch (cause) {
        this.pending.delete(id);
        reject({ kind: 'protocol', message: 'Write failed', cause } satisfies ProtocolCallError);
      }
    });
    if (isJsonRpcErrorResponse(response)) {
      throw {
        kind: 'rpc',
        code: response.error.code,
        message: response.error.message,
        data: response.error.data,
      } satisfies RpcCallError;
    }
    return response.result;
  }

  close(): void {
    if (this.socket && this.dataListener) {
      this.socket.removeListener('data', this.dataListener);
    }
    this.socket?.end();
    this.socket = null;
    this.notificationHandlers.clear();
    for (const pending of this.pending.values()) {
      pending.reject({ kind: 'protocol', message: 'Client closed' });
    }
    this.pending.clear();
  }
}

export { AGENT_EVENT_NOTIFICATION };
