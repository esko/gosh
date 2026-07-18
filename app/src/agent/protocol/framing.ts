import { AGENT_PAYLOAD_TOO_LARGE, RPC_PARSE_ERROR, makeRpcError } from './errors';
import { JSONRPC_VERSION, type JsonRpcErrorResponse, type JsonRpcRequest } from './types';

/** Default max NDJSON frame size (1 MiB). */
export const DEFAULT_MAX_FRAME_BYTES = 1_048_576;

export type FrameDecodeError = {
  ok: false;
  code: typeof RPC_PARSE_ERROR | typeof AGENT_PAYLOAD_TOO_LARGE;
  message: string;
  line?: string;
};

export type FrameDecodeSuccess<T = unknown> = {
  ok: true;
  value: T;
  bytes: number;
};

export type FrameDecodeResult<T = unknown> = FrameDecodeSuccess<T> | FrameDecodeError;

export class FrameTooLargeError extends Error {
  readonly code = AGENT_PAYLOAD_TOO_LARGE;
  readonly bytes: number;
  readonly maxBytes: number;

  constructor(bytes: number, maxBytes: number) {
    super(`Frame exceeds max size (${bytes} > ${maxBytes} bytes)`);
    this.name = 'FrameTooLargeError';
    this.bytes = bytes;
    this.maxBytes = maxBytes;
  }
}

export class InvalidJsonLineError extends Error {
  readonly code = RPC_PARSE_ERROR;
  readonly line: string;

  constructor(line: string, cause?: unknown) {
    super('Invalid JSON in NDJSON frame');
    this.name = 'InvalidJsonLineError';
    this.line = line;
    if (cause instanceof Error) this.cause = cause;
  }
}

/** Encode one JSON-RPC message as a single NDJSON line (trailing newline). */
export function encodeFrame(message: unknown, maxBytes = DEFAULT_MAX_FRAME_BYTES): string {
  const line = `${JSON.stringify(message)}\n`;
  const bytes = new TextEncoder().encode(line).byteLength;
  if (bytes > maxBytes) {
    throw new FrameTooLargeError(bytes, maxBytes);
  }
  return line;
}

/** Decode one NDJSON line. Does not consume partial lines. */
export function decodeFrame<T = unknown>(
  line: string,
  maxBytes = DEFAULT_MAX_FRAME_BYTES,
): FrameDecodeResult<T> {
  const trimmed = line.endsWith('\n') ? line.slice(0, -1) : line;
  if (trimmed.length === 0) {
    return {
      ok: false,
      code: RPC_PARSE_ERROR,
      message: 'Empty frame',
      line,
    };
  }
  const bytes = new TextEncoder().encode(trimmed).byteLength;
  if (bytes > maxBytes) {
    return {
      ok: false,
      code: AGENT_PAYLOAD_TOO_LARGE,
      message: `Frame exceeds max size (${bytes} > ${maxBytes} bytes)`,
      line: trimmed,
    };
  }
  try {
    const value = JSON.parse(trimmed) as T;
    return { ok: true, value, bytes };
  } catch {
    return {
      ok: false,
      code: RPC_PARSE_ERROR,
      message: 'Invalid JSON',
      line: trimmed,
    };
  }
}

/** Split a buffer into complete NDJSON lines (handles \\n and \\r\\n). */
export function splitNdjsonLines(buffer: string): { lines: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');
  if (parts.length === 1) {
    return { lines: [], remainder: parts[0] ?? '' };
  }
  const remainder = parts.pop() ?? '';
  const lines = parts.filter((part) => part.length > 0).map((part) => `${part}\n`);
  return { lines, remainder };
}

export function decodeFrames<T = unknown>(
  buffer: string,
  maxBytes = DEFAULT_MAX_FRAME_BYTES,
): { decoded: FrameDecodeSuccess<T>[]; errors: FrameDecodeError[]; remainder: string } {
  const { lines, remainder } = splitNdjsonLines(buffer);
  const decoded: FrameDecodeSuccess<T>[] = [];
  const errors: FrameDecodeError[] = [];
  for (const line of lines) {
    const result = decodeFrame<T>(line, maxBytes);
    if (result.ok) decoded.push(result);
    else errors.push(result);
  }
  return { decoded, errors, remainder };
}

export function parseErrorResponse(
  id: string | number | null,
  code: typeof RPC_PARSE_ERROR | typeof AGENT_PAYLOAD_TOO_LARGE,
  message: string,
): JsonRpcErrorResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    error: makeRpcError(code, message),
    id,
  };
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.jsonrpc === JSONRPC_VERSION && typeof record.method === 'string' && 'id' in record;
}
