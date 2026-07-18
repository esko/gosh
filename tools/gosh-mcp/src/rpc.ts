/** JSON-RPC 2.0 framing aligned with `docs/agent/PROTOCOL.md`. */
export const JSONRPC_VERSION = '2.0' as const;
export const AUTH_METHOD = 'gosh.authenticate' as const;
export const DEFAULT_MAX_FRAME_BYTES = 1_048_576;

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: unknown;
  id: JsonRpcId;
};

export type JsonRpcSuccessResponse<T = unknown> = {
  jsonrpc: typeof JSONRPC_VERSION;
  result: T;
  id: JsonRpcId;
};

export type JsonRpcErrorResponse = {
  jsonrpc: typeof JSONRPC_VERSION;
  error: { code: number; message: string; data?: unknown };
  id: JsonRpcId | null;
};

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;

export function isJsonRpcErrorResponse(
  response: JsonRpcResponse,
): response is JsonRpcErrorResponse {
  return 'error' in response;
}

export function encodeFrame(message: unknown, maxBytes = DEFAULT_MAX_FRAME_BYTES): string {
  const line = `${JSON.stringify(message)}\n`;
  const bytes = new TextEncoder().encode(line).byteLength;
  if (bytes > maxBytes) {
    throw new Error(`Frame exceeds max size (${bytes} > ${maxBytes} bytes)`);
  }
  return line;
}

export function decodeFrameLine<T = unknown>(line: string): T {
  const trimmed = line.endsWith('\n') ? line.slice(0, -1) : line;
  if (trimmed.length === 0) {
    throw new Error('Empty frame');
  }
  return JSON.parse(trimmed) as T;
}

export class GoshRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'GoshRpcError';
    this.code = code;
    this.data = data;
  }
}
