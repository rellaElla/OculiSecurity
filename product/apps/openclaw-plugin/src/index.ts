/**
 * Oculi Security Gateway — OpenClaw Plugin
 *
 * Drop this file (or the whole package) into your OpenClaw plugins directory.
 * OpenClaw loads plugins as TypeScript modules via jiti — no build step needed.
 *
 * Required environment variables (set in your OpenClaw config):
 *
 *   GATEWAY_URL          URL of the Oculi Security Gateway  (e.g. http://192.168.1.10:3000)
 *
 *   One of:
 *     GATEWAY_TOKEN      Pre-minted JWT for this OpenClaw instance
 *     OR
 *     GATEWAY_ACTOR      Actor name  (e.g. openclaw)
 *     GATEWAY_ORG        Org ID      (e.g. my-org)
 *     GATEWAY_ROLES      Comma-separated roles (e.g. editor)
 *     GATEWAY_JWT_SECRET The gateway's JWT_SECRET (same value as on the gateway)
 *
 * Optional:
 *   GATEWAY_SESSION_ID   Fixed session ID for audit correlation (default: random per call)
 */

import { GatewayClient, GatewayTool } from './gateway-client';

// ---------------------------------------------------------------------------
// OpenClaw plugin tool interface (matches OpenClaw's plugin contract)
// ---------------------------------------------------------------------------

interface OpenClawTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    additionalProperties: boolean;
  };
  execute(args: Record<string, unknown>): Promise<string>;
}

interface OpenClawPlugin {
  name: string;
  version: string;
  tools: OpenClawTool[];
  initialize(config: Record<string, string>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin state
// ---------------------------------------------------------------------------

let client: GatewayClient | null = null;

function buildClient(): GatewayClient {
  const gatewayUrl = process.env.GATEWAY_URL;
  if (!gatewayUrl) throw new Error('[oculi-security] GATEWAY_URL env var is required');

  const token = process.env.GATEWAY_TOKEN;
  if (token) {
    return new GatewayClient({ gatewayUrl, token });
  }

  const actor = process.env.GATEWAY_ACTOR;
  const orgId = process.env.GATEWAY_ORG;
  const jwtSecret = process.env.GATEWAY_JWT_SECRET;

  if (!actor || !orgId || !jwtSecret) {
    throw new Error(
      '[oculi-security] Provide either GATEWAY_TOKEN or ' +
      '(GATEWAY_ACTOR + GATEWAY_ORG + GATEWAY_JWT_SECRET)'
    );
  }

  const roles = (process.env.GATEWAY_ROLES ?? 'editor')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  return new GatewayClient({ gatewayUrl, actor, orgId, roles, jwtSecret });
}

function buildTool(gatewayTool: GatewayTool): OpenClawTool {
  const { upstreamId, toolName, namespacedName, description } = gatewayTool;
  const sessionId = process.env.GATEWAY_SESSION_ID;

  return {
    name: namespacedName,
    description,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      if (!client) throw new Error('[oculi-security] Plugin not initialized');

      const result = await client.callTool(upstreamId, toolName, args, sessionId);
      return typeof result === 'string' ? result : JSON.stringify(result);
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const plugin: OpenClawPlugin = {
  name: 'oculi-security-gateway',
  version: '0.1.0',
  tools: [], // populated in initialize()

  async initialize(_config: Record<string, string>): Promise<void> {
    client = buildClient();

    const discovered = await client.discoverTools();
    plugin.tools = discovered.map(buildTool);

    const toolNames = plugin.tools.map((t) => t.name).join(', ');
    console.log(`[oculi-security] Initialized with ${plugin.tools.length} tools: ${toolNames}`);
  },
};

export default plugin;
export { plugin }; // named export for frameworks that import by name
