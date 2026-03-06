#!/usr/bin/env bash
# MCP Security Gateway — Setup Script
# Installs dependencies for all apps.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       MCP Security Gateway — Setup                  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Check Node version
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")
echo "→ Node.js: $NODE_VERSION"

if [ "$NODE_VERSION" = "not found" ]; then
  echo "✗ Node.js is required. Install from https://nodejs.org/ (v20+)"
  exit 1
fi

NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✗ Node.js 18+ required (found $NODE_VERSION)"
  exit 1
fi

echo ""
echo "→ Installing gateway dependencies..."
cd "$ROOT/apps/gateway" && npm install

echo ""
echo "→ Installing demo-upstream-fs dependencies..."
cd "$ROOT/apps/demo-upstream-fs" && npm install

echo ""
echo "→ Installing demo-upstream-http dependencies..."
cd "$ROOT/apps/demo-upstream-http" && npm install

echo ""
echo "→ Copying .env.example → .env (if not present)..."
cd "$ROOT/apps/gateway"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  Created apps/gateway/.env (edit JWT_SECRET before production use!)"
else
  echo "  .env already exists, skipping."
fi

echo ""
echo "→ Creating demo data directory..."
mkdir -p "$ROOT/apps/demo-upstream-fs/demo-data"
echo "Hello from the MCP Security Gateway demo!" > "$ROOT/apps/demo-upstream-fs/demo-data/hello.txt"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Setup complete! Next steps:                        ║"
echo "║                                                      ║"
echo "║  Option A — Local dev (3 terminals):                 ║"
echo "║    cd apps/demo-upstream-fs && npm run dev          ║"
echo "║    cd apps/demo-upstream-http && npm run dev        ║"
echo "║    cd apps/gateway && OPA_ENABLED=false npm run dev ║"
echo "║                                                      ║"
echo "║  Option B — Full stack with Docker:                  ║"
echo "║    docker compose up --build                         ║"
echo "║                                                      ║"
echo "║  Mint a JWT:                                         ║"
echo "║    node scripts/generate-jwt.mjs                    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
