/**
 * OASIS Dashboard v3 - Rate Limit Middleware
 * Sliding window, in-memory rate limiter.
 * 120 req/min general, 10 auth failures/min per IP.
 */

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;

// Map of IP -> { windowStart, count }
const rateLimitMap = new Map();

// Periodically clean up stale entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 300_000);

export function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();

  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;

  if (entry.count > RATE_MAX_REQUESTS) {
    return res.status(429).json({ error: "Too many requests" });
  }

  next();
}

export { rateLimitMap };
