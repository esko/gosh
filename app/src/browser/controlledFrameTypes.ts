/** Minimal Controlled Frame element surface for tests and production. */

export type ControlledFrameLoadEvent = Event & {
  url?: string;
  oldUrl?: string;
  newUrl?: string;
  detail?: { reason?: string };
};

export type ControlledFramePermissionRequest = {
  permission: string;
  allow?: () => void;
  deny?: () => void;
};

export type ControlledFramePermissionRequestEvent = Event & {
  permission: string;
  request?: ControlledFramePermissionRequest;
};

export type BrowserDialogType = 'alert' | 'confirm' | 'prompt';

export type ControlledFrameDialogController = {
  okay?: (response?: string) => void;
  ok?: (response?: string) => void;
  cancel?: () => void;
};

export type ControlledFrameDialogMessage = {
  messageType?: BrowserDialogType;
  messageText?: string;
  dialog?: ControlledFrameDialogController;
};

export type ControlledFrameDialogEvent = Event & {
  messageType?: BrowserDialogType;
  messageText?: string;
  dialog?: ControlledFrameDialogController;
  dialogMessage?: ControlledFrameDialogMessage;
};

export type ControlledFrameNewWindowController = {
  attach?: (element: ControlledFrameElementLike) => void;
  discard?: () => void;
};

export type ControlledFrameNewWindowDetails = {
  targetUrl?: string;
  name?: string;
  windowOpenDisposition?: string;
  window?: ControlledFrameNewWindowController;
};

export type ControlledFrameNewWindowEvent = Event & {
  targetUrl?: string;
  name?: string;
  windowOpenDisposition?: string;
  window?: ControlledFrameNewWindowController;
  newWindow?: ControlledFrameNewWindowDetails;
};

export type ControlledFrameElementLike = {
  src: string;
  partition?: string;
  back(): Promise<boolean>;
  forward(): Promise<boolean>;
  reload(): void;
  stop?(): void;
  canGoBack?(): boolean;
  canGoForward?(): boolean;
  getTitle?(): string;
  isLoading?(): boolean;
  executeScript?(details: { code?: string; files?: string[] }): Promise<unknown>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

export function isControlledFrameAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if ('HTMLControlledFrameElement' in window) return true;
  return typeof customElements !== 'undefined' && customElements.get('controlledframe') !== undefined;
}

export function createControlledFrameElement(partition: string): ControlledFrameElementLike {
  const el = document.createElement('controlledframe');
  el.setAttribute('partition', partition);
  return el as unknown as ControlledFrameElementLike;
}
