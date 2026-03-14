#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Building CLI..."
cd product/apps/gateway
npm run build --silent
npm link --silent 2>/dev/null
cd ../../..

echo "Syncing to Docker build context..."
rsync -a --exclude node_modules --exclude dist --exclude '*.db' --exclude '*.db-shm' --exclude '*.db-wal' product/apps/gateway/ apps/gateway/

echo "Rebuilding Docker containers..."
docker compose up --build -d

echo "Done. Gateway: http://localhost:3000/admin/"
