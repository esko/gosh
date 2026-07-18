# Development

ChromeOS Isolated Web App terminal client. The product direction is a Moshtty `legacy-pwa`–shaped frontend with Restty as the sole terminal renderer, plus IWA packaging and Direct Sockets transports.

## References

### Terminal renderer

- [Restty](https://github.com/wiedymi/restty) / [`@eslzzyl/restty`](https://www.npmjs.com/package/@eslzzyl/restty) — vendored in `vendor/restty/`
- [Ghostty](https://github.com/ghostty-org/ghostty) (`libghostty-vt`) — WASM VT core used by Restty

### SSH / transport WASM and clients

- [Chromium libapps](https://chromium.googlesource.com/apps/libapps) — [nassh](https://chromium.googlesource.com/apps/libapps/+/HEAD/nassh/), [wassh](https://chromium.googlesource.com/apps/libapps/+/HEAD/wassh/), [wasi-js-bindings](https://chromium.googlesource.com/apps/libapps/+/HEAD/wasi-js-bindings/), [ssh_client](https://chromium.googlesource.com/apps/libapps/+/HEAD/ssh_client/)
- OpenSSH WASM: `app/upstream/plugin/wasm/ssh.wasm` (plus `scp.wasm` / `sftp.wasm` / `ssh-keygen.wasm`)
- [Mosh](https://mosh.org/) / [mobile-shell/mosh](https://github.com/mobile-shell/mosh) — `app/upstream/plugin/wasm/mosh-client.wasm`
- [wassh](https://chromium.googlesource.com/apps/libapps/+/HEAD/wassh/) — runs OpenSSH + Mosh WASM plugins
- [Eternal Terminal](https://eternalterminal.dev/) / [MisterTea/EternalTerminal](https://github.com/MisterTea/EternalTerminal) — TS Direct Sockets client in `app/src/et/` (not WASM)
- [tsshd](https://github.com/trzsz/tsshd) — browser WASM in `app/src/tsshd/runtime/` (`vendor/tsshd-wasm/`)

### Product / platform

- [Google Terminal](https://chromium.googlesource.com/apps/libapps/+/HEAD/terminal/)
- [Isolated Web Apps](https://developer.chrome.com/docs/iwa/introduction)
- [Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets)

## Direction

Follow Google Terminal / nassh architecture unless IWA packaging or Direct Sockets requires an adaptation.

Allowed local deltas:

- Restty terminal engine with native pane layout, splits, and custom caption tabs
- Arbitrary terminal font family strings, including Nerd Fonts
- Stronger theme, scrollback, and renderer / performance controls
- SSH, Mosh, Eternal Terminal, and tsshd over IWA Direct Sockets

See also:

- [Reset PRD](RESET_PRD.md)
- [Architecture](ARCHITECTURE.md)
- [Upstream Sync](UPSTREAM_SYNC.md)
- [Terminal Deltas](TERMINAL_DELTAS.md)
- [Mosh](MOSH.md)
- [Test Plan](TEST_PLAN.md)
- [IWA Dev Setup](IWA_DEV_SETUP.md)
- [Release](RELEASE.md)
- [Agent Guide](AGENT_GUIDE.md)

## Architecture

```text
IWA terminal shell
  home, custom caption tabs, profiles, settings, pane sessions
        │
        ├── Restty Terminal Engine (sole product renderer)
        │     canvas rendering, native pane layout/splits, fonts, themes
        │
        ├── NasshRuntime & ET / tsshd adapters
        │     upstream CommandInstance.connectTo() (SSH/Mosh) and UDP clients
        │
        └── IWA adapter layer
              Chrome polyfills, Direct Sockets, asset URLs, web bundle constraints

Copied upstream assets
  nassh, wassh, wasi-js-bindings, OpenSSH WASM plugin files
```

## Setup

```bash
npm install
git submodule update --init --depth 1 upstream/libapps   # when refreshing upstream
npm run fetch-assets                                     # refresh app/upstream copies
npm run dev
npm run typecheck
npm run test
npm run build
```

IWA install on a Chromebook: [IWA_DEV_SETUP.md](IWA_DEV_SETUP.md).  
Public release / Pages update manifest: [RELEASE.md](RELEASE.md).

## Verification

Before handing off installed-IWA changes:

- `npm run typecheck`
- `npm run test`
- `npm run build`
- bump IWA version with `npm run bump-version` when the installed app changes
- smoke SSH (and Mosh / ET / tsshd as needed) on a real device

## License

Upstream libapps is Chromium-licensed. Restty is MIT. Preserve upstream notices for copied runtime and plugin assets.
