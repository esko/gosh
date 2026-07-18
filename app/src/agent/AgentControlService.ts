import { buildCapabilities } from './capabilities';
import { CommandTracker, type CommandRecord, type Osc133FeedEvent } from './CommandTracker';
import type { AgentActivityAction } from './agentActivityPulse';
import type { AgentEventBus, AgentEventListener, AgentSubscription } from './AgentEventBus';
import type { WorkspaceRegistry } from './WorkspaceRegistry';
import {
  agentErr,
  agentOk,
  type AgentCapabilities,
  type AgentEvent,
  type AgentResult,
  type BrowserHost,
  type PaneDirection,
  type PaneHost,
  type PaneInfo,
  type PaneSurfaceKind,
  type PaneDiagnostics,
  type SplitDirection,
  type TabInfo,
  type TerminalReadResult,
  type TerminalRunCompletion,
  type TerminalRunResult,
  type TerminalTextCapture,
  type WindowInfo,
} from './types';
import type {
  BrowserQueryResult,
  BrowserSnapshotResult,
  BrowserWaitForResult,
  BrowserWaitForState,
} from '../browser/browserAutomationTypes';

export type { CommandRecord, Osc133FeedEvent };

export type AgentActivityListener = (input: { paneId: string; action: AgentActivityAction }) => void;

const DEFAULT_RUN_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_MAX_OUTPUT_BYTES = 256_000;

export type AgentControlServiceOptions = {
  registry: WorkspaceRegistry;
  host?: PaneHost | null;
  browserHost?: BrowserHost | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Transport-independent product API for agent control.
 * CDP / CLI / MCP adapters must call this service rather than views or Restty.
 */
export class AgentControlService {
  private readonly registry: WorkspaceRegistry;
  private readonly events: AgentEventBus;
  private readonly commandTracker: CommandTracker;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private host: PaneHost | null;
  private browserHost: BrowserHost | null;
  private readonly activeRuns = new Set<string>();
  private activityListener: AgentActivityListener | null = null;

  constructor(options: AgentControlServiceOptions) {
    this.registry = options.registry;
    this.events = options.registry.events;
    this.host = options.host ?? null;
    this.browserHost = options.browserHost ?? null;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.commandTracker = new CommandTracker(this.events, this.registry.windowId, this.now);
    this.events.subscribe((event) => {
      if (event.type === 'pane.closed' && event.paneId) {
        this.notePaneInvalidated(event.paneId, 'pane-closed');
      }
    });
  }

  setPaneHost(host: PaneHost | null): void {
    this.host = host;
  }

  setBrowserHost(host: BrowserHost | null): void {
    this.browserHost = host;
  }

  /** UI hook for per-pane typing / terminal.run activity chrome (optional). */
  setActivityListener(listener: AgentActivityListener | null): void {
    this.activityListener = listener;
  }

  private notifyActivity(paneId: string, action: AgentActivityAction): void {
    this.activityListener?.({ paneId, action });
  }

  private emitBrowserNavigated(tabId: string, url: string): void {
    this.events.emit('browser.navigated', {
      windowId: this.registry.windowId,
      tabId,
      url,
    });
  }

  capabilities(): AgentCapabilities {
    const hasHost = this.host !== null;
    const hasRead = hasHost && typeof this.host?.readViewport === 'function';
    const hasRun = hasHost && hasRead;
    const hasBrowser = this.browserHost !== null;
    return buildCapabilities({
      hasPaneHost: hasHost,
      hasTerminalRead: hasRead,
      hasTerminalRun: hasRun,
      hasBrowserHost: hasBrowser,
    });
  }

  /** Feed OSC 133 markers from the UI/adapter layer (opaque pane ids). */
  noteOsc133(paneId: string, event: Osc133FeedEvent): CommandRecord | null {
    return this.commandTracker.noteOsc133(paneId, event);
  }

  notePaneInvalidated(paneId: string, reason: 'pane-closed' | 'disconnected' | 'reconnect'): void {
    this.activeRuns.delete(paneId);
    this.commandTracker.invalidatePane(paneId, reason);
  }

  notePaneDisconnected(paneId: string): void {
    const pane = this.registry.getPane(paneId);
    if (pane) {
      this.events.emit('terminal.disconnected', {
        windowId: this.registry.windowId,
        tabId: pane.tabId,
        paneId,
      });
    }
    this.notePaneInvalidated(paneId, 'disconnected');
  }

  /** Controlled Frame loadabort / navigation failure (opaque tab id). */
  noteBrowserLoadFailed(tabId: string, url: string, failureReason: string): void {
    const tab = this.registry.getTab(tabId);
    if (!tab || (tab.kind !== 'browser' && tab.kind !== 'mixed')) return;
    this.events.emit('browser.load.failed', {
      windowId: this.registry.windowId,
      tabId,
      url,
      failureReason,
    });
  }

  getCurrentCommand(paneId: string): CommandRecord | null {
    return this.commandTracker.getCurrentCommand(paneId);
  }

  getLastCommand(paneId: string): CommandRecord | null {
    return this.commandTracker.getLastCommand(paneId);
  }

  listWindows(): AgentResult<WindowInfo[]> {
    return agentOk(this.registry.listWindows());
  }

  listTabs(): AgentResult<TabInfo[]> {
    return agentOk(this.registry.listTabs());
  }

  listPanes(filter?: { tabId?: string }): AgentResult<PaneInfo[]> {
    if (filter?.tabId && !this.registry.getTab(filter.tabId)) {
      return agentErr('not-found', `Unknown tab: ${filter.tabId}`);
    }
    return agentOk(this.registry.listPanes(filter));
  }

  browserNavigate(input: { tabId: string; url: string }): AgentResult<{ tabId: string; url: string }> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    if (typeof input.url !== 'string' || input.url.trim().length === 0) {
      return agentErr('invalid-argument', 'url must be a non-empty string');
    }
    try {
      resolved.value.host.navigate(input.tabId, input.url);
      const url = resolved.value.host.getUrl(input.tabId);
      this.emitBrowserNavigated(input.tabId, url);
      return agentOk({ tabId: input.tabId, url });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  async browserBack(input: { tabId: string }): Promise<AgentResult<{ tabId: string; moved: boolean }>> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    try {
      const moved = await resolved.value.host.back(input.tabId);
      if (moved) {
        this.emitBrowserNavigated(input.tabId, resolved.value.host.getUrl(input.tabId));
      }
      return agentOk({ tabId: input.tabId, moved });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  async browserForward(input: { tabId: string }): Promise<AgentResult<{ tabId: string; moved: boolean }>> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    try {
      const moved = await resolved.value.host.forward(input.tabId);
      if (moved) {
        this.emitBrowserNavigated(input.tabId, resolved.value.host.getUrl(input.tabId));
      }
      return agentOk({ tabId: input.tabId, moved });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  browserReload(input: { tabId: string }): AgentResult<{ tabId: string; reloaded: boolean }> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    try {
      resolved.value.host.reload(input.tabId);
      this.emitBrowserNavigated(input.tabId, resolved.value.host.getUrl(input.tabId));
      return agentOk({ tabId: input.tabId, reloaded: true });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  async browserWaitFor(input: {
    tabId: string;
    selector?: string;
    text?: string;
    loadState?: BrowserWaitForState;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<AgentResult<BrowserWaitForResult>> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    const hasCondition =
      input.selector !== undefined || input.text !== undefined || input.loadState !== undefined;
    if (!hasCondition) {
      return agentErr('invalid-argument', 'selector, text, or loadState is required');
    }
    if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
      return agentErr('invalid-argument', 'timeoutMs must be a positive number');
    }
    if (input.pollIntervalMs !== undefined && (!Number.isFinite(input.pollIntervalMs) || input.pollIntervalMs <= 0)) {
      return agentErr('invalid-argument', 'pollIntervalMs must be a positive number');
    }
    try {
      const result = await resolved.value.host.waitFor(input.tabId, {
        selector: input.selector,
        text: input.text,
        loadState: input.loadState,
        timeoutMs: input.timeoutMs,
        pollIntervalMs: input.pollIntervalMs,
      });
      return agentOk(result);
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  async browserSnapshot(input: {
    tabId: string;
    maxNodes?: number;
    maxBytes?: number;
  }): Promise<AgentResult<BrowserSnapshotResult>> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    if (input.maxNodes !== undefined && (!Number.isFinite(input.maxNodes) || input.maxNodes <= 0)) {
      return agentErr('invalid-argument', 'maxNodes must be a positive number');
    }
    if (input.maxBytes !== undefined && (!Number.isFinite(input.maxBytes) || input.maxBytes <= 0)) {
      return agentErr('invalid-argument', 'maxBytes must be a positive number');
    }
    try {
      const snapshot = await resolved.value.host.snapshot(input.tabId, {
        maxNodes: input.maxNodes,
        maxBytes: input.maxBytes,
      });
      return agentOk(snapshot);
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  async browserQuery(input: {
    tabId: string;
    role?: string;
    name?: string;
    text?: string;
    selector?: string;
  }): Promise<AgentResult<BrowserQueryResult>> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    const hasFilter =
      input.role !== undefined ||
      input.name !== undefined ||
      input.text !== undefined ||
      input.selector !== undefined;
    if (!hasFilter) {
      return agentErr('invalid-argument', 'role, name, text, or selector is required');
    }
    try {
      const matches = await resolved.value.host.query(input.tabId, {
        role: input.role,
        name: input.name,
        text: input.text,
        selector: input.selector,
      });
      return agentOk(matches);
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  async browserClick(input: { tabId: string; ref: string }): Promise<AgentResult<{ tabId: string; ref: string }>> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    if (typeof input.ref !== 'string' || input.ref.length === 0) {
      return agentErr('invalid-argument', 'ref must be a non-empty string');
    }
    try {
      await resolved.value.host.click(input.tabId, { ref: input.ref });
      return agentOk({ tabId: input.tabId, ref: input.ref });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Stale element ref')) {
        return agentErr('invalid-argument', message);
      }
      return agentErr('failed', message);
    }
  }

  async browserType(input: {
    tabId: string;
    ref: string;
    text: string;
    clear?: boolean;
  }): Promise<AgentResult<{ tabId: string; ref: string }>> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    if (typeof input.ref !== 'string' || input.ref.length === 0) {
      return agentErr('invalid-argument', 'ref must be a non-empty string');
    }
    if (typeof input.text !== 'string') {
      return agentErr('invalid-argument', 'text must be a string');
    }
    try {
      await resolved.value.host.type(input.tabId, {
        ref: input.ref,
        text: input.text,
        clear: input.clear,
      });
      return agentOk({ tabId: input.tabId, ref: input.ref });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Stale element ref')) {
        return agentErr('invalid-argument', message);
      }
      return agentErr('failed', message);
    }
  }

  async browserPress(input: {
    tabId: string;
    ref: string;
    key: string;
  }): Promise<AgentResult<{ tabId: string; ref: string; key: string }>> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    if (typeof input.ref !== 'string' || input.ref.length === 0) {
      return agentErr('invalid-argument', 'ref must be a non-empty string');
    }
    if (typeof input.key !== 'string' || input.key.length === 0) {
      return agentErr('invalid-argument', 'key must be a non-empty string');
    }
    try {
      await resolved.value.host.press(input.tabId, { ref: input.ref, key: input.key });
      return agentOk({ tabId: input.tabId, ref: input.ref, key: input.key });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Stale element ref')) {
        return agentErr('invalid-argument', message);
      }
      return agentErr('failed', message);
    }
  }

  browserGetUrl(input: { tabId: string }): AgentResult<{ tabId: string; url: string }> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    try {
      return agentOk({ tabId: input.tabId, url: resolved.value.host.getUrl(input.tabId) });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  browserGetTitle(input: { tabId: string }): AgentResult<{ tabId: string; title: string }> {
    const resolved = this.resolveBrowserTab(input.tabId);
    if (!resolved.ok) return resolved;
    try {
      return agentOk({ tabId: input.tabId, title: resolved.value.host.getTitle(input.tabId) });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  async paneSplit(input: {
    tabId?: string;
    paneId?: string;
    direction: SplitDirection;
    surface?: PaneSurfaceKind;
  }): Promise<AgentResult<{ paneId: string; tabId: string }>> {
    const host = this.requireHost();
    if (!host.ok) return host;
    const tabId = input.tabId ?? this.registry.getActiveTabId();
    if (!tabId) return agentErr('not-found', 'No active tab');
    if (!this.registry.getTab(tabId)) return agentErr('not-found', `Unknown tab: ${tabId}`);
    if (input.direction !== 'vertical' && input.direction !== 'horizontal') {
      return agentErr('invalid-argument', 'direction must be vertical or horizontal');
    }
    if (input.surface !== undefined && input.surface !== 'terminal' && input.surface !== 'browser') {
      return agentErr('invalid-argument', 'surface must be terminal or browser');
    }
    if (input.paneId !== undefined && !this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    try {
      const { paneId } = await host.value.split(tabId, input.direction, {
        paneId: input.paneId,
        surface: input.surface,
      });
      return agentOk({ paneId, tabId });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  paneFocus(input: { paneId: string }): AgentResult<{ paneId: string }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    try {
      host.value.focus(input.paneId);
      this.registry.setActivePane(input.paneId);
      return agentOk({ paneId: input.paneId });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  paneResize(input: {
    paneId: string;
    direction: PaneDirection;
    amount?: number;
  }): AgentResult<{ paneId: string; resized: boolean }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    const dirs: PaneDirection[] = ['left', 'right', 'up', 'down'];
    if (!dirs.includes(input.direction)) {
      return agentErr('invalid-argument', 'direction must be left|right|up|down');
    }
    const amount = input.amount ?? 6;
    if (!Number.isFinite(amount) || amount <= 0) {
      return agentErr('invalid-argument', 'amount must be a positive number');
    }
    try {
      const resized = host.value.resize(input.paneId, input.direction, amount);
      if (resized) {
        this.events.emit('pane.resized', {
          windowId: this.registry.windowId,
          tabId: this.registry.getPane(input.paneId)?.tabId,
          paneId: input.paneId,
        });
      }
      return agentOk({ paneId: input.paneId, resized });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  paneZoom(input: { paneId: string; zoomed?: boolean }): AgentResult<{ paneId: string; zoomed: boolean }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    try {
      const ok = host.value.zoom(input.paneId, input.zoomed);
      if (!ok) return agentErr('failed', 'Zoom operation failed');
      const zoomed =
        host.value.isZoomed?.(input.paneId) ??
        this.registry.getPane(input.paneId)?.zoomed ??
        Boolean(input.zoomed);
      this.registry.setPaneZoomed(input.paneId, zoomed);
      return agentOk({ paneId: input.paneId, zoomed });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  paneClose(input: { paneId: string }): AgentResult<{ paneId: string; closed: boolean }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    try {
      const closed = host.value.close(input.paneId);
      if (!closed) return agentErr('failed', 'Close refused (last pane or unknown)');
      // UI onPaneClose updates the registry; keep this idempotent if it raced.
      this.registry.closePane(input.paneId);
      return agentOk({ paneId: input.paneId, closed: true });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  terminalSend(input: { paneId: string; data: string }): AgentResult<{ paneId: string }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    if (typeof input.data !== 'string') {
      return agentErr('invalid-argument', 'data must be a string');
    }
    try {
      host.value.send(input.paneId, input.data);
      this.notifyActivity(input.paneId, 'send');
      return agentOk({ paneId: input.paneId });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  terminalRead(input: {
    paneId: string;
    lastLines?: number;
    maxBytes?: number;
  }): AgentResult<TerminalReadResult> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    if (input.lastLines !== undefined && (!Number.isFinite(input.lastLines) || input.lastLines <= 0)) {
      return agentErr('invalid-argument', 'lastLines must be a positive number');
    }
    if (input.maxBytes !== undefined && (!Number.isFinite(input.maxBytes) || input.maxBytes <= 0)) {
      return agentErr('invalid-argument', 'maxBytes must be a positive number');
    }
    try {
      const capture =
        input.lastLines !== undefined
          ? host.value.readHistory(input.paneId, { lastLines: input.lastLines })
          : host.value.readViewport(input.paneId);
      const limited = limitCaptureText(capture, input.maxBytes);
      return agentOk({
        paneId: input.paneId,
        capture: limited.capture,
        text: limited.text,
        truncated: limited.truncated,
      });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  async terminalRun(input: {
    pane: string;
    command: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
  }): Promise<AgentResult<TerminalRunResult>> {
    const paneId = input.pane;
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(paneId)) {
      return agentErr('not-found', `Unknown pane: ${paneId}`);
    }
    if (typeof input.command !== 'string' || input.command.length === 0) {
      return agentErr('invalid-argument', 'command must be a non-empty string');
    }
    if (this.activeRuns.has(paneId) || this.commandTracker.hasArmedRun(paneId)) {
      return agentErr('failed', `Concurrent terminalRun on pane: ${paneId}`);
    }

    const timeoutMs = input.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_RUN_MAX_OUTPUT_BYTES;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return agentErr('invalid-argument', 'timeoutMs must be a positive number');
    }
    if (!Number.isFinite(maxOutputBytes) || maxOutputBytes <= 0) {
      return agentErr('invalid-argument', 'maxOutputBytes must be a positive number');
    }

    const startedAt = this.now();
    const controller = new AbortController();
    const linked = linkAbortSignal(input.signal, controller);

    let run: { completion: Promise<CommandRecord> };
    try {
      run = this.commandTracker.beginRun(paneId, input.command, controller.signal);
    } catch (err) {
      const reason = (err as { reason?: string }).reason;
      if (reason === 'conflict') {
        return agentErr('failed', `Concurrent terminalRun on pane: ${paneId}`);
      }
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }

    this.activeRuns.add(paneId);
    this.notifyActivity(paneId, 'run-start');
    try {
      host.value.send(paneId, `${input.command}\n`);

      type RunRaceResult = { kind: 'osc133'; record: CommandRecord } | { kind: 'timeout' };
      const completion: RunRaceResult = await Promise.race([
        run.completion.then((record) => ({ kind: 'osc133' as const, record })),
        this.sleep(timeoutMs).then(() => ({ kind: 'timeout' as const })),
      ]);

      if (completion.kind === 'timeout') {
        controller.abort();
        const output = this.extractRunOutput(host.value, paneId, null, maxOutputBytes);
        return agentOk({
          command: input.command,
          exitCode: null,
          output: output.text,
          durationMs: this.now() - startedAt,
          completion: 'timeout',
          truncated: output.truncated,
        });
      }

      const output = this.extractRunOutput(host.value, paneId, completion.record, maxOutputBytes);
      return agentOk({
        command: input.command,
        exitCode: completion.record.exitCode ?? null,
        output: output.text,
        durationMs: (completion.record.finishedAt ?? this.now()) - startedAt,
        completion: 'osc133',
        truncated: output.truncated,
      });
    } catch (err) {
      const reason = (err as { reason?: string }).reason;
      const output = this.extractRunOutput(host.value, paneId, null, maxOutputBytes);
      if (reason === 'cancelled') {
        return agentOk({
          command: input.command,
          exitCode: null,
          output: output.text,
          durationMs: this.now() - startedAt,
          completion: 'cancelled',
          truncated: output.truncated,
        });
      }
      if (reason === 'pane-closed' || reason === 'disconnected' || reason === 'reconnect') {
        const completion: TerminalRunCompletion =
          reason === 'pane-closed' ? 'pane-closed' : 'disconnected';
        return agentOk({
          command: input.command,
          exitCode: null,
          output: output.text,
          durationMs: this.now() - startedAt,
          completion,
          truncated: output.truncated,
        });
      }
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    } finally {
      this.activeRuns.delete(paneId);
      this.notifyActivity(paneId, 'run-end');
      linked?.dispose();
    }
  }

  paneDiagnostics(input: { paneId: string }): AgentResult<PaneDiagnostics> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    if (!host.value.paneDiagnostics) {
      return agentErr('unavailable', 'Pane diagnostics are not wired');
    }
    try {
      const diag = host.value.paneDiagnostics(input.paneId);
      if (!diag) return agentErr('failed', 'Pane diagnostics unavailable');
      return agentOk(diag);
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  subscribe(listener: AgentEventListener): AgentSubscription {
    return this.events.subscribe(listener);
  }

  /** Test / CDP helper: drain a promise of the next matching event. */
  waitForEvent(type: AgentEvent['type'], timeoutMs = 2000): Promise<AgentEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.dispose();
        reject(new Error(`timeout waiting for ${type}`));
      }, timeoutMs);
      const sub = this.subscribe((event) => {
        if (event.type !== type) return;
        clearTimeout(timer);
        sub.dispose();
        resolve(event);
      });
    });
  }

  private extractRunOutput(
    host: PaneHost,
    paneId: string,
    record: CommandRecord | null,
    maxBytes: number,
  ): { text: string; truncated: boolean } {
    let capture: TerminalTextCapture;
    let truncated = false;
    if (record?.outputStart && record.completedAt) {
      try {
        capture = host.readRange(paneId, { start: record.outputStart, end: record.completedAt });
        truncated = capture.truncated;
      } catch {
        capture = host.readViewport(paneId);
        truncated = true;
      }
    } else {
      capture = host.readViewport(paneId);
      truncated = true;
    }
    const limited = limitCaptureText(capture, maxBytes);
    return { text: limited.text, truncated: truncated || limited.truncated };
  }

  private requireHost(): AgentResult<PaneHost> {
    if (!this.host) return agentErr('unavailable', 'Pane host is not wired');
    return agentOk(this.host);
  }

  private requireBrowserHost(): AgentResult<BrowserHost> {
    if (!this.browserHost) return agentErr('unavailable', 'Browser host is not wired');
    return agentOk(this.browserHost);
  }

  private resolveBrowserTab(tabId: string): AgentResult<{ host: BrowserHost }> {
    const browser = this.requireBrowserHost();
    if (!browser.ok) return browser;
    const tab = this.registry.getTab(tabId);
    if (!tab) return agentErr('not-found', `Unknown tab: ${tabId}`);
    if (tab.kind !== 'browser' && tab.kind !== 'mixed') {
      return agentErr('invalid-argument', `Tab is not a browser tab: ${tabId}`);
    }
    return agentOk({ host: browser.value });
  }
}

function limitCaptureText(
  capture: TerminalTextCapture,
  maxBytes?: number,
): { capture: TerminalTextCapture; text: string; truncated: boolean } {
  let text = capture.lines.join('\n');
  let truncated = capture.truncated;
  if (maxBytes !== undefined) {
    const encoder = new TextEncoder();
    if (encoder.encode(text).length > maxBytes) {
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (encoder.encode(text.slice(0, mid)).length <= maxBytes) lo = mid;
        else hi = mid - 1;
      }
      text = text.slice(0, lo);
      truncated = true;
    }
  }
  return { capture, text, truncated: Boolean(truncated) };
}

function linkAbortSignal(
  signal: AbortSignal | undefined,
  controller: AbortController,
): { dispose: () => void } | null {
  if (!signal) return null;
  if (signal.aborted) {
    controller.abort();
    return null;
  }
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort);
  return { dispose: () => signal.removeEventListener('abort', onAbort) };
}
