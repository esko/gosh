#!/usr/bin/env node
/**
 * Build the GitHub Pages site that hosts the IWA update manifest.
 *
 * Usage:
 *   node scripts/build-pages-site.mjs
 *   node scripts/build-pages-site.mjs --version 0.1.168
 *   PREVIOUS_UPDATE_JSON_URL=https://esko.github.io/gosh/update.json node scripts/build-pages-site.mjs
 *
 * Writes pages/update.json and pages/index.html. Bundle assets live on GitHub Releases;
 * update.json `src` points at release download URLs.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'esko/gosh';
const PAGES_ORIGIN = 'https://esko.github.io/gosh';
const UPDATE_MANIFEST_URL = `${PAGES_ORIGIN}/update.json`;
const OUT_DIR = join(ROOT, 'pages');

const args = process.argv.slice(2);
const versionFlag = args.indexOf('--version');
const explicitVersion = versionFlag >= 0 ? args[versionFlag + 1] : null;

function readPackageVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

function compareVersions(a, b) {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function releaseAssetUrl(version) {
  return `https://github.com/${REPO}/releases/download/v${version}/gosh.swbn`;
}

async function fetchPreviousManifest(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function mergeVersions(previous, nextEntry) {
  const byVersion = new Map();
  for (const entry of previous?.versions ?? []) {
    if (entry?.version && entry?.src) byVersion.set(String(entry.version), entry);
  }
  byVersion.set(nextEntry.version, nextEntry);
  return [...byVersion.values()].sort((a, b) => compareVersions(a.version, b.version));
}

function landingHtml({ version, updateManifestUrl }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gosh — ChromeOS SSH client</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.5; }
    body { margin: 0 auto; max-width: 44rem; padding: 2.5rem 1.25rem 4rem; }
    h1 { font-size: 1.75rem; margin: 0 0 0.5rem; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
    code { padding: 0.1em 0.35em; border-radius: 4px; background: color-mix(in srgb, CanvasText 8%, Canvas); }
    pre { padding: 0.9rem 1rem; overflow-x: auto; border-radius: 8px; background: color-mix(in srgb, CanvasText 8%, Canvas); }
    a { color: inherit; }
    .muted { opacity: 0.75; }
    ol { padding-left: 1.25rem; }
    li { margin: 0.4rem 0; }
  </style>
</head>
<body>
  <h1>Gosh</h1>
  <p class="muted">ChromeOS Isolated Web App for SSH, Mosh, Eternal Terminal, and tsshd. Latest packaged version: <strong>${version}</strong>.</p>

  <h2>Install</h2>
  <ol>
    <li>On ChromeOS / Chrome 120+, open <code>chrome://flags</code> and enable:
      <ul>
        <li><code>#enable-isolated-web-apps</code></li>
        <li><code>#enable-isolated-web-app-dev-mode</code></li>
        <li><code>#enable-chromeos-isolated-web-app-set-shape</code> (rounded corners)</li>
        <li><code>#enable-desktop-pwas-additional-windowing-controls</code> (minimize / maximize)</li>
      </ul>
      Restart Chrome when prompted.
    </li>
    <li>Open <code>chrome://web-app-internals</code>.</li>
    <li>Under <strong>Install IWA from Update Manifest</strong>, paste:</li>
  </ol>
  <pre>${updateManifestUrl}</pre>
  <p>Then launch <strong>Gosh</strong> from the app launcher (not a normal browser tab).</p>

  <h2>Updates</h2>
  <p>Installed copies check this update manifest periodically. You can also use <strong>Force update check</strong> on <code>chrome://web-app-internals</code>.</p>

  <p class="muted">Source and docs: <a href="https://github.com/${REPO}">github.com/${REPO}</a></p>
</body>
</html>
`;
}

const version = explicitVersion || readPackageVersion();
if (!/^\d+(\.\d+)*$/.test(version)) {
  console.error(`Invalid version: ${version}`);
  process.exit(1);
}

const previousUrl = process.env.PREVIOUS_UPDATE_JSON_URL || UPDATE_MANIFEST_URL;
const previous = await fetchPreviousManifest(previousUrl);
const nextEntry = {
  version,
  src: releaseAssetUrl(version),
  channels: ['default'],
};
const versions = mergeVersions(previous, nextEntry);

const manifest = {
  channels: {
    default: { name: 'Stable' },
  },
  versions,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'update.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(OUT_DIR, 'index.html'),
  landingHtml({ version, updateManifestUrl: UPDATE_MANIFEST_URL }),
);

console.log(`Wrote ${OUT_DIR}/update.json (${versions.length} version(s), latest ${version})`);
console.log(`Wrote ${OUT_DIR}/index.html`);
console.log(`Install URL: ${UPDATE_MANIFEST_URL}`);
