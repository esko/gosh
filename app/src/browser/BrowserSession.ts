import { ControlledFrameController, normalizeBrowserUrl } from './ControlledFrameController';
import type { ControlledFrameNavState } from './ControlledFrameController';
import {
  createControlledFrameElement,
  isControlledFrameAvailable,
  type ControlledFrameElementLike,
} from './controlledFrameTypes';
import { browserStoragePartition } from './policies';

export type BrowserSessionOptions = {
  tabId: string;
  paneId?: string;
  container: HTMLElement;
  initialUrl?: string;
  onTitleChange?: (title: string) => void;
  onAgentNavState?: (state: ControlledFrameNavState) => void;
  onDialog?: (request: { messageType: 'alert' | 'confirm' | 'prompt'; messageText: string }) => void;
  onNewWindow?: (request: { targetUrl: string; name: string; disposition?: string }) => void;
  createElement?: (partition: string) => ControlledFrameElementLike;
};

export type BrowserSessionHandle = {
  controller: ControlledFrameController | null;
  dispose(): void;
};

const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
const FORWARD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>';
const RELOAD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>';

export function mountBrowserSession(options: BrowserSessionOptions): BrowserSessionHandle {
  const { tabId, paneId, container, initialUrl, onTitleChange, onAgentNavState, onDialog, onNewWindow, createElement = createControlledFrameElement } = options;
  container.className = 'term-session term-browser';
  container.replaceChildren();

  const shell = document.createElement('div');
  shell.className = 'browser-shell';

  const toolbar = document.createElement('div');
  toolbar.className = 'browser-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Browser navigation');
  toolbar.innerHTML = `
    <button type="button" class="browser-nav-btn" data-browser-back aria-label="Back" title="Back">${BACK_SVG}</button>
    <button type="button" class="browser-nav-btn" data-browser-forward aria-label="Forward" title="Forward">${FORWARD_SVG}</button>
    <button type="button" class="browser-nav-btn" data-browser-reload aria-label="Reload" title="Reload">${RELOAD_SVG}</button>
    <button type="button" class="browser-nav-btn" data-browser-stop aria-label="Stop" title="Stop" hidden>${STOP_SVG}</button>
  `;

  const urlForm = document.createElement('form');
  urlForm.className = 'browser-url-form';
  urlForm.dataset.browserForm = '';
  const urlInput = document.createElement('input');
  urlInput.className = 'browser-url-input';
  urlInput.dataset.browserUrl = '';
  urlInput.type = 'text';
  urlInput.inputMode = 'url';
  urlInput.autocomplete = 'off';
  urlInput.spellcheck = false;
  urlInput.setAttribute('aria-label', 'Address');
  urlInput.placeholder = 'Search or enter address';
  urlForm.append(urlInput);
  toolbar.append(urlForm);

  const frameHost = document.createElement('div');
  frameHost.className = 'browser-frame-host';
  frameHost.dataset.browserFrameHost = '';

  const status = document.createElement('div');
  status.className = 'browser-status';
  status.dataset.browserStatus = '';
  status.hidden = true;

  shell.append(toolbar, frameHost, status);
  container.append(shell);

  const backBtn = toolbar.querySelector<HTMLButtonElement>('[data-browser-back]')!;
  const forwardBtn = toolbar.querySelector<HTMLButtonElement>('[data-browser-forward]')!;
  const reloadBtn = toolbar.querySelector<HTMLButtonElement>('[data-browser-reload]')!;
  const stopBtn = toolbar.querySelector<HTMLButtonElement>('[data-browser-stop]')!;

  if (!isControlledFrameAvailable()) {
    const notice = document.createElement('div');
    notice.className = 'browser-unavailable';
    notice.innerHTML =
      '<p>Controlled Frame is not available in this context.</p>' +
      '<p class="browser-unavailable-hint">Install and launch the Gosh IWA on ChromeOS with <code>controlled-frame</code> enabled in the manifest.</p>';
    frameHost.append(notice);
    return {
      controller: null,
      dispose: () => container.replaceChildren(),
    };
  }

  const partition = browserStoragePartition(tabId);
  const frame = createElement(partition);
  frameHost.append(frame as unknown as Node);

  const controller = new ControlledFrameController(frame, {
    tabId,
    paneId,
    initialUrl,
    onStateChange: (state) => {
      urlInput.value = state.url === 'about:blank' ? '' : state.url;
      backBtn.disabled = !state.canGoBack;
      forwardBtn.disabled = !state.canGoForward;
      reloadBtn.hidden = state.loading;
      stopBtn.hidden = !state.loading;
      if (state.failed && state.failureReason) {
        status.textContent = state.failureReason;
        status.hidden = false;
      } else {
        status.hidden = true;
        status.textContent = '';
      }
      onTitleChange?.(state.title);
      onAgentNavState?.(state);
    },
    onDialog,
    onNewWindow,
  });

  urlForm.addEventListener('submit', (event) => {
    event.preventDefault();
    controller.navigate(normalizeBrowserUrl(urlInput.value));
    urlInput.blur();
  });
  backBtn.addEventListener('click', () => void controller.back());
  forwardBtn.addEventListener('click', () => void controller.forward());
  reloadBtn.addEventListener('click', () => controller.reload());
  stopBtn.addEventListener('click', () => controller.stop());

  return {
    controller,
    dispose: () => {
      controller.dispose();
      container.replaceChildren();
    },
  };
}
