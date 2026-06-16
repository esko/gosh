#!/usr/bin/env node
/**
 * CDP smoke test for echo-stub session (no SSH required).
 * Requires: npm run dev:chrome (or Vite on 5173 + Chrome with --remote-debugging-port=9222)
 */

import { createConnection } from 'node:net';

const CDP_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const APP_PORT = Number(process.env.IWA_SSH_DEV_PORT || 5173);
const BASE = `http://127.0.0.1:${APP_PORT}`;

async function cdp(method, params = {}) {
  const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
  const page = list.find((t) => t.type === 'page' && t.url?.includes(String(APP_PORT)));
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('No debuggable page found — run npm run dev:chrome first');
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const id = 1;
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id === id) {
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}

function waitForPort(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.end();
      resolve();
    });
    socket.once('error', () => reject(new Error(`Port ${port} not open`)));
  });
}

const checks = [];

function pass(name) {
  checks.push({ name, ok: true });
  console.log(`  ✓ ${name}`);
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail });
  console.error(`  ✗ ${name}: ${detail}`);
}

async function main() {
  console.log('Echo-stub CDP smoke\n');

  try {
    await waitForPort(APP_PORT);
    pass('Vite dev server reachable');
  } catch (error) {
    fail('Vite dev server reachable', error.message);
    process.exit(1);
  }

  try {
    await waitForPort(CDP_PORT);
    pass('Chrome CDP port open');
  } catch (error) {
    fail('Chrome CDP port open', error.message);
    console.log('\nRun: npm run dev:chrome');
    process.exit(1);
  }

  try {
    await cdp('Page.navigate', { url: `${BASE}/connect` });
    pass('Navigate to /connect');
  } catch (error) {
    fail('Navigate to /connect', error.message);
  }

  try {
    const { result } = await cdp('Runtime.evaluate', {
      expression: `document.querySelector('#host') !== null`,
      returnByValue: true,
    });
    if (result?.value) pass('Connect form present');
    else fail('Connect form present', 'missing #host');
  } catch (error) {
    fail('Connect form present', error.message);
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
