#!/usr/bin/env node
/**
 * JWT Generator for MCP Security Gateway
 *
 * Usage:
 *   node scripts/generate-jwt.mjs
 *   node scripts/generate-jwt.mjs --actor alice --org my-org --roles admin --expiry 24h
 *   node scripts/generate-jwt.mjs --roles viewer --silent   # prints token only
 *
 * The JWT_SECRET env var is used if set, otherwise the dev default is used.
 */

import { createHmac } from 'crypto';

// ── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const actor   = getArg('actor',  'dev-user');
const orgId   = getArg('org',    'dev-org');
const rolesRaw = getArg('roles', 'editor');
const roles   = rolesRaw.split(',').map(r => r.trim());
const expiry  = getArg('expiry', '1h');
const silent  = hasFlag('silent');

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production-min32chars!!';

// ── Minimal HS256 JWT implementation (no external deps) ─────────────────────

function base64url(input) {
  const b64 = Buffer.from(JSON.stringify(input)).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlRaw(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function parseExpiry(s) {
  const match = String(s).match(/^(\d+)(s|m|h|d)?$/);
  if (!match) return 3600;
  const n = parseInt(match[1], 10);
  const unit = match[2] ?? 's';
  return unit === 's' ? n : unit === 'm' ? n * 60 : unit === 'h' ? n * 3600 : n * 86400;
}

function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64  = base64url(header);
  const payloadB64 = base64url(payload);
  const data = `${headerB64}.${payloadB64}`;
  const sig  = createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64urlRaw(sig)}`;
}

// ── Build payload ────────────────────────────────────────────────────────────

const now        = Math.floor(Date.now() / 1000);
const expirysSec = parseExpiry(expiry);

const payload = {
  sub:   actor,
  actor,
  orgId,
  roles,
  iat:   now,
  exp:   now + expirysSec,
};

const token = signJWT(payload, JWT_SECRET);

// ── Output ───────────────────────────────────────────────────────────────────

if (silent) {
  process.stdout.write(token + '\n');
} else {
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  MCP Security Gateway — JWT Generator');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  actor  : ${actor}`);
  console.log(`  orgId  : ${orgId}`);
  console.log(`  roles  : ${roles.join(', ')}`);
  console.log(`  expiry : ${expiry} (${expirysSec}s)`);
  console.log(`  secret : ${JWT_SECRET.slice(0, 8)}... (first 8 chars)`);
  console.log('──────────────────────────────────────────────────────────');
  console.log('\nToken:');
  console.log(token);
  console.log('\nUsage:');
  console.log(`  export TOKEN="${token}"`);
  console.log(`  curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/call ...`);
  console.log('──────────────────────────────────────────────────────────\n');
}
