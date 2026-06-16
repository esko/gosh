/**
 * Runtime URLs for copied libapps assets under app/public/upstream/.
 */

export function getUpstreamBase(): string {
  return typeof __IWA_UPSTREAM_BASE__ !== 'undefined' ? __IWA_UPSTREAM_BASE__ : '/upstream';
}

/** Absolute URL for a file under the upstream public tree. */
export function upstreamUrl(relativePath: string): string {
  const base = getUpstreamBase().replace(/\/$/, '');
  const path = relativePath.replace(/^\//, '');
  return `${base}/${path}`;
}

/** Dynamic import from /upstream/ without bundling into the Vite app chunk. */
export function upstreamImport<T = unknown>(relativePath: string): Promise<T> {
  return import(/* @vite-ignore */ upstreamUrl(relativePath));
}
