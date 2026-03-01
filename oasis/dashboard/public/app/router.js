/**
 * OASIS Dashboard — Hash Router
 * Client-side routing based on URL hash fragments.
 * Supports parameter extraction (e.g. #/agents/:id)
 */

class Router {
  constructor() {
    /** @type {Array<{pattern: string, regex: RegExp, keys: string[], callback: Function}>} */
    this._routes = [];

    /** @type {string} current path */
    this._current = '';

    /** @type {Function[]} global navigation listeners */
    this._listeners = [];

    // Listen to browser hash changes
    window.addEventListener('hashchange', () => this._dispatch());

    // Handle initial load
    window.addEventListener('DOMContentLoaded', () => this._dispatch());
  }

  /**
   * Register a route handler.
   * Pattern supports :param segments, e.g. "/agents/:id"
   * @param {string} pattern — route pattern (without leading #)
   * @param {Function} callback — called with (params, path)
   */
  onRoute(pattern, callback) {
    const { regex, keys } = this._compilePattern(pattern);
    const entry = { pattern, regex, keys, callback };
    this._routes.push(entry);
    // Return unsubscribe function for cleanup
    return () => {
      const idx = this._routes.indexOf(entry);
      if (idx >= 0) {this._routes.splice(idx, 1);}
    };
  }

  /**
   * Navigate to a hash path.
   * @param {string} path — e.g. "/agents/oasis" (without leading #)
   */
  navigate(path) {
    // Strip leading '#' if present — we only need the path portion
    const clean = path.startsWith('#') ? path.slice(1) : path;
    const hashPath = clean.startsWith('/') ? clean : `/${clean}`;
    if (window.location.hash === `#${hashPath}`) {
      // Already there — still dispatch to re-render
      this._dispatch();
    } else {
      window.location.hash = hashPath;
    }
  }

  /**
   * Add a global listener called on every route change.
   * @param {Function} fn — called with (path, params)
   */
  onChange(fn) {
    this._listeners.push(fn);
    // Return unsubscribe function for cleanup
    return () => {
      const idx = this._listeners.indexOf(fn);
      if (idx >= 0) {this._listeners.splice(idx, 1);}
    };
  }

  /**
   * Get the current path (without #).
   */
  get current() {
    return this._current;
  }

  /**
   * Extract params from current path for a given pattern.
   * @param {string} pattern
   * @returns {object|null}
   */
  match(pattern) {
    const { regex, keys } = this._compilePattern(pattern);
    const m = this._current.match(regex);
    if (!m) {return null;}
    const params = {};
    keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return params;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  _dispatch() {
    const hash = window.location.hash;
    // Normalize: '' or '#' both map to '/'
    const path = !hash || hash === '#' ? '/' : hash.slice(1);
    this._current = path;

    // Notify global listeners
    for (const fn of this._listeners) {
      try { fn(path); } catch (e) { console.error('[Router] listener error:', e); }
    }

    // Find matching registered routes
    let matched = false;
    for (const route of this._routes) {
      const m = path.match(route.regex);
      if (m) {
        const params = {};
        route.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1] || '');
        });
        try { route.callback(params, path); } catch (e) { console.error('[Router] route callback error:', e); }
        matched = true;
        // Continue matching (allow multiple handlers for same pattern)
      }
    }

    // Default: redirect to home only if registered routes exist but none matched.
    // If only onChange listeners are used (no onRoute calls), skip the redirect —
    // the listeners handle page loading themselves.
    if (!matched && path !== '/' && this._routes.length > 0 && this._listeners.length === 0) {
      console.warn(`[Router] No route matched: ${path} — redirecting to /`);
      this.navigate('/');
    }
  }

  /**
   * Compile a route pattern into a regex with named param keys.
   * @param {string} pattern
   * @returns {{ regex: RegExp, keys: string[] }}
   */
  _compilePattern(pattern) {
    // Cache compiled patterns to avoid repeated work
    if (!this._cache) {this._cache = new Map();}
    if (this._cache.has(pattern)) {return this._cache.get(pattern);}

    const keys = [];
    // Escape special regex chars, then replace :param with capture groups
    const regexStr = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // escape special chars
      .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      });

    // Exact match: anchor start and end
    const regex = new RegExp(`^${regexStr}$`);
    const result = { regex, keys };
    this._cache.set(pattern, result);
    return result;
  }
}

/** Singleton router instance */
export const router = new Router();

/**
 * Pre-defined application routes.
 * Import this to ensure routes are registered at startup.
 */
export const ROUTES = {
  HOME: '/',
  AGENTS: '/agents',
  AGENT_DETAIL: '/agents/:id',
  CHAT: '/chat',
  CHAT_AGENT: '/chat/:agentId',
  OPERATIONS: '/operations',
  KNOWLEDGE: '/knowledge',
  BUSINESS: '/business',
  HOUSEHOLD: '/household',
  ANALYTICS: '/analytics',
  TOOLS: '/tools',
  SPAWN: '/spawn',
  SETTINGS: '/settings',
};

export default router;
