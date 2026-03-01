/**
 * OASIS Dashboard — Theme Toggle
 * Manages dark/light theme preference with localStorage persistence.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

const STORAGE_KEY = 'oasis-theme';
const THEMES = { DARK: 'dark', LIGHT: 'light' };

export class OasisTheme extends LitElement {
  static properties = {
    _theme: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: var(--radius);
      background: transparent;
      border: 1px solid var(--border);
      cursor: pointer;
      color: var(--text-dim);
      font-size: 1rem;
      transition:
        background var(--transition-fast),
        color var(--transition-fast),
        border-color var(--transition-fast);
      user-select: none;
    }

    button:hover {
      background: var(--surface-2);
      color: var(--text);
      border-color: var(--accent);
    }

    button:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }
  `;

  constructor() {
    super();
    this._theme = this._readStoredTheme();
    this._applyTheme(this._theme);
  }

  connectedCallback() {
    super.connectedCallback();
    // Sync if another tab changes the theme
    window.addEventListener('storage', this._onStorage);
    // Listen for OS theme changes at runtime
    this._mql = window.matchMedia('(prefers-color-scheme: dark)');
    this._onSystemThemeChange = (e) => {
      // Only follow OS if user hasn't manually set a preference
      if (!localStorage.getItem(STORAGE_KEY)) {
        this._setTheme(e.matches ? THEMES.DARK : THEMES.LIGHT);
      }
    };
    this._mql.addEventListener('change', this._onSystemThemeChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('storage', this._onStorage);
    if (this._mql) {this._mql.removeEventListener('change', this._onSystemThemeChange);}
  }

  render() {
    const isDark = this._theme === THEMES.DARK;
    return html`
      <button
        @click=${this._toggle}
        aria-label=${isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title=${isDark ? 'Light mode' : 'Dark mode'}
      >
        ${isDark ? '☀️' : '🌙'}
      </button>
    `;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _toggle() {
    const next = this._theme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
    this._setTheme(next);
  }

  _setTheme(theme) {
    // Add transition class for smooth color swap
    document.documentElement.classList.add('theme-transitioning');

    this._theme = theme;
    this._applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);

    // Remove transition class after animation completes
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 350);

    this.dispatchEvent(new CustomEvent('theme-change', {
      detail: { theme },
      bubbles: true,
      composed: true,
    }));
  }

  _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Update theme-color meta for browser chrome
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {meta.content = theme === THEMES.DARK ? '#0a0a0f' : '#ffffff';}
  }

  _readStoredTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === THEMES.LIGHT || stored === THEMES.DARK) {return stored;}
    // Respect system preference as default
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? THEMES.DARK : THEMES.LIGHT;
  }

  _onStorage = (ev) => {
    if (ev.key === STORAGE_KEY && ev.newValue) {
      this._theme = ev.newValue;
      this._applyTheme(ev.newValue);
    }
  };
}

customElements.define('oasis-theme', OasisTheme);
