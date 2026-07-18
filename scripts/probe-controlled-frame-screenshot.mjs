#!/usr/bin/env node
/**
 * CDP feasibility probe for Controlled Frame screenshots (ADR 0015).
 *
 * Connects to Chrome remote debugging, lists targets, attempts
 * Page.captureScreenshot on the IWA/shell page, and reports whether nested
 * targets exist that may correspond to Controlled Frame guest content.
 *
 * Skips gracefully (exit 0) when no Chrome CDP endpoint is reachable.
 *
 * Usage:
 *   npm run probe:controlled-frame-screenshot
 *   CHROME_DEBUG_PORT=9222 npm run probe:controlled-frame-screenshot
 */

import { createConnection } from 'node:net';

const CDP_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const URL_MATCH = process.env.GOSH_IWA_URL_MATCH || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForPort(port, timeoutMs = 1500) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`port ${port} not open`));
          return;
        }
        setTimeout(tryOnce, 100);
      });
    };
    tryOnce();
  });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
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
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket error')));
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}, sessionId) {
          return new Promise((res, rej) => {
            const id = nextId++;
            pending.set(id, { res, rej });
            const payload = { id, method, params };
            if (sessionId) payload.sessionId = sessionId;
            ws.send(JSON.stringify(payload));
          });
        },
        close: () => ws.close(),
      }),
    );
  });
}

function summarizeTarget(t) {
  return {
    id: t.id ?? t.targetId,
    type: t.type,
    title: t.title,
    url: t.url,
    parentId: t.parentId ?? t.openerId ?? t.browserContextId ?? undefined,
  };
}

function isIwaShellTarget(t) {
  const url = t.url ?? '';
  if (url.startsWith('isolated-app://')) return true;
  if (/^https?:\/\/127\.0\.0\.1:\d+/.test(url)) return true;
  if (URL_MATCH && url.includes(URL_MATCH)) return true;
  return false;
}

function isNestedCandidate(t, shellId) {
  const id = t.id ?? t.targetId;
  if (!id || id === shellId) return false;
  const type = t.type ?? '';
  if (!['page', 'iframe', 'webview', 'guest', 'other'].includes(type)) return false;
  const parentId = t.parentId ?? t.openerId;
  if (parentId && parentId === shellId) return true;
  const url = t.url ?? '';
  if (url && !url.startsWith('devtools://') && !url.startsWith('chrome://')) {
    if (parentId) return true;
    if (type === 'iframe' || type === 'webview' || type === 'guest') return true;
  }
  return false;
}

async function probePageScreenshot(client, label) {
  await client.send('Page.enable');
  const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const bytes = shot?.data ? Buffer.from(shot.data, 'base64').length : 0;
  return { label, ok: bytes > 0, bytes };
}

async function main() {
  console.log('Controlled Frame screenshot CDP probe (ADR 0015)\n');

  try {
    await waitForPort(CDP_PORT);
  } catch {
    console.log(`⊘ Skipped — no Chrome CDP on 127.0.0.1:${CDP_PORT}`);
    console.log('  Enable --remote-debugging-port or run npm run dev:chrome');
    console.log('  On ChromeOS: forward port 9222 from the device for Crostini probes.');
    process.exit(0);
  }

  let version;
  let flatTargets = [];
  try {
    version = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    flatTargets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  } catch (error) {
    console.log(`⊘ Skipped — CDP HTTP endpoint error: ${error.message}`);
    process.exit(0);
  }

  console.log(`Browser: ${version.Browser ?? '(unknown)'}`);
  console.log(`Flat targets (/json/list): ${flatTargets.length}\n`);

  for (const t of flatTargets) {
    const s = summarizeTarget(t);
    const tag = isIwaShellTarget(t) ? ' [IWA shell candidate]' : '';
    console.log(`  • ${s.type}\t${s.url || '(no url)'}${tag}`);
    if (s.parentId) console.log(`      parent/opener: ${s.parentId}`);
  }

  const shell =
    flatTargets.find((t) => t.type === 'page' && isIwaShellTarget(t)) ??
    flatTargets.find((t) => t.type === 'page' && !String(t.url ?? '').startsWith('devtools://'));

  if (!shell?.webSocketDebuggerUrl) {
    console.log('\n⚠ No attachable page target found. Open the installed IWA (browser tab loaded) and retry.');
    process.exit(0);
  }

  const shellId = shell.id ?? shell.targetId;
  const nestedFlat = flatTargets.filter((t) => isNestedCandidate(t, shellId));
  console.log(`\nShell target: ${shell.url}`);
  console.log(`Nested flat targets (heuristic): ${nestedFlat.length}`);
  for (const t of nestedFlat) {
    const s = summarizeTarget(t);
    console.log(`  ↳ ${s.type}\t${s.url || '(no url)'}`);
  }

  const pageClient = await openClient(shell.webSocketDebuggerUrl);
  const pageShots = [];

  try {
    pageShots.push(await probePageScreenshot(pageClient, 'outer IWA page'));
    console.log(`\nPage.captureScreenshot (outer): ${pageShots[0].bytes} bytes`);
  } catch (error) {
    console.log(`\nPage.captureScreenshot (outer): failed — ${error.message}`);
  } finally {
    pageClient.close();
  }

  let browserNested = [];
  const browserWs = version.webSocketDebuggerUrl;
  if (browserWs) {
    const browserClient = await openClient(browserWs);
    try {
      await browserClient.send('Target.setDiscoverTargets', { discover: true });
      const { targetInfos = [] } = await browserClient.send('Target.getTargets');
      browserNested = targetInfos.filter((t) => isNestedCandidate(t, shellId));
      console.log(`\nTarget.getTargets (browser): ${targetInfos.length} total, ${browserNested.length} nested candidates`);
      for (const t of browserNested) {
        const s = summarizeTarget(t);
        console.log(`  ↳ ${s.type}\t${s.url || '(no url)'}`);
      }

      for (const t of browserNested.slice(0, 3)) {
        const targetId = t.targetId ?? t.id;
        try {
          const { sessionId } = await browserClient.send('Target.attachToTarget', {
            targetId,
            flatten: true,
          });
          const nestedShot = await browserClient.send(
            'Page.captureScreenshot',
            { format: 'png', fromSurface: true },
            sessionId,
          );
          const bytes = nestedShot?.data ? Buffer.from(nestedShot.data, 'base64').length : 0;
          console.log(`  captureScreenshot nested ${targetId.slice(0, 8)}…: ${bytes} bytes`);
          await browserClient.send('Target.detachFromTarget', { sessionId });
        } catch (error) {
          console.log(`  captureScreenshot nested ${String(targetId).slice(0, 8)}…: failed — ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`\nTarget.getTargets: ${error.message}`);
    } finally {
      browserClient.close();
    }
  }

  const hasNested = nestedFlat.length > 0 || browserNested.length > 0;
  console.log('\n── Summary ──');
  console.log(`  Outer screenshot: ${pageShots[0]?.ok ? `ok (${pageShots[0].bytes} bytes)` : 'failed or empty'}`);
  console.log(`  Nested CDP targets for Controlled Frame: ${hasNested ? 'yes (see above)' : 'none detected'}`);
  console.log('  Interpretation: pending Chromebook evidence — see docs/adr/0015-browser-screenshot-feasibility.md');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
