import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('ghostty-web/package.json');
const packageRoot = dirname(packageJsonPath);
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const rendererSource = join(packageRoot, 'lib', 'renderer.ts');
const terminalSource = join(packageRoot, 'lib', 'terminal.ts');
const distEntry = join(packageRoot, 'dist', 'ghostty-web.js');

if (existsSync(rendererSource) && existsSync(terminalSource)) {
  console.log('ghostty-web source files are present; no local renderer patch is required for this pinned package.');
  process.exit(0);
}

if (!existsSync(distEntry)) {
  throw new Error(`ghostty-web ${packageJson.version ?? ''} does not contain lib sources or dist/ghostty-web.js`);
}

const dist = readFileSync(distEntry, 'utf8');
if (!dist.includes('ghostty-vt.wasm') && !dist.includes('data:application/wasm')) {
  throw new Error('ghostty-web dist entry does not expose a Ghostty WASM loading path');
}

console.log(`ghostty-web ${packageJson.version} is prebuilt; patch check passed.`);
