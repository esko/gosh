/**
 * Custom window controls for the borderless (unframed) IWA window.
 *
 * With `display_override: ["borderless"]` the OS draws no title bar or caption
 * buttons — the whole window is web content — so the app must provide its own
 * draggable title bar and minimize / maximize-restore / close controls. These
 * are styled to match ChromeOS caption buttons (frameless glyphs with a gray
 * circular hover highlight).
 *
 * Window actions use the Additional Windowing Controls API
 * (`window.minimize/maximize/restore`, gated by the `window-management`
 * permission) with feature detection; `window.close()` always works for an app
 * window. Rounded corners use the ChromeOS Window Shape API
 * (`chromeos.isolatedWebApp.setShape` — see windowShape.ts). In a plain browser
 * tab the browser supplies its own frame, so the custom title bar is not shown.
 */

import { installWindowShape, syncWindowShape } from './windowShape';

type AcwWindow = Window & {
  minimize?: () => Promise<void> | void;
  maximize?: () => Promise<void> | void;
  restore?: () => Promise<void> | void;
  displayState?: 'normal' | 'minimized' | 'maximized' | 'fullscreen';
};

const TITLEBAR_ID = 'app-titlebar';
/** Invisible top drag target used while the caption is hidden. */
const MOVE_STRIP_ID = 'app-window-move-strip';
/** Slot in the caption (left of the window controls) for custom terminal tabs. */
export const CAPTION_TABS_SLOT_ID = 'app-titlebar-tabs';
const TITLEBAR_HIDDEN_KEY = 'gosh-titlebar-hidden';
const TITLEBAR_HIDDEN_CLASS = 'titlebar-hidden';

/** App-global: completely hide the custom caption (tabs + window controls). */
export function isTitlebarHidden(): boolean {
  try {
    return localStorage.getItem(TITLEBAR_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Apply the persisted hide/show preference to the document. */
export function applyTitlebarVisibility(): void {
  document.documentElement.classList.toggle(TITLEBAR_HIDDEN_CLASS, isTitlebarHidden());
}

/** Fired after titlebar show/hide has been applied and CSS layout has settled. */
export const TITLEBAR_LAYOUT_EVENT = 'gosh:titlebar-layout';

export function setTitlebarHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(TITLEBAR_HIDDEN_KEY, '1');
    else localStorage.removeItem(TITLEBAR_HIDDEN_KEY);
  } catch {
    // Persistence is best-effort; still apply for this session.
  }
  applyTitlebarVisibility();
  // --titlebar-h / .term-shell top change only after style+layout. A sync
  // resize/fit here still sees the old box; wait two frames, then notify.
  notifyTitlebarLayoutChange();
}

/** Schedule post-reflow resize notifications for Restty / window shape. */
export function notifyTitlebarLayoutChange(): void {
  const fire = (): void => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event(TITLEBAR_LAYOUT_EVENT));
  };
  const raf = globalThis.requestAnimationFrame?.bind(globalThis);
  if (!raf) {
    fire();
    return;
  }
  raf(() => raf(fire));
}

/** Toggle caption visibility. Returns the new hidden state. */
export function toggleTitlebarHidden(): boolean {
  const next = !isTitlebarHidden();
  setTitlebarHidden(next);
  return next;
}

// 16×16 glyphs, centered, using currentColor so they follow the theme.
const ICONS = {
  minimize: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 8h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  maximize: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="4.1" y="4.1" width="7.8" height="7.8" rx="1.2" stroke="currentColor" stroke-width="1.3"/></svg>',
  restore: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="4" y="6" width="6" height="6" rx="1.1" stroke="currentColor" stroke-width="1.3"/><path d="M6.6 4.6h4.2c.66 0 1.2.54 1.2 1.2v4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
};

/** True when the app owns the whole window (no OS-drawn title bar). */
function isAppWindow(): boolean {
  if (new URLSearchParams(location.search).get('chrome') === 'force') return true;
  // Only the frameless modes: the OS draws no title bar, so the app must draw
  // its own. In standalone the OS still draws a caption, and adding ours
  // there stacks a second title bar under the native one (device-confirmed).
  return ['borderless', 'unframed'].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
  );
}

function isMaximized(): boolean {
  // Additional Windowing Controls exposes window.displayState and a
  // (display-state: maximized) media feature; fall back to a size heuristic.
  const state = (window as AcwWindow).displayState;
  if (state) return state === 'maximized';
  if (window.matchMedia('(display-state: maximized)').matches) return true;
  return (
    Math.abs(window.outerWidth - screen.availWidth) <= 4 &&
    Math.abs(window.outerHeight - screen.availHeight) <= 4
  );
}

/** Request window-management up front so borderless + ACW are usable. */
async function requestWindowManagement(): Promise<void> {
  if (!('getScreenDetails' in window)) return;
  try {
    await (window as unknown as { getScreenDetails: () => Promise<unknown> }).getScreenDetails();
  } catch {
    /* needs a user gesture on fresh install — retried from pointerdown below */
  }
  mountCaption();
  void syncWindowShape();
}

async function ensureWindowManagement(): Promise<void> {
  try {
    const status = await navigator.permissions?.query({ name: 'window-management' as PermissionName });
    status?.addEventListener?.('change', () => {
      void requestWindowManagement();
    });
    if (status?.state === 'granted') await requestWindowManagement();
  } catch {
    /* permission API unavailable — controls still render, actions feature-detect */
  }
}

export function installWindowControls(): void {
  // window-management is what unlocks unframed/borderless, and it may only be
  // granted a beat after load (flipping the window from standalone to unframed).
  // Mount immediately if already frameless, and re-check on display-mode changes
  // so the caption appears once the mode flips — without it the user is stuck
  // with the native standalone bar even after the grant.
  applyTitlebarVisibility();
  mountCaption();
  installWindowShape();
  for (const mode of ['unframed', 'borderless']) {
    window.matchMedia(`(display-mode: ${mode})`).addEventListener?.('change', () => {
      mountCaption();
      void syncWindowShape();
    });
  }
  void ensureWindowManagement();
  // Fresh installs often need a user gesture before window-management grants.
  document.addEventListener('pointerdown', () => { void requestWindowManagement(); }, { once: true, capture: true });
}

function mountCaption(): void {
  if (!isAppWindow()) return;
  if (document.getElementById(TITLEBAR_ID)) return;
  document.documentElement.classList.add('app-chrome');
  applyTitlebarVisibility();

  const bar = document.createElement('div');
  bar.id = TITLEBAR_ID;
  bar.className = 'titlebar';
  // Title is a sibling of the drag strip (not a child) so it cannot expand the
  // app-region:drag hit target over the window controls.
  bar.innerHTML = `
    <div class="titlebar-tabs" id="${CAPTION_TABS_SLOT_ID}"></div>
    <div class="titlebar-drag"></div>
    <span class="titlebar-title"></span>
    <div class="win-controls">
      <button class="win-btn" type="button" data-act="minimize" aria-label="Minimize">${ICONS.minimize}</button>
      <button class="win-btn" type="button" data-act="maximize" aria-label="Maximize">${ICONS.maximize}</button>
      <button class="win-btn win-close" type="button" data-act="close" aria-label="Close">${ICONS.close}</button>
    </div>`;
  document.body.prepend(bar);

  // Caption-hidden mode: keep a thin top drag target so the window can still be
  // moved (and so Chromium keeps desktop-frame hit testing armed for edges).
  if (!document.getElementById(MOVE_STRIP_ID)) {
    const moveStrip = document.createElement('div');
    moveStrip.id = MOVE_STRIP_ID;
    moveStrip.className = 'window-move-strip';
    moveStrip.setAttribute('aria-hidden', 'true');
    document.body.prepend(moveStrip);
  }

  // Let the terminal view relocate its tab strip into the caption slot now that
  // it exists (the caption can mount after the terminal renders).
  window.dispatchEvent(new CustomEvent('app-caption-mounted'));

  // Mirror the document title into the caption (ChromeOS shows the window title).
  const titleEl = bar.querySelector<HTMLElement>('.titlebar-title')!;
  const syncTitle = (): void => { titleEl.textContent = document.title; };
  syncTitle();
  const titleNode = document.querySelector('title');
  if (titleNode) new MutationObserver(syncTitle).observe(titleNode, { childList: true });

  const maxBtn = bar.querySelector<HTMLButtonElement>('[data-act="maximize"]')!;
  const syncMaxIcon = (): void => {
    const max = isMaximized();
    maxBtn.innerHTML = max ? ICONS.restore : ICONS.maximize;
    maxBtn.setAttribute('aria-label', max ? 'Restore' : 'Maximize');
  };
  syncMaxIcon();
  window.addEventListener('resize', syncMaxIcon);
  // Prefer the ACW state-change event; fall back to the media-feature change.
  window.addEventListener('displaystatechange', syncMaxIcon);
  window.matchMedia('(display-state: maximized)').addEventListener?.('change', syncMaxIcon);

  const toggleMaximize = async (): Promise<void> => {
    await runWindowAction(async (w) => {
      if (isMaximized()) {
        if (typeof w.restore !== 'function') throw new Error('window.restore is unavailable');
        await w.restore();
      } else {
        if (typeof w.maximize !== 'function') throw new Error('window.maximize is unavailable');
        await w.maximize();
      }
    });
    syncMaxIcon();
  };

  bindWindowButton(bar.querySelector('[data-act="minimize"]'), async () => {
    await runWindowAction(async (w) => {
      if (typeof w.minimize !== 'function') throw new Error('window.minimize is unavailable');
      await w.minimize();
    });
  });
  bindWindowButton(maxBtn, () => toggleMaximize());
  bindWindowButton(bar.querySelector('[data-act="close"]'), () => {
    window.close();
  });
  // ChromeOS: double-clicking the caption (not a button) maximizes/restores.
  bar.addEventListener('dblclick', (event) => {
    if (!(event.target as Element)?.closest('.win-controls')) void toggleMaximize();
  });
}

/**
 * Run an ACW action under the current user gesture.
 * Do not await permission prompts here — that burns transient activation and
 * causes minimize/maximize to reject even when permission is grantable.
 */
async function runWindowAction(action: (w: AcwWindow) => Promise<void>): Promise<void> {
  await action(window as AcwWindow);
}

function bindWindowButton(
  button: Element | null,
  action: () => void | Promise<void>,
): void {
  if (!button) return;
  // Use click (keeps transient activation for ACW). pointerup+preventDefault
  // can drop the gesture before minimize/maximize run.
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void Promise.resolve(action()).catch(() => {
      // Permission denied / API unavailable (e.g. AWC flag off).
    });
  });
}
