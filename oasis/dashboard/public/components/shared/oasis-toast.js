/**
 * OASIS Dashboard — Toast Notification Manager
 * Singleton component that renders stacked toast messages.
 * Exposes global window.__oasisToast() for non-Lit code.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

const ICONS = {
  ok: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const AUTO_DISMISS_MS = 4000;

let _instance = null;

export class OasisToast extends LitElement {
  static properties = {
    _toasts: { type: Array, state: true },
  };

  static styles = css`
    :host {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.625rem;
      pointer-events: none;
      max-width: 360px;
      width: calc(100vw - 2rem);
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: 0.625rem;
      padding: 0.75rem 1rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      pointer-events: all;
      cursor: pointer;
      animation: slideInRight 250ms ease;
      transition: opacity 300ms ease, transform 300ms ease;
      position: relative;
      overflow: hidden;
      min-width: 240px;
    }

    .toast.dismissing {
      opacity: 0;
      transform: translateX(110%);
    }

    .toast-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .toast.ok .toast-icon {
      background: var(--green-dim);
      color: var(--green);
      border: 1px solid var(--green);
    }

    .toast.error .toast-icon {
      background: var(--red-dim);
      color: var(--red);
      border: 1px solid var(--red);
    }

    .toast.warning .toast-icon {
      background: var(--yellow-dim);
      color: var(--yellow);
      border: 1px solid var(--yellow);
    }

    .toast.info .toast-icon {
      background: var(--blue-dim);
      color: var(--blue);
      border: 1px solid var(--blue);
    }

    .toast-body {
      flex: 1;
      min-width: 0;
    }

    .toast-msg {
      font-size: var(--font-size-sm);
      color: var(--text);
      line-height: 1.4;
      word-break: break-word;
    }

    .toast-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      font-size: 0.75rem;
      flex-shrink: 0;
      cursor: pointer;
      transition: color var(--transition-fast), background var(--transition-fast);
      border: none;
      background: none;
    }

    .toast-close:hover {
      color: var(--text);
      background: var(--surface-3);
    }

    /* Accent bar on left edge */
    .toast::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
    }

    .toast.ok::before { background: var(--green); }
    .toast.error::before { background: var(--red); }
    .toast.warning::before { background: var(--yellow); }
    .toast.info::before { background: var(--blue); }

    @keyframes slideInRight {
      from { transform: translateX(110%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    @media (max-width: 480px) {
      :host {
        bottom: 1rem;
        right: 0.5rem;
        left: 0.5rem;
        width: auto;
        max-width: none;
      }
    }
  `;

  constructor() {
    super();
    this._toasts = [];
    this._counter = 0;
    this._timers = new Set();

    // Register as global singleton
    _instance = this;

    // Expose global API for non-Lit consumers
    window.__oasisToast = (msg, type = 'info') => this.show(msg, type);

    // Flush any queued toasts from before this component was mounted
    if (window.__oasisToastQueue?.length) {
      for (const { msg, type } of window.__oasisToastQueue) {
        this.show(msg, type);
      }
      window.__oasisToastQueue = [];
    }
  }

  render() {
    return html`
      ${this._toasts.map(t => html`
        <div
          class="toast ${t.type} ${t.dismissing ? 'dismissing' : ''}"
          role="alert"
          aria-live="assertive"
          @click=${() => this._dismiss(t.id)}
        >
          <div class="toast-icon" aria-hidden="true">${ICONS[t.type] || ICONS.info}</div>
          <div class="toast-body">
            <div class="toast-msg">${t.msg}</div>
          </div>
          <button
            class="toast-close"
            @click=${(e) => { e.stopPropagation(); this._dismiss(t.id); }}
            aria-label="Dismiss notification"
          >✕</button>
        </div>
      `)}
    `;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Show a toast notification.
   * @param {string} msg — message text
   * @param {'ok'|'error'|'warning'|'info'} type
   * @param {number} [duration] — ms before auto-dismiss (default 4000, 0 = persistent)
   */
  show(msg, type = 'info', duration = AUTO_DISMISS_MS) {
    const id = ++this._counter;
    const toast = { id, msg, type: this._normalizeType(type), dismissing: false };
    this._toasts = [...this._toasts, toast];

    if (duration > 0) {
      const tid = setTimeout(() => { this._timers.delete(tid); this._dismiss(id); }, duration);
      this._timers.add(tid);
    }

    return id;
  }

  /**
   * Dismiss a toast by id.
   * @param {number} id
   */
  dismiss(id) {
    this._dismiss(id);
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _dismiss(id) {
    // Trigger dismissing animation first
    this._toasts = this._toasts.map(t =>
      t.id === id ? { ...t, dismissing: true } : t
    );
    // Remove after animation completes
    const tid = setTimeout(() => { this._timers.delete(tid); this._toasts = this._toasts.filter(t => t.id !== id); }, 310);
    this._timers.add(tid);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const tid of this._timers) {clearTimeout(tid);}
    this._timers.clear();
  }

  _normalizeType(type) {
    const valid = { ok: 'ok', success: 'ok', error: 'error', warning: 'warning', warn: 'warning', info: 'info' };
    return valid[type] || 'info';
  }
}

customElements.define('oasis-toast', OasisToast);

/**
 * Convenience helper — can be imported directly:
 * import { showToast } from '/components/shared/oasis-toast.js';
 * showToast('Saved!', 'ok');
 */
export function showToast(msg, type = 'info', duration) {
  if (window.__oasisToast) {
    window.__oasisToast(msg, type, duration);
  } else {
    if (!window.__oasisToastQueue) {window.__oasisToastQueue = [];}
    window.__oasisToastQueue.push({ msg, type });
  }
}
