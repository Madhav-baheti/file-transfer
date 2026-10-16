export interface SignalingConfig {
  port: number;
  allowedOrigins: string[];
  sessionTtlMs: number;
  trustProxyHops: number;
  turnUrls: string[];
  turnSharedSecret: string | null;
  rateLimitCapacity: number;
  rateLimitRefillRate: number;
  maxMessageSize: number;
}

function parseInteger(name: string, value: string, minimum: number): number {
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return parsed;
}

function parsePositiveFiniteNumber(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a finite number greater than 0`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SignalingConfig {
  const isProduction = env.NODE_ENV === 'production';
  const allowedOriginsRaw = env.ALLOWED_ORIGINS ?? (isProduction ? '' : '*');
  const allowedOrigins = allowedOriginsRaw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (isProduction && (allowedOrigins.length === 0 || allowedOrigins.includes('*'))) {
    throw new Error(
      'ALLOWED_ORIGINS must contain one or more exact origins in production; empty values and "*" are not allowed',
    );
  }

  const port = parseInteger('PORT', env.PORT ?? '3001', 1);
  if (port > 65535) throw new Error('PORT must be between 1 and 65535');
  const rawTurnUrls = env.TURN_URLS?.split(',').map((url) => url.trim()).filter(Boolean) ?? [];
  const turnUrlsAreValid = rawTurnUrls.every(
    (url) => /^turns?:[^\s,]+$/i.test(url) && !url.includes('@'),
  );
  const turnUrls = turnUrlsAreValid ? rawTurnUrls : [];
  const candidateTurnSecret = env.TURN_SHARED_SECRET?.trim() || null;
  const turnSharedSecret =
    candidateTurnSecret && candidateTurnSecret.length >= 32 ? candidateTurnSecret : null;

  return {
    port,
    allowedOrigins,
    sessionTtlMs: parseInteger('SESSION_TTL_MS', env.SESSION_TTL_MS ?? '300000', 1),
    trustProxyHops: parseInteger('TRUST_PROXY_HOPS', env.TRUST_PROXY_HOPS ?? '0', 0),
    turnUrls:
      turnUrls.length > 0 && turnSharedSecret ? turnUrls : [],
    turnSharedSecret: turnUrls.length > 0 ? turnSharedSecret : null,
    rateLimitCapacity: parseInteger(
      'RATE_LIMIT_CAPACITY',
      env.RATE_LIMIT_CAPACITY ?? '15',
      1,
    ),
    rateLimitRefillRate: parsePositiveFiniteNumber(
      'RATE_LIMIT_REFILL_RATE',
      env.RATE_LIMIT_REFILL_RATE ?? '0.5',
    ),
    maxMessageSize: 64 * 1024, // 64 KB per TECH_STACK.md §5
  };
}
