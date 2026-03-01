/**
 * OASIS Dashboard — Top Bar
 * Shows gateway status, session count, uptime, and theme toggle.
 * Auto-refreshes health every 30s from /api/health.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { store } from '/app/store.js';
import '/components/shell/oasis-theme.js';

export class OasisTopbar extends LitElement {
  static properties = {
    _health: { type: Object, state: true },
    _wsStatus: { type: String, state: true },
    _mobileMenuOpen: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: block;
    }

    .topbar {
      height: var(--topbar-height);
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0 1.5rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .hamburger {
      display: none;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 5px;
      width: 36px;
      height: 36px;
      padding: 6px;
      border-radius: var(--radius);
      cursor: pointer;
      color: var(--text-dim);
      border: none;
      background: none;
      transition:
        background var(--transition-fast),
        color var(--transition-fast);
      flex-shrink: 0;
    }

    .hamburger:hover {
      background: var(--surface-2);
      color: var(--text);
    }

    .hamburger:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    .hamburger span {
      display: block;
      width: 20px;
      height: 2px;
      background: currentColor;
      border-radius: 1px;
      transition: transform var(--transition), opacity var(--transition);
    }

    .hamburger.open span:nth-child(1) {
      transform: translateY(7px) rotate(45deg);
    }

    .hamburger.open span:nth-child(2) {
      opacity: 0;
    }

    .hamburger.open span:nth-child(3) {
      transform: translateY(-7px) rotate(-45deg);
    }

    .brand {
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .spacer {
      flex: 1;
    }

    .indicators {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .indicator {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      color: var(--text-dim);
      white-space: nowrap;
    }

    .indicator .label {
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 0.68rem;
    }

    .indicator .value {
      color: var(--text);
      font-weight: 600;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .dot.online {
      background: var(--green);
      box-shadow: 0 0 5px var(--green);
    }

    .dot.offline {
      background: var(--red);
      box-shadow: 0 0 5px var(--red);
    }

    .dot.unknown {
      background: var(--text-muted);
    }

    .dot.reconnecting {
      background: var(--yellow);
      box-shadow: 0 0 5px var(--yellow);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .divider {
      width: 1px;
      height: 20px;
      background: var(--border);
    }

    @media (max-width: 768px) {
      .hamburger {
        display: flex;
      }

      .topbar {
        padding: 0 1rem;
      }

      .indicator .label,
      .indicator.sessions,
      .indicator.uptime {
        display: none;
      }
    }

    @media (max-width: 480px) {
      .indicators {
        gap: 0.5rem;
      }

      .brand {
        display: none;
      }
    }
  `;

  constructor() {
    super();
    this._health = store.get('health') || {};
    this._wsStatus = 'disconnected';
    this._mobileMenuOpen = false;
    this._refreshInterval = null;
  }

  connectedCallback() {
    super.connectedCallback();

    // Subscribe to store health updates
    this._unsubHealth = store.subscribe('health', (val) => {
      this._health = val || {};
    });

    // Watch WebSocket status
    this._onWsStatus = (ev) => {
      this._wsStatus = ev.detail?.status || 'disconnected';
    };
    window.addEventListener('ws-status', this._onWsStatus);

    // Poll health endpoint every 30s
    this._fetchHealth();
    this._refreshInterval = setInterval(() => this._fetchHealth(), 30_000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._unsubHealth) {this._unsubHealth();}
    window.removeEventListener('ws-status', this._onWsStatus);
    if (this._refreshInterval) {clearInterval(this._refreshInterval);}
  }

  render() {
    const gateway = this._health?.gateway || 'unknown';
    const sessions = this._health?.sessions ?? 0;
    const uptime = this._formatUptime(this._health?.uptime);
    const version = this._health?.version || '';

    return html`
      <div class="topbar">
        <button
          class="hamburger ${this._mobileMenuOpen ? 'open' : ''}"
          @click=${this._toggleMobile}
          aria-label="Toggle navigation menu"
          aria-expanded=${this._mobileMenuOpen}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div class="brand">OASIS</div>

        <div class="spacer"></div>

        <div class="indicators">
          <!-- Gateway status -->
          <div class="indicator">
            <div class="dot ${gateway === 'online' ? 'online' : gateway === 'offline' ? 'offline' : 'unknown'}"></div>
            <span class="label">Gateway</span>
            <span class="value">${gateway}</span>
          </div>

          <div class="divider"></div>

          <!-- Sessions -->
          <div class="indicator sessions">
            <span class="label">Sessions</span>
            <span class="value">${sessions}</span>
          </div>

          <!-- Uptime -->
          ${uptime ? html`
            <div class="divider"></div>
            <div class="indicator uptime">
              <span class="label">Up</span>
              <span class="value">${uptime}</span>
            </div>
          ` : ''}

          <!-- WS status -->
          <div class="divider"></div>
          <div class="indicator">
            <div class="dot ${this._wsStatus === 'connected' ? 'online' : this._wsStatus === 'reconnecting' ? 'reconnecting' : 'offline'}"></div>
            <span class="label">WS</span>
          </div>

          ${version ? html`
            <div class="divider"></div>
            <div class="indicator">
              <span class="label">v</span>
              <span class="value">${version}</span>
            </div>
          ` : ''}

          <div class="divider"></div>
          <oasis-theme></oasis-theme>
        </div>
      </div>
    `;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _toggleMobile() {
    this._mobileMenuOpen = !this._mobileMenuOpen;
    this.dispatchEvent(new CustomEvent('toggle-sidebar', {
      bubbles: true,
      composed: true,
      detail: { open: this._mobileMenuOpen },
    }));
  }

  async _fetchHealth() {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        store.set('health', {
          gateway: data.status === 'ok' ? 'online' : 'offline',
          uptime: data.uptime || 0,
          sessions: typeof data.sessions === 'number' ? data.sessions : 0,
          version: data.version || '',
          agents: data.agents || 0,
          lastCheck: Date.now(),
          gatewayDetail: data.gateway || null,
        });
      } else {
        store.patch('health', { gateway: 'offline', lastCheck: Date.now() });
      }
    } catch {
      store.patch('health', { gateway: 'offline', lastCheck: Date.now() });
    }
  }

  _formatUptime(seconds) {
    if (!seconds || seconds < 1) {return '';}
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {return `${h}h ${m}m`;}
    if (m > 0) {return `${m}m ${s}s`;}
    return `${s}s`;
  }
}

customElements.define('oasis-topbar', OasisTopbar);
