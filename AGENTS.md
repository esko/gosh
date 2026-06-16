# Agent Guide

This repo is being reset toward a near-upstream Google Terminal + nassh shape. Upstream behavior wins unless an IWA/Direct Sockets adaptation or an approved local delta requires otherwise.

## Current Product Direction

Keep only these local deltas without a new ADR:

- xterm.js `6.1.0-beta` with kitty keyboard protocol support.
- Arbitrary font support, including Nerd Font family strings.
- Stronger theme, scrollback, and performance controls.
- Mosh support through upstream nassh/wassh.

Do not preserve old custom route, session, dashboard, fixture, identity, or tab behavior simply because it exists. Preserve it only when it matches upstream Terminal/nassh behavior or an approved delta.

## Implementation Rules

- Read `docs/RESET_PRD.md`, `docs/ARCHITECTURE.md`, `docs/UPSTREAM_SYNC.md`, and the relevant ADR before changing reset work.
- Keep upstream-copied runtime files mechanically refreshed by `scripts/fetch-upstream-assets.mjs`; document local patches there or in `docs/UPSTREAM_SYNC.md`.
- Put IWA/Direct Sockets adaptations in thin adapter or polyfill modules. Do not push app-specific concerns into upstream-shaped UI or emulator modules.
- Check `git status --short` before edits and do not overwrite unrelated local changes.
- Use separate git worktrees for parallel implementation slices or subagent-owned coding work. Name worktrees after the issue or slice, keep each worktree scoped to one reset issue when possible, and merge results back only after review and verification.
- Verify with the smallest relevant command first, then run broader checks before handing off.

## Cost And Parallelism

Use cheap subagents when they can reduce cost or safely parallelize work, even if the main agent could do the task directly. Good subagent tasks include independent doc review, upstream/source comparison, test inventory, UI route inventory, and narrow code audits. Keep implementation decisions, final edits, and verification orchestration in the main agent unless the task is explicitly delegated.

Do not spawn subagents for tiny single-file edits or when their context loading would cost more than the work. When using subagents, give bounded instructions, ask for file/line evidence, and merge only reviewed output.
