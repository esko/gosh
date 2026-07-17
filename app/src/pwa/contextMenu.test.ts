import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeContextMenu, showContextMenu } from './contextMenu';

type Listener = EventListenerOrEventListenerObject;

function makeMemoryDom() {
  const listeners = new Map<string, Set<Listener>>();
  const el = (tag: string) => {
    const attrs = new Map<string, string>();
    const children: unknown[] = [];
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      style: {} as Record<string, string>,
      disabled: false,
      children,
      append: (...nodes: unknown[]) => { children.push(...nodes); },
      remove: vi.fn(),
      textContent: '',
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
      getAttribute: (name: string) => attrs.get(name) ?? null,
      addEventListener: vi.fn(),
      getBoundingClientRect: () => ({ width: 120, height: 80, left: 0, top: 0, right: 120, bottom: 80 }),
      contains: (target: unknown) => target === node || children.includes(target),
    };
    return node;
  };

  const body = {
    append: vi.fn(),
  };

  const documentStub = {
    body,
    createElement: (tag: string) => el(tag),
    addEventListener: (type: string, listener: Listener, _options?: unknown) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    },
  };

  const windowStub = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  return { documentStub, windowStub, listeners, body };
}

describe('context menu outside dismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const { documentStub, windowStub, listeners, body } = makeMemoryDom();
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', windowStub);
    (globalThis as { __ctxListeners?: Map<string, Set<Listener>> }).__ctxListeners = listeners;
    (globalThis as { __ctxBody?: typeof body }).__ctxBody = body;
  });

  afterEach(() => {
    closeContextMenu();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('registers a capture pointerdown dismiss listener (not mousedown)', () => {
    showContextMenu(10, 10, [
      { type: 'item', label: 'Paste', onSelect: () => undefined },
    ]);
    expect((globalThis as unknown as { __ctxBody: { append: ReturnType<typeof vi.fn> } }).__ctxBody.append).toHaveBeenCalledOnce();

    const listeners = (globalThis as unknown as { __ctxListeners: Map<string, Set<Listener>> }).__ctxListeners;
    expect(listeners.get('pointerdown')?.size ?? 0).toBe(0);
    vi.runAllTimers();
    expect(listeners.get('pointerdown')?.size).toBe(1);
    expect(listeners.get('mousedown')?.size ?? 0).toBe(0);
  });

  it('closes when pointerdown lands outside the menu', () => {
    const onSelect = vi.fn();
    showContextMenu(10, 10, [{ type: 'item', label: 'Paste', onSelect }]);
    vi.runAllTimers();

    const listeners = (globalThis as unknown as { __ctxListeners: Map<string, Set<Listener>> }).__ctxListeners;
    const handler = [...listeners.get('pointerdown')!][0] as (event: { target: unknown }) => void;
    handler({ target: { id: 'outside' } });

    // Menu removed; listener torn down.
    expect(listeners.get('pointerdown')?.size ?? 0).toBe(0);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
