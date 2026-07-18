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
          force: runParams.force,
        }),
        requestId,
      );
    }
    case 'pane.diagnostics':
      return wrap(service.paneDiagnostics(params as AgentRpcParams['pane.diagnostics']), requestId);
    case 'browser.navigate':
      return wrap(service.browserNavigate(params as AgentRpcParams['browser.navigate']), requestId);
    case 'browser.back':
      return wrap(await service.browserBack(params as AgentRpcParams['browser.back']), requestId);
    case 'browser.forward':
      return wrap(await service.browserForward(params as AgentRpcParams['browser.forward']), requestId);
    case 'browser.reload':
      return wrap(service.browserReload(params as AgentRpcParams['browser.reload']), requestId);
    case 'browser.waitFor':
      return wrap(await service.browserWaitFor(params as AgentRpcParams['browser.waitFor']), requestId);
    case 'browser.snapshot':
      return wrap(await service.browserSnapshot(params as AgentRpcParams['browser.snapshot']), requestId);
    case 'browser.query':
      return wrap(await service.browserQuery(params as AgentRpcParams['browser.query']), requestId);
    case 'browser.click':
      return wrap(await service.browserClick(params as AgentRpcParams['browser.click']), requestId);
    case 'browser.type':
      return wrap(await service.browserType(params as AgentRpcParams['browser.type']), requestId);
    case 'browser.press':
      return wrap(await service.browserPress(params as AgentRpcParams['browser.press']), requestId);
    case 'browser.getUrl':
      return wrap(service.browserGetUrl(params as AgentRpcParams['browser.getUrl']), requestId);
    case 'browser.getTitle':
      return wrap(service.browserGetTitle(params as AgentRpcParams['browser.getTitle']), requestId);
    case 'events.subscribe':
      return {
        ok: true,
        result: {
          subscriptionId: `sub_${crypto.randomUUID()}`,
          types: (params as AgentRpcParams['events.subscribe']).types,
        },
      };
    case 'agent.audit.list':
      return {
        ok: false,
        response: {
          jsonrpc: '2.0',
          error: makeRpcError(-32603, 'agent.audit.list must be handled by ControlServer'),
          id: requestId,
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
