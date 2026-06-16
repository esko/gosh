# SSH test fixture

Minimal **Alpine** OpenSSH server with **vim**, **tmux**, and **fish** for local smoke tests (~30 MB image vs hundreds for linuxserver).

Auth is **key-based** (fixture Ed25519 key). Password login is disabled.

## One-time: generate fixture keys

```bash
bash tests/fixtures/generate-keys.sh          # create if missing
bash tests/fixtures/generate-keys.sh --force  # replace existing keys
```

Creates `tests/fixtures/keys/smoke` and `smoke.pub` (no passphrase, fixture-only). **Rebuild** the image after creating or replacing keys.

## Start

```bash
cd tests/fixtures
docker compose up -d --build
```

Wait until healthy (`docker compose ps`).

| Field | Value |
|-------|-------|
| Host | `127.0.0.1` |
| Port | `2222` |
| User | `test` |
| Private key | `tests/fixtures/keys/smoke` |

The public key is baked at build time into `/etc/ssh/authorized_keys.d/test` (OpenSSH system path, read as root).

```bash
bash tests/fixtures/verify-fixture.sh   # after container is up
```

## Run smoke checks

From repo root:

```bash
npm run smoke:ssh      # vim/tmux/fish over ssh -tt (PTY)
npm run smoke:e2e      # PTY checks + echo CDP + IWA manual checklist
```

Override target:

```bash
export SSH_HOST=127.0.0.1 SSH_PORT=2222 SSH_USER=test SSH_KEY=tests/fixtures/keys/smoke
npm run smoke:ssh
```

Scripts skip gracefully when the fixture is offline; they exit non-zero when reachable but a test fails.

**Note:** PTY smoke tests verify remote packages over `ssh -tt`. Full-screen terminal UI in the IWA still requires the manual checklist in `tests/e2e/smoke-terminal.spec.md`.

## Stop

```bash
docker compose down
```

## Troubleshooting

### `no space left on device` during build

The old `linuxserver/openssh-server` image is large. This fixture uses Alpine instead. Free Docker disk first:

```bash
docker system prune -a --volumes   # removes unused images, including old linuxserver layers
docker builder prune -a
df -h                            # confirm free space on /
```

Then rebuild:

```bash
cd tests/fixtures
docker compose down
docker compose build --no-cache
docker compose up -d
bash verify-fixture.sh
```

If the host is still full, remove other large images/containers or expand the disk (common on ChromeOS Crostini).

### SSH key auth fails (`Permission denied (publickey)`)

Keys live in `/etc/ssh/authorized_keys.d/test` inside the image — rebuild after any key change:

```bash
bash tests/fixtures/generate-keys.sh --force   # only if replacing keys
cd tests/fixtures
docker compose down
docker compose build --no-cache
docker compose up -d
bash verify-fixture.sh
```

`verify-fixture.sh` prints the account shadow state, local/container key fingerprints, the effective `AuthorizedKeysFile`, recent `sshd` logs, and a real `ssh -i keys/smoke ... echo fixture-ok` check. If auth fails with `User test not allowed because account is locked`, rebuild with the current Dockerfile; it sets a throwaway password only to unlock the account while `PasswordAuthentication no` keeps login key-only.

### Connecting from the IWA (ChromeOS)

On ChromeOS the IWA's loopback is **not** the Crostini loopback, so `127.0.0.1:2222` from
the IWA does not reach this container. Connect to the **Crostini IP** instead:

```bash
hostname -I   # in the Crostini terminal; use the first address as the IWA host
```

`docker compose build` (especially `--no-cache`) regenerates the container's host key, so a
previously trusted fixture key will no longer match. The CLI smoke scripts handle this on
their own, but the IWA stores the old key in IndexedDB. After a rebuild OpenSSH would
normally fail hard with `REMOTE HOST IDENTIFICATION HAS CHANGED` and no yes/no prompt — the
app now detects this, shows the changed-key prompt with the new fingerprint, and (on
approval) clears the stale key and reconnects. You can also clear it manually under
**Settings → Known hosts**.
