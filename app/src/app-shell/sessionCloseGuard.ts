/**
 * Confirm before closing a tab/window with an active SSH session.
 */

import { getSessionDebugState } from '../debug/logger';
import { loadSettings } from '../storage/indexedDb';

let installed = false;
let confirmCloseEnabled = true;

export async function refreshSessionCloseSetting(): Promise<void> {
  const settings = await loadSettings();
  confirmCloseEnabled = settings.behavior.confirmCloseTab;
}

export function initSessionCloseGuard(): void {
  if (installed) return;
  installed = true;

  void refreshSessionCloseSetting();

  window.addEventListener('beforeunload', (event) => {
    if (getSessionDebugState().activeSessionIds.length === 0) return;
    if (!confirmCloseEnabled) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

/** Prompt when closing a simulated tab that hosts a session. */
export async function confirmCloseSessionTab(path: string): Promise<boolean> {
  if (!path.startsWith('/session/')) return true;

  await refreshSessionCloseSetting();
  if (!confirmCloseEnabled) return true;

  return window.confirm('Close this SSH session tab? The connection will be disconnected.');
}
