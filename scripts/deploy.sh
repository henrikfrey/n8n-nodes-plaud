#!/usr/bin/env bash
#
# Deploy the current working copy of n8n-nodes-plaud-cloud to a remote n8n
# Docker host — without going through npm. Use this while iterating; only
# publish to npm when something actually works.
#
# Usage:
#
#   PLAUD_VPS=user@host ./scripts/deploy.sh
#   PLAUD_VPS=root@88.99.191.149 PLAUD_CONTAINER=n8n ./scripts/deploy.sh
#
# Env vars:
#
#   PLAUD_VPS        required. SSH target. e.g. "root@88.99.191.149".
#   PLAUD_CONTAINER  optional. Docker container name running n8n. If unset,
#                    auto-detects the first running container whose name
#                    starts with "n8n".
#
# What it does:
#   1. Builds the TypeScript + icons (npm run build)
#   2. Packs the tarball (npm pack)
#   3. scp's the tarball to <vps>:/tmp/
#   4. docker cp's it into the n8n container
#   5. npm uninstalls the previous version, npm installs the new one in
#      /home/node/.n8n/custom
#   6. docker restart's the container

set -euo pipefail

: "${PLAUD_VPS:?PLAUD_VPS is required (e.g. PLAUD_VPS=root@88.99.191.149)}"
PLAUD_CONTAINER="${PLAUD_CONTAINER:-}"

# Repo root = parent of this script's directory.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building..."
npm run build >/dev/null

echo "==> Packing..."
rm -f n8n-nodes-plaud-cloud-*.tgz
TARBALL=$(npm pack 2>/dev/null | tail -1)
echo "    $TARBALL"

echo "==> Uploading to $PLAUD_VPS..."
scp -q "$TARBALL" "$PLAUD_VPS:/tmp/"

echo "==> Installing on remote..."
ssh "$PLAUD_VPS" bash -s -- "$TARBALL" "$PLAUD_CONTAINER" <<'REMOTE'
set -euo pipefail
TARBALL="$1"
CONTAINER="${2:-}"

if [ -z "$CONTAINER" ]; then
  CONTAINER=$(docker ps --format '{{.Names}}' | grep -E '^n8n' | head -1 || true)
  if [ -z "$CONTAINER" ]; then
    echo "ERROR: no running container with a name starting in 'n8n' found." >&2
    echo "Running containers:" >&2
    docker ps --format '{{.Names}}' >&2
    echo "Re-run with: PLAUD_CONTAINER=<name> ..." >&2
    exit 1
  fi
fi
echo "    container: $CONTAINER"

docker cp "/tmp/$TARBALL" "$CONTAINER:/tmp/"
docker exec "$CONTAINER" sh -c "
  mkdir -p /home/node/.n8n/custom &&
  cd /home/node/.n8n/custom &&
  if [ ! -f package.json ]; then npm init -y >/dev/null 2>&1; fi &&
  npm uninstall n8n-nodes-plaud-cloud >/dev/null 2>&1 || true &&
  npm install '/tmp/$TARBALL' --silent >/dev/null
"
rm -f "/tmp/$TARBALL"
docker restart "$CONTAINER" >/dev/null
echo "    restarted $CONTAINER"
REMOTE

echo "==> Done. Re-test the credential in n8n."
