/**
 * OASIS Dashboard — Card
 * Surface-colored card with optional hover accent and selected state.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

export class OasisCard extends LitElement {
  static properties = {
    clickable: { type: Boolean, reflect: true },
    selected: { type: Boolean, reflect: true },
    accent: { type: String }, // optional: 'green' | 'red' | 'yellow' | 'purple' etc.
    padding: { type: String }, // 'sm' | 'md' (default) | 'lg' | 'none'
  };

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 1.25rem;
      transition:
        border-color var(--transition),
        box-shadow var(--transition),
        background var(--transition);
      position: relative;
      overflow: hidden;
    }

    /* Padding variants */
    :host([padding="none"]) .card { padding: 0; }
    :host([padding="sm"]) .card { padding: 0.75rem; }
    :host([padding="lg"]) .card { padding: 1.75rem; }

    /* Clickable */
    :host([clickable]) .card {
      cursor: pointer;
      user-select: none;
    }

    :host([clickable]) .card:hover {
      border-color: var(--accent);
      box-shadow: var(--shadow-glow);
      background: var(--surface-2);
    }

    :host([clickable]) .card:active {
      background: var(--surface-3);
    }

    :host([clickable]) .card:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    /* Selected */
    :host([selected]) .card {
      border-color: var(--accent);
      background: var(--accent-dim);
      box-shadow: var(--shadow-glow);
    }

    /* Accent color stripe variants */
    :host([accent="green"]) .card { border-left: 3px solid var(--green); }
    :host([accent="red"]) .card { border-left: 3px solid var(--red); }
    :host([accent="yellow"]) .card { border-left: 3px solid var(--yellow); }
    :host([accent="orange"]) .card { border-left: 3px solid var(--orange); }
    :host([accent="purple"]) .card { border-left: 3px solid var(--purple); }
    :host([accent="blue"]) .card { border-left: 3px solid var(--blue); }
    :host([accent="accent"]) .card { border-left: 3px solid var(--accent); }
  `;

  constructor() {
    super();
    this.clickable = false;
    this.selected = false;
    this.padding = 'md';
  }

  render() {
    return html`
      <div
        class="card"
        role=${this.clickable ? 'button' : 'presentation'}
        tabindex=${this.clickable ? '0' : '-1'}
        @keydown=${this._onKeyDown}
        @click=${this._onClick}
      >
        <slot></slot>
      </div>
    `;
  }

  _onClick(e) {
    if (this.clickable) {
      this.dispatchEvent(new CustomEvent('card-click', {
        bubbles: true,
        composed: true,
        detail: { originalEvent: e },
      }));
    }
  }

  _onKeyDown(e) {
    if (this.clickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this._onClick(e);
    }
  }
}

customElements.define('oasis-card', OasisCard);
