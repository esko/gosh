# Security

iwa-ssh is a **high-trust IWA** — packaged, signed, isolated. Security choices below are intentional for personal SSH use on ChromeOS.

## Credentials

| Rule | Implementation |
|------|----------------|
| **No plaintext passwords** | Key-based auth only; no password field in profiles or storage |
| **Encrypted private keys** | AES-GCM + PBKDF2 via `app/src/security/KeyCrypto.ts` |
| **No silent auth** | Connecting requires explicit user action (connect button / profile select) |

Passphrase is never written to IndexedDB or export JSON.

### Implemented (MVP)

- **Key import UI** (`app/src/ssh/KeyImport.ts`): OpenSSH private key PEM via file or paste; encrypted at rest with a user-chosen storage passphrase.
- **Identity picker** on connect and profile editor with import button.
- **Storage passphrase prompt** at connect time (`identitySecrets.ts`); cached in memory for the session only.
- **OpenSSH-encrypted PEM keys**: imported and stored; ssh prompts for the key passphrase via `SecureInputPrompt` at connect time.
- **No password fields** anywhere in the UI or storage layer.

### Legacy / migration

- **`Identity.privateKeyPemBytesDevOnly`**: plaintext PEM from early imports; still readable for staging until re-imported. Settings shows these as “legacy plaintext”.

## Host trust

| Rule | Implementation |
|------|----------------|
| **known_hosts store** | `KnownHost` records in IndexedDB (`host:port` → fingerprint) |
| **Trust prompt** | Unknown/changed host keys require user confirmation before connect |
| **No LAN scanning** | No discovery, broadcast, or background connection attempts |

### Implemented (MVP)

- **Trust modal** (`app/src/ssh/KnownHostPrompt.ts`): UI for host trust decisions.
- **HostKeyGuard** (`app/src/ssh/HostKeyGuard.ts`): intercepts OpenSSH fingerprint prompts during live SSH; sends `yes`/`no` after user choice.
- **known_hosts sync** (`app/src/ssh/nasshKnownHosts.ts`): stages trusted lines into nassh FS before connect; syncs back after `Permanently added …`.
- **Connect gate** (`app/src/routes/connect.ts`): stub prompt only when upstream assets are missing.
- **Settings UI**: list and remove trusted hosts and SSH identities.
- **Dev inspector** (`/debug`): host-trust probe (stub mode).

### Dev-only / echo stub

- Pre-connect stub prompt when upstream wassh is unavailable (`SHA256:STUB-…` fingerprints).
- **Session reconnect** does not re-prompt for host trust (checked at connect-screen submit in stub mode only).
- **Removing or editing** known host entries: remove via Settings; no inline edit yet.

## Network

| Rule | Implementation |
|------|----------------|
| **Direct TCP only (MVP)** | `TCPSocket` via Direct Sockets; no relay/proxy fallback |
| **User-initiated** | No connections without explicit connect action |
| **SSH to declared host:port** | Profile stores target; no redirect to arbitrary endpoints |

SSH traffic uses upstream wassh via nassh `CommandInstance` (`--field-trial-direct-sockets`). `DirectSocketProbe.ts` is for capability checks only (e.g. `/debug`).

## Content Security Policy

IWA bundles enforce strict CSP (set via bundle `headerOverride` in `iwa/webbundle.config.ts`):

```text
script-src 'self' 'wasm-unsafe-eval'
connect-src 'self' https: wss: blob: data:
default-src 'self'
object-src 'none'
base-uri 'none'
style-src 'self' 'unsafe-inline'
trusted-types default
```

Chrome enforces `require-trusted-types-for 'script'` on IWAs at runtime. The app registers a **default** Trusted Types policy in `app/src/security/trustedTypes.ts` before any `innerHTML` rendering so the shell can boot.

Cross-origin isolation headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

## Bundle integrity

| Rule | Notes |
|------|-------|
| **No remote scripts** | All JS/WASM/CSS/fonts ship inside the signed `.swbn` |
| **No CDN runtime deps** | xterm, app code bundled at build time |
| **Signed updates** | Optional; local-only installs use `.swbn` from disk without an update server |
| **Stable identity** | Web Bundle ID derived from signing key — rotate key = new app |

`'wasm-unsafe-eval'` is required for OpenSSH WASM (wassh). No `'unsafe-inline'` for scripts.

## Storage isolation

- IWA storage is separate from normal browser profile storage
- Each Web Bundle ID gets its own `isolated-app://` origin
- Export JSON omits private key bytes (`hasEncryptedPrivateKey` / `hasLegacyPlaintextKey` flags only)

## Dev mode caveats

IWA Dev Mode Proxy assigns a **random** bundle ID — fine for development, not for security testing of updates/signing.

Do not use dev proxy installs for secrets you would not put in a normal browser tab on an untrusted network.

## Non-goals (MVP)

- Password authentication
- Agent forwarding
- Port forwarding UI
- Automatic trust of all hosts on a subnet
- Telemetry or remote crash reporting

## Reporting

For upstream Secure Shell security issues, see [Chromium security](https://www.chromium.org/Home/chromium-security/). For this fork, use the project issue tracker.
