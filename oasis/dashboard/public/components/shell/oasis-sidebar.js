/**
 * OASIS Dashboard — Navigation Sidebar
 * Navigation menu with route-based active state, mobile overlay support.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { router } from '/app/router.js';

const NAV_ITEMS = [
  { icon: '🏠', label: 'Home', path: '/' },
  { icon: '🤖', label: 'Agents', path: '/agents' },
  { icon: '💬', label: 'Chat', path: '/chat' },
  { icon: '⚙️', label: 'Operations', path: '/operations' },
  { icon: '📚', label: 'Knowledge', path: '/knowledge' },
  { icon: '💼', label: 'Business', path: '/business' },
  { icon: '🏡', label: 'Household', path: '/household' },
  { icon: '📊', label: 'Analytics', path: '/analytics' },
  { icon: '🔧', label: 'Tools', path: '/tools' },
  { icon: '➕', label: 'Spawn Agent', path: '/spawn' },
  { icon: '🎛️', label: 'Settings', path: '/settings' },
];

export class OasisSidebar extends LitElement {
  static properties = {
    _currentPath: { type: String, state: true },
    open: { type: Boolean, reflect: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: var(--sidebar-width);
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
      overflow: hidden;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1rem 0.5rem;
      flex-shrink: 0;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.625rem;
    }

    .logo-icon {
      width: 32px;
      height: 32px;
      background: var(--accent-dim);
      border: 1px solid var(--accent);
      border-radius: var(--radius);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
    }

    .logo-text {
      font-family: var(--font-mono);
      font-size: var(--font-size-md);
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.08em;
    }

    .close-btn {
      display: none;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm);
      color: var(--text-dim);
      cursor: pointer;
      font-size: 1.1rem;
      background: none;
      border: none;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .close-btn:hover {
      background: var(--surface-2);
      color: var(--text);
    }

    .nav-section {
      padding: 0.5rem 0.625rem;
      flex: 1;
      overflow-y: auto;
    }

    .nav-section-label {
      font-size: 0.67rem;
      font-family: var(--font-mono);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      padding: 0.75rem 0.5rem 0.375rem;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.5rem 0.75rem;
      border-radius: var(--radius);
      cursor: pointer;
      text-decoration: none;
      color: var(--text-dim);
      font-size: var(--font-size-sm);
      font-weight: 500;
      border-left: 2px solid transparent;
      transition:
        background var(--transition-fast),
        color var(--transition-fast),
        border-color var(--transition-fast);
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
    }

    .nav-item:hover {
      background: var(--sidebar-item-hover);
      color: var(--text);
    }

    .nav-item.active {
      background: var(--sidebar-item-active);
      color: var(--accent);
      border-left-color: var(--sidebar-item-active-border);
      font-weight: 600;
    }

    .nav-item:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: -2px;
    }

    .nav-icon {
      font-size: 1rem;
      flex-shrink: 0;
      width: 1.25rem;
      text-align: center;
    }

    .nav-label {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sidebar-footer {
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }

    .version-tag {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      text-align: center;
    }

    .version-tag span {
      color: var(--accent);
    }

    .nav-divider {
      height: 1px;
      background: var(--border);
      margin: 0.5rem 0.625rem;
    }

    /* Mobile: show close button */
    @media (max-width: 768px) {
      .close-btn {
        display: flex;
      }
    }
  `;

  constructor() {
    super();
    this._currentPath = router.current || '/';
    this.open = false;
  }

  connectedCallback() {
    super.connectedCallback();
    // Update active state on route changes
    this._routeListener = (path) => {
      this._currentPath = path;
    };
    this._routeUnsub = router.onChange(this._routeListener);
    // Set initial path
    this._currentPath = router.current || '/';
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._routeUnsub) {this._routeUnsub();}
  }

  render() {
    return html`
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon">🌊</div>
          <div class="logo-text">OASIS</div>
        </div>
        <button class="close-btn" @click=${this._closeMobile} aria-label="Close navigation">
          ✕
        </button>
      </div>

      <nav class="nav-section" role="navigation" aria-label="Main navigation">
        <div class="nav-section-label">Navigation</div>

        ${NAV_ITEMS.slice(0, 8).map(item => this._renderNavItem(item))}

        <div class="nav-divider"></div>
        <div class="nav-section-label">Config</div>

        ${NAV_ITEMS.slice(8).map(item => this._renderNavItem(item))}
      </nav>

      <div class="sidebar-footer">
        <div class="version-tag">OASIS <span>v3.0</span></div>
      </div>
    `;
  }

  _renderNavItem(item) {
    const isActive = this._isActive(item.path);
    return html`
      <a
        class="nav-item ${isActive ? 'active' : ''}"
        href="#${item.path}"
        @click=${(e) => this._onNavClick(e, item.path)}
        aria-current=${isActive ? 'page' : 'false'}
        title=${item.label}
      >
        <span class="nav-icon" aria-hidden="true">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </a>
    `;
  }

  _isActive(path) {
    if (path === '/') {return this._currentPath === '/';}
    // For non-root paths, also match sub-routes (e.g. /agents/oasis matches /agents)
    return this._currentPath === path || this._currentPath.startsWith(`${path}/`);
  }

  _onNavClick(e, path) {
    e.preventDefault();
    router.navigate(path);
    // Close mobile sidebar on navigation
    this._closeMobile();
  }

  _closeMobile() {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', {
      bubbles: true,
      composed: true,
    }));
  }
}

customElements.define('oasis-sidebar', OasisSidebar);
