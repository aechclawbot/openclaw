/**
 * OASIS Dashboard — Root App Shell
 * Renders the full SPA: sidebar + topbar + lazy-loaded page content.
 * Manages mobile sidebar state and route-based page switching.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { router } from '/app/router.js';
import { store } from '/app/store.js';
// Import shared components so they register globally
import '/components/shared/oasis-toast.js';
// Shell components
import './oasis-sidebar.js';
import './oasis-topbar.js';

/**
 * Route → page component file mapping.
 * Dynamic imports enable code splitting (load only what's needed).
 * Pages live under /components/pages/ (flat structure).
 */
const PAGE_MAP = {
  '/':              () => import('/components/pages/page-home.js').then(() => 'page-home'),
  '/agents':        () => import('/components/pages/page-agents.js').then(() => 'page-agents'),
  '/agents/:id':    () => import('/components/pages/page-agents.js').then(() => 'page-agents'),
  '/chat':          () => import('/components/pages/page-chat.js').then(() => 'page-chat'),
  '/chat/:agentId': () => import('/components/pages/page-chat.js').then(() => 'page-chat'),
  '/operations':    () => import('/components/pages/page-operations.js').then(() => 'page-operations'),
  '/knowledge':     () => import('/components/pages/page-knowledge.js').then(() => 'page-knowledge'),
  '/business':      () => import('/components/pages/page-business.js').then(() => 'page-business'),
  '/household':     () => import('/components/pages/page-household.js').then(() => 'page-household'),
  '/analytics':     () => import('/components/pages/page-analytics.js').then(() => 'page-analytics'),
  '/tools':         () => import('/components/pages/page-tools.js').then(() => 'page-tools'),
  '/spawn':         () => import('/components/pages/page-spawn.js').then(() => 'page-spawn'),
  '/settings':      () => import('/components/pages/page-settings.js').then(() => 'page-settings'),
};

/**
 * Match a path against a route pattern with :param support.
 * Returns { pattern, params } or null if no match.
 */
function matchRoute(path) {
  // Exact match first
  if (PAGE_MAP[path]) {return { pattern: path, params: {} };}

  // Parametric match
  for (const pattern of Object.keys(PAGE_MAP)) {
    if (!pattern.includes(':')) {continue;}
    const regexStr = pattern.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, '([^/]+)');
    const re = new RegExp(`^${regexStr}$`);
    const m = path.match(re);
    if (m) {
      // Extract param names and values
      const keys = [...pattern.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(x => x[1]);
      const params = {};
      keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { pattern, params };
    }
  }

  return null;
}

export class OasisApp extends LitElement {
  static properties = {
    _sidebarOpen: { type: Boolean, state: true },
    _currentTag: { type: String, state: true },
    _loading: { type: Boolean, state: true },
    _loadError: { type: String, state: true },
    _params: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      height: 100vh;
      overflow: hidden;
      background: var(--bg);
    }

    /* Sidebar wrapper — fixed width on desktop, slide-in on mobile */
    .sidebar-wrapper {
      width: var(--sidebar-width);
      flex-shrink: 0;
      height: 100vh;
      position: relative;
      z-index: 100;
      transition: transform var(--transition);
    }

    oasis-sidebar {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    /* Right side: topbar + page area */
    .main-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    /* Page content area */
    .page-area {
      flex: 1;
      overflow-y: auto;
      position: relative;
    }

    /* Overlay (mobile sidebar backdrop) */
    .overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: var(--overlay);
      z-index: 99;
      animation: fadeIn 200ms ease;
    }

    .overlay.visible {
      display: block;
    }

    /* Loading spinner for lazy-loaded pages */
    .page-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 300px;
      gap: 1rem;
      color: var(--text-dim);
      font-size: var(--font-size-sm);
      font-family: var(--font-mono);
    }

    .spinner {
      width: 2.5rem;
      height: 2.5rem;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    /* Error state for failed page loads */
    .page-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 300px;
      gap: 1rem;
      color: var(--text-dim);
      font-size: var(--font-size-sm);
      padding: 2rem;
      text-align: center;
    }

    .page-error .error-icon {
      font-size: 2.5rem;
    }

    .page-error .error-msg {
      color: var(--red);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      max-width: 400px;
    }

    .page-error button {
      padding: 0.5rem 1rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      cursor: pointer;
      font-size: var(--font-size-sm);
      transition: background var(--transition-fast);
    }

    .page-error button:hover {
      background: var(--surface-3);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* Mobile layout */
    @media (max-width: 768px) {
      .sidebar-wrapper {
        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        transform: translateX(-100%);
        z-index: 200;
        box-shadow: var(--shadow-lg);
        background: var(--sidebar-bg);
      }

      .sidebar-wrapper.open {
        transform: translateX(0);
      }
    }
  `;

  constructor() {
    super();
    this._sidebarOpen = false;
    this._currentTag = null;
    this._loading = false;
    this._params = {};
    this._loadError = null;
  }

  connectedCallback() {
    super.connectedCallback();

    // Listen to route changes and load the appropriate page
    this._routeUnsub = router.onChange((path) => {
      this._loadPage(path);
      // Sync route params to store
      const match = matchRoute(path);
      store.set('route', { path, params: match?.params || {} });
    });

    // Mobile sidebar: close when sidebar emits 'close'
    this._onClose = () => { this._sidebarOpen = false; };
    this.addEventListener('close', this._onClose);

    // Topbar hamburger toggle
    this._onToggleSidebar = (e) => {
      this._sidebarOpen = e.detail?.open ?? !this._sidebarOpen;
    };
    this.addEventListener('toggle-sidebar', this._onToggleSidebar);

    // Load page for current route — read hash directly as fallback since
    // DOMContentLoaded may not have fired yet when the component connects
    const hash = window.location.hash;
    const initialPath = router.current || (hash && hash !== '#' ? hash.slice(1) : '/');
    this._loadPage(initialPath);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._routeUnsub) { this._routeUnsub(); this._routeUnsub = null; }
    this.removeEventListener('close', this._onClose);
    this.removeEventListener('toggle-sidebar', this._onToggleSidebar);
  }

  render() {
    return html`
      <!-- Mobile overlay backdrop -->
      <div
        class="overlay ${this._sidebarOpen ? 'visible' : ''}"
        @click=${this._closeSidebar}
        aria-hidden="true"
      ></div>

      <!-- Sidebar -->
      <div class="sidebar-wrapper ${this._sidebarOpen ? 'open' : ''}">
        <oasis-sidebar></oasis-sidebar>
      </div>

      <!-- Main content area -->
      <div class="main-wrapper">
        <oasis-topbar></oasis-topbar>

        <main class="page-area" id="main-content" tabindex="-1">
          ${this._renderPageContent()}
        </main>
      </div>

      <!-- Toast container (registered globally) -->
      <oasis-toast></oasis-toast>
    `;
  }

  _renderPageContent() {
    if (this._loading) {
      return html`
        <div class="page-loading">
          <div class="spinner"></div>
          <span>Loading...</span>
        </div>
      `;
    }

    if (this._loadError) {
      return html`
        <div class="page-error">
          <div class="error-icon">⚠️</div>
          <div>Failed to load page</div>
          <div class="error-msg">${this._loadError}</div>
          <button @click=${() => this._loadPage(router.current)}>Retry</button>
        </div>
      `;
    }

    if (this._currentTag) {
      // Render the loaded page component, passing route params as properties
      // Lit can render DOM nodes directly — we cache the element and update params
      if (!this._pageEl || this._pageEl.tagName.toLowerCase() !== this._currentTag) {
        this._pageEl = document.createElement(this._currentTag);
      }
      if (this._params && typeof this._params === 'object') {
        for (const [k, v] of Object.entries(this._params)) {
          try { this._pageEl[k] = v; } catch {}
        }
      }
      return html`<div style="height:100%">${this._pageEl}</div>`;
    }

    return html`
      <div class="page-loading">
        <div class="spinner"></div>
      </div>
    `;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  async _loadPage(path) {
    const match = matchRoute(path);

    if (!match) {
      // No matching route: show 404-style page or redirect home
      console.warn(`[App] no page for path: ${path}`);
      this._currentTag = null;
      this._loading = false;
      this._loadError = `Page not found: ${path}`;
      return;
    }

    this._loadError = null;
    this._params = match.params;

    try {
      const tag = await PAGE_MAP[match.pattern]();

      // Reuse existing page element if same component type —
      // sub-route changes (e.g. /chat/oasis → /chat/aech) are
      // handled by the page's own route listeners, no need to recreate.
      if (tag === this._currentTag && this._pageEl) {
        return;
      }

      this._loading = true;
      this._pageEl = null;
      this.requestUpdate();
      this._currentTag = tag;
    } catch (err) {
      console.error('[App] failed to load page:', err);
      this._currentTag = null;
      this._loadError = err.message || 'Failed to load page';
    } finally {
      this._loading = false;
    }
  }

  _closeSidebar() {
    this._sidebarOpen = false;
  }

  // Override to use light DOM for global CSS
  createRenderRoot() {
    // Use shadow DOM but inherit CSS custom properties
    return super.createRenderRoot();
  }
}

customElements.define('oasis-app', OasisApp);
