/**
 * OASIS Dashboard — WebSocket Event Bus
 * Single persistent WebSocket connection with auto-reconnect,
 * heartbeat ping-pong, and pub/sub event routing.
 */

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

class EventBus {
  constructor() {
    /** @type {WebSocket|null} */
    this._ws = null;

    /** @type {'connected'|'disconnected'|'reconnecting'} */
    this._status = 'disconnected';

    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();

    /** @type {number} reconnect attempt counter */
    this._reconnectAttempts = 0;

    /** @type {ReturnType<typeof setTimeout>|null} */
    this._reconnectTimer = null;

    /** @type {ReturnType<typeof setInterval>|null} */
    this._heartbeatTimer = null;

    /** @type {number|null} last pong received timestamp */
    this._lastPong = null;

    /** @type {boolean} intentionally closed (no reconnect) */
    this._intentionallyClosed = false;

    /** Queue for messages sent while disconnected */
    this._sendQueue = [];

    this._connect();
  }

  /**
   * Subscribe to an event type.
   * Use '*' as wildcard for all events.
   * @param {string} eventType
   * @param {Function} handler — (data, eventType) => void
   * @returns {Function} unsubscribe function
   */
  on(eventType, handler) {
    if (!this._handlers.has(eventType)) {
      this._handlers.set(eventType, new Set());
    }
    this._handlers.get(eventType).add(handler);
    return () => this.off(eventType, handler);
  }

  /**
   * Unsubscribe from an event type.
   * @param {string} eventType
   * @param {Function} handler
   */
  off(eventType, handler) {
    const set = this._handlers.get(eventType);
    if (set) {set.delete(handler);}
  }

  /**
   * Emit an event to the server.
   * If not connected, queues the message for delivery on reconnect.
   * @param {string} eventType
   * @param {any} data
   */
  emit(eventType, data) {
    const payload = JSON.stringify({ type: eventType, data });
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(payload);
    } else {
      // Queue for delivery when reconnected
      this._sendQueue.push(payload);
      console.warn(`[EventBus] queued emit (${eventType}) — not connected`);
    }
  }

  /**
   * Current connection status.
   * @returns {'connected'|'disconnected'|'reconnecting'}
   */
  get status() {
    return this._status;
  }

  /**
   * True if currently connected.
   */
  get connected() {
    return this._status === 'connected';
  }

  /**
   * Permanently close the connection (no reconnect).
   */
  close() {
    this._intentionallyClosed = true;
    this._clearTimers();
    if (this._ws) {
      this._ws.close(1000, 'client closed');
      this._ws = null;
    }
    this._setStatus('disconnected');
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _connect() {
    if (this._intentionallyClosed) {return;}

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${proto}//${host}/ws`;

    console.debug(`[EventBus] connecting to ${wsUrl} (attempt ${this._reconnectAttempts + 1})`);

    try {
      this._ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('[EventBus] WebSocket constructor error:', err);
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => {
      console.debug('[EventBus] connected');
      this._reconnectAttempts = 0;
      this._setStatus('connected');
      this._startHeartbeat();

      // Flush queued messages
      while (this._sendQueue.length > 0) {
        const msg = this._sendQueue.shift();
        try { this._ws.send(msg); } catch (e) { /* ignore */ }
      }
    };

    this._ws.onclose = (ev) => {
      this._stopHeartbeat();
      if (!this._intentionallyClosed) {
        console.warn(`[EventBus] disconnected (code=${ev.code}), scheduling reconnect`);
        this._setStatus('reconnecting');
        this._scheduleReconnect();
      } else {
        this._setStatus('disconnected');
      }
    };

    this._ws.onerror = (err) => {
      // onerror is always followed by onclose — no need to schedule reconnect here
      console.error('[EventBus] WebSocket error:', err);
    };

    this._ws.onmessage = (ev) => {
      this._handleMessage(ev.data);
    };
  }

  _handleMessage(rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      // Plain text — emit as 'message'
      this._dispatch('message', rawData);
      return;
    }

    // Server heartbeat pong
    if (msg.type === 'pong') {
      this._lastPong = Date.now();
      return;
    }

    const type = msg.type || 'message';
    const data = msg.data !== undefined ? msg.data : msg;
    this._dispatch(type, data);
  }

  _dispatch(eventType, data) {
    // Type-specific handlers
    const handlers = this._handlers.get(eventType);
    if (handlers) {
      for (const fn of handlers) {
        try { fn(data, eventType); } catch (e) { console.error('[EventBus] handler error:', e); }
      }
    }

    // Wildcard handlers
    const wildcards = this._handlers.get('*');
    if (wildcards) {
      for (const fn of wildcards) {
        try { fn(data, eventType); } catch (e) { console.error('[EventBus] wildcard handler error:', e); }
      }
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) {return;}
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this._reconnectAttempts,
      RECONNECT_MAX_MS
    );
    this._reconnectAttempts++;
    console.debug(`[EventBus] reconnecting in ${delay}ms`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._lastPong = Date.now();
    this._heartbeatTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        // Check for stale connection (no pong received in 2x heartbeat interval)
        if (this._lastPong && Date.now() - this._lastPong > HEARTBEAT_INTERVAL_MS * 3) {
          console.warn('[EventBus] stale connection detected — no pong received, forcing reconnect');
          this._ws.close();
          return;
        }
        this._ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _clearTimers() {
    this._stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _setStatus(status) {
    const old = this._status;
    this._status = status;
    if (old !== status) {
      this._dispatch('connection-status', { status, previousStatus: old });
      // Also fire a browser CustomEvent for non-component listeners
      window.dispatchEvent(new CustomEvent('ws-status', { detail: { status } }));
    }
  }
}

/** Singleton event bus instance */
export const eventBus = new EventBus();

export default eventBus;
