/**
 * OASIS Dashboard — Status Badge
 * Color-coded badge for displaying status values.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

export class OasisBadge extends LitElement {
  static properties = {
    type: { type: String }, // 'ok' | 'warning' | 'error' | 'info' | 'neutral'
    text: { type: String },
    dot: { type: Boolean }, // show dot indicator
    size: { type: String }, // 'sm' | 'md' (default)
  };

  static styles = css`
    :host {
      display: inline-flex;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.2rem 0.55rem;
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      font-weight: 600;
      letter-spacing: 0.03em;
      white-space: nowrap;
      border: 1px solid transparent;
      line-height: 1.4;
    }

    :host([size="sm"]) .badge {
      padding: 0.1rem 0.4rem;
      font-size: 0.67rem;
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* Type variants */
    .badge.ok {
      background: var(--green-dim);
      color: var(--green);
      border-color: rgba(34, 197, 94, 0.25);
    }
    .badge.ok .dot { background: var(--green); }

    .badge.warning {
      background: var(--yellow-dim);
      color: var(--yellow);
      border-color: rgba(234, 179, 8, 0.25);
    }
    .badge.warning .dot { background: var(--yellow); }

    .badge.error {
      background: var(--red-dim);
      color: var(--red);
      border-color: rgba(239, 68, 68, 0.25);
    }
    .badge.error .dot { background: var(--red); }

    .badge.info {
      background: var(--blue-dim);
      color: var(--blue);
      border-color: rgba(59, 130, 246, 0.25);
    }
    .badge.info .dot { background: var(--blue); }

    .badge.neutral {
      background: var(--surface-3);
      color: var(--text-dim);
      border-color: var(--border);
    }
    .badge.neutral .dot { background: var(--text-muted); }

    .badge.purple {
      background: var(--purple-dim);
      color: var(--purple);
      border-color: rgba(168, 85, 247, 0.25);
    }
    .badge.purple .dot { background: var(--purple); }

    .badge.orange {
      background: var(--orange-dim);
      color: var(--orange);
      border-color: rgba(249, 115, 22, 0.25);
    }
    .badge.orange .dot { background: var(--orange); }
  `;

  constructor() {
    super();
    this.type = 'neutral';
    this.text = '';
    this.dot = false;
    this.size = 'md';
  }

  render() {
    const resolvedType = this._resolveType(this.type);
    return html`
      <span class="badge ${resolvedType}">
        ${this.dot ? html`<span class="dot"></span>` : ''}
        ${this.text || html`<slot></slot>`}
      </span>
    `;
  }

  /** Normalize common aliases to badge type names */
  _resolveType(type) {
    const map = {
      success: 'ok',
      online: 'ok',
      active: 'ok',
      running: 'ok',
      healthy: 'ok',
      warn: 'warning',
      pending: 'warning',
      idle: 'warning',
      offline: 'error',
      failed: 'error',
      stopped: 'error',
      dead: 'error',
      unknown: 'neutral',
      disabled: 'neutral',
      muted: 'neutral',
    };
    return map[type] || type || 'neutral';
  }
}

customElements.define('oasis-badge', OasisBadge);
