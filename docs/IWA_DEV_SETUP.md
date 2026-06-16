# IWA development setup

Personal-use **local-only** Isolated Web App for ChromeOS SSH. No web server hosting, no update CDN, no `example.com` URLs. Requires **Chrome or ChromeOS 120+**.

## Local-only workflow (recommended)

You have two ways to run this on your Chromebook — both stay on the machine:

| Mode | When to use | How |
|------|-------------|-----|
| **Dev Mode Proxy** | Daily development | `npm run dev` → install `http://127.0.0.1:5173` via Web App Internals |
| **Signed `.swbn`** | Stable install without Vite running | `npm run bundle:iwa` → pick `dist/iwa-ssh.swbn` from disk in Web App Internals |

You do **not** need:

- `update_manifest_url` in the manifest (omit it for local use)
- Hosting `update-manifest.json` anywhere
- A public HTTPS origin for the app bundle

To refresh after code changes:

- **Dev proxy:** save files; Vite hot-reloads (or re-open the app)
- **Signed bundle:** `npm run bundle:iwa` again → reinstall the new `.swbn` from `dist/`

## Prerequisites

- ChromeOS device (or Chrome with IWA dev mode for limited testing)
- Node.js 20+ and `npm install` in this repo
- For signed-bundle install: OpenSSL (for signing keys)

## Enable IWA dev mode

1. Open `chrome://flags/#enable-isolated-web-app-dev-mode`
2. Set to **Enabled**
3. Restart Chrome

Optional flags while developing:

| Flag | Purpose |
|------|---------|
| `#enable-isolated-web-app-dev-mode` | Required for local IWA install |
| `#enable-direct-sockets-for-isolated-web-apps` | Direct Sockets in IWAs (if not default on your channel) |

## chrome://web-app-internals

Open `chrome://web-app-internals` — central page for installing and debugging IWAs.

Two install paths:

### A. Dev Mode Proxy (day-to-day development)

Best for iterating without rebuilding `.swbn` on every change.

1. `npm run dev` (Vite on `http://127.0.0.1:5173`)
2. On **Web App Internals**, choose **Install IWA with Dev Mode Proxy**
3. Enter `http://127.0.0.1:5173/` (use `127.0.0.1`, not `localhost`, if Chrome is picky)
4. Chrome assigns a random `isolated-app://` identity for this dev install

The proxy serves your live dev server inside the IWA security model so `TCPSocket` and other IWA APIs are available.

**Caveats:**

- Dev proxy identity changes between installs — not suitable for production updates
- App must meet IWA requirements (COOP/COEP headers, CSP, no server-rendered pages)
- Use **Force update check** on Web App Internals to refresh after server restarts

### B. Signed Web Bundle (local file install)

Use this when you want a normal app-launcher icon without keeping `npm run dev` running.

1. `npm run bundle:iwa` (builds `dist/`, signs if you have a key — see below)
2. On **Web App Internals**, choose **Install IWA from Signed Web Bundle**
3. Select `dist/iwa-ssh.swbn` from this repo on disk (USB, Downloads, home directory — anywhere local)

Identity is stable when signed — tied to your Ed25519 key (Web Bundle ID).

## Signing keys (first time)

```bash
mkdir -p iwa/keys

# Ed25519 (recommended)
openssl genpkey -algorithm Ed25519 -out iwa/keys/private_key.pem
openssl pkcs8 -in iwa/keys/private_key.pem -topk8 -out iwa/keys/encrypted_key.pem
rm iwa/keys/private_key.pem   # keep only encrypted key

# Get Web Bundle ID before first bundle
npx wbn-dump-id -iwa iwa/keys/encrypted_key.pem
```

Put the passphrase in `WEB_BUNDLE_SIGNING_PASSPHRASE` when signing non-interactively.

Keys under `iwa/keys/*.pem` are gitignored — never commit private keys.

## Direct Sockets debugging

From **Chrome 138+**, Direct Sockets traffic appears in DevTools **Network** panel when inspecting the IWA:

1. Open the IWA window
2. Right-click → **Inspect** (or DevTools from Web App Internals)
3. Network tab → filter for socket / Direct Sockets entries

Useful for verifying TCP connect, read/write timing, and abort behavior.

If `TCPSocket` is undefined:

- Confirm IWA dev mode is enabled
- Confirm install via Dev Mode Proxy or signed bundle (not a normal browser tab)
- Check `direct-sockets` is in the web app manifest `permissions_policy`

## Local workflow

```bash
npm install
npm run dev          # dev server
npm run build        # production dist/
npm run bundle:iwa   # dist/ + .swbn packaging steps
npm run typecheck
```

## Install steps summary (.swbn)

```text
1. Generate signing key → iwa/keys/encrypted_key.pem
2. npm run bundle:iwa
3. chrome://flags → enable IWA dev mode → restart
4. chrome://web-app-internals → Install from Signed Web Bundle
5. Select dist/iwa-ssh.swbn
6. Launch from app launcher; open DevTools to debug
```

## Updates (local only)

For personal local use, **skip remote updates entirely**. When you change the app:

1. Rebuild: `npm run bundle:iwa`
2. Reinstall the new `.swbn` from **Web App Internals** (same signing key → same app identity)

`iwa/update-manifest.json` is an optional template for people who later self-host updates. This project does not use it by default.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `TCPSocket` unavailable | IWA install path, not plain `localhost` tab |
| Integrity Block V1 error | Re-sign with current `wbn-sign` (V2 required since M129) |
| xterm blank/broken in prod build | Vite re-minifying xterm — see `vite.config.ts` `optimizeDeps.exclude` |
| Different app after re-signing with new key | Web Bundle ID changes with key — expected |
