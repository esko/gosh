import type { AgentCapabilities, AgentEvent } from '../types';
import type { AgentMethodName } from './methods';

export const JSONRPC_VERSION = '2.0' as const;
export type JsonRpcVersion = typeof JSONRPC_VERSION;

/** JSON-RPC request id: string, number, or null (notifications omit id). */
export type JsonRpcId = string | number;

export type JsonRpcRequest<M extends AgentMethodName = AgentMethodName> = {
  jsonrpc: JsonRpcVersion;
  method: M;
  params?: unknown;
  id: JsonRpcId;
};

export type JsonRpcNotification<M extends string = string> = {
  jsonrpc: JsonRpcVersion;
  method: M;
  params?: unknown;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcSuccessResponse<T = unknown> = {
  jsonrpc: JsonRpcVersion;
  result: T;
  id: JsonRpcId;
};

export type JsonRpcErrorResponse = {
  jsonrpc: JsonRpcVersion;
  error: JsonRpcErrorObject;
  id: JsonRpcId | null;
};

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;

export function isJsonRpcErrorResponse(
  response: JsonRpcResponse,
): response is JsonRpcErrorResponse {
  return 'error' in response;
}

export type GoshCapabilitiesResult = AgentCapabilities & {
  protocolVersion: number;
};

export type EventsSubscribeResult = {
  subscriptionId: string;
};

export type EventsPushParams = {
  subscriptionId: string;
  event: AgentEvent;
};

/** Typed success payloads keyed by method (for clients and docs). */
export type AgentRpcResult = {
  'gosh.capabilities': GoshCapabilitiesResult;
  'workspace.listWindows': import('../types').WindowInfo[];
  'workspace.listTabs': import('../types').TabInfo[];
  'workspace.listPanes': import('../types').PaneInfo[];
  'pane.split': { paneId: string; tabId: string };
  'pane.focus': { paneId: string };
  'pane.resize': { paneId: string; resized: boolean };
  'pane.zoom': { paneId: string; zoomed: boolean };
  'pane.close': { paneId: string; closed: boolean };
  'terminal.send': { paneId: string };
  'terminal.read': { data: string; truncated?: boolean };
  'terminal.run': { exitCode: number; stdout: string; stderr: string };
  'events.subscribe': EventsSubscribeResult;
};
