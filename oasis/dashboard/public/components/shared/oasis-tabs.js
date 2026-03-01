/**
 * OASIS Dashboard — Tab Container
 * Tab switcher with active indicator and slot-based content panels.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

export class OasisTabs extends LitElement {
  static properties = {
    tabs: { type: Array }, // Array of { id, label, icon?, badge? }
    active: { type: String },
  };

  static styles = css`
    :host {
      display: block;
    }

    .tabs-header {
      display: flex;
      border-bottom: 1px solid var(--border);
      gap: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .tabs-header::-webkit-scrollbar {
      display: none;
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.625rem 1.125rem;
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      white-space: nowrap;
      transition:
        color var(--transition-fast),
        border-color var(--transition-fast);
      position: relative;
    }

    .tab-btn:hover {
      color: var(--text-dim);
      background: var(--surface-2);
    }

    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    .tab-btn:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: -2px;
    }

    .tab-icon {
      font-size: 0.9rem;
    }

    .tab-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 0.3rem;
      background: var(--accent-dim);
      color: var(--accent);
      border-radius: var(--radius-full);
      font-size: 0.65rem;
      font-family: var(--font-mono);
      font-weight: 700;
    }

    .tab-badge.error {
      background: var(--red-dim);
      color: var(--red);
    }

    /* Tab panel content */
    .tabs-content {
      padding-top: 1rem;
    }

    /* Only show the active panel slot */
    ::slotted([slot]) {
      display: none;
    }
  `;

  constructor() {
    super();
    this.tabs = [];
    this.active = '';
  }

  updated(changed) {
    if (changed.has('active')) {
      this._updatePanelVisibility();
    }
    if (changed.has('tabs') && this.tabs?.length && !this.active) {
      // Auto-select first tab if none active
      this.active = this.tabs[0].id;
    }
  }

  render() {
    return html`
      <div class="tabs-header" role="tablist">
        ${(this.tabs || []).map(tab => html`
          <button
            class="tab-btn ${this.active === tab.id ? 'active' : ''}"
            role="tab"
            aria-selected=${this.active === tab.id}
            aria-controls="panel-${tab.id}"
            id="tab-${tab.id}"
            @click=${() => this._selectTab(tab.id)}
          >
            ${tab.icon ? html`<span class="tab-icon">${tab.icon}</span>` : ''}
            ${tab.label}
            ${tab.badge != null ? html`
              <span class="tab-badge ${tab.badgeType || ''}">${tab.badge}</span>
            ` : ''}
          </button>
        `)}
      </div>
      <div class="tabs-content">
        <slot></slot>
      </div>
    `;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _selectTab(id) {
    if (this.active === id) {return;}
    const old = this.active;
    this.active = id;
    this._updatePanelVisibility();
    this.dispatchEvent(new CustomEvent('tab-change', {
      detail: { id, previousId: old },
      bubbles: true,
      composed: true,
    }));
  }

  _updatePanelVisibility() {
    // Show/hide slotted panels by [slot="<tabId>"] attribute
    const panels = this.querySelectorAll('[slot]');
    panels.forEach(panel => {
      const isActive = panel.getAttribute('slot') === this.active;
      panel.style.display = isActive ? '' : 'none';
    });
  }
}

customElements.define('oasis-tabs', OasisTabs);
