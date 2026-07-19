#!/usr/bin/env node
/**
 * CDP verification for live Exposé / tab overview.
 *
 * Requires Vite on 5173 and Chrome with --remote-debugging-port=9222
 * (e.g. agent-browser attach, or a manual Chrome launch).
 */

import { createConnection } from 'node:net';

const CDP_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const APP_PORT = Number(process.env.GOSH_DEV_PORT || 5173);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return res.json();
}

async function findPageWsUrl(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = [];
  while (Date.now() < deadline) {
    try {
      const list = await listTargets();
      lastSeen = list;
      const page =
        list.find((t) => t.type === 'page' && t.url?.includes(String(APP_PORT))) ??
        list.find((t) => t.type === 'page' && /^(https?:|about:)/.test(t.url ?? ''));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // retry
    }
    await sleep(150);
  }
  throw new Error(`No page target — last: ${lastSeen.map((t) => `${t.type}:${t.url}`).join(', ')}`);
}

function openClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket error')));
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = nextId++;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => ws.close(),
      }),
    );
  });
}

async function evaluate(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result?.value;
}

async function waitFor(client, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(client, expression);
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label} (last=${JSON.stringify(last)})`);
}

const checks = [];
const pass = (n) => {
  checks.push(true);
  console.log(`  ✓ ${n}`);
};
const fail = (n, d) => {
  checks.push(false);
  console.error(`  ✗ ${n}: ${d}`);
};

async function main() {
  console.log('Exposé / tab overview CDP verification\n');

  await waitForPort(APP_PORT);
  pass('Vite reachable');
  await waitForPort(CDP_PORT);
  pass('Chrome CDP open');

  const client = await openClient(await findPageWsUrl());
  pass('CDP page session');

  await client.send('Page.enable');
  await client.send('Page.navigate', {
    url: `${BASE}/terminal.html?protocol=echo&host=local&username=expose`,
  });

  await waitFor(
    client,
    `document.querySelector('#status')?.dataset.state === 'connected'`,
    12000,
    'echo connected',
  );
  pass('Echo session connected');

  await waitFor(client, `!!document.querySelector('button.expose-toggle')`, 5000, 'expose toggle');
  pass('Expose toggle button present');

  const opened = await evaluate(
    client,
    `(() => {
      const btn = document.querySelector('button.expose-toggle');
      if (!btn) return { ok: false, reason: 'no button' };
      btn.click();
      return {
        ok: !!document.querySelector('.modal.tab-overview'),
        pressed: btn.getAttribute('aria-pressed'),
        cards: document.querySelectorAll('.tab-overview-card').length,
      };
    })()`,
  );
  if (opened?.ok) pass(`Expose opens (${opened.cards} card(s), aria-pressed=${opened.pressed})`);
  else fail('Expose opens', JSON.stringify(opened));

  let previewSrc1;
  try {
    previewSrc1 = await waitFor(
      client,
      `document.querySelector('.tab-overview-img')?.getAttribute('src') || ''`,
      8000,
      'preview image',
    );
    if (typeof previewSrc1 === 'string' && previewSrc1.startsWith('blob:')) {
      pass(`Live preview image present (${previewSrc1.slice(0, 24)}…)`);
    } else {
      fail('Live preview image present', `src=${previewSrc1}`);
    }
  } catch (error) {
    fail('Live preview image present', error.message);
  }

  if (previewSrc1) {
    await sleep(1600);
    const previewSrc2 = await evaluate(
      client,
      `document.querySelector('.tab-overview-img')?.getAttribute('src') || ''`,
    );
    if (previewSrc2 && previewSrc2 !== previewSrc1) {
      pass('Preview URL refreshed while Exposé is open');
    } else {
      fail('Preview URL refreshed while Exposé is open', `still ${previewSrc2 || '(empty)'}`);
    }
  }

  const closed = await evaluate(
    client,
    `(() => {
      const btn = document.querySelector('button.expose-toggle');
      btn?.click();
      return {
        ok: !document.querySelector('.modal.tab-overview'),
        pressed: btn?.getAttribute('aria-pressed'),
      };
    })()`,
  );
  if (closed?.ok) pass(`Expose toggle closes (aria-pressed=${closed.pressed})`);
  else fail('Expose toggle closes', JSON.stringify(closed));

  client.close();
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
