/**
 * OASIS Dashboard — Modal Dialog
 * Accessible modal with focus trap, Escape key, and backdrop click-to-close.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

export class OasisModal extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    title: { type: String },
    size: { type: String }, // 'sm' | 'md' | 'lg' | 'xl'
    closable: { type: Boolean },
  };

  static styles = css`
    :host {
      display: none;
    }

    :host([open]) {
      display: block;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: var(--overlay);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      animation: fadeIn 150ms ease;
    }

    .modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      max-height: 80vh;
      width: 100%;
      animation: scaleIn 150ms ease;
      position: relative;
    }

    .modal.sm { max-width: 400px; }
    .modal.md { max-width: 560px; }
    .modal.lg { max-width: 720px; }
    .modal.xl { max-width: 960px; }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem 1rem;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .modal-title {
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--text);
      margin: 0;
    }

    .close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius);
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 1.1rem;
      transition: background var(--transition-fast), color var(--transition-fast);
      flex-shrink: 0;
    }

    .close-btn:hover {
      background: var(--surface-2);
      color: var(--text);
    }

    .close-btn:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.25rem 1.5rem;
    }

    .modal-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }

    /* Footer slot is hidden if empty */
    .modal-footer:empty,
    .modal-footer slot:not([name])::slotted(*):only-child {
      display: none;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scaleIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    @media (max-width: 480px) {
      .backdrop {
        padding: 0.5rem;
        align-items: flex-end;
      }

      .modal {
        max-height: 90vh;
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
      }
    }
  `;

  constructor() {
    super();
    this.open = false;
    this.title = '';
    this.size = 'md';
    this.closable = true;
    this._focusableSelector = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onKeyDown);
    this._restoreScroll();
  }

  updated(changed) {
    if (changed.has('open')) {
      if (this.open) {
        document.addEventListener('keydown', this._onKeyDown);
        this._lockScroll();
        // Focus first focusable element after render
        requestAnimationFrame(() => this._focusFirst());
      } else {
        document.removeEventListener('keydown', this._onKeyDown);
        this._restoreScroll();
        this._returnFocus();
      }
    }
  }

  render() {
    if (!this.open) {return html``;}

    return html`
      <div
        class="backdrop"
        @click=${this._onBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-label=${this.title || 'Dialog'}
      >
        <div
          class="modal ${this.size}"
          @click=${(e) => e.stopPropagation()}
          role="document"
        >
          ${this.title || this.closable ? html`
            <div class="modal-header">
              ${this.title ? html`<h2 class="modal-title">${this.title}</h2>` : html`<div></div>`}
              ${this.closable ? html`
                <button class="close-btn" @click=${this._close} aria-label="Close dialog">
                  ✕
                </button>
              ` : ''}
            </div>
          ` : ''}

          <div class="modal-body">
            <slot></slot>
          </div>

          <div class="modal-footer">
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Close the modal */
  close() {
    this._close();
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _close() {
    if (!this.closable) {return;}
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _onBackdropClick() {
    if (this.closable) {this._close();}
  }

  _handleKeyDown(e) {
    if (!this.open) {return;}
    if (e.key === 'Escape' && this.closable) {
      e.preventDefault();
      this._close();
      return;
    }
    if (e.key === 'Tab') {
      this._trapFocus(e);
    }
  }

  _trapFocus(e) {
    const focusable = this._getFocusable();
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || this.shadowRoot?.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || this.shadowRoot?.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  _focusFirst() {
    const focusable = this._getFocusable();
    if (focusable.length > 0) {
      // Store the element that had focus before the modal opened
      this._previousFocus = document.activeElement;
      focusable[0].focus();
    }
  }

  _returnFocus() {
    if (this._previousFocus && typeof this._previousFocus.focus === 'function') {
      this._previousFocus.focus();
      this._previousFocus = null;
    }
  }

  _getFocusable() {
    const root = this.shadowRoot || this;
    const container = root.querySelector('.modal');
    if (!container) {return [];}
    return [...container.querySelectorAll(this._focusableSelector)].filter(
      el => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none'
    );
  }

  _lockScroll() {
    this._scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
  }

  _restoreScroll() {
    document.body.style.overflow = '';
  }
}

customElements.define('oasis-modal', OasisModal);
