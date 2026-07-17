import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTitlebarVisibility,
  isTitlebarHidden,
  setTitlebarHidden,
  toggleTitlebarHidden,
} from './windowControls';

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}

function makeDocumentStub(): { classList: Set<string>; documentElement: { classList: { contains: (c: string) => boolean; toggle: (c: string, force?: boolean) => void }; className: string } } {
  const classes = new Set<string>();
  const documentElement = {
    get className() {
      return [...classes].join(' ');
    },
    set className(value: string) {
      classes.clear();
      for (const token of value.split(/\s+/).filter(Boolean)) classes.add(token);
    },
    classList: {
      contains: (name: string) => classes.has(name),
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  return { classList: classes, documentElement };
}

describe('titlebar visibility', () => {
  let stub: ReturnType<typeof makeDocumentStub>;

  beforeEach(() => {
    stub = makeDocumentStub();
    stub.documentElement.className = 'app-chrome';
    vi.stubGlobal('localStorage', makeMemoryStorage());
    vi.stubGlobal('document', { documentElement: stub.documentElement });
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to visible and toggles the document class + persistence', () => {
    expect(isTitlebarHidden()).toBe(false);
    applyTitlebarVisibility();
    expect(stub.documentElement.classList.contains('titlebar-hidden')).toBe(false);

    expect(toggleTitlebarHidden()).toBe(true);
    expect(isTitlebarHidden()).toBe(true);
    expect(stub.documentElement.classList.contains('titlebar-hidden')).toBe(true);
    expect(localStorage.getItem('gosh-titlebar-hidden')).toBe('1');

    setTitlebarHidden(false);
    expect(isTitlebarHidden()).toBe(false);
    expect(stub.documentElement.classList.contains('titlebar-hidden')).toBe(false);
    expect(localStorage.getItem('gosh-titlebar-hidden')).toBeNull();
  });
});
