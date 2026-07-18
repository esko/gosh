import { describe, expect, it, vi } from 'vitest';
import { AgentControlService } from './AgentControlService';
import { WorkspaceRegistry } from './WorkspaceRegistry';
import type { PaneHost } from './types';

function setup() {
  const registry = new WorkspaceRegistry({ windowId: 'win_unit' });
  const tabId = registry.openTab({ kind: 'terminal', title: 'echo' });
  const paneId = registry.openPane({ tabId, resttyPaneId: 1 });
  const host: PaneHost = {
    split: vi.fn(async () => {
      const created = registry.openPane({ tabId, resttyPaneId: 2 });
      return { paneId: created };
    }),
    focus: vi.fn(),
    resize: vi.fn(() => true),
    zoom: vi.fn(() => true),
    close: vi.fn((id) => {
      registry.closePane(id);
      return true;
    }),
    send: vi.fn(),
    readViewport: vi.fn(() => ({
      lines: ['prompt>'],
      cols: 80,
      rows: 24,
      wrapping: 'unknown' as const,
      truncated: false,
    })),
    readHistory: vi.fn(() => ({
      lines: ['old', 'prompt>'],
      cols: 80,
      rows: 24,
      wrapping: 'unknown' as const,
      truncated: true,
      truncationReason: 'test',
    })),
    readRange: vi.fn(() => ({
      lines: ['x'],
      cols: 80,
      rows: 24,
      wrapping: 'unknown' as const,
      truncated: false,
    })),
    isZoomed: vi.fn(() => false),
  };
  const service = new AgentControlService({ registry, host });
  return { registry, service, tabId, paneId, host };
}

describe('AgentControlService', () => {
  it('reports capabilities for implemented and unavailable methods', () => {
    const { service } = setup();
    const caps = service.capabilities();
    expect(caps.methods.listPanes.available).toBe(true);
    expect(caps.methods.paneSplit.available).toBe(true);
    expect(caps.methods.terminalRead.available).toBe(true);
    expect(caps.methods.terminalRun.available).toBe(false);
    expect(caps.methods.terminalRun.reason).toBeTruthy();
  });

  it('lists windows, tabs, and panes without Restty numeric ids', () => {
    const { service, tabId, paneId } = setup();
    const windows = service.listWindows();
    expect(windows.ok).toBe(true);
    if (!windows.ok) return;
    expect(windows.value[0]?.windowId).toBe('win_unit');
    const tabs = service.listTabs();
    expect(tabs.ok).toBe(true);
    if (!tabs.ok) return;
    expect(tabs.value[0]?.tabId).toBe(tabId);
    const panes = service.listPanes();
    expect(panes.ok).toBe(true);
    if (!panes.ok) return;
    expect(panes.value[0]?.paneId).toBe(paneId);
    expect(JSON.stringify(panes.value)).not.toMatch(/resttyPaneId/);
  });

  it('returns structured not-found for unknown panes', async () => {
    const { service } = setup();
    const focus = service.paneFocus({ paneId: 'pane_missing' });
    expect(focus).toEqual({
      ok: false,
      error: { code: 'not-found', message: 'Unknown pane: pane_missing' },
    });
    const read = service.terminalRead({ paneId: 'pane_missing' });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.code).toBe('not-found');
  });

  it('reads viewport text through the host', () => {
    const { service, paneId, host } = setup();
    const read = service.terminalRead({ paneId });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.text).toBe('prompt>');
    expect(read.value.capture.lines).toEqual(['prompt>']);
    expect(host.readViewport).toHaveBeenCalledWith(paneId);
  });

  it('splits, focuses, resizes, zooms, sends, and closes through the host', async () => {
    const { service, paneId, host, tabId } = setup();
    const split = await service.paneSplit({ tabId, direction: 'vertical' });
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(host.split).toHaveBeenCalledWith(tabId, 'vertical');

    expect(service.paneFocus({ paneId }).ok).toBe(true);
    expect(host.focus).toHaveBeenCalledWith(paneId);

    expect(service.paneResize({ paneId, direction: 'right', amount: 6 }).ok).toBe(true);
    expect(host.resize).toHaveBeenCalledWith(paneId, 'right', 6);

    expect(service.paneZoom({ paneId }).ok).toBe(true);
    expect(service.terminalSend({ paneId, data: 'hi' }).ok).toBe(true);
    expect(host.send).toHaveBeenCalledWith(paneId, 'hi');

    const closed = service.paneClose({ paneId });
    expect(closed.ok).toBe(true);
    expect(host.close).toHaveBeenCalledWith(paneId);
  });

  it('marks host methods unavailable when PaneHost is missing', () => {
    const registry = new WorkspaceRegistry();
    const service = new AgentControlService({ registry, host: null });
    expect(service.capabilities().methods.paneSplit.available).toBe(false);
    expect(service.paneFocus({ paneId: 'x' }).ok).toBe(false);
    expect(service.terminalRead({ paneId: 'x' }).ok).toBe(false);
  });
});
