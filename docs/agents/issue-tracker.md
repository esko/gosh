# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `esko/iwa-ssh`. Use the `gh` CLI from the repo root.

## Conventions

- Create an issue: `gh issue create --title "..." --body-file <file> --label "ready-for-agent"`
- Read an issue: `gh issue view <number> --comments`
- List issues before creating more: `gh issue list --state open --limit 100 --json number,title,labels,url`
- Comment on an issue: `gh issue comment <number> --body "..."`
- Apply or remove labels: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

## Current planning surface

The active parent planning issue should point to `docs/LEGACY_PWA_PIVOT_PRD.md`. Implementation issues should reference that parent and should be small enough for one agent/worktree.

Before publishing new issues, check open issues to avoid duplicating reset tickets from the older near-upstream/xterm plan.
