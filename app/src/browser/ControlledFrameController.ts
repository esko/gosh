import { handleBrowserPermissionRequest } from './policies';
import { BrowserAutomation } from './BrowserAutomation';
import type {
  BrowserDialogType,
  ControlledFrameDialogController,
  ControlledFrameDialogEvent,
  ControlledFrameElementLike,
  ControlledFrameLoadEvent,
  ControlledFrameNewWindowController,
  ControlledFrameNewWindowEvent,
  ControlledFramePermissionRequestEvent,
} from './controlledFrameTypes';

export type ControlledFrameNavState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  failed: boolean;
  failureReason?: string;
};

export type BrowserDialogRequest = {
  messageType: BrowserDialogType;
  messageText: string;
};

export type BrowserNewWindowRequest = {
  targetUrl: string;
  name: string;
  disposition?: string;
};

export type ControlledFrameControllerOptions = {
  tabId?: string;
  paneId?: string;
  initialUrl?: string;
  onStateChange?: (state: ControlledFrameNavState) => void;
  onDialog?: (request: BrowserDialogRequest) => void;
  onNewWindow?: (request: BrowserNewWindowRequest) => void;
  sleep?: (ms: number) => Promise<void>;
  pendingTimeoutMs?: number;
};

type StateListener = (state: ControlledFrameNavState) => void;

const DEFAULT_STATE: ControlledFrameNavState = {
  url: '',
  title: 'New Tab',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  failed: false,
};

export const BROWSER_PENDING_TIMEOUT_MS = 30_000;

type PendingDialog = {
  messageType: BrowserDialogType;
  messageText: string;
  controller: ControlledFrameDialogController;
  timeout: ReturnType<typeof setTimeout>;
};

type PendingNewWindow = {
  targetUrl: string;
  name: string;
  disposition?: string;
  controller: ControlledFrameNewWindowController;
  timeout: ReturnType<typeof setTimeout>;
};

export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

export class ControlledFrameController {
  private state: ControlledFrameNavState = { ...DEFAULT_STATE };
  private readonly listeners = new Set<StateListener>();
  private readonly onStateChange?: (state: ControlledFrameNavState) => void;
  private readonly onDialog?: (request: BrowserDialogRequest) => void;
  private readonly onNewWindow?: (request: BrowserNewWindowRequest) => void;
  private readonly pendingTimeoutMs: number;
  readonly automation: BrowserAutomation | null;
  private disposed = false;
  private readonly handlers: Record<string, EventListener>;
  private pendingDialog: PendingDialog | null = null;
  private pendingNewWindow: PendingNewWindow | null = null;

  constructor(
    private readonly element: ControlledFrameElementLike,
    options?: ControlledFrameControllerOptions,
  ) {
    this.onStateChange = options?.onStateChange;
    this.onDialog = options?.onDialog;
    this.onNewWindow = options?.onNewWindow;
    this.pendingTimeoutMs = options?.pendingTimeoutMs ?? BROWSER_PENDING_TIMEOUT_MS;
    this.automation = options?.tabId
      ? new BrowserAutomation(element, {
          tabId: options.tabId,
          sleep: options.sleep,
          isLoading: () => this.state.loading,
        })
      : null;
    this.handlers = {
      loadstart: (event) => this.onLoadStart(event as ControlledFrameLoadEvent),
      loadcommit: (event) => this.onLoadCommit(event as ControlledFrameLoadEvent),
      contentload: () => this.onContentLoad(),
      loadstop: () => this.onLoadStop(),
      loadabort: (event) => this.onLoadAbort(event as ControlledFrameLoadEvent),
      permissionrequest: (event) => this.onPermissionRequest(event as ControlledFramePermissionRequestEvent),
      dialog: (event) => this.onDialogEvent(event as ControlledFrameDialogEvent),
      newwindow: (event) => this.onNewWindowEvent(event as ControlledFrameNewWindowEvent),
    };
    for (const [type, handler] of Object.entries(this.handlers)) {
      element.addEventListener(type, handler);
    }
    const startUrl = options?.initialUrl ? normalizeBrowserUrl(options.initialUrl) : 'about:blank';
    this.patchState({ url: startUrl, title: titleForUrl(startUrl), loading: startUrl !== 'about:blank' });
    element.src = startUrl;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): ControlledFrameNavState {
    return { ...this.state };
  }

  getUrl(): string {
    return this.state.url;
  }

  getTitle(): string {
    return this.state.title;
  }

  hasPendingDialog(): boolean {
    return this.pendingDialog !== null;
  }

  hasPendingNewWindow(): boolean {
    return this.pendingNewWindow !== null;
  }

  handleDialog(action: 'accept' | 'dismiss', promptText?: string): { handled: boolean } {
    this.assertAlive();
    const pending = this.pendingDialog;
    if (!pending) return { handled: false };
    this.clearPendingDialog();
    if (action === 'accept') {
      acceptDialog(pending.controller, promptText);
    } else {
      cancelDialog(pending.controller);
    }
    return { handled: true };
  }

  handleNewWindow(
    action: 'deny' | 'open-tab',
    urlOverride?: string,
    openTab?: (url: string) => string | null,
  ): { handled: boolean; tabId?: string } {
    this.assertAlive();
    const pending = this.pendingNewWindow;
    if (!pending) return { handled: false };
    this.clearPendingNewWindow();
    const url = urlOverride?.trim() ? normalizeBrowserUrl(urlOverride) : pending.targetUrl;
    if (action === 'open-tab' && openTab) {
      const tabId = openTab(url) ?? undefined;
      discardNewWindow(pending.controller);
      return { handled: true, tabId };
    }
    discardNewWindow(pending.controller);
    return { handled: true };
  }

  navigate(url: string): void {
    this.assertAlive();
    this.automation?.invalidateRefs();
    const normalized = normalizeBrowserUrl(url);
    this.patchState({
      url: normalized,
      loading: normalized !== 'about:blank',
      failed: false,
      failureReason: undefined,
    });
    this.element.src = normalized;
  }

  async back(): Promise<boolean> {
    this.assertAlive();
    this.automation?.invalidateRefs();
    this.patchState({ loading: true, failed: false, failureReason: undefined });
    try {
      const success = await this.element.back();
      this.syncHistory();
      if (!success) this.patchState({ loading: false });
      return success;
    } catch (err) {
      this.failNavigation(err);
      return false;
    }
  }

  async forward(): Promise<boolean> {
    this.assertAlive();
    this.automation?.invalidateRefs();
    this.patchState({ loading: true, failed: false, failureReason: undefined });
    try {
      const success = await this.element.forward();
      this.syncHistory();
      if (!success) this.patchState({ loading: false });
      return success;
    } catch (err) {
      this.failNavigation(err);
      return false;
    }
  }

  reload(): void {
    this.assertAlive();
    if (!this.state.url || this.state.url === 'about:blank') return;
    this.automation?.invalidateRefs();
    this.patchState({ loading: true, failed: false, failureReason: undefined });
    this.element.reload();
  }

  stop(): void {
    this.assertAlive();
    this.element.stop?.();
    this.patchState({ loading: false });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dismissPendingDialog();
    this.discardPendingNewWindow();
    for (const [type, handler] of Object.entries(this.handlers)) {
      this.element.removeEventListener(type, handler);
    }
    this.element.stop?.();
    this.listeners.clear();
  }

  private onDialogEvent(event: ControlledFrameDialogEvent): void {
    const dialogMessage = event.dialogMessage;
    const messageType = event.messageType ?? dialogMessage?.messageType ?? 'alert';
    const messageText = event.messageText ?? dialogMessage?.messageText ?? '';
    const controller = event.dialog ?? dialogMessage?.dialog;
    if (!controller) {
      return;
    }
    this.dismissPendingDialog();
    const pending: PendingDialog = {
      messageType,
      messageText,
      controller,
      timeout: setTimeout(() => this.dismissPendingDialog(), this.pendingTimeoutMs),
    };
    this.pendingDialog = pending;
    this.onDialog?.({ messageType, messageText });
  }

  private onNewWindowEvent(event: ControlledFrameNewWindowEvent): void {
    const details = event.newWindow;
    const targetUrl = details?.targetUrl ?? event.targetUrl ?? '';
    const name = details?.name ?? event.name ?? '';
    const disposition = details?.windowOpenDisposition ?? event.windowOpenDisposition;
    const controller = details?.window ?? event.window;
    if (!controller) return;
    this.discardPendingNewWindow();
    const pending: PendingNewWindow = {
      targetUrl,
      name,
      disposition,
      controller,
      timeout: setTimeout(() => this.discardPendingNewWindow(), this.pendingTimeoutMs),
    };
    this.pendingNewWindow = pending;
    this.onNewWindow?.({ targetUrl, name, disposition });
  }

  private dismissPendingDialog(): void {
    const pending = this.pendingDialog;
    if (!pending) return;
    this.clearPendingDialog();
    cancelDialog(pending.controller);
  }

  private discardPendingNewWindow(): void {
    const pending = this.pendingNewWindow;
    if (!pending) return;
    this.clearPendingNewWindow();
    discardNewWindow(pending.controller);
  }

  private clearPendingDialog(): void {
    if (!this.pendingDialog) return;
    clearTimeout(this.pendingDialog.timeout);
    this.pendingDialog = null;
  }

  private clearPendingNewWindow(): void {
    if (!this.pendingNewWindow) return;
    clearTimeout(this.pendingNewWindow.timeout);
    this.pendingNewWindow = null;
  }

  private onLoadStart(event: ControlledFrameLoadEvent): void {
    this.automation?.invalidateRefs();
    const url = event.url ?? this.element.src;
    this.patchState({ url, loading: true, failed: false, failureReason: undefined });
  }

  private onLoadCommit(event: ControlledFrameLoadEvent): void {
    const url = event.url ?? this.element.src;
    this.patchState({ url });
    this.syncHistory();
  }

  private onContentLoad(): void {
    this.syncTitle();
    this.syncHistory();
  }

  private onLoadStop(): void {
    this.syncTitle();
    this.syncHistory();
    this.patchState({ loading: false, failed: false, failureReason: undefined });
  }

  private onLoadAbort(event: ControlledFrameLoadEvent): void {
    const reason = event.detail?.reason ?? 'Navigation aborted';
    this.patchState({ loading: false, failed: true, failureReason: reason });
  }

  private onPermissionRequest(event: ControlledFramePermissionRequestEvent): void {
    handleBrowserPermissionRequest(event);
  }

  private syncTitle(): void {
    const fromElement = this.element.getTitle?.();
    const title = fromElement?.trim() || titleForUrl(this.element.src || this.state.url);
    this.patchState({ title });
  }

  private syncHistory(): void {
    this.patchState({
      canGoBack: Boolean(this.element.canGoBack?.()),
      canGoForward: Boolean(this.element.canGoForward?.()),
      url: this.element.src || this.state.url,
    });
  }

  private failNavigation(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.patchState({ loading: false, failed: true, failureReason: message });
  }

  private patchState(patch: Partial<ControlledFrameNavState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
    this.onStateChange?.(snapshot);
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('ControlledFrameController was disposed');
  }
}

function acceptDialog(controller: ControlledFrameDialogController, response?: string): void {
  if (typeof controller.okay === 'function') {
    controller.okay(response);
    return;
  }
  controller.ok?.(response);
}

function cancelDialog(controller: ControlledFrameDialogController): void {
  controller.cancel?.();
}

function discardNewWindow(controller: ControlledFrameNewWindowController): void {
  controller.discard?.();
}

function titleForUrl(url: string): string {
  if (!url || url === 'about:blank') return 'New Tab';
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
