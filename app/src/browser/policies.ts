/**
 * Storage partition and permission-request defaults for browser tabs.
 * See docs/agent/BROWSER.md for rationale and ChromeOS/IWA caveats.
 */

/** Persistent per-tab partition prefix (cookies/localStorage survive relaunch). */
export const BROWSER_STORAGE_PARTITION_PREFIX = 'persist:gosh-browser';

export function browserStoragePartition(tabId: string): string {
  return `${BROWSER_STORAGE_PARTITION_PREFIX}:${tabId}`;
}

/**
 * Embedded sites must not receive sensitive capabilities unless the IWA already
 * holds the permission and we add an explicit allow path later (D2+).
 */
export const BROWSER_DENIED_PERMISSIONS = new Set([
  'geolocation',
  'notifications',
  'midi',
  'camera',
  'microphone',
  'clipboard-read',
  'clipboard-write',
  'clipboard-sanitized-write',
  'idle-detection',
  'payment',
  'usb',
  'serial',
  'hid',
  'bluetooth',
  'window-management',
]);

export type BrowserPermissionRequestEvent = {
  permission: string;
  request?: {
    allow?: () => void;
    deny?: () => void;
  };
};

/** Deny risky or unreviewed permission requests from embedded pages. */
export function handleBrowserPermissionRequest(event: BrowserPermissionRequestEvent): void {
  const deny = (): void => {
    event.request?.deny?.();
  };
  if (BROWSER_DENIED_PERMISSIONS.has(event.permission)) {
    deny();
    return;
  }
  // Default closed: only allow-list specific safe permissions in follow-up work.
  deny();
}
