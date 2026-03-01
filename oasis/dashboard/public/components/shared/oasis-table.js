/**
 * OASIS Dashboard — Data Table
 * Responsive sortable table with hover highlighting.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

export class OasisTable extends LitElement {
  static properties = {
    columns: { type: Array }, // Array of { key, label, width?, sortable?, render?: (row) => html }
    data: { type: Array },
    sortable: { type: Boolean },
    _sortKey: { type: String, state: true },
    _sortDir: { type: String, state: true }, // 'asc' | 'desc'
    emptyMessage: { type: String },
    loading: { type: Boolean },
  };

  static styles = css`
    :host {
      display: block;
    }

    .table-wrap {
      overflow-x: auto;
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--font-size-sm);
    }

    thead {
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
    }

    th {
      padding: 0.625rem 1rem;
      text-align: left;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-muted);
      white-space: nowrap;
    }

    th.sortable-col {
      cursor: pointer;
      user-select: none;
      transition: color var(--transition-fast);
    }

    th.sortable-col:hover {
      color: var(--text-dim);
    }

    th.sorted {
      color: var(--accent);
    }

    .sort-indicator {
      margin-left: 0.3rem;
      opacity: 0.8;
      font-size: 0.6rem;
      vertical-align: middle;
    }

    tbody tr {
      border-bottom: 1px solid var(--border);
      transition: background var(--transition-fast);
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    tbody tr:hover {
      background: var(--surface-2);
    }

    tbody tr:active {
      background: var(--surface-3);
    }

    td {
      padding: 0.75rem 1rem;
      color: var(--text);
      vertical-align: middle;
    }

    td.muted {
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
    }

    /* Empty state */
    .empty-row td {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-muted);
      font-size: var(--font-size-sm);
    }

    .empty-icon {
      font-size: 2rem;
      display: block;
      margin-bottom: 0.5rem;
    }

    /* Loading state */
    .loading-row td {
      text-align: center;
      padding: 2.5rem 1rem;
    }

    .spinner {
      display: inline-block;
      width: 1.5rem;
      height: 1.5rem;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Column width support */
    col[style] { /* width handled via inline style on <col> */ }
  `;

  constructor() {
    super();
    this.columns = [];
    this.data = [];
    this.sortable = false;
    this._sortKey = null;
    this._sortDir = 'asc';
    this.emptyMessage = 'No data available';
    this.loading = false;
  }

  render() {
    const sorted = this._getSortedData();

    return html`
      <div class="table-wrap">
        <table>
          <colgroup>
            ${this.columns.map(col => html`
              <col style=${col.width ? `width: ${col.width}` : ''}>
            `)}
          </colgroup>
          <thead>
            <tr>
              ${this.columns.map(col => this._renderHeader(col))}
            </tr>
          </thead>
          <tbody>
            ${this.loading
              ? html`
                <tr class="loading-row">
                  <td colspan=${this.columns.length}>
                    <div class="spinner"></div>
                  </td>
                </tr>
              `
              : sorted.length === 0
                ? html`
                  <tr class="empty-row">
                    <td colspan=${this.columns.length}>
                      <span class="empty-icon">📭</span>
                      ${this.emptyMessage}
                    </td>
                  </tr>
                `
                : sorted.map((row, i) => this._renderRow(row, i))
            }
          </tbody>
        </table>
      </div>
    `;
  }

  _renderHeader(col) {
    const isSortable = this.sortable && col.sortable !== false;
    const isSorted = this._sortKey === col.key;
    const indicator = isSorted ? (this._sortDir === 'asc' ? '▲' : '▼') : '⇕';

    return html`
      <th
        class="${isSortable ? 'sortable-col' : ''} ${isSorted ? 'sorted' : ''}"
        @click=${isSortable ? () => this._toggleSort(col.key) : null}
        aria-sort=${isSorted ? this._sortDir + 'ending' : 'none'}
        title=${isSortable ? `Sort by ${col.label}` : ''}
      >
        ${col.label}
        ${isSortable ? html`<span class="sort-indicator">${indicator}</span>` : ''}
      </th>
    `;
  }

  _renderRow(row, i) {
    return html`
      <tr
        @click=${() => this._onRowClick(row, i)}
        style="cursor: ${row.__clickable !== false ? 'pointer' : 'default'}"
      >
        ${this.columns.map(col => html`
          <td class=${col.muted ? 'muted' : ''}>
            ${col.render
              ? col.render(row, i)
              : this._getCellValue(row, col.key)
            }
          </td>
        `)}
      </tr>
    `;
  }

  _toggleSort(key) {
    if (this._sortKey === key) {
      this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this._sortKey = key;
      this._sortDir = 'asc';
    }
    this.dispatchEvent(new CustomEvent('sort-change', {
      detail: { key: this._sortKey, dir: this._sortDir },
      bubbles: true,
      composed: true,
    }));
  }

  _onRowClick(row, index) {
    this.dispatchEvent(new CustomEvent('row-click', {
      detail: { row, index },
      bubbles: true,
      composed: true,
    }));
  }

  _getSortedData() {
    if (!this.data?.length) {return [];}
    if (!this._sortKey) {return [...this.data];}

    return [...this.data].toSorted((a, b) => {
      const av = this._getCellValue(a, this._sortKey);
      const bv = this._getCellValue(b, this._sortKey);

      let cmp = 0;
      if (av == null && bv == null) {cmp = 0;}
      else if (av == null) {cmp = 1;}
      else if (bv == null) {cmp = -1;}
      else if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
      }

      return this._sortDir === 'asc' ? cmp : -cmp;
    });
  }

  _getCellValue(row, key) {
    // Support dot-notation: e.g. "user.name"
    if (!key) {return '';}
    return key.split('.').reduce((obj, k) => obj?.[k], row) ?? '';
  }
}

customElements.define('oasis-table', OasisTable);
