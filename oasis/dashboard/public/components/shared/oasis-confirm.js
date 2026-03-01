/**
 * OASIS Dashboard — Confirmation Dialog
 * Programmatic confirm dialog that returns a Promise<boolean>.
 * Usage: const ok = await OasisConfirm.show({ title, message, confirmText, cancelText, destructive })
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

export class OasisConfirm extends LitElement {
  static properties = {
    _open: { type: Boolean, state: true },
    _config: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: contents;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: var(--overlay);
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      animation: fadeIn 150ms ease;
    }

    .dialog {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: 100%;
      max-width: 420px;
      animation: scaleIn 150ms ease;
      overflow: hidden;
    }

    .dialog-header {
      padding: 1.25rem 1.5rem 0.75rem;
    }

    .dialog-title {
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--text);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .dialog-title .destructive-icon {
      color: var(--red);
    }

    .dialog-body {
      padding: 0 1.5rem 1.25rem;
    }

    .dialog-message {
      font-size: var(--font-size-sm);
      color: var(--text-dim);
      line-height: 1.6;
    }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border);
      background: var(--surface-2);
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem 1.125rem;
      border-radius: var(--radius);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition:
        background var(--transition-fast),
        color var(--transition-fast),
        border-color var(--transition-fast);
    }

    .btn-cancel {
      background: var(--surface-3);
      color: var(--text-dim);
      border-color: var(--border);
    }

    .btn-cancel:hover {
      background: var(--surface-2);
      color: var(--text);
    }

    .btn-confirm {
      background: var(--accent);
      color: var(--bg);
      border-color: var(--accent);
      font-weight: 600;
    }

    .btn-confirm:hover {
      background: color-mix(in srgb, var(--accent) 80%, white 20%);
    }

    .btn-confirm.destructive {
      background: var(--red-dim);
      color: var(--red);
      border-color: var(--red);
    }

    .btn-confirm.destructive:hover {
      background: var(--red);
      color: white;
    }

    button:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scaleIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `;

  constructor() {
    super();
    this._open = false;
    this._config = null;
    this._resolve = null;
    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onKeyDown);
  }

  render() {
    if (!this._open || !this._config) {return html``;}

    const { title, message, confirmText = 'Confirm', cancelText = 'Cancel', destructive = false } = this._config;

    return html`
      <div class="backdrop" @click=${this._onBackdropClick}>
        <div class="dialog" @click=${(e) => e.stopPropagation()} role="alertdialog" aria-modal="true"
          aria-labelledby="confirm-title" aria-describedby="confirm-msg">
          <div class="dialog-header">
            <h2 class="dialog-title" id="confirm-title">
              ${destructive ? html`<span class="destructive-icon">⚠️</span>` : ''}
              ${title}
            </h2>
          </div>
          ${message ? html`
            <div class="dialog-body">
              <p class="dialog-message" id="confirm-msg">${message}</p>
            </div>
          ` : ''}
          <div class="dialog-footer">
            <button class="btn-cancel" @click=${() => this._resolve(false)}>
              ${cancelText}
            </button>
            <button
              class="btn-confirm ${destructive ? 'destructive' : ''}"
              @click=${() => this._resolve(true)}
              autofocus
            >
              ${confirmText}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Static API ──────────────────────────────────────────────────────────

  /**
   * Show a confirmation dialog and return a Promise<boolean>.
   * @param {{ title: string, message?: string, confirmText?: string, cancelText?: string, destructive?: boolean }} config
   * @returns {Promise<boolean>}
   */
  static show(config) {
    // Get or create the singleton instance mounted in the document
    let instance = document.querySelector('oasis-confirm');
    if (!instance) {
      instance = document.createElement('oasis-confirm');
      document.body.appendChild(instance);
    }
    return instance._showDialog(config);
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _showDialog(config) {
    this._config = config;
    this._open = true;
    document.addEventListener('keydown', this._onKeyDown);

    return new Promise((resolve) => {
      this._resolve = (result) => {
        document.removeEventListener('keydown', this._onKeyDown);
        this._open = false;
        this._config = null;
        this._resolve = null;
        resolve(result);
      };
    });
  }

  _onBackdropClick() {
    if (this._resolve) {this._resolve(false);}
  }

  _handleKeyDown(e) {
    if (!this._open) {return;}
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this._resolve) {this._resolve(false);}
    }
    if (e.key === 'Enter') {
      // Only confirm if the cancel button isn't focused
      const focused = this.shadowRoot?.activeElement;
      const cancelBtn = this.shadowRoot?.querySelector('.cancel-btn');
      if (focused === cancelBtn) {return;}
      e.preventDefault();
      if (this._resolve) {this._resolve(true);}
    }
  }
}

customElements.define('oasis-confirm', OasisConfirm);
