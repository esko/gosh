#!/usr/bin/env node

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [
  ['app/upstream/libdot/js/libdot_resources.js', ['export const version']],
  ['app/upstream/hterm/js/hterm_resources.js', ['export const VERSION', 'export const HTML_FIND_BAR']],
];
const entryChecks = [
  ['app/upstream/libdot/index.js', "import * as resources from './js/libdot_resources.js';"],
  ['app/upstream/hterm/index.js', "import * as resources from './js/hterm_resources.js';"],
];

for (const [relative, signatures] of checks) {
  const file = path.join(repoRoot, relative);
  let source;
  try {
    source = await fsp.readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`missing upstream module resource ${relative}; run npm run fetch-assets`, { cause: error });
  }
  if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(source)) {
    throw new Error(`${relative} contains an HTML fallback instead of JavaScript`);
  }
  for (const signature of signatures) {
    if (!source.includes(signature)) throw new Error(`${relative} is not the expected JavaScript resource module`);
  }
}

for (const [relative, expectedImport] of entryChecks) {
  const source = await fsp.readFile(path.join(repoRoot, relative), 'utf8');
  if (!source.includes(expectedImport) || source.includes("from './dist/js/")) {
    throw new Error(`${relative} does not import its tracked JavaScript resource module`);
  }
}

console.log('Upstream libdot/hterm module resources verified.');
