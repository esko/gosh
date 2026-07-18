import { describe, expect, it } from 'vitest';
import { AGENT_METHODS } from '@gosh/protocol/methods.js';
import { shapeAuthRequest, shapeRequest } from '../src/client.js';
import { encodeFrame } from '../src/rpc.js';
import {
  GOSH_MCP_PROTOCOL_METHODS,
  GOSH_MCP_TOOL_NAMES,
  GOSH_MCP_TOOLS,
  assertToolMethodsAreProtocolMethods,
  getToolByName,
} from '../src/tools.js';

describe('gosh-mcp tools', () => {
  it('lists the expected MCP tools', () => {
    expect(GOSH_MCP_TOOL_NAMES).toEqual([
      'gosh_list_workspaces',
      'gosh_list_panes',
      'gosh_terminal_read',
      'gosh_terminal_send',
      'gosh_terminal_run',
      'gosh_pane_split',
      'gosh_pane_resize',
      'gosh_pane_focus',
      'gosh_pane_zoom',
      'gosh_pane_close',
      'gosh_browser_navigate',
      'gosh_browser_back',
      'gosh_browser_forward',
      'gosh_browser_reload',
      'gosh_browser_wait_for',
      'gosh_browser_snapshot',
      'gosh_browser_query',
      'gosh_browser_click',
      'gosh_browser_type',
      'gosh_browser_press',
      'gosh_browser_get_url',
      'gosh_browser_get_title',
    ]);
  });

  it('maps every tool to a registered agent protocol method', () => {
    expect(() => assertToolMethodsAreProtocolMethods()).not.toThrow();
    for (const method of GOSH_MCP_PROTOCOL_METHODS) {
      expect(AGENT_METHODS).toContain(method);
    }
    for (const tool of GOSH_MCP_TOOLS) {
      expect(AGENT_METHODS).toContain(tool.method);
    }
  });

  it('shapes protocol params for pane operations', () => {
    const split = getToolByName('gosh_pane_split');
    expect(split?.toParams({ direction: 'vertical', tabId: 'tab_1' })).toEqual({
      direction: 'vertical',
      tabId: 'tab_1',
    });

    const resize = getToolByName('gosh_pane_resize');
    expect(resize?.toParams({ paneId: 'pane_1', direction: 'right', amount: 4 })).toEqual({
      paneId: 'pane_1',
      direction: 'right',
      amount: 4,
    });
  });

  it('shapes protocol params for terminal operations', () => {
    const run = getToolByName('gosh_terminal_run');
    expect(
      run?.toParams({
        paneId: 'pane_1',
        command: 'echo hi',
        timeoutMs: 5000,
      }),
    ).toEqual({
      paneId: 'pane_1',
      command: 'echo hi',
      timeoutMs: 5000,
    });
  });

  it('shapes protocol params for browser operations', () => {
    const navigate = getToolByName('gosh_browser_navigate');
    expect(navigate?.toParams({ tabId: 'tab_1', url: 'https://example.com' })).toEqual({
      tabId: 'tab_1',
      url: 'https://example.com',
    });

    const snapshot = getToolByName('gosh_browser_snapshot');
    expect(snapshot?.toParams({ tabId: 'tab_1', maxNodes: 100 })).toEqual({
      tabId: 'tab_1',
      maxNodes: 100,
    });

    const type = getToolByName('gosh_browser_type');
    expect(type?.toParams({ tabId: 'tab_1', ref: 'e2', text: 'hello', clear: false })).toEqual({
      tabId: 'tab_1',
      ref: 'e2',
      text: 'hello',
      clear: false,
    });

    const waitFor = getToolByName('gosh_browser_wait_for');
    expect(
      waitFor?.toParams({ tabId: 'tab_1', selector: '#main', loadState: 'idle', timeoutMs: 3000 }),
    ).toEqual({
      tabId: 'tab_1',
      selector: '#main',
      loadState: 'idle',
      timeoutMs: 3000,
    });
  });
});

describe('gosh-mcp client request shaping', () => {
  it('encodes authenticate handshake per PROTOCOL.md', () => {
    const request = shapeAuthRequest('pairing-token', 1);
    expect(request).toEqual({
      jsonrpc: '2.0',
      method: 'gosh.authenticate',
      params: { token: 'pairing-token' },
      id: 1,
    });
    expect(encodeFrame(request)).toBe(
      '{"jsonrpc":"2.0","method":"gosh.authenticate","params":{"token":"pairing-token"},"id":1}\n',
    );
  });

  it('encodes workspace and terminal RPC requests', () => {
    const listTabs = shapeRequest('workspace.listTabs', {}, 2);
    expect(encodeFrame(listTabs)).toBe(
      '{"jsonrpc":"2.0","method":"workspace.listTabs","params":{},"id":2}\n',
    );

    const terminalRun = shapeRequest(
      'terminal.run',
      { paneId: 'pane_abc', command: 'pwd' },
      3,
    );
    expect(encodeFrame(terminalRun)).toBe(
      '{"jsonrpc":"2.0","method":"terminal.run","params":{"paneId":"pane_abc","command":"pwd"},"id":3}\n',
    );
  });
});
