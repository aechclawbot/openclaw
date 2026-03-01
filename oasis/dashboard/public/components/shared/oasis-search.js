/**
 * OASIS Dashboard — Search Input
 * Debounced search input with clear button.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

export class OasisSearch extends LitElement {
  static properties = {
    placeholder: { type: String },
    delay: { type: Number },
    value: { type: String },
    disabled: { type: Boolean, reflect: true },
    _hasValue: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: block;
    }

    .search-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 0.75rem;
      color: var(--text-muted);
      font-size: 0.875rem;
      pointer-events: none;
      flex-shrink: 0;
    }

    input {
      width: 100%;
      padding: 0.5rem 2.25rem 0.5rem 2.25rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-size: var(--font-size-sm);
      font-family: var(--font-sans);
      transition:
        border-color var(--transition-fast),
        background var(--transition-fast);
      outline: none;
    }

    input:focus {
      border-color: var(--accent);
      background: var(--surface-3);
    }

    input::placeholder {
      color: var(--text-muted);
    }

    input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .clear-btn {
      position: absolute;
      right: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: var(--radius-sm);
      background: var(--surface-3);
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 0.7rem;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .clear-btn:hover {
      background: var(--border);
      color: var(--text);
    }

    .clear-btn:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 1px;
    }

    .clear-btn[hidden] {
      display: none;
    }
  `;

  constructor() {
    super();
    this.placeholder = 'Search...';
    this.delay = 300;
    this.value = '';
    this.disabled = false;
    this._hasValue = false;
    this._debounceTimer = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._debounceTimer);
  }

  render() {
    return html`
      <div class="search-wrap">
        <span class="search-icon" aria-hidden="true">🔍</span>
        <input
          type="search"
          .value=${this.value}
          placeholder=${this.placeholder}
          ?disabled=${this.disabled}
          @input=${this._onInput}
          @keydown=${this._onKeyDown}
          aria-label=${this.placeholder}
          autocomplete="off"
          spellcheck="false"
        >
        <button
          class="clear-btn"
          ?hidden=${!this._hasValue}
          @click=${this._clear}
          aria-label="Clear search"
          tabindex=${this._hasValue ? '0' : '-1'}
        >✕</button>
      </div>
    `;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Programmatically clear the search input */
  clear() {
    this._clear();
  }

  /** Focus the input */
  focus() {
    this.shadowRoot?.querySelector('input')?.focus();
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _onInput(e) {
    const val = e.target.value;
    this.value = val;
    this._hasValue = val.length > 0;

    // Debounce the search event
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.dispatchEvent(new CustomEvent('search', {
        detail: { query: val },
        bubbles: true,
        composed: true,
      }));
    }, this.delay);
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      this._clear();
    } else if (e.key === 'Enter') {
      // Immediate dispatch on Enter (no debounce wait)
      clearTimeout(this._debounceTimer);
      this.dispatchEvent(new CustomEvent('search', {
        detail: { query: this.value },
        bubbles: true,
        composed: true,
      }));
    }
  }

  _clear() {
    this.value = '';
    this._hasValue = false;
    clearTimeout(this._debounceTimer);

    const input = this.shadowRoot?.querySelector('input');
    if (input) {
      input.value = '';
      input.focus();
    }

    this.dispatchEvent(new CustomEvent('search', {
      detail: { query: '' },
      bubbles: true,
      composed: true,
    }));
    this.dispatchEvent(new CustomEvent('clear', {
      bubbles: true,
      composed: true,
    }));
  }
}

customElements.define('oasis-search', OasisSearch);
