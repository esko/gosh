# ADR 0003: Upstream Patch Layer

## Status

Accepted

## Decision

Copied upstream runtime files may only be changed through documented patch functions or scripts. `scripts/fetch-upstream-assets.mjs` owns generated nassh/wassh asset patches.

## Consequences

- Generated files under `app/upstream/` are not normal hand-edited source.
- Local patches must be small, documented, and drift-checked.
- Product behavior belongs in local modules, not copied upstream files.

