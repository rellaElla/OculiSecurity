import axios, { AxiosError } from 'axios';
import { AppConfig } from '../config';
import { UpstreamCallRequest, UpstreamConfig } from '../types';

export interface UpstreamResult {
  data: unknown;
  latencyMs: number;
}

export class UpstreamConnector {
  private readonly registry: Map<string, UpstreamConfig>;

  constructor(config: AppConfig) {
    this.registry = new Map(config.upstreams.map((u) => [u.id, u]));
  }

  getConfig(upstreamId: string): UpstreamConfig | undefined {
    return this.registry.get(upstreamId);
  }

  listUpstreams(): UpstreamConfig[] {
    return Array.from(this.registry.values());
  }

  async call(
    upstreamId: string,
    body: UpstreamCallRequest
  ): Promise<UpstreamResult> {
    const upstream = this.registry.get(upstreamId);
    if (!upstream) {
      throw new Error(`Unknown upstream: '${upstreamId}'`);
    }

    const url = `${upstream.baseUrl}/v1/call`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (upstream.authHeader) {
      headers['Authorization'] = upstream.authHeader;
    }

    const startMs = Date.now();

    try {
      const response = await axios.post<unknown>(url, body, {
        headers,
        timeout: upstream.timeout,
        validateStatus: () => true, // handle non-2xx ourselves
      });

      const latencyMs = Date.now() - startMs;

      if (response.status >= 400) {
        const errData = response.data as Record<string, unknown>;
        throw new UpstreamError(
          errData?.error as string ??
            `Upstream returned ${response.status}`,
          response.status,
          latencyMs
        );
      }

      return { data: response.data, latencyMs };
    } catch (err) {
      if (err instanceof UpstreamError) throw err;

      const latencyMs = Date.now() - startMs;
      const axiosErr = err as AxiosError;

      if (axiosErr.code === 'ECONNABORTED') {
        throw new UpstreamError(
          `Upstream '${upstreamId}' timed out after ${upstream.timeout}ms`,
          504,
          latencyMs
        );
      }
      if (axiosErr.code === 'ECONNREFUSED') {
        throw new UpstreamError(
          `Upstream '${upstreamId}' connection refused at ${url}`,
          502,
          latencyMs
        );
      }

      throw new UpstreamError(
        `Upstream '${upstreamId}' error: ${axiosErr.message}`,
        502,
        latencyMs
      );
    }
  }
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly latencyMs: number
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}
