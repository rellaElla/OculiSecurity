"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpstreamError = exports.UpstreamConnector = void 0;
const axios_1 = __importDefault(require("axios"));
class UpstreamConnector {
    registry;
    constructor(config) {
        this.registry = new Map(config.upstreams.map((u) => [u.id, u]));
    }
    getConfig(upstreamId) {
        return this.registry.get(upstreamId);
    }
    listUpstreams() {
        return Array.from(this.registry.values());
    }
    async call(upstreamId, body) {
        const upstream = this.registry.get(upstreamId);
        if (!upstream) {
            throw new Error(`Unknown upstream: '${upstreamId}'`);
        }
        const url = `${upstream.baseUrl}/v1/call`;
        const headers = {
            'Content-Type': 'application/json',
        };
        if (upstream.authHeader) {
            headers['Authorization'] = upstream.authHeader;
        }
        const startMs = Date.now();
        try {
            const response = await axios_1.default.post(url, body, {
                headers,
                timeout: upstream.timeout,
                validateStatus: () => true, // handle non-2xx ourselves
            });
            const latencyMs = Date.now() - startMs;
            if (response.status >= 400) {
                const errData = response.data;
                throw new UpstreamError(errData?.error ??
                    `Upstream returned ${response.status}`, response.status, latencyMs);
            }
            return { data: response.data, latencyMs };
        }
        catch (err) {
            if (err instanceof UpstreamError)
                throw err;
            const latencyMs = Date.now() - startMs;
            const axiosErr = err;
            if (axiosErr.code === 'ECONNABORTED') {
                throw new UpstreamError(`Upstream '${upstreamId}' timed out after ${upstream.timeout}ms`, 504, latencyMs);
            }
            if (axiosErr.code === 'ECONNREFUSED') {
                throw new UpstreamError(`Upstream '${upstreamId}' connection refused at ${url}`, 502, latencyMs);
            }
            throw new UpstreamError(`Upstream '${upstreamId}' error: ${axiosErr.message}`, 502, latencyMs);
        }
    }
}
exports.UpstreamConnector = UpstreamConnector;
class UpstreamError extends Error {
    statusCode;
    latencyMs;
    constructor(message, statusCode, latencyMs) {
        super(message);
        this.statusCode = statusCode;
        this.latencyMs = latencyMs;
        this.name = 'UpstreamError';
    }
}
exports.UpstreamError = UpstreamError;
//# sourceMappingURL=upstream.js.map