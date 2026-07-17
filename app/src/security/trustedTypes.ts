/**
 * IWA runtime enforces require-trusted-types-for 'script'. Without a default
 * policy, innerHTML assignments throw and the UI stays blank (#202124).
 */

type TrustedTypePolicyFactory = {
  createPolicy: (
    name: string,
    rules: {
      createHTML?: (input: string) => string;
      createScriptURL?: (input: string) => string;
      createScript?: (input: string) => string;
    },
  ) => unknown;
};

type TrustedTypesGlobal = typeof globalThis & {
  trustedTypes?: TrustedTypePolicyFactory;
  location?: Location;
};

function hasPathTraversal(input: string): boolean {
  return /(?:^|[\\/])(?:\.|%2e){1,2}(?=[\\/?#]|%2f|%5c|$)/i.test(input);
}

function isUpstreamJavaScriptModule(pathname: string): boolean {
  const segments = pathname.split('/');
  return segments.length >= 3
    && segments[0] === ''
    && segments[1] === 'upstream'
    && segments.slice(2).every((segment) => segment.length > 0
      && segment !== '.'
      && segment !== '..'
      && !segment.includes('\\')
      && !segment.includes('%'))
    && segments.at(-1)!.endsWith('.js');
}

function allowScriptURL(input: string): string {
  const runtime = globalThis as TrustedTypesGlobal;
  if (!runtime.location) throw new TypeError('Worker URLs require a browser location.');

  const documentUrl = new URL(runtime.location.href);
  const url = new URL(input, documentUrl);
  // isolated-app: has an opaque `null` URL.origin, so compare its concrete
  // authority instead of treating every isolated-app host as the same origin.
  const sameOrigin = url.protocol === documentUrl.protocol
    && url.host === documentUrl.host
    && url.username === documentUrl.username
    && url.password === documentUrl.password;
  const trustedPath = url.pathname === '/src/tsshd/tsshdRelayWorker.ts'
    || url.pathname === '/src/et/worker.ts'
    || /^\/assets\/tsshdRelayWorker-[A-Za-z0-9_-]+\.js$/.test(url.pathname)
    || /^\/assets\/worker-[A-Za-z0-9_-]+\.js$/.test(url.pathname)
    || (!hasPathTraversal(input) && isUpstreamJavaScriptModule(url.pathname));
  if (!sameOrigin || !trustedPath) throw new TypeError('Untrusted worker script URL.');
  return url.href;
}

export function initTrustedTypesPolicy(): void {
  const tt = (globalThis as TrustedTypesGlobal).trustedTypes;
  if (!tt?.createPolicy) return;

  try {
    tt.createPolicy('default', {
      createHTML: (html: string) => html,
      // Worker() is a TrustedScriptURL sink in the IWA. Keep the default
      // policy narrow: only the same-origin TSSHD/ET workers and vendored
      // JavaScript modules loaded dynamically by NasshLoader.
      createScriptURL: allowScriptURL,
    });
  } catch {
    // Default policy already registered (HMR / double init).
  }
}

initTrustedTypesPolicy();
