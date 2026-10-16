export interface TurnConfiguration {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: number;
}

export function parseTurnConfiguration(
  value: unknown,
  nowSeconds = Date.now() / 1000,
): TurnConfiguration | null {
  if (typeof value !== 'object' || value === null) return null;
  const config = value as Record<string, unknown>;
  if (
    !Array.isArray(config.urls) ||
    config.urls.length === 0 ||
    !config.urls.every(
      (url) => typeof url === 'string' && /^turns?:[^\s,]+$/i.test(url) && !url.includes('@'),
    ) ||
    typeof config.username !== 'string' ||
    config.username.length === 0 ||
    typeof config.credential !== 'string' ||
    config.credential.length === 0 ||
    typeof config.expiresAt !== 'number' ||
    !Number.isSafeInteger(config.expiresAt) ||
    config.expiresAt <= nowSeconds
  ) {
    return null;
  }
  return {
    urls: config.urls,
    username: config.username,
    credential: config.credential,
    expiresAt: config.expiresAt,
  };
}

export function defaultStunServers(configured?: string): RTCIceServer[] {
  const urls = configured?.split(',').map((url) => url.trim()).filter(Boolean);
  if (urls?.length && urls.every((url) => /^stun:/i.test(url))) {
    return urls.map((url) => ({ urls: url }));
  }
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
}

export function toTurnIceServer(config: TurnConfiguration): RTCIceServer {
  return {
    urls: config.urls,
    username: config.username,
    credential: config.credential,
  };
}
