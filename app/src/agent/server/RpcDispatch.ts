import type { AgentControlService } from '../AgentControlService';
import { AGENT_PROTOCOL_VERSION } from '../protocol/methods';
import { agentErrorToRpcCode, makeRpcError, type AgentProtocolErrorCode } from '../protocol/errors';
import type { AgentErrorCode } from '../types';
import type { AgentMethodName, AgentRpcParams } from '../protocol/methods';
import type { JsonRpcErrorResponse } from '../protocol/types';

export type RpcDispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; response: JsonRpcErrorResponse };

export async function dispatchAgentRpc(
  service: AgentControlService,
  method: AgentMethodName,
  params: AgentRpcParams[AgentMethodName],
  requestId: string | number | null,
): Promise<RpcDispatchResult> {
  switch (method) {
    case 'gosh.capabilities': {
      const requested = (params as AgentRpcParams['gosh.capabilities']).protocolVersion;
      if (requested !== undefined && requested !== AGENT_PROTOCOL_VERSION) {
        return {
          ok: false,
          response: {
            jsonrpc: '2.0',
            error: makeRpcError(-32602, `Unsupported protocol version: ${requested}`),
            id: requestId,
          },
        };
      }
      return {
        ok: true,
        result: { protocolVersion: AGENT_PROTOCOL_VERSION, ...service.capabilities() },
      };
    }
    case 'workspace.listWindows':
      return wrap(service.listWindows(), requestId);
    case 'workspace.listTabs':
      return wrap(service.listTabs(), requestId);
    case 'workspace.listPanes':
      return wrap(service.listPanes(params as AgentRpcParams['workspace.listPanes']), requestId);
    case 'pane.split':
      return wrap(await service.paneSplit(params as AgentRpcParams['pane.split']), requestId);
    case 'pane.focus':
      return wrap(service.paneFocus(params as AgentRpcParams['pane.focus']), requestId);
    case 'pane.resize':
      return wrap(service.paneResize(params as AgentRpcParams['pane.resize']), requestId);
    case 'pane.zoom':
      return wrap(service.paneZoom(params as AgentRpcParams['pane.zoom']), requestId);
    case 'pane.close':
      return wrap(service.paneClose(params as AgentRpcParams['pane.close']), requestId);
    case 'terminal.send':
      return wrap(service.terminalSend(params as AgentRpcParams['terminal.send']), requestId);
    case 'terminal.read':
      return wrap(service.terminalRead(params as AgentRpcParams['terminal.read']), requestId);
    case 'terminal.run': {
      const runParams = params as AgentRpcParams['terminal.run'];
      return wrap(
        await service.terminalRun({
          pane: runParams.paneId,
          command: runParams.command,
          timeoutMs: runParams.timeoutMs,
          maxOutputBytes: runParams.maxOutputBytes,
        }),
        requestId,
      );
    }
    case 'pane.diagnostics':
      return wrap(service.paneDiagnostics(params as AgentRpcParams['pane.diagnostics']), requestId);
    case 'events.subscribe':
      return {
        ok: true,
        result: {
          subscriptionId: `sub_${crypto.randomUUID()}`,
          types: (params as AgentRpcParams['events.subscribe']).types,
        },
      };
    default: {
      const _exhaustive: never = method;
      return {
        ok: false,
        response: {
          jsonrpc: '2.0',
          error: makeRpcError(-32601, `Unknown method: ${String(_exhaustive)}`),
          id: requestId,
        },
      };
    }
  }
}

function wrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
  requestId: string | number | null,
): RpcDispatchResult {
  if (result.ok) return { ok: true, result: result.value };
  return {
    ok: false,
    response: {
      jsonrpc: '2.0',
      error: makeRpcError(
        agentErrorToRpcCode(result.error.code as AgentErrorCode) as AgentProtocolErrorCode,
        result.error.message,
        { code: result.error.code as AgentErrorCode },
      ),
      id: requestId,
    },
  };
}
