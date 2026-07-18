import { describe, expect, it, vi } from 'vitest';
import { ControlledFrameController, normalizeBrowserUrl } from './ControlledFrameController';
import type { ControlledFrameElementLike } from './controlledFrameTypes';
import { BROWSER_DENIED_PERMISSIONS } from './policies';

class MockControlledFrame implements ControlledFrameElementLike {
  src = 'about:blank';
  partition = '';
  private readonly listeners = new Map<string, Set<EventListener>>();
  private history: string[] = ['about:blank'];
  private historyIndex = 0;
  title = 'New Tab';

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, detail: Record<string, unknown> = {}): void {
    const event = { ...detail, type } as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  async back(): Promise<boolean> {
    if (this.historyIndex <= 0) return false;
    this.historyIndex -= 1;
    this.src = this.history[this.historyIndex]!;
    this.emit('loadcommit', { url: this.src });
    this.emit('contentload');
    this.emit('loadstop');
    return true;
  }

  async forward(): Promise<boolean> {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex += 1;
    this.src = this.history[this.historyIndex]!;
    this.emit('loadcommit', { url: this.src });
    this.emit('contentload');
    this.emit('loadstop');
    return true;
  }

  reload(): void {
    this.emit('loadstart', { url: this.src });
    this.emit('loadcommit', { url: this.src });
    this.emit('contentload');
    this.emit('loadstop');
  }

  stop(): void {
    this.emit('loadabort', { url: this.src, detail: { reason: 'stopped' } });
  }

  canGoBack(): boolean {
    return this.historyIndex > 0;
  }

  canGoForward(): boolean {
    return this.historyIndex < this.history.length - 1;
  }

  getTitle(): string {
    return this.title;
  }

  navigateTo(url: string): void {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(url);
    this.historyIndex = this.history.length - 1;
    this.src = url;
    this.title = new URL(url).hostname;
    this.emit('loadstart', { url });
    this.emit('loadcommit', { url });
    this.emit('contentload');
    this.emit('loadstop');
  }
}

describe('normalizeBrowserUrl', () => {
  it('adds https scheme for bare hosts', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com');
  });

  it('preserves explicit schemes and about:blank', () => {
    expect(normalizeBrowserUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeBrowserUrl('about:blank')).toBe('about:blank');
  });
});

describe('ControlledFrameController', () => {
  it('tracks loading, title, and history through navigation events', async () => {
    const frame = new MockControlledFrame();
    const controller = new ControlledFrameController(frame);

    frame.navigateTo('https://example.com');
    expect(controller.getState().loading).toBe(false);
    expect(controller.getUrl()).toBe('https://example.com');
    expect(controller.getTitle()).toBe('example.com');

    frame.navigateTo('https://example.org');
    expect(await controller.back()).toBe(true);
    expect(controller.getUrl()).toBe('https://example.com');
    expect(controller.getState().canGoForward).toBe(true);

    controller.dispose();
    expect(() => controller.navigate('https://blocked.test')).toThrow(/disposed/i);
  });

  it('records loadabort failures', () => {
    const frame = new MockControlledFrame();
    const controller = new ControlledFrameController(frame);
    frame.emit('loadabort', { url: 'https://fail.test', detail: { reason: 'net_error' } });
    expect(controller.getState().failed).toBe(true);
    expect(controller.getState().failureReason).toBe('net_error');
  });

  it('denies permission requests by default', () => {
    const frame = new MockControlledFrame();
    const deny = vi.fn();
    new ControlledFrameController(frame);
    for (const permission of BROWSER_DENIED_PERMISSIONS) {
      frame.emit('permissionrequest', { permission, request: { deny } });
    }
    expect(deny).toHaveBeenCalled();
  });

  it('queues dialog requests and auto-dismisses after timeout', () => {
    vi.useFakeTimers();
    const frame = new MockControlledFrame();
    const cancel = vi.fn();
    const onDialog = vi.fn();
    const controller = new ControlledFrameController(frame, {
      tabId: 'tab_1',
      pendingTimeoutMs: 30_000,
      onDialog,
    });

    frame.emit('dialog', {
      messageType: 'confirm',
      messageText: 'Continue?',
      dialog: { cancel, okay: vi.fn() },
    });

    expect(onDialog).toHaveBeenCalledWith({ messageType: 'confirm', messageText: 'Continue?' });
    expect(controller.hasPendingDialog()).toBe(true);
    expect(cancel).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(cancel).toHaveBeenCalled();
    expect(controller.hasPendingDialog()).toBe(false);
    vi.useRealTimers();
  });

  it('handles dialog accept and dismiss via controller methods', () => {
    const frame = new MockControlledFrame();
    const okay = vi.fn();
    const cancel = vi.fn();
    const controller = new ControlledFrameController(frame, { tabId: 'tab_1' });

    frame.emit('dialog', {
      messageType: 'prompt',
      messageText: 'Name?',
      dialog: { okay, cancel },
    });

    expect(controller.handleDialog('accept', 'alice')).toEqual({ handled: true });
    expect(okay).toHaveBeenCalledWith('alice');
    expect(controller.handleDialog('dismiss')).toEqual({ handled: false });

    frame.emit('dialog', { messageType: 'alert', messageText: 'Hi', dialog: { cancel } });
    expect(controller.handleDialog('dismiss')).toEqual({ handled: true });
    expect(cancel).toHaveBeenCalled();
  });

  it('queues newwindow requests and auto-discards after timeout', () => {
    vi.useFakeTimers();
    const frame = new MockControlledFrame();
    const discard = vi.fn();
    const onNewWindow = vi.fn();
    const controller = new ControlledFrameController(frame, {
      tabId: 'tab_1',
      pendingTimeoutMs: 30_000,
      onNewWindow,
    });

    frame.emit('newwindow', {
      newWindow: {
        targetUrl: 'https://popup.test',
        name: '_blank',
        windowOpenDisposition: 'new_foreground_tab',
        window: { discard },
      },
    });

    expect(onNewWindow).toHaveBeenCalledWith({
      targetUrl: 'https://popup.test',
      name: '_blank',
      disposition: 'new_foreground_tab',
    });
    expect(controller.hasPendingNewWindow()).toBe(true);

    vi.advanceTimersByTime(30_000);
    expect(discard).toHaveBeenCalled();
    expect(controller.hasPendingNewWindow()).toBe(false);
    vi.useRealTimers();
  });

  it('handles newwindow deny and open-tab actions', () => {
    const frame = new MockControlledFrame();
    const discard = vi.fn();
    const controller = new ControlledFrameController(frame, { tabId: 'tab_1' });
    const openTab = vi.fn(() => 'tab_new');

    frame.emit('newwindow', {
      targetUrl: 'https://child.test',
      name: 'child',
      window: { discard },
    });

    expect(controller.handleNewWindow('open-tab', undefined, openTab)).toEqual({
      handled: true,
      tabId: 'tab_new',
    });
    expect(openTab).toHaveBeenCalledWith('https://child.test');
    expect(discard).toHaveBeenCalled();

    frame.emit('newwindow', { targetUrl: 'https://blocked.test', window: { discard } });
    expect(controller.handleNewWindow('deny')).toEqual({ handled: true });
    expect(discard).toHaveBeenCalledTimes(2);

    frame.emit('newwindow', { targetUrl: 'https://no-host.test', window: { discard } });
    expect(controller.handleNewWindow('open-tab')).toEqual({ handled: true });
    expect(discard).toHaveBeenCalledTimes(3);
  });
});
