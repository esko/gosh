import { timingSafeEqual } from './Pairing';

export const DEFAULT_MAX_CONTROL_CLIENTS = 4;
export const DEFAULT_MAX_REQUESTS_PER_SECOND = 30;
export const DEFAULT_SLOW_SUBSCRIBER_BYTES = 65_536;

export type RateLimitSnapshot = {
  tokens: number;
  lastRefillMs: number;
};

export type ControlPermissionsOptions = {
  token: string;
  maxClients?: number;
  maxRequestsPerSecond?: number;
  now?: () => number;
};

/**
 * Transport-layer auth and per-connection limits for the agent control server.
 * Business rules stay in AgentControlService; this module gates access only.
 */
export class ControlPermissions {
  private readonly expectedToken: string;
  readonly maxClients: number;
  private readonly maxRequestsPerSecond: number;
  private readonly now: () => number;
  private readonly rateLimits = new Map<string, RateLimitSnapshot>();

  constructor(options: ControlPermissionsOptions) {
    this.expectedToken = options.token;
    this.maxClients = options.maxClients ?? DEFAULT_MAX_CONTROL_CLIENTS;
    this.maxRequestsPerSecond = options.maxRequestsPerSecond ?? DEFAULT_MAX_REQUESTS_PER_SECOND;
    this.now = options.now ?? (() => Date.now());
  }

  verifyToken(candidate: string): boolean {
    if (!candidate) return false;
    return timingSafeEqual(this.expectedToken, candidate);
  }

  canAcceptClient(activeClients: number): boolean {
    return activeClients < this.maxClients;
  }

  /** Token-bucket limiter keyed by connection id. Returns false when over limit. */
  allowRequest(clientId: string): boolean {
    const bucket = this.rateLimits.get(clientId) ?? {
      tokens: this.maxRequestsPerSecond,
      lastRefillMs: this.now(),
    };
    const elapsedMs = Math.max(0, this.now() - bucket.lastRefillMs);
    const refill = (elapsedMs / 1000) * this.maxRequestsPerSecond;
    bucket.tokens = Math.min(this.maxRequestsPerSecond, bucket.tokens + refill);
    bucket.lastRefillMs = this.now();
    if (bucket.tokens < 1) {
      this.rateLimits.set(clientId, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.rateLimits.set(clientId, bucket);
    return true;
  }

  clearClient(clientId: string): void {
    this.rateLimits.delete(clientId);
  }
}
