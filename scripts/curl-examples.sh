#!/usr/bin/env bash
# MCP Security Gateway — curl Examples
#
# Usage: ./scripts/curl-examples.sh
# Requires: gateway running on localhost:3000 + upstreams on 3001/3002

set -euo pipefail

GATEWAY="http://localhost:3000"

# ── Generate tokens ───────────────────────────────────────────────────────────

echo ""
echo "=== Generating test JWTs ==="

EDITOR_TOKEN=$(node scripts/generate-jwt.mjs --actor alice --org demo-org --roles editor --silent)
VIEWER_TOKEN=$(node scripts/generate-jwt.mjs --actor bob --org demo-org --roles viewer --silent)
ADMIN_TOKEN=$(node scripts/generate-jwt.mjs  --actor sysadmin --org demo-org --roles admin --silent)

echo "  editor token: ${EDITOR_TOKEN:0:40}..."
echo "  viewer token: ${VIEWER_TOKEN:0:40}..."
echo "  admin  token: ${ADMIN_TOKEN:0:40}..."

# ── Health check ──────────────────────────────────────────────────────────────

echo ""
echo "=== [1] Health Check ==="
curl -s "$GATEWAY/health" | jq .

# ── ALLOW: readFile ──────────────────────────────────────────────────────────

echo ""
echo "=== [2] ALLOW — readFile as editor ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"readFile","args":{"path":"hello.txt"}}' \
  | jq '{decision, result}'

# ── ALLOW: listDir ────────────────────────────────────────────────────────────

echo ""
echo "=== [3] ALLOW — listDir as viewer ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"listDir","args":{"path":"."}}' \
  | jq '{decision, result}'

# ── ALLOW: readFile with redaction (editor, non-admin) ────────────────────────

echo ""
echo "=== [4] ALLOW — readFile config.json (sensitive fields redacted for editor) ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"readFile","args":{"path":"config.json"}}' \
  | jq '{decision, result}'

echo ""
echo "=== [5] ALLOW — readFile config.json (NO redaction for admin) ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"readFile","args":{"path":"config.json"}}' \
  | jq '{decision, result}'

# ── DENY: role restriction ────────────────────────────────────────────────────

echo ""
echo "=== [6] DENY — writeFile as viewer (role restriction) ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"writeFile","args":{"path":"pwned.txt","content":"gotcha"}}' \
  | jq '{decision, error}'

# ── DENY: path traversal ──────────────────────────────────────────────────────

echo ""
echo "=== [7] DENY — readFile with ../ traversal ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"readFile","args":{"path":"../../../etc/passwd"}}' \
  | jq '{decision, error}'

# ── DENY: shell injection in args ─────────────────────────────────────────────

echo ""
echo "=== [8] DENY — shell injection in path arg ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"readFile","args":{"path":"file.txt; cat /etc/passwd"}}' \
  | jq '{decision, error}'

# ── DENY: tool not in allowlist ───────────────────────────────────────────────

echo ""
echo "=== [9] DENY — tool not in allowlist ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"execCommand","args":{"cmd":"whoami"}}' \
  | jq '{decision, error}'

# ── DENY: no auth ─────────────────────────────────────────────────────────────

echo ""
echo "=== [10] DENY — no Authorization header ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"readFile","args":{"path":"hello.txt"}}' \
  | jq .

# ── ALLOW: writeFile as editor ────────────────────────────────────────────────

echo ""
echo "=== [11] ALLOW — writeFile as editor ==="
curl -s -X POST "$GATEWAY/v1/call" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"writeFile","args":{"path":"output.txt","content":"written by gateway demo"}}' \
  | jq '{decision, result}'

# ── Audit log ─────────────────────────────────────────────────────────────────

echo ""
echo "=== [12] Audit Log (last 5 entries) ==="
curl -s "$GATEWAY/admin/logs?limit=5" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '.logs[] | {timestamp, actor, tool, decision, reason, outcome}'

echo ""
echo "Done! See docs/HOW_TO.md for more examples."
