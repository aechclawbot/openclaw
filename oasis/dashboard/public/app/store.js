/**
 * OASIS Dashboard — Centralized State Store
 * EventTarget-based reactive state management.
 * Components subscribe to keys and receive updates via custom events.
 */

class Store extends EventTarget {
  constructor() {
    super();

    /** @type {Map<string, any>} internal state map */
    this._state = new Map();

    /** @type {Map<string, Set<Function>>} key → Set of subscriber callbacks */
    this._subscribers = new Map();

    // Initialize with default state
    this._initDefaults();
  }

  /**
   * Get a state value by key.
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this._state.get(key);
  }

  /**
   * Set a state value and notify subscribers.
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    const oldValue = this._state.get(key);
    this._state.set(key, value);

    // Dispatch a custom event for this key
    const event = new CustomEvent('state-change', {
      detail: { key, value, oldValue },
    });
    this.dispatchEvent(event);

    // Notify direct key subscribers
    const subs = this._subscribers.get(key);
    if (subs) {
      for (const cb of subs) {
        try { cb(value, oldValue, key); } catch (e) { console.error('[Store] subscriber error:', e); }
      }
    }

    // Notify wildcard subscribers
    const wildcards = this._subscribers.get('*');
    if (wildcards) {
      for (const cb of wildcards) {
        try { cb(value, oldValue, key); } catch (e) { console.error('[Store] wildcard subscriber error:', e); }
      }
    }
  }

  /**
   * Subscribe to changes on a specific key (or '*' for all keys).
   * @param {string} key — state key or '*'
   * @param {Function} callback — (value, oldValue, key) => void
   * @returns {Function} unsubscribe function
   */
  subscribe(key, callback) {
    if (!this._subscribers.has(key)) {
      this._subscribers.set(key, new Set());
    }
    this._subscribers.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      const subs = this._subscribers.get(key);
      if (subs) {subs.delete(callback);}
    };
  }

  /**
   * Update a slice of an object value (shallow merge).
   * @param {string} key
   * @param {object} patch
   */
  patch(key, patch) {
    const current = this.get(key);
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      this.set(key, { ...current, ...patch });
    } else {
      this.set(key, patch);
    }
  }

  /**
   * Fetch JSON from a URL and store it under key.
   * @param {string} key — state key to store result
   * @param {string} url — fetch URL
   * @param {RequestInit} [options] — optional fetch options
   * @returns {Promise<any>} the fetched data (or null on error)
   */
  async fetchAndSet(key, url, options = {}) {
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      if (!res.ok) {throw new Error(`HTTP ${res.status} ${res.statusText}`);}
      const data = await res.json();
      this.set(key, data);
      return data;
    } catch (err) {
      console.error(`[Store] fetchAndSet(${key}, ${url}) failed:`, err);
      return null;
    }
  }

  /**
   * Get all state as a plain object snapshot.
   */
  snapshot() {
    return Object.fromEntries(this._state);
  }

  /**
   * Reset a key to its default value (or delete if no default).
   * @param {string} key
   */
  reset(key) {
    if (this._defaults.has(key)) {
      this.set(key, this._defaults.get(key));
    } else {
      this._state.delete(key);
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _initDefaults() {
    this._defaults = new Map();

    const defaults = {
      // System health
      health: {
        gateway: 'unknown',
        uptime: 0,
        sessions: 0,
        version: '',
        lastCheck: null,
      },

      // Agent list
      agents: [],

      // Active sessions
      sessions: [],

      // Cron jobs
      cronJobs: [],

      // Docker containers
      containers: [],

      // Activity feed
      activity: [],

      // Todo items
      todos: [],

      // Treasury / financial snapshot
      treasury: {
        balance: null,
        currency: 'USD',
        updated: null,
      },

      // Token usage / cost tracking
      usage: {
        today: { tokens: 0, cost: 0 },
        month: { tokens: 0, cost: 0 },
        total: { tokens: 0, cost: 0 },
      },

      // User preferences
      preferences: {
        theme: localStorage.getItem('oasis-theme') || 'dark',
        compactMode: false,
        notificationsEnabled: true,
        autoRefreshInterval: 30,
      },

      // Knowledge base
      knowledge: {
        categories: [],
        totalItems: 0,
        indexedAt: null,
      },

      // Current route info (populated by router integration)
      route: {
        path: '/',
        params: {},
      },

      // UI state
      ui: {
        sidebarOpen: false,
        activeModal: null,
        loading: {},
      },
    };

    for (const [key, value] of Object.entries(defaults)) {
      this._defaults.set(key, value);
      this._state.set(key, structuredClone(value));
    }
  }
}

/** Singleton store instance */
export const store = new Store();

/** Pre-defined state keys (for IDE autocomplete and avoiding typos) */
export const STATE_KEYS = {
  HEALTH: 'health',
  AGENTS: 'agents',
  SESSIONS: 'sessions',
  CRON_JOBS: 'cronJobs',
  CONTAINERS: 'containers',
  ACTIVITY: 'activity',
  TODOS: 'todos',
  TREASURY: 'treasury',
  USAGE: 'usage',
  PREFERENCES: 'preferences',
  KNOWLEDGE: 'knowledge',
  ROUTE: 'route',
  UI: 'ui',
};

export default store;
