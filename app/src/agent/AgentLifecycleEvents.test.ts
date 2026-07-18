import { describe, expect, it } from 'vitest';
import { AgentEventBus } from './AgentEventBus';
import { AgentControlService } from './AgentControlService';
import { WorkspaceRegistry } from './WorkspaceRegistry';
import {
  createBrowserAgentStateHook,
  getAgentControlService,
  getWorkspaceRegistry,
  resetAgentControl,
} from '../pwa/agentControlHost';

describe('Agent lifecycle events', () => {
  it('emits window.opened when the workspace registry boots', () => {
    const events: Array<{ type: string; seq: number; windowId: string }> = [];
    const bus = new AgentEventBus();
    bus.subscribe((event) => {
      events.push({ type: event.type, seq: event.seq, windowId: event.windowId });
    });
    new WorkspaceRegistry({ windowId: 'win_boot', events: bus });
    expect(events).toEqual([{ type: 'window.opened', seq: 1, windowId: 'win_boot' }]);
  });

  it('emits window.closed once on closeWindow', () => {
    const reg = new WorkspaceRegistry({ windowId: 'win_close' });
    const types: string[] = [];
    reg.events.subscribe((event) => types.push(event.type));

    reg.closeWindow();
    reg.closeWindow();
    expect(types).toEqual(['window.closed']);
    expect(reg.events.lastSeq).toBe(2);
  });

  it('resetAgentControl closes the live workspace window', () => {
    resetAgentControl();
    const reg = getWorkspaceRegistry();
    const types: string[] = [];
    reg.events.subscribe((event) => types.push(event.type));
    resetAgentControl();
    expect(types).toEqual(['window.closed']);
    resetAgentControl();
  });

  it('emits terminal.disconnected with monotonic seq', () => {
    const registry = new WorkspaceRegistry({ windowId: 'win_term' });
    const tabId = registry.openTab({ kind: 'terminal', title: 'ssh' });
    const paneId = registry.openPane({ tabId, surface: 'terminal', resttyPaneId: 1 });
    const service = new AgentControlService({ registry, host: null });
    const captured: Array<{ type: string; seq: number; paneId?: string }> = [];
    service.subscribe((event) => {
      captured.push({ type: event.type, seq: event.seq, paneId: event.paneId });
    });

    service.notePaneDisconnected(paneId);

    const disconnects = captured.filter((e) => e.type === 'terminal.disconnected');
    expect(disconnects).toEqual([{ type: 'terminal.disconnected', seq: 4, paneId }]);
    expect(captured.map((e) => e.seq)).toEqual([4]);
  });

  it('emits browser.load.failed from noteBrowserLoadFailed', () => {
    const registry = new WorkspaceRegistry({ windowId: 'win_browser' });
    const tabId = registry.openTab({ kind: 'browser', title: 'Browser' });
    const service = new AgentControlService({ registry, host: null });
    const events: Array<{ type: string; seq: number; tabId?: string; url?: string; failureReason?: string }> = [];
    service.subscribe((event) => {
      events.push({
        type: event.type,
        seq: event.seq,
        tabId: event.tabId,
        url: event.url,
        failureReason: event.failureReason,
      });
    });

    service.noteBrowserLoadFailed(tabId, 'https://fail.test', 'net_error');
    service.noteBrowserLoadFailed('tab_missing', 'https://x', 'ignored');

    expect(events).toEqual([
      {
        type: 'browser.load.failed',
        seq: 3,
        tabId,
        url: 'https://fail.test',
        failureReason: 'net_error',
      },
    ]);
  });

  it('wires browser.load.failed through createBrowserAgentStateHook on failed transition', () => {
    resetAgentControl();
    const registry = getWorkspaceRegistry();
    const tabId = registry.openTab({ kind: 'browser', title: 'Browser' });
    const service = getAgentControlService();
    const hook = createBrowserAgentStateHook(tabId);
    const events: Array<{ type: string; seq: number; failureReason?: string }> = [];
    service.subscribe((event) => {
      events.push({ type: event.type, seq: event.seq, failureReason: event.failureReason });
    });

    hook({
      url: 'https://fail.test',
      title: 'fail',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      failed: true,
      failureReason: 'net_error',
    });
    hook({
      url: 'https://fail.test',
      title: 'fail',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      failed: true,
      failureReason: 'net_error',
    });
    hook({
      url: 'https://retry.test',
      title: 'retry',
      loading: true,
      canGoBack: false,
      canGoForward: false,
      failed: false,
    });
    hook({
      url: 'https://retry.test',
      title: 'retry',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      failed: true,
      failureReason: 'stopped',
    });

    expect(events.map((e) => e.type)).toEqual(['browser.load.failed', 'browser.load.failed']);
    expect(events[0]?.seq).toBe(3);
    expect(events[1]?.seq).toBe(4);
    expect(events[0]?.failureReason).toBe('net_error');
    expect(events[1]?.failureReason).toBe('stopped');
    resetAgentControl();
  });

  it('emits browser.dialog and browser.newwindow from note helpers', () => {
    const registry = new WorkspaceRegistry({ windowId: 'win_browser' });
    const tabId = registry.openTab({ kind: 'browser', title: 'Browser' });
    const service = new AgentControlService({ registry, host: null });
    const events: Array<{ type: string; dialogType?: string; message?: string; url?: string; name?: string }> =
      [];
    service.subscribe((event) => {
      events.push({
        type: event.type,
        dialogType: event.dialogType,
        message: event.message,
        url: event.url,
        name: event.name,
      });
    });

    service.noteBrowserDialog(tabId, { messageType: 'confirm', messageText: 'OK?' });
    service.noteBrowserNewWindow(tabId, {
      targetUrl: 'https://popup.test',
      name: '_blank',
      disposition: 'new_foreground_tab',
    });

    expect(events).toEqual([
      { type: 'browser.dialog', dialogType: 'confirm', message: 'OK?' },
      { type: 'browser.newwindow', url: 'https://popup.test', name: '_blank' },
    ]);
  });
});
