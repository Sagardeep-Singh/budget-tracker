/**
 * Vercel (and most reverse proxies) set `x-forwarded-for` to a
 * client-first, comma-separated chain; `x-real-ip` is a common fallback for
 * proxies that don't. No trusted IP means every caller shares one "unknown"
 * bucket for IP-scoped rate limits — degraded, not broken.
 */
export const clientIpFromHeaders = (headers: Headers): string => {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return headers.get('x-real-ip') ?? 'unknown';
};
