/**
 * Typed HTTP client for the Oculi Security Gateway.
 *
 * Supports two auth modes:
 *   1. Pre-minted token  — set GATEWAY_TOKEN env var
 *   2. Dynamic minting   — set GATEWAY_ACTOR, GATEWAY_ORG, GATEWAY_ROLES,
 *                          and GATEWAY_JWT_SECRET env vars
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatewayClientConfig {
  gatewayUrl: string;
  token?: string;
  // Dynamic minting (only used when token is not provided)
  actor?: string;
  orgId?: string;
  roles?: string[];
  jwtSecret?: string;
}

export interface GatewayTool {
  upstreamId: string;
  toolName: string;
  namespacedName: string; // "{upstreamId}__{toolName}"
  description: string;
}

// ---------------------------------------------------------------------------
// Minimal JWT signer (no external deps — mirrors generate-jwt.mjs)
// ---------------------------------------------------------------------------

function base64url(data: string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function mintJwt(actor: string, orgId: string, roles: string[], secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ sub: actor, actor, orgId, roles, iat: now, exp: now + 3600 }));
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ---------------------------------------------------------------------------
// Simple HTTP fetch (no external deps — avoids adding axios to the plugin)
// ---------------------------------------------------------------------------

function httpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}) },
    };

    const req = (isHttps ? https : http).request(options, (res) => {
      let raw = '';
      res.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// GatewayClient
// ---------------------------------------------------------------------------

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: GatewayClientConfig) {
    this.baseUrl = config.gatewayUrl.replace(/\/$/, '');

    if (config.token) {
      this.token = config.token;
    } else if (config.actor && config.orgId && config.jwtSecret) {
      this.token = mintJwt(
        config.actor,
        config.orgId,
        config.roles ?? ['editor'],
        config.jwtSecret
      );
    } else {
      throw new Error(
        'GatewayClient requires either GATEWAY_TOKEN or ' +
        '(GATEWAY_ACTOR + GATEWAY_ORG + GATEWAY_JWT_SECRET)'
      );
    }
  }

  /**
   * Discover all tools exposed by the gateway using the OpenAI tools listing
   * endpoint — no need to know upstream IDs in advance.
   */
  async discoverTools(): Promise<GatewayTool[]> {
    const res = await httpRequest(
      `${this.baseUrl}/v1/openai/tools`,
      'GET',
      { Authorization: `Bearer ${this.token}` }
    );

    if (res.status !== 200) {
      throw new Error(`Gateway tool discovery failed with status ${res.status}`);
    }

    const body = res.data as {
      object: string;
      data: Array<{ type: string; function: { name: string; description: string } }>;
    };

    return body.data.map((item) => {
      const idx = item.function.name.indexOf('__');
      return {
        upstreamId: item.function.name.slice(0, idx),
        toolName: item.function.name.slice(idx + 2),
        namespacedName: item.function.name,
        description: item.function.description,
      };
    });
  }

  /**
   * Execute a tool call through the gateway's policy pipeline.
   * Throws if the policy denies the call or the upstream returns an error.
   */
  async callTool(
    upstreamId: string,
    tool: string,
    args: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown> {
    const body = JSON.stringify({ upstreamId, tool, args, sessionId });
    const res = await httpRequest(
      `${this.baseUrl}/v1/call`,
      'POST',
      {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body
    );

    const data = res.data as {
      decision: { allow: boolean; reason: string };
      result?: unknown;
      error?: string;
    };

    if (!data.decision?.allow) {
      throw new Error(`Gateway denied tool '${tool}' on '${upstreamId}': ${data.decision?.reason ?? 'no reason'}`);
    }

    if (data.error) {
      throw new Error(`Upstream error for '${tool}' on '${upstreamId}': ${data.error}`);
    }

    return data.result;
  }
}
