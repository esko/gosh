import {
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  makeRpcError,
} from './errors';
import { isAgentMethodName, type AgentMethodName, type AgentRpcParams } from './methods';
import { JSONRPC_VERSION, type JsonRpcErrorResponse, type JsonRpcRequest } from './types';

export type ValidationOk<M extends AgentMethodName = AgentMethodName> = {
  ok: true;
  request: JsonRpcRequest<M>;
  params: AgentRpcParams[M];
};

export type ValidationError = {
  ok: false;
  response: JsonRpcErrorResponse;
};

export type ValidationResult<M extends AgentMethodName = AgentMethodName> =
  | ValidationOk<M>
  | ValidationError;

function invalidRequest(id: string | number | null, message: string): ValidationError {
  return {
    ok: false,
    response: {
      jsonrpc: JSONRPC_VERSION,
      error: makeRpcError(RPC_INVALID_REQUEST, message),
      id,
    },
  };
}

function invalidParams(id: string | number | null, message: string): ValidationError {
  return {
    ok: false,
    response: {
      jsonrpc: JSONRPC_VERSION,
      error: makeRpcError(RPC_INVALID_PARAMS, message),
      id,
    },
  };
}

function methodNotFound(id: string | number | null, method: string): ValidationError {
  return {
    ok: false,
    response: {
      jsonrpc: JSONRPC_VERSION,
      error: makeRpcError(RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`),
      id,
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  id: string | number | null,
  obj: Record<string, unknown>,
  key: string,
): { ok: true; value: string } | ValidationError {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    return invalidParams(id, `${key} must be a non-empty string`);
  }
  return { ok: true, value };
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function validateMethodParams(
  id: string | number | null,
  method: AgentMethodName,
  params: unknown,
): { ok: true; params: AgentRpcParams[typeof method] } | ValidationError {
  const empty = {} as AgentRpcParams[typeof method];

  switch (method) {
    case 'gosh.capabilities': {
      if (params === undefined) return { ok: true, params: empty };
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const protocolVersion = params.protocolVersion;
      if (
        protocolVersion !== undefined &&
        (typeof protocolVersion !== 'number' || !Number.isInteger(protocolVersion))
      ) {
        return invalidParams(id, 'protocolVersion must be an integer');
      }
      return { ok: true, params: params as AgentRpcParams['gosh.capabilities'] };
    }
    case 'workspace.listWindows':
    case 'workspace.listTabs': {
      if (params === undefined) return { ok: true, params: empty };
      if (!isPlainObject(params) || Object.keys(params).length > 0) {
        return invalidParams(id, 'params must be an empty object or omitted');
      }
      return { ok: true, params: empty };
    }
    case 'workspace.listPanes': {
      if (params === undefined) return { ok: true, params: empty };
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const tabId = optionalString(params, 'tabId');
      if (params.tabId !== undefined && tabId === undefined) {
        return invalidParams(id, 'tabId must be a string');
      }
      return { ok: true, params: { tabId } };
    }
    case 'pane.split': {
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const direction = params.direction;
      if (direction !== 'vertical' && direction !== 'horizontal') {
        return invalidParams(id, 'direction must be vertical or horizontal');
      }
      const tabId = optionalString(params, 'tabId');
      if (params.tabId !== undefined && tabId === undefined) {
        return invalidParams(id, 'tabId must be a string');
      }
      return { ok: true, params: { direction, tabId } };
    }
    case 'pane.focus':
    case 'pane.close': {
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const paneId = requireString(id, params, 'paneId');
      if (!paneId.ok) return paneId;
      return { ok: true, params: { paneId: paneId.value } };
    }
    case 'pane.resize': {
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const paneId = requireString(id, params, 'paneId');
      if (!paneId.ok) return paneId;
      const direction = params.direction;
      if (direction !== 'left' && direction !== 'right' && direction !== 'up' && direction !== 'down') {
        return invalidParams(id, 'direction must be left, right, up, or down');
      }
      const amount = optionalNumber(params, 'amount');
      if (params.amount !== undefined && amount === undefined) {
        return invalidParams(id, 'amount must be a finite number');
      }
      return { ok: true, params: { paneId: paneId.value, direction, amount } };
    }
    case 'pane.zoom': {
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const paneId = requireString(id, params, 'paneId');
      if (!paneId.ok) return paneId;
      if (params.zoomed !== undefined && typeof params.zoomed !== 'boolean') {
        return invalidParams(id, 'zoomed must be a boolean');
      }
      return {
        ok: true,
        params: { paneId: paneId.value, zoomed: params.zoomed as boolean | undefined },
      };
    }
    case 'terminal.send': {
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const paneId = requireString(id, params, 'paneId');
      if (!paneId.ok) return paneId;
      if (typeof params.data !== 'string') {
        return invalidParams(id, 'data must be a string');
      }
      return { ok: true, params: { paneId: paneId.value, data: params.data } };
    }
    case 'terminal.read': {
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const paneId = requireString(id, params, 'paneId');
      if (!paneId.ok) return paneId;
      const maxBytes = optionalNumber(params, 'maxBytes');
      if (params.maxBytes !== undefined && maxBytes === undefined) {
        return invalidParams(id, 'maxBytes must be a finite number');
      }
      return { ok: true, params: { paneId: paneId.value, maxBytes } };
    }
    case 'terminal.run': {
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const paneId = requireString(id, params, 'paneId');
      if (!paneId.ok) return paneId;
      const command = requireString(id, params, 'command');
      if (!command.ok) return command;
      const timeoutMs = optionalNumber(params, 'timeoutMs');
      if (params.timeoutMs !== undefined && timeoutMs === undefined) {
        return invalidParams(id, 'timeoutMs must be a finite number');
      }
      return {
        ok: true,
        params: { paneId: paneId.value, command: command.value, timeoutMs },
      };
    }
    case 'events.subscribe': {
      if (params === undefined) return { ok: true, params: empty };
      if (!isPlainObject(params)) return invalidParams(id, 'params must be an object');
      const types = params.types;
      if (types !== undefined) {
        if (!Array.isArray(types) || types.some((t) => typeof t !== 'string')) {
          return invalidParams(id, 'types must be an array of strings');
        }
      }
      return { ok: true, params: { types: types as string[] | undefined } };
    }
    default: {
      const _exhaustive: never = method;
      return invalidParams(id, `Unhandled method: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Light structural validation for inbound JSON-RPC requests.
 * Does not check workspace ids or host availability — that stays in AgentControlService.
 */
export function validateRequest(value: unknown): ValidationResult {
  if (!isPlainObject(value)) {
    return invalidRequest(null, 'Request must be a JSON object');
  }

  const id = value.id;
  if (id !== null && typeof id !== 'string' && typeof id !== 'number') {
    return invalidRequest(null, 'id must be a string, number, or null');
  }
  const requestId = id as string | number | null;

  if (value.jsonrpc !== JSONRPC_VERSION) {
    return invalidRequest(requestId, `jsonrpc must be "${JSONRPC_VERSION}"`);
  }
  if (typeof value.method !== 'string') {
    return invalidRequest(requestId, 'method must be a string');
  }
  if (!('id' in value)) {
    return invalidRequest(null, 'Requests must include id (use notifications for one-way messages)');
  }

  const method = value.method;
  if (!isAgentMethodName(method)) {
    return methodNotFound(requestId, method);
  }

  const paramsResult = validateMethodParams(requestId, method, value.params);
  if (!paramsResult.ok) return paramsResult;

  return {
    ok: true,
    request: value as JsonRpcRequest<typeof method>,
    params: paramsResult.params,
  };
}
