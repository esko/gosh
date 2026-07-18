import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IWA_PERMISSIONS_POLICY } from '../iwa/permissionsPolicy';

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

type Manifest = {
  display_override?: string[];
  permissions_policy?: Record<string, unknown>;
  tab_strip?: unknown;
  background_color?: string;
  icons?: ManifestIcon[];
  update_manifest_url?: string;
  version?: string;
};

const read = (rel: string): Manifest =>
  JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf8')) as Manifest;

// The HTML links to /.well-known/manifest.webmanifest, so that is authoritative.
const WELL_KNOWN = 'app/public/.well-known/manifest.webmanifest';
const PUBLIC = 'app/public/manifest.webmanifest';

describe('IWA window manifest', () => {
  it('uses only the custom unframed window shell', () => {
    const manifest = read(WELL_KNOWN);
    expect(manifest.tab_strip).toBeUndefined();
    expect(manifest.display_override).not.toContain('tabbed');
    // Opaque background_color fills square corners behind the rounded OS clip.
    expect(manifest.background_color).toBe('transparent');
  });

  it('keeps the public and well-known permissions policies in sync', () => {
    expect(read(PUBLIC).permissions_policy).toEqual(read(WELL_KNOWN).permissions_policy);
  });

  it('points both manifests at the public GitHub Pages update manifest', () => {
    const expected = 'https://esko.github.io/gosh/update.json';
    expect(read(WELL_KNOWN).update_manifest_url).toBe(expected);
    expect(read(PUBLIC).update_manifest_url).toBe(expected);
    expect(read(WELL_KNOWN).version).toBe(read(PUBLIC).version);
  });

  it('allows clipboard and window-management APIs', () => {
    const manifest = read(WELL_KNOWN);
    // The app-drawn caption needs a frameless display mode...
    expect(manifest.display_override).toEqual(expect.arrayContaining(['unframed', 'borderless']));
    // ...and unframed/borderless is gated on the window-management permission,
    // which must be allowed by the manifest's permissions policy or Chrome falls
    // back to standalone (native title bar). This guards that regression.
    expect(manifest.permissions_policy?.['window-management']).toEqual(['self']);
    // Image paste (Ctrl+Shift+V) reads ClipboardItem via navigator.clipboard.read.
    expect(manifest.permissions_policy?.['clipboard-read']).toEqual(['self']);
    expect(manifest.permissions_policy?.['clipboard-write']).toEqual(['self']);
    expect(manifest.permissions_policy?.['controlled-frame']).toEqual(['self']);
  });

  it('keeps dev Permissions-Policy headers aligned with manifest clipboard keys', () => {
    expect(IWA_PERMISSIONS_POLICY).toContain('clipboard-read=(self)');
    expect(IWA_PERMISSIONS_POLICY).toContain('clipboard-write=(self)');
    expect(IWA_PERMISSIONS_POLICY).toContain('controlled-frame=(self)');
    expect(IWA_PERMISSIONS_POLICY).toContain('window-management=(self)');
  });

  it('ships maskable app icons at the install sizes Chrome requires', () => {
    const icons = read(WELL_KNOWN).icons ?? [];
    const maskable = icons.filter((icon) => icon.purpose?.split(/\s+/).includes('maskable'));
    expect(maskable.map((icon) => icon.sizes).sort()).toEqual([
      '128x128',
      '192x192',
      '384x384',
      '48x48',
      '512x512',
      '72x72',
      '96x96',
    ]);
    expect(maskable.every((icon) => icon.type === 'image/png')).toBe(true);
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icon-192.png', sizes: '192x192', purpose: 'any' }),
        expect.objectContaining({ src: '/icon-512.png', sizes: '512x512', purpose: 'any' }),
      ]),
    );
  });
});
