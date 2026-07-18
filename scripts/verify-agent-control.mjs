#!/usr/bin/env node
/**
 * CDP verification for the in-process agent control plane (ADR 0011).
 * Drives window.__goshAgent (not __resttyAdapter) for list/split/focus/resize/close.
 *
 * Requires Chromium with --remote-debugging-port=9222 and Vite on 5173.
 */

const CDP_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const APP_PORT = Number(process.env.GOSH_DEV_PORT || 5173);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPageWsUrl() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
  });
  const target = await res.json();
  return target.webSocketDebuggerUrl;
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
    } catch (e) {
      last = e.message;
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
  console.log('agent control CDP verification (__goshAgent)\n');
  const client = await openClient(await newPageWsUrl());
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  await client.send('Page.navigate', {
    url: `${BASE}/terminal.html?protocol=echo&host=local&username=smoke`,
  });

  try {
    await waitFor(client, `document.querySelector('#status')?.dataset.state === 'connected'`, 15000, 'connected');
    pass('echo transport connected');
  } catch (e) {
    fail('echo transport connected', e.message);
  }

  try {
    await waitFor(client, `!!window.__goshAgent`, 10000, '__goshAgent');
    pass('window.__goshAgent exposed');
  } catch (e) {
    fail('window.__goshAgent exposed', e.message);
  }

  try {
    const caps = JSON.parse(
      await evaluate(client, `JSON.stringify(window.__goshAgent.capabilities())`),
    );
    if (caps.methods?.listPanes?.available && caps.methods?.paneSplit?.available && caps.methods?.terminalRead?.available) {
      pass('capabilities report implemented vs unavailable methods');
    } else {
      fail('capabilities report implemented vs unavailable methods', JSON.stringify(caps));
    }
  } catch (e) {
    fail('capabilities report implemented vs unavailable methods', e.message);
  }

  let tabId;
  let paneId;
  try {
    const listed = JSON.parse(
      await waitFor(
        client,
        `(() => {
          const tabs = window.__goshAgent.listTabs();
          const panes = window.__goshAgent.listPanes();
          if (!tabs.ok || !panes.ok || panes.value.length < 1) return '';
          return JSON.stringify({ tabId: tabs.value[0].tabId, paneId: panes.value[0].paneId, panes });
        })()`,
        10000,
        'list panes',
      ),
    );
    tabId = listed.tabId;
    paneId = listed.paneId;
    if (typeof tabId === 'string' && typeof paneId === 'string' && !JSON.stringify(listed).includes('resttyPaneId')) {
      pass(`listTabs/listPanes opaque ids (tab=${tabId.slice(0, 12)}… pane=${paneId.slice(0, 12)}…)`);
    } else {
      fail('listTabs/listPanes opaque ids', JSON.stringify(listed));
    }
  } catch (e) {
    fail('listTabs/listPanes opaque ids', e.message);
  }

  let secondPane;
  try {
    const split = JSON.parse(
      await evaluate(
        client,
        `window.__goshAgent.paneSplit({ tabId: ${JSON.stringify(tabId)}, direction: 'vertical' }).then(JSON.stringify)`,
      ),
    );
    if (!split.ok) throw new Error(JSON.stringify(split));
    secondPane = split.value.paneId;
    await waitFor(
      client,
      `(() => { const r = window.__goshAgent.listPanes(); return r.ok && r.value.length === 2 ? '1' : ''; })()`,
      8000,
      '2 panes',
    );
    if (secondPane && secondPane !== paneId) pass(`paneSplit created distinct pane ${secondPane.slice(0, 12)}…`);
    else fail('paneSplit created distinct pane', JSON.stringify(split));
  } catch (e) {
    fail('paneSplit created distinct pane', e.message);
  }

  try {
    const focus = JSON.parse(
      await evaluate(
        client,
        `JSON.stringify(window.__goshAgent.paneFocus({ paneId: ${JSON.stringify(secondPane)} }))`,
      ),
    );
    const resize = JSON.parse(
      await evaluate(
        client,
        `JSON.stringify(window.__goshAgent.paneResize({ paneId: ${JSON.stringify(secondPane)}, direction: 'right', amount: 6 }))`,
      ),
    );
    if (focus.ok && resize.ok) pass('paneFocus + paneResize ok');
    else fail('paneFocus + paneResize ok', JSON.stringify({ focus, resize }));
  } catch (e) {
    fail('paneFocus + paneResize ok', e.message);
  }

  try {
    const closed = JSON.parse(
      await evaluate(
        client,
        `JSON.stringify(window.__goshAgent.paneClose({ paneId: ${JSON.stringify(secondPane)} }))`,
      ),
    );
    await waitFor(
      client,
      `(() => { const r = window.__goshAgent.listPanes(); return r.ok && r.value.length === 1 ? '1' : ''; })()`,
      8000,
      '1 pane after close',
    );
    if (closed.ok) pass('paneClose returns to a single pane');
    else fail('paneClose returns to a single pane', JSON.stringify(closed));
  } catch (e) {
    fail('paneClose returns to a single pane', e.message);
  }

  client.close();
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
