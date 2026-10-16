export function getClientIp(
  forwardedFor: string | string[] | undefined,
  socketAddress: string | undefined,
  trustedProxyHops: number,
): string {
  const fallback = socketAddress || 'unknown';
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops <= 0) return fallback;

  const entries = (Array.isArray(forwardedFor) ? forwardedFor : [forwardedFor])
    .flatMap((header) => header?.split(',') ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length < trustedProxyHops) return fallback;
  return entries[entries.length - trustedProxyHops] || fallback;
}
