/**
 * Handle launchQueue for tabbed IWA (new window vs navigate existing).
 */

import { Router } from './router';

type LaunchParams = { targetURL?: string };
type LaunchQueue = { setConsumer: (callback: (params: LaunchParams) => void) => void };

export function initLaunchHandler(): void {
  const launchQueue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
  if (!launchQueue?.setConsumer) return;

  launchQueue.setConsumer((params) => {
    const target = params.targetURL;
    if (!target) return;

    try {
      const url = new URL(target, window.location.origin);
      const path = `${url.pathname}${url.search}`;
      logLaunch(path);
      Router.go(path);
    } catch (error) {
      console.warn('launchQueue: invalid targetURL', target, error);
    }
  });
}

function logLaunch(path: string): void {
  if (import.meta.env.DEV) {
    console.info('[iwa-ssh] launchQueue navigate', path);
  }
}
