/**
 * Load nassh/hterm UI strings (PLUGIN_LOADING, CONNECTING, …).
 *
 * Only `/upstream/nassh/_locales/en/` is packaged in the IWA. Upstream's
 * `findAndLoadMessages` walks `navigator.languages` (en_GB, fi, fi_FI, …) and
 * awaits a signed-bundle 404 for each missing locale before falling back to
 * `en` — that cascade alone can cost ~10s on cold start / ChromeOS resume.
 * Load `en` directly and skip the hunt.
 */

import { log } from '../debug/logger';
import { upstreamImport } from './upstreamUrls';

type MessageDefs = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;

type HtermModule = {
  hterm: {
    initPromise: Promise<void>;
    messageManager: {
      useCrlf: boolean;
      addMessages: (defs: MessageDefs) => void;
      findAndLoadMessages: (pattern: string) => Promise<void>;
    };
  };
};

const EN_MESSAGES_URL = '/upstream/nassh/_locales/en/messages.json';

let loaded = false;
let loadPromise: Promise<void> | null = null;

async function loadEnglishMessages(): Promise<void> {
  const htermMod = await upstreamImport<HtermModule>('hterm/js/hterm.js');
  await htermMod.hterm.initPromise;
  htermMod.hterm.messageManager.useCrlf = true;

  const response = await fetch(EN_MESSAGES_URL);
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.statusText}`);
  }
  htermMod.hterm.messageManager.addMessages((await response.json()) as MessageDefs);
}

export async function loadNasshMessages(): Promise<void> {
  if (loaded) return;
  loadPromise ??= (async () => {
    try {
      await loadEnglishMessages();
      loaded = true;
      log.ssh.debug('nassh locale messages loaded (en)');
    } catch (error) {
      // Allow a later connect to retry; do not leave a rejected singleton.
      loadPromise = null;
      log.ssh.warn('nassh locale messages unavailable', { error });
    }
  })();
  await loadPromise;
}
