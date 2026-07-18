import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RESTTY_BUNDLE = resolve(process.cwd(), 'vendor/restty/dist/restty.esm.js');

const DOM_CONTRACT_MARKERS = [
  'pane-split',
  'is-vertical',
  'is-horizontal',
  'pane-divider',
  'dataset.paneId',
  '0 0 ${',
] as const;

describe('Restty pane DOM contract drift', () => {
  it('keeps resize/zoom DOM markers in the pinned Restty bundle', () => {
    const source = readFileSync(RESTTY_BUNDLE, 'utf8');
    const missing = DOM_CONTRACT_MARKERS.filter((marker) => !source.includes(marker));
    expect(missing, `Restty bundle drifted; missing markers: ${missing.join(', ')}`).toEqual([]);
  });
});
