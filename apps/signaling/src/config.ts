export interface SignalingConfig {
  port: number;
  allowedOrigins: string[];
  sessionTtlMs: number;
  rateLimitCapacity: number;
  rateLimitRefillRate: number;
  maxMessageSize: number;
}

export function loadConfig(): SignalingConfig {
  const allowedOriginsRaw = process.env.ALLOWED_ORIGINS ?? '*';
  const allowedOrigins = allowedOriginsRaw === '*' ? ['*'] : allowedOriginsRaw.split(',').map((s) => s.trim());

  return {
    port: parseInt(process.env.PORT ?? '3001', 10),
    allowedOrigins,
    sessionTtlMs: parseInt(process.env.SESSION_TTL_MS ?? '300000', 10), // 5 mins
    rateLimitCapacity: parseInt(process.env.RATE_LIMIT_CAPACITY ?? '15', 10),
    rateLimitRefillRate: parseFloat(process.env.RATE_LIMIT_REFILL_RATE ?? '0.5'),
    maxMessageSize: 64 * 1024, // 64 KB per TECH_STACK.md §5
  };
}
