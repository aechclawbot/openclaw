/**
 * OASIS Dashboard v3 - Basic Auth Middleware
 * HMAC-based constant-time comparison to prevent timing attacks.
 */

import { timingSafeEqual, createHmac } from "crypto";

const AUTH_USER = process.env.OPENCLAW_DASHBOARD_USERNAME || "";
const AUTH_PASS = process.env.OPENCLAW_DASHBOARD_PASSWORD || "";

// Track auth failures per IP for rate limiting (shared with rate-limit middleware)
export const authFailures = new Map();
const AUTH_RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;

// HMAC-based constant-time string comparison (avoids length leak via timingSafeEqual)
function safeCompare(a, b) {
  const hmacA = createHmac("sha256", "dashboard-auth").update(a).digest();
  const hmacB = createHmac("sha256", "dashboard-auth").update(b).digest();
  return timingSafeEqual(hmacA, hmacB);
}

let _warnedNoAuth = false;

export function basicAuth(req, res, next) {
  // If credentials not configured, skip auth with a one-time warning
  if (!AUTH_USER || !AUTH_PASS) {
    if (!_warnedNoAuth) {
      console.warn(
        "WARNING: Dashboard authentication is disabled — OPENCLAW_DASHBOARD_USERNAME or OPENCLAW_DASHBOARD_PASSWORD not set"
      );
      _warnedNoAuth = true;
    }
    return next();
  }

  // Exempt the health endpoint for Docker healthchecks (minimal response)
  if (req.path === "/api/health") {return next();}

  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="OASIS Dashboard"');
    return res.status(401).send("Authentication required");
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const idx = decoded.indexOf(":");
  if (idx < 0) {
    res.set("WWW-Authenticate", 'Basic realm="OASIS Dashboard"');
    return res.status(401).send("Authentication required");
  }

  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);

  if (safeCompare(user, AUTH_USER) && safeCompare(pass, AUTH_PASS)) {
    return next();
  }

  // Track auth failures per IP for rate limiting
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  let entry = authFailures.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    entry = { windowStart: now, authFails: 0 };
    authFailures.set(ip, entry);
  }
  entry.authFails++;

  if (entry.authFails > AUTH_RATE_MAX) {
    return res.status(429).send("Too many authentication failures");
  }

  res.set("WWW-Authenticate", 'Basic realm="OASIS Dashboard"');
  return res.status(401).send("Invalid credentials");
}

export { AUTH_USER, AUTH_PASS };
