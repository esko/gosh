import { handleBrowserPermissionRequest } from './policies';
import type {
  ControlledFrameElementLike,
  ControlledFrameLoadEvent,
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

export type ControlledFrameControllerOptions = {
  initialUrl?: string;
  onStateChange?: (state: ControlledFrameNavState) => void;
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
  private disposed = false;
  private readonly handlers: Record<string, EventListener>;

  constructor(
    private readonly element: ControlledFrameElementLike,
    options?: ControlledFrameControllerOptions,
  ) {
    this.onStateChange = options?.onStateChange;
    this.handlers = {
      loadstart: (event) => this.onLoadStart(event as ControlledFrameLoadEvent),
      loadcommit: (event) => this.onLoadCommit(event as ControlledFrameLoadEvent),
      contentload: () => this.onContentLoad(),
      loadstop: () => this.onLoadStop(),
      loadabort: (event) => this.onLoadAbort(event as ControlledFrameLoadEvent),
      permissionrequest: (event) => this.onPermissionRequest(event as ControlledFramePermissionRequestEvent),
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

  navigate(url: string): void {
    this.assertAlive();
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
    for (const [type, handler] of Object.entries(this.handlers)) {
      this.element.removeEventListener(type, handler);
    }
    this.element.stop?.();
    this.listeners.clear();
  }

  private onLoadStart(event: ControlledFrameLoadEvent): void {
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

function titleForUrl(url: string): string {
  if (!url || url === 'about:blank') return 'New Tab';
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
