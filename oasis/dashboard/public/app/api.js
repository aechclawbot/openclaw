/**
 * OASIS Dashboard — API Client
 * Centralized wrapper for all HTTP calls to /api/*.
 * Handles error formatting and toast notifications.
 */

/**
 * Show a toast notification — delegated to oasis-toast singleton.
 * @param {string} msg
 * @param {'ok'|'error'|'warning'|'info'} type
 */
function showToast(msg, type = 'error') {
  // oasis-toast exposes a global method after first render
  if (typeof window.__oasisToast === 'function') {
    window.__oasisToast(msg, type);
  } else {
    // Fallback: queue the toast for when the component is ready
    if (!window.__oasisToastQueue) {window.__oasisToastQueue = [];}
    window.__oasisToastQueue.push({ msg, type });
  }
}

class ApiClient {
  constructor() {
    /** Base URL: current origin + /api/ */
    this._base = `${window.location.origin}/api/`;
  }

  /**
   * GET request.
   * @param {string} path — relative to /api/
   * @param {RequestInit} [opts]
   * @returns {Promise<any|null>}
   */
  async get(path, opts = {}) {
    return this._request('GET', path, undefined, opts);
  }

  /**
   * POST request with JSON body.
   * @param {string} path
   * @param {any} [body]
   * @param {RequestInit} [opts]
   * @returns {Promise<any|null>}
   */
  async post(path, body, opts = {}) {
    return this._request('POST', path, body, opts);
  }

  /**
   * PUT request with JSON body.
   * @param {string} path
   * @param {any} [body]
   * @param {RequestInit} [opts]
   * @returns {Promise<any|null>}
   */
  async put(path, body, opts = {}) {
    return this._request('PUT', path, body, opts);
  }

  /**
   * PATCH request with JSON body.
   * @param {string} path
   * @param {any} [body]
   * @param {RequestInit} [opts]
   * @returns {Promise<any|null>}
   */
  async patch(path, body, opts = {}) {
    return this._request('PATCH', path, body, opts);
  }

  /**
   * DELETE request.
   * @param {string} path
   * @param {RequestInit} [opts]
   * @returns {Promise<any|null>}
   */
  async del(path, opts = {}) {
    return this._request('DELETE', path, undefined, opts);
  }

  /** Alias for del() — some callers use api.delete() */
  async delete(path, opts = {}) {
    return this.del(path, opts);
  }

  /**
   * POST with Server-Sent Events (SSE) streaming response.
   * Calls onEvent for each parsed SSE event, returns when stream closes.
   * @param {string} path
   * @param {any} body
   * @param {Function} onEvent — (event: {type: string, data: any}) => void
   * @returns {Promise<void>}
   */
  async stream(path, body, onEvent) {
    const url = this._url(path);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error');
      throw err;
    }

    if (!res.ok) {
      const msg = await this._extractErrorMessage(res);
      showToast(msg, 'error');
      throw new Error(msg);
    }

    if (!res.body) {
      console.error('[API] stream: no response body');
      throw new Error('No response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {break;}

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages separated by double newlines
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const parsed = this._parseSseMessage(part);
          if (parsed) {
            try { onEvent(parsed); } catch (e) { console.error('[API] stream onEvent error:', e); }
          }
        }
      }

      // Flush any remaining buffer
      if (buffer.trim()) {
        const parsed = this._parseSseMessage(buffer);
        if (parsed) {
          try { onEvent(parsed); } catch (e) { console.error('[API] stream onEvent error:', e); }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[API] stream read error:', err);
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  /**
   * Build full URL for a path.
   * @param {string} path
   * @returns {string}
   */
  _url(path) {
    // Allow absolute paths that start with /
    if (path.startsWith('/')) {return `${window.location.origin}${path}`;}
    // Strip leading ./ or api/
    const clean = path.replace(/^\.?\/?(api\/)?/, '');
    return `${this._base}${clean}`;
  }

  /**
   * Core request method.
   * @param {string} method
   * @param {string} path
   * @param {any} [body]
   * @param {RequestInit} [opts]
   * @returns {Promise<any|null>}
   */
  async _request(method, path, body, opts = {}) {
    const url = this._url(path);
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...opts.headers,
    };

    const init = {
      method,
      headers,
      ...opts,
    };

    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      init.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Network-level error (no connectivity, DNS failure, etc.)
      showToast(`Network error: ${err.message}`, 'error');
      console.error(`[API] ${method} ${path} — network error:`, err);
      return null;
    }

    if (!res.ok) {
      const msg = await this._extractErrorMessage(res);
      showToast(msg, 'error');
      console.error(`[API] ${method} ${path} — HTTP ${res.status}: ${msg}`);
      return null;
    }

    // Handle empty response (e.g. 204 No Content)
    const contentType = res.headers.get('content-type') || '';
    if (res.status === 204 || !contentType.includes('application/json')) {
      return true;
    }

    try {
      return await res.json();
    } catch (err) {
      console.error(`[API] ${method} ${path} — JSON parse error:`, err);
      return null;
    }
  }

  /**
   * Extract a human-readable error message from a failed response.
   * @param {Response} res
   * @returns {Promise<string>}
   */
  async _extractErrorMessage(res) {
    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        return data?.error || data?.message || `HTTP ${res.status}`;
      }
      const text = await res.text();
      return text.slice(0, 200) || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status} ${res.statusText}`;
    }
  }

  /**
   * Parse a single SSE message block into { type, data }.
   * @param {string} block
   * @returns {{ type: string, data: any }|null}
   */
  _parseSseMessage(block) {
    if (!block.trim()) {return null;}

    let eventType = 'message';
    let dataLines = [];

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {return null;}

    const rawData = dataLines.join('\n');
    let data;
    try {
      data = JSON.parse(rawData);
    } catch {
      data = rawData;
    }

    return { type: eventType, data };
  }
}

/** Singleton API client instance */
export const api = new ApiClient();

export default api;
