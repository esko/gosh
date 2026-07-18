import type { AgentErrorCode } from '../types';

/** JSON-RPC 2.0 standard error codes. */
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

/** Gosh agent protocol extensions (server implementation range -32000..-32099). */
export const AGENT_TIMEOUT = -32000;
export const AGENT_CANCELLED = -32001;
export const AGENT_UNAUTHORIZED = -32002;
export const AGENT_PAYLOAD_TOO_LARGE = -32003;
export const AGENT_CONFLICT = -32004;

export type AgentProtocolErrorCode =
  | typeof RPC_PARSE_ERROR
  | typeof RPC_INVALID_REQUEST
  | typeof RPC_METHOD_NOT_FOUND
  | typeof RPC_INVALID_PARAMS
  | typeof RPC_INTERNAL_ERROR
  | typeof AGENT_TIMEOUT
  | typeof AGENT_CANCELLED
  | typeof AGENT_UNAUTHORIZED
  | typeof AGENT_PAYLOAD_TOO_LARGE
  | typeof AGENT_CONFLICT;

export type AgentApplicationErrorCode = AgentErrorCode;

export type AgentRpcErrorData = {
  /** Application-level code when the failure is from AgentControlService. */
  code?: AgentApplicationErrorCode;
  [key: string]: unknown;
};

export const PROTOCOL_ERROR_MESSAGES: Record<AgentProtocolErrorCode, string> = {
  [RPC_PARSE_ERROR]: 'Parse error',
  [RPC_INVALID_REQUEST]: 'Invalid request',
  [RPC_METHOD_NOT_FOUND]: 'Method not found',
  [RPC_INVALID_PARAMS]: 'Invalid params',
  [RPC_INTERNAL_ERROR]: 'Internal error',
  [AGENT_TIMEOUT]: 'Request timed out',
  [AGENT_CANCELLED]: 'Request cancelled',
  [AGENT_UNAUTHORIZED]: 'Unauthorized',
  [AGENT_PAYLOAD_TOO_LARGE]: 'Payload too large',
  [AGENT_CONFLICT]: 'Conflict with human input',
};

export function protocolErrorMessage(code: AgentProtocolErrorCode): string {
  return PROTOCOL_ERROR_MESSAGES[code];
}

export function agentErrorToRpcCode(code: AgentErrorCode): number {
  switch (code) {
    case 'not-found':
      return RPC_INVALID_PARAMS;
    case 'invalid-argument':
      return RPC_INVALID_PARAMS;
    case 'unavailable':
      return RPC_INTERNAL_ERROR;
    case 'failed':
      return RPC_INTERNAL_ERROR;
    case 'conflict':
      return AGENT_CONFLICT;
    default:
      return RPC_INTERNAL_ERROR;
  }
}

export function makeRpcError(
  code: AgentProtocolErrorCode,
  message?: string,
  data?: AgentRpcErrorData,
): { code: number; message: string; data?: AgentRpcErrorData } {
  return {
    code,
    message: message ?? protocolErrorMessage(code),
    ...(data !== undefined ? { data } : {}),
  };
}
