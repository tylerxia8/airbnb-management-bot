#!/usr/bin/env bash
set -euo pipefail

: "${RAILWAY_PUBLIC_DOMAIN:?Generate a Railway public domain for this service}"
: "${RAILWAY_VOLUME_MOUNT_PATH:?Mount a dedicated Railway volume at /sandbox}"
test "$RAILWAY_VOLUME_MOUNT_PATH" = /sandbox
mountpoint -q /sandbox
[[ "$RAILWAY_PUBLIC_DOMAIN" =~ ^[a-z0-9][a-z0-9.-]+[a-z0-9]$ ]]
export PLAYGROUND_ORIGIN="https://$RAILWAY_PUBLIC_DOMAIN"
export PLAYGROUND_DB=/sandbox/playground.sqlite3
export PORT="${PORT:-8080}"
export NO_PROXY=127.0.0.1,localhost
unset PLAYGROUND_LOCAL
export XDG_DATA_HOME=/tmp/playground-caddy-data XDG_CONFIG_HOME=/tmp/playground-caddy-config
umask 077
chown 10001:10001 /sandbox
chmod 700 /sandbox

pids=()
cleanup() {
  if (("${#pids[@]}" > 0)); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 0' TERM INT
run=(setpriv --reuid=10001 --regid=10001 --clear-groups --no-new-privs)
"${run[@]}" /app/.venv/bin/uvicorn app.playground.server:factory --factory --host 127.0.0.1 --port 8000 \
  --no-access-log --no-proxy-headers --limit-concurrency 32 &
pids+=("$!")
HOSTNAME=127.0.0.1 PORT=3000 "${run[@]}" node /web/server.js &
pids+=("$!")
for attempt in {1..60}; do
  if python -c 'import socket; [socket.create_connection(("127.0.0.1", port), 1).close() for port in (3000, 8000)]' 2>/dev/null; then
    break
  fi
  kill -0 "${pids[@]}"
  if [[ "$attempt" = 60 ]]; then
    echo "Playground services failed to start." >&2
    exit 1
  fi
  sleep 1
done
"${run[@]}" caddy run --config /opt/playground/Caddyfile --adapter caddyfile &
pids+=("$!")
wait -n "${pids[@]}"
exit 1
