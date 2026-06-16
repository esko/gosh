import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

/** Public URL base for copied upstream libapps assets (see scripts/fetch-upstream-assets.mjs). */
const UPSTREAM_BASE = '/upstream';
const WASSH_WORKER_URL = `${UPSTREAM_BASE}/wassh/js/worker.js`;
const UPSTREAM_PLUGIN_BASE = `${UPSTREAM_BASE}/plugin`;

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** WASM streaming compile needs application/wasm; COOP/COEP enable SharedArrayBuffer for wassh. */
function upstreamAssetHeaders(): Plugin {
  const applyHeaders = (
    res: { setHeader(name: string, value: string): unknown },
    url: string,
  ): void => {
    for (const [name, value] of Object.entries(crossOriginIsolationHeaders)) {
      res.setHeader(name, value);
    }
    if (url.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm');
    }
  };

  return {
    name: 'iwa-upstream-asset-headers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url.startsWith(UPSTREAM_BASE)) {
          const end = res.end.bind(res);
          res.end = ((...args: Parameters<typeof end>) => {
            applyHeaders(res, url);
            return end(...args);
          }) as typeof res.end;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url.startsWith(UPSTREAM_BASE)) {
          const end = res.end.bind(res);
          res.end = ((...args: Parameters<typeof end>) => {
            applyHeaders(res, url);
            return end(...args);
          }) as typeof res.end;
        }
        next();
      });
    },
  };
}

// xterm 6 is pre-minified; re-minifying breaks the bundle (xtermjs/xterm.js#5800).
export default defineConfig({
  root: 'app',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'app/src'),
    },
  },
  define: {
    __IWA_UPSTREAM_BASE__: JSON.stringify(UPSTREAM_BASE),
    __IWA_WASSH_WORKER_URL__: JSON.stringify(WASSH_WORKER_URL),
    __IWA_PLUGIN_BASE__: JSON.stringify(UPSTREAM_PLUGIN_BASE),
    __IWA_DEFAULT_SSH_WASM__: JSON.stringify(`${UPSTREAM_PLUGIN_BASE}/wasm/ssh.wasm`),
  },
  assetsInclude: ['**/*.wasm'],
  plugins: [upstreamAssetHeaders()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xterm/')) {
            return 'xterm';
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links', '@xterm/addon-search', '@xterm/addon-clipboard'],
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
});
