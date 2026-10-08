#!/usr/bin/env bash
# Restart the Koda voice gateway — PRESERVING the brain session by default.
#
# Plan GenuineConversation, Decision 5: deleting ~/.koda-acp-session on every
# restart was self-induced amnesia — the brain's durable memory (VPS SQLite)
# survives restarts precisely so Koda remembers; wiping the cached sessionId
# threw that away each time. Fresh sessions are now the EXPLICIT exception:
#
#   ./restart.sh           # restart, same brain session (memory intact)
#   ./restart.sh --fresh   # restart with a brand-new brain session
#
# Logs: /tmp/koda-gateway.log
set -euo pipefail

cd "$(dirname "$0")"

if [[ "${1:-}" == "--fresh" ]]; then
    echo "[restart] FRESH session requested — wiping ~/.koda-acp-session"
    rm -f ~/.koda-acp-session
else
    echo "[restart] preserving brain session (use --fresh for a clean one)"
fi

# Kill the gateway AND its ssh child (a SIGKILL'd gateway orphans the ssh that
# keeps the remote acp alive — kill both, always). pkill pattern matches the
# real argv ("Python main.py", not "agent/main.py").
pkill -9 -f "Python main.py" 2>/dev/null || true
pkill -9 -f "ssh.*zeroclaw" 2>/dev/null || true
sleep 1

nohup .venv/bin/python main.py > /tmp/koda-gateway.log 2>&1 &
echo "[restart] gateway starting (pid $!) — log: /tmp/koda-gateway.log"
echo "[restart] refresh http://localhost:8800 to reconnect"
