/** noop location — nassh only needs href for internal bookkeeping. */
export function createNasshTerminalLocation(): { href: string; hash: string; replace: () => void } {
  return {
    href: globalThis.location?.href ?? '',
    hash: '',
    replace: () => {},
  };
}

/**
 * Window stub that drops nassh's `beforeunload` quit-warning handler while
 * proxying everything else to the real window. The app manages close confirmation
 * itself with a styled modal.
 */
export function createNasshTerminalWindow(): Record<string, unknown> {
  return {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
      if (type === 'beforeunload') return;
      globalThis.addEventListener(type, listener, options as AddEventListenerOptions);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
      if (type === 'beforeunload') return;
      globalThis.removeEventListener(type, listener, options as EventListenerOptions);
    },
    close: () => globalThis.close(),
  };
}
