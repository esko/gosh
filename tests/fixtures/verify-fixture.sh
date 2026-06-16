#!/usr/bin/env bash
# Verify the dockerized SSH fixture (run from repo root or tests/fixtures).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
KEY="${SSH_KEY:-$ROOT/keys/smoke}"
HOST="${SSH_HOST:-127.0.0.1}"
PORT="${SSH_PORT:-2222}"
USER="${SSH_USER:-test}"
CONTAINER="${FIXTURE_CONTAINER:-fixtures-sshd-1}"

echo "== fixture verify =="
echo "target: ${USER}@${HOST}:${PORT}"
echo "key:    $KEY"
echo

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER is not running."
  echo "Start: cd tests/fixtures && docker compose up -d --build"
  exit 1
fi

echo "-- container authorized_keys.d/test --"
docker exec "$CONTAINER" sh -c "ls -la /etc/ssh/authorized_keys.d/; echo; cat /etc/ssh/authorized_keys.d/test"
echo

echo "-- account state --"
docker exec "$CONTAINER" sh -c "
  grep '^${USER}:' /etc/passwd
  shadow_field=\$(grep '^${USER}:' /etc/shadow | cut -d: -f2)
  case \"\$shadow_field\" in
    '!'*|'*') echo '${USER}: locked' ;;
    '') echo '${USER}: empty-password-field' ;;
    *) echo '${USER}: unlocked-password-field' ;;
  esac
"
echo

echo "-- local private key fingerprint --"
ssh-keygen -lf "$KEY.pub"
echo

echo "-- container authorized key fingerprint --"
docker exec "$CONTAINER" ssh-keygen -lf /etc/ssh/authorized_keys.d/test
echo

echo "-- fingerprint match --"
local_fp="$(ssh-keygen -lf "$KEY.pub" | awk '{print $2}')"
container_fp="$(docker exec "$CONTAINER" ssh-keygen -lf /etc/ssh/authorized_keys.d/test | awk '{print $2}')"
if [[ "$local_fp" != "$container_fp" ]]; then
  echo "local:     $local_fp"
  echo "container: $container_fp"
  echo "Mismatch: rebuild the fixture after changing tests/fixtures/keys/smoke.pub"
  exit 1
fi
echo "$local_fp"
echo

echo "-- sshd config (auth-related) --"
docker exec "$CONTAINER" /usr/sbin/sshd -T -f /etc/ssh/sshd_config | grep -iE 'port|authorizedkeysfile|pubkey|password|allowusers|strictmodes' || true
echo

echo "-- recent container logs --"
docker logs --tail 80 "$CONTAINER" || true
echo

echo "-- ssh auth test --"
ssh -i "$KEY" -p "$PORT" -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "${USER}@${HOST}" 'echo fixture-ok'
