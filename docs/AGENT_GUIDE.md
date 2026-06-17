# Reset Agent Guide

## Rule

The active frontend reset is the Moshtty `legacy-pwa` pivot. Use the legacy PWA/Ghostty frontend as the base, not the old `iwa-ssh` app shell or xterm UI. Keep IWA packaging, Direct Sockets, upstream nassh/wassh assets, and platform adapters as local infrastructure.

## Read First

Before reset implementation work, read:

- `docs/RESET_PRD.md`
- `docs/LEGACY_PWA_PIVOT_PRD.md`
- `docs/LEGACY_PWA_PIVOT_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/UPSTREAM_SYNC.md`
- relevant files in `docs/adr/`
- `docs/TERMINAL_DELTAS.md` for terminal settings work
- `docs/MOSH.md` for Mosh work

## Implementation Order

1. Preserve WIP and create/reset branch when requested by the maintainer.
2. Keep docs, PRD, and issue links current.
3. Keep the active frontend under the legacy-PWA/Ghostty shape.
4. Replace legacy workspaces/sessions with `iwa-ssh` profiles and recents.
5. Keep one connection per native app tab; do not add internal tabs or splits.
6. Plug Direct Sockets SSH through a transport boundary.
7. Keep Mosh deferred until SSH acceptance passes.
8. Remove obsolete app-shell/routes/xterm UI once replacement parity is verified.
9. Run browser, build, and installed-IWA acceptance.

## Verification Commands

Use the narrowest relevant check while developing:

```bash
npm run typecheck
npm run build
npm run fetch-assets
npm run smoke:ssh
npm run smoke:e2e
```

Device checks require an installed IWA and cannot be replaced by Vite-only testing.

## Subagents

Use cheap subagents when they can safely reduce cost or parallelize independent analysis. Good tasks are route inventory, upstream parser comparison, test gap scans, generated asset diff review, and documentation consistency checks.

The main agent remains responsible for final decisions, patches, and verification. Do not merge subagent output without checking file/line evidence.
