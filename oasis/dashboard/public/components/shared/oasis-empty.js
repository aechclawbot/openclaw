/**
 * OASIS Dashboard — Empty State Placeholder
 * Centered empty state with emoji icon, message, and optional action button.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

export class OasisEmpty extends LitElement {
  static properties = {
    icon: { type: String },
    message: { type: String },
    action: { type: String }, // Optional button label
    description: { type: String }, // Optional sub-description
  };

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 3rem 2rem;
      gap: 0.75rem;
      max-width: 360px;
    }

    .empty-icon {
      font-size: 3rem;
      line-height: 1;
      user-select: none;
      filter: grayscale(20%);
      margin-bottom: 0.25rem;
    }

    .empty-message {
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--text-dim);
    }

    .empty-description {
      font-size: var(--font-size-sm);
      color: var(--text-muted);
      line-height: 1.5;
    }

    .empty-action {
      margin-top: 0.5rem;
      padding: 0.5rem 1.25rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text-dim);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition:
        background var(--transition-fast),
        color var(--transition-fast),
        border-color var(--transition-fast);
    }

    .empty-action:hover {
      background: var(--surface-3);
      color: var(--text);
      border-color: var(--accent);
    }

    .empty-action:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    /* Slot for custom additional content */
    .empty-slot {
      margin-top: 0.5rem;
    }
  `;

  constructor() {
    super();
    this.icon = '📭';
    this.message = 'Nothing here yet';
    this.action = '';
    this.description = '';
  }

  render() {
    return html`
      <div class="empty-state" role="status" aria-label=${this.message}>
        <div class="empty-icon" aria-hidden="true">${this.icon}</div>
        <div class="empty-message">${this.message}</div>
        ${this.description ? html`
          <div class="empty-description">${this.description}</div>
        ` : ''}
        ${this.action ? html`
          <button class="empty-action" @click=${this._onAction}>
            ${this.action}
          </button>
        ` : ''}
        <div class="empty-slot">
          <slot></slot>
        </div>
      </div>
    `;
  }

  _onAction() {
    this.dispatchEvent(new CustomEvent('action', {
      bubbles: true,
      composed: true,
    }));
  }
}

customElements.define('oasis-empty', OasisEmpty);
