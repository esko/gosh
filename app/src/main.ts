import './security/trustedTypes';
import { installBootErrorHandler, showBootError } from './security/bootError';
import { renderApp } from './pwa/views';
import './pwa/styles.css';

installBootErrorHandler();

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app root element');
  await renderApp(root);
  window.addEventListener('popstate', () => void renderApp(root));
}

boot().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  showBootError(detail);
  console.error('Boot failed', error);
});
