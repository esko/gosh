# Reset Agent Guide

## Rule

Upstream behavior wins. Use Google Terminal/nassh behavior as the default and add local behavior only for documented IWA adaptations or approved deltas.

## Read First

Before reset implementation work, read:

- `docs/RESET_PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/UPSTREAM_SYNC.md`
- relevant files in `docs/adr/`
- `docs/TERMINAL_DELTAS.md` for terminal settings work
- `docs/MOSH.md` for Mosh work

## Implementation Order

1. Preserve WIP and create/reset branch when requested by the maintainer.
2. Keep docs and ADRs current.
3. Introduce upstream-shaped module boundaries.
4. Port command parsing and profile semantics.
5. Centralize xterm in `TerminalEmulator`.
6. Add font, theme, scrollback, and performance settings.
7. Wrap nassh in `NasshRuntime`.
8. Make upstream asset sync repeatable.
9. Add Mosh through nassh.
10. Port tests.
11. Run device acceptance.
12. Remove obsolete custom code.

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

