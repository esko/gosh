/**
 * Minimal goshctl wire types and framing.
 * Source of truth: app/src/agent/protocol/ (Node cannot import that tree without .ts extensions).
 * Keep encode/decode behavior and method/param shapes aligned with the app protocol module.
 */

export const JSONRPC_VERSION = '2.0' as const;
export const AGENT_PROTOCOL_VERSION = 1;
export const AGENT_EVENT_NOTIFICATION = 'events.push' as const;
export const DEFAULT_MAX_FRAME_BYTES = 1_048_576;

export const RPC_PARSE_ERROR = -32700;
export const AGENT_PAYLOAD_TOO_LARGE = -32003;

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: unknown;
  id: JsonRpcId;
};

export type JsonRpcNotification = {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: unknown;
};

export type JsonRpcErrorResponse = {
  jsonrpc: typeof JSONRPC_VERSION;
  error: { code: number; message: string; data?: unknown };
  id: JsonRpcId | null;
};

export type JsonRpcSuccessResponse<T = unknown> = {
  jsonrpc: typeof JSONRPC_VERSION;
  result: T;
  id: JsonRpcId;
};

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;

export function isJsonRpcErrorResponse(response: JsonRpcResponse): response is JsonRpcErrorResponse {
  return 'error' in response;
}

export type AgentMethodName =
  | 'gosh.capabilities'
  | 'workspace.listWindows'
  | 'workspace.listTabs'
  | 'workspace.listPanes'
  | 'pane.split'
  | 'pane.focus'
  | 'pane.resize'
  | 'pane.zoom'
  | 'pane.close'
  | 'terminal.send'
  | 'terminal.read'
  | 'terminal.run'
  | 'pane.diagnostics'
  | 'browser.navigate'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'
  | 'browser.waitFor'
  | 'browser.snapshot'
  | 'browser.query'
  | 'browser.click'
  | 'browser.type'
  | 'browser.press'
  | 'browser.getUrl'
  | 'browser.getTitle'
  | 'events.subscribe';

export type AgentRpcParams = {
  'gosh.capabilities': { protocolVersion?: number };
  'workspace.listWindows': Record<string, never>;
  'workspace.listTabs': Record<string, never>;
  'workspace.listPanes': { tabId?: string };
  'pane.split': { tabId?: string; paneId?: string; direction: 'vertical' | 'horizontal'; surface?: 'terminal' | 'browser' };
  'pane.focus': { paneId: string };
  'pane.resize': { paneId: string; direction: 'left' | 'right' | 'up' | 'down'; amount?: number };
  'pane.zoom': { paneId: string; zoomed?: boolean };
  'pane.close': { paneId: string };
  'terminal.send': { paneId: string; data: string };
  'terminal.read': { paneId: string; maxBytes?: number };
  'terminal.run': { paneId: string; command: string; timeoutMs?: number; maxOutputBytes?: number };
  'pane.diagnostics': { paneId: string };
  'browser.navigate': { tabId: string; url: string };
  'browser.back': { tabId: string };
  'browser.forward': { tabId: string };
  'browser.reload': { tabId: string };
  'browser.waitFor': {
    tabId: string;
    selector?: string;
    text?: string;
    loadState?: 'load' | 'idle';
    timeoutMs?: number;
    pollIntervalMs?: number;
  };
  'browser.snapshot': { tabId: string; maxNodes?: number; maxBytes?: number };
  'browser.query': { tabId: string; role?: string; name?: string; text?: string; selector?: string };
  'browser.click': { tabId: string; ref: string };
  'browser.type': { tabId: string; ref: string; text: string; clear?: boolean };
  'browser.press': { tabId: string; ref: string; key: string };
  'browser.getUrl': { tabId: string };
  'browser.getTitle': { tabId: string };
  'events.subscribe': { types?: string[] };
};

export type PaneInfo = {
  paneId: string;
  tabId: string;
  windowId: string;
  active: boolean;
  zoomed: boolean;
};

type FrameDecodeError = {
  ok: false;
  code: number;
  message: string;
};

type FrameDecodeSuccess<T> = {
  ok: true;
  value: T;
  bytes: number;
};

export function encodeFrame(message: unknown, maxBytes = DEFAULT_MAX_FRAME_BYTES): string {
  const line = `${JSON.stringify(message)}\n`;
  const bytes = new TextEncoder().encode(line).byteLength;
  if (bytes > maxBytes) {
    throw new Error(`Frame exceeds max size (${bytes} > ${maxBytes} bytes)`);
  }
  return line;
}

function splitNdjsonLines(buffer: string): { lines: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');
  if (parts.length === 1) {
    return { lines: [], remainder: parts[0] ?? '' };
  }
  const remainder = parts.pop() ?? '';
  const lines = parts.filter((part) => part.length > 0).map((part) => `${part}\n`);
  return { lines, remainder };
}

function decodeFrame<T>(line: string, maxBytes = DEFAULT_MAX_FRAME_BYTES): FrameDecodeSuccess<T> | FrameDecodeError {
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
    return { ok: true, value: JSON.parse(trimmed) as T, bytes };
  } catch {
    return { ok: false, code: RPC_PARSE_ERROR, message: 'Invalid JSON' };
  }
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
