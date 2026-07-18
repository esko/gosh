import { Socket } from 'node:net';
import {
  AUTH_METHOD,
  GoshRpcError,
  JSONRPC_VERSION,
  decodeFrameLine,
  encodeFrame,
  isJsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcResponse,
} from './rpc.js';

export type GoshControlClientOptions = {
  host?: string;
  port: number;
  token: string;
  connectTimeoutMs?: number;
};

export type GoshControlRequestOptions = {
  signal?: AbortSignal;
};

export class GoshControlClient {
  private readonly socket: Socket;
  private readonly token: string;
  private buffer = '';
  private nextId = 1;
  private authenticated = false; // set true after gosh.authenticate or fromSocket({ authenticated: true })
  private closed = false;
  private readonly pending = new Map<
    JsonRpcId,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      abortCleanup?: () => void;
    }
  >();

  private constructor(socket: Socket, token: string) {
    this.socket = socket;
    this.token = token;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string | Buffer) => {
      this.onData(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    });
    socket.on('error', (error) => this.rejectAll(error));
    socket.on('close', () => {
      this.closed = true;
      this.rejectAll(new Error('Gosh control connection closed'));
    });
  }

  static async connect(options: GoshControlClientOptions): Promise<GoshControlClient> {
    const host = options.host ?? '127.0.0.1';
    const timeoutMs = options.connectTimeoutMs ?? 10_000;
    const socket = await new Promise<Socket>((resolve, reject) => {
      const s = new Socket();
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error(`Timed out connecting to ${host}:${options.port}`));
      }, timeoutMs);
      s.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      s.connect(options.port, host, () => {
        clearTimeout(timer);
        resolve(s);
      });
    });
    const client = new GoshControlClient(socket, options.token);
    await client.authenticate();
    return client;
  }

  /** Test hook: client over an already-open socket (optionally pre-authenticated). */
  static fromSocket(
    socket: Socket,
    token: string,
    options: { authenticated?: boolean } = {},
  ): GoshControlClient {
    const client = new GoshControlClient(socket, token);
    if (options.authenticated) {
      client.authenticated = true;
    }
    return client;
  }

  static fromEnv(): Promise<GoshControlClient> {
    const port = Number(process.env.GOSH_AGENT_PORT ?? process.env.GOSH_CONTROL_PORT);
    const token = process.env.GOSH_AGENT_TOKEN ?? process.env.GOSH_CONTROL_TOKEN;
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('GOSH_AGENT_PORT (or GOSH_CONTROL_PORT) must be a positive integer');
    }
    if (!token) {
      throw new Error('GOSH_AGENT_TOKEN (or GOSH_CONTROL_TOKEN) is required');
    }
    return GoshControlClient.connect({
      host: process.env.GOSH_AGENT_HOST ?? process.env.GOSH_CONTROL_HOST ?? '127.0.0.1',
      port,
      token,
    });
  }

  async call(method: string, params: unknown, options: GoshControlRequestOptions = {}): Promise<unknown> {
    if (this.closed) {
      throw new Error('Client is closed');
    }
    if (!this.authenticated && method !== AUTH_METHOD) {
      throw new Error('Client is not authenticated');
    }
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const id = this.nextId++;
    const request = {
      jsonrpc: JSONRPC_VERSION,
      method,
      params,
      id,
    };

    return new Promise<unknown>((resolve, reject) => {
      const abortCleanup = bindAbort(options.signal, () => {
        this.pending.delete(id);
        reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      });

      this.pending.set(id, {
        resolve,
        reject,
        abortCleanup,
      });

      try {
        this.socket.write(encodeFrame(request));
      } catch (error) {
        this.pending.delete(id);
        abortCleanup?.();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new Error('Client closed'));
    this.socket.destroy();
  }

  private async authenticate(): Promise<void> {
    const result = await this.call(AUTH_METHOD, { token: this.token });
    if (!isAuthOk(result)) {
      throw new Error('Authentication failed');
    }
    this.authenticated = true;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex + 1);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = decodeFrameLine<JsonRpcResponse>(line);
    } catch {
      return;
    }

    if (isJsonRpcErrorResponse(message)) {
      if (message.id === null) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      entry.abortCleanup?.();
      entry.reject(
        new GoshRpcError(message.error.code, message.error.message, message.error.data),
      );
      return;
    }

    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    entry.abortCleanup?.();
    entry.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.abortCleanup?.();
      entry.reject(error);
    }
  }
}

function bindAbort(signal: AbortSignal | undefined, onAbort: () => void): (() => void) | undefined {
  if (!signal) return undefined;
  if (signal.aborted) {
    onAbort();
    return undefined;
  }
  const listener = () => onAbort();
  signal.addEventListener('abort', listener, { once: true });
  return () => signal.removeEventListener('abort', listener);
}

function isAuthOk(value: unknown): value is { ok: true } {
  return typeof value === 'object' && value !== null && (value as { ok?: boolean }).ok === true;
}

/** Shape an outbound JSON-RPC request for tests and diagnostics. */
export function shapeRequest(
  method: string,
  params: unknown,
  id: number,
): { jsonrpc: string; method: string; params: unknown; id: number } {
  return {
    jsonrpc: JSONRPC_VERSION,
    method,
    params,
    id,
  };
}

/** Shape the authenticate handshake request. */
export function shapeAuthRequest(token: string, id = 1) {
  return shapeRequest(AUTH_METHOD, { token }, id);
}
