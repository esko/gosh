/**
 * Minimal NDJSON JSON-RPC helpers for agent control transport probes.
 * Keep aligned with app/src/agent/protocol/ and tools/goshctl/src/protocol.ts.
 */

export const JSONRPC_VERSION = '2.0';
export const AGENT_PROTOCOL_VERSION = 1;
export const DEFAULT_MAX_FRAME_BYTES = 1_048_576;

export const RPC_PARSE_ERROR = -32700;
export const AGENT_UNAUTHORIZED = -32002;
export const AGENT_PAYLOAD_TOO_LARGE = -32003;

export const AUTH_METHOD = 'gosh.authenticate';

export function encodeFrame(message, maxBytes = DEFAULT_MAX_FRAME_BYTES) {
  const line = `${JSON.stringify(message)}\n`;
  const bytes = new TextEncoder().encode(line).byteLength;
  if (bytes > maxBytes) {
    throw new Error(`Frame exceeds max size (${bytes} > ${maxBytes} bytes)`);
  }
  return line;
}

function splitNdjsonLines(buffer) {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');
  if (parts.length === 1) {
    return { lines: [], remainder: parts[0] ?? '' };
  }
  const remainder = parts.pop() ?? '';
  const lines = parts.filter((part) => part.length > 0).map((part) => `${part}\n`);
  return { lines, remainder };
}

function decodeFrame(line, maxBytes = DEFAULT_MAX_FRAME_BYTES) {
  const trimmed = line.endsWith('\n') ? line.slice(0, -1) : line;
  if (trimmed.length === 0) {
    return { ok: false, code: RPC_PARSE_ERROR, message: 'Empty frame' };
  }
  const bytes = new TextEncoder().encode(trimmed).byteLength;
  if (bytes > maxBytes) {
    return {
      ok: false,
      code: AGENT_PAYLOAD_TOO_LARGE,
      message: `Frame exceeds max size (${bytes} > ${maxBytes} bytes)`,
    };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed), bytes };
  } catch {
    return { ok: false, code: RPC_PARSE_ERROR, message: 'Invalid JSON' };
  }
}

export function decodeFrames(buffer, maxBytes = DEFAULT_MAX_FRAME_BYTES) {
  const { lines, remainder } = splitNdjsonLines(buffer);
  const decoded = [];
  const errors = [];
  for (const line of lines) {
    const result = decodeFrame(line, maxBytes);
    if (result.ok) decoded.push(result);
    else errors.push(result);
  }
  return { decoded, errors, remainder };
}

export function isJsonRpcErrorResponse(response) {
  return typeof response === 'object' && response !== null && 'error' in response;
}
