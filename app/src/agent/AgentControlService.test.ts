import { describe, expect, it, vi } from 'vitest';
import { AgentControlService } from './AgentControlService';
import { WorkspaceRegistry } from './WorkspaceRegistry';
import type { PaneHost } from './types';

function setup(options?: { sleep?: (ms: number) => Promise<void>; now?: () => number }) {
  let now = 1000;
  const registry = new WorkspaceRegistry({ windowId: 'win_unit' });
  const tabId = registry.openTab({ kind: 'terminal', title: 'echo' });
  const paneId = registry.openPane({ tabId, surface: 'terminal', resttyPaneId: 1 });
  const host: PaneHost = {
    split: vi.fn(async () => {
      const created = registry.openPane({ tabId, surface: 'terminal', resttyPaneId: 2 });
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
    paneDiagnostics: vi.fn(() => ({
      osc133: {
        detected: true,
        phase: 'B' as const,
        lastMarkerAt: 1,
        commandRunning: false,
        exitCode: null,
      },
    })),
    readViewport: vi.fn(() => ({
      lines: ['fallback'],
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
      lines: ['hello'],
      cols: 80,
      rows: 24,
      wrapping: 'unknown' as const,
      truncated: false,
    })),
    isZoomed: vi.fn(() => false),
  };
  const service = new AgentControlService({
    registry,
    host,
    now: options?.now ?? (() => now),
    sleep: options?.sleep,
  });
  const advance = (ms: number) => {
    now += ms;
  };
  return { registry, service, tabId, paneId, host, advance };
}

describe('AgentControlService', () => {
  it('reports capabilities for implemented and unavailable methods', () => {
    const { service } = setup();
    const caps = service.capabilities();
    expect(caps.methods.listPanes.available).toBe(true);
    expect(caps.methods.paneSplit.available).toBe(true);
    expect(caps.methods.terminalRead.available).toBe(true);
    expect(caps.methods.terminalRun.available).toBe(true);
    expect(caps.methods.paneDiagnostics.available).toBe(true);
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
    expect(read.value.text).toBe('fallback');
    expect(read.value.capture.lines).toEqual(['fallback']);
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

    const diag = service.paneDiagnostics({ paneId });
    expect(diag.ok).toBe(true);
    if (diag.ok) {
      expect(diag.value.osc133.detected).toBe(true);
      expect(host.paneDiagnostics).toHaveBeenCalledWith(paneId);
    }

    const closed = service.paneClose({ paneId });
    expect(closed.ok).toBe(true);
    expect(host.close).toHaveBeenCalledWith(paneId);
  });

  it('marks host methods unavailable when PaneHost is missing', () => {
    const registry = new WorkspaceRegistry();
    const service = new AgentControlService({ registry, host: null });
    expect(service.capabilities().methods.paneSplit.available).toBe(false);
    expect(service.capabilities().methods.terminalRun.available).toBe(false);
    expect(service.paneFocus({ paneId: 'x' }).ok).toBe(false);
    expect(service.terminalRead({ paneId: 'x' }).ok).toBe(false);
  });

  it('navigates browser tabs through BrowserHost', () => {
    const registry = new WorkspaceRegistry();
    const tabId = registry.openTab({ kind: 'browser', title: 'Browser' });
    const browserHost = {
      navigate: vi.fn(),
      back: vi.fn(async () => true),
      forward: vi.fn(async () => false),
      reload: vi.fn(),
      waitFor: vi.fn(async () => ({ tabId, satisfied: true, reason: 'load' as const })),
      snapshot: vi.fn(async () => ({
        tabId,
        url: 'https://example.com',
        title: 'Example',
        generation: 1,
        nodes: [],
        truncated: false,
        byteLength: 10,
      })),
      query: vi.fn(async () => ({ tabId, matches: [] })),
      click: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
      getUrl: vi.fn(() => 'https://example.com'),
      getTitle: vi.fn(() => 'Example'),
    };
    const service = new AgentControlService({ registry, host: null, browserHost });
    expect(service.capabilities().methods.browserNavigate.available).toBe(true);
    const nav = service.browserNavigate({ tabId, url: 'https://example.com' });
    expect(nav.ok).toBe(true);
    expect(browserHost.navigate).toHaveBeenCalledWith(tabId, 'https://example.com');
    expect(service.browserGetTitle({ tabId })).toEqual({ ok: true, value: { tabId, title: 'Example' } });
    expect(service.capabilities().methods.browserSnapshot.available).toBe(true);
  });
});

describe('AgentControlService.terminalRun', () => {
  it('runs a command and returns OSC 133 output', async () => {
    const { service, paneId, host } = setup();
    const runPromise = service.terminalRun({ pane: paneId, command: 'echo hello' });
    expect(host.send).toHaveBeenCalledWith(paneId, 'echo hello\n');
    service.noteOsc133(paneId, { phase: 'C', position: { row: 1, col: 0 } });
    service.noteOsc133(paneId, { phase: 'D', exitCode: 0, position: { row: 2, col: 0 } });
    const run = await runPromise;
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.completion).toBe('osc133');
    expect(run.value.exitCode).toBe(0);
    expect(run.value.output).toBe('hello');
    expect(host.readRange).toHaveBeenCalledWith(paneId, {
      start: { row: 1, col: 0 },
      end: { row: 2, col: 0 },
    });
  });

  it('returns non-zero exit codes from OSC 133 D', async () => {
    const { service, paneId } = setup();
    const runPromise = service.terminalRun({ pane: paneId, command: 'false' });
    service.noteOsc133(paneId, { phase: 'D', exitCode: 1 });
    const run = await runPromise;
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.exitCode).toBe(1);
    expect(run.value.completion).toBe('osc133');
  });

  it('times out when no OSC 133 completion arrives', async () => {
    let sleepResolve: (() => void) | undefined;
    const sleep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          sleepResolve = resolve;
        }),
    );
    const { service, paneId } = setup({ sleep });
    const runPromise = service.terminalRun({ pane: paneId, command: 'sleep 9', timeoutMs: 50 });
    sleepResolve!();
    const run = await runPromise;
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.completion).toBe('timeout');
    expect(run.value.exitCode).toBeNull();
  });

  it('rejects concurrent runs on the same pane', async () => {
    const { service, paneId } = setup();
    void service.terminalRun({ pane: paneId, command: 'one' });
    const second = await service.terminalRun({ pane: paneId, command: 'two' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.message).toMatch(/Concurrent terminalRun/);
  });

  it('cancels via AbortSignal', async () => {
    const { service, paneId } = setup();
    const controller = new AbortController();
    const runPromise = service.terminalRun({ pane: paneId, command: 'sleep 9', signal: controller.signal });
    controller.abort();
    const run = await runPromise;
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.completion).toBe('cancelled');
  });

  it('resolves with pane-closed when the pane is invalidated', async () => {
    const { service, paneId } = setup();
    const runPromise = service.terminalRun({ pane: paneId, command: 'long' });
    service.notePaneInvalidated(paneId, 'pane-closed');
    const run = await runPromise;
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.completion).toBe('pane-closed');
  });
});
