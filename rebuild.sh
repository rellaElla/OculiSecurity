#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Building CLI..."
cd product/apps/gateway
npm run build --silent
npm link --silent 2>/dev/null
cd ../../..

echo "Rebuilding Docker containers..."
docker compose up --build -d

echo "Done. Gateway: http://localhost:3000/admin/"
