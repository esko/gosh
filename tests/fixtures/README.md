# SSH test fixture

Dockerized OpenSSH server for local smoke tests.

## Start

```bash
cd tests/fixtures
docker compose up -d
```

Wait until healthy (`docker compose ps`). Default credentials:

| Field | Value |
|-------|-------|
| Host | `127.0.0.1` |
| Port | `2222` |
| User | `test` |
| Password | `test` |

## Run smoke checks

From repo root:

```bash
export SSH_HOST=127.0.0.1 SSH_PORT=2222 SSH_USER=test SSH_PASS=test
npm run smoke:e2e
```

The runner verifies TCP reachability and prints the manual vim/tmux/fish checklist from `tests/e2e/smoke-terminal.spec.md`.

## Stop

```bash
docker compose down
```
