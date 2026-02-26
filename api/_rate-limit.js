/** @type {Map<string, { windowStart: number; count: number }>} */
const rateLimitMap = new Map();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > 120_000) rateLimitMap.delete(key);
  }
}

/**
 * @param {string} ip
 * @param {{ limit?: number; windowMs?: number }} [opts]
 * @returns {{ limited: boolean; remaining: number; retryAfter: number }}
 */
export function checkRateLimit(ip, { limit = 60, windowMs = 60_000 } = {}) {
  cleanup();
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return { limited: false, remaining: limit - 1, retryAfter: 0 };
  }

  entry.count += 1;
  const limited = entry.count > limit;
  const remaining = Math.max(0, limit - entry.count);
  const retryAfter = limited ? Math.ceil((entry.windowStart + windowMs - now) / 1000) : 0;
  return { limited, remaining, retryAfter };
}

/**
 * @param {Request} request
 * @returns {string}
 */
export function getClientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
