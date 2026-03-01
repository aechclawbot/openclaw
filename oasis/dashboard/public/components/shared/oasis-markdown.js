/**
 * OASIS Dashboard — Markdown Renderer
 * XSS-safe client-side markdown renderer. No external dependencies.
 * Supports: headings, bold, italic, code, pre, links, lists, blockquotes, HR, tables.
 * Blocks javascript:, data:, vbscript: URLs.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';

export class OasisMarkdown extends LitElement {
  static properties = {
    content: { type: String },
  };

  static styles = css`
    :host {
      display: block;
    }

    .md {
      color: var(--text);
      font-size: var(--font-size-sm);
      line-height: 1.7;
    }

    .md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
      color: var(--text);
      font-weight: 600;
      line-height: 1.3;
      margin-top: 1.25em;
      margin-bottom: 0.5em;
    }
    .md h1:first-child, .md h2:first-child, .md h3:first-child {
      margin-top: 0;
    }

    .md h1 { font-size: 1.5em; }
    .md h2 { font-size: 1.25em; }
    .md h3 { font-size: 1.1em; }
    .md h4, .md h5, .md h6 { font-size: 1em; color: var(--text-dim); }

    .md p {
      margin-bottom: 0.85em;
    }
    .md p:last-child { margin-bottom: 0; }

    .md a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .md a:hover {
      color: color-mix(in srgb, var(--accent) 80%, white 20%);
    }

    .md code {
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.1em 0.35em;
      font-family: var(--font-mono);
      font-size: 0.875em;
      color: var(--accent);
    }

    .md pre {
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      overflow-x: auto;
      margin-bottom: 1em;
    }

    .md pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: var(--font-size-sm);
      color: var(--text);
    }

    .md ul, .md ol {
      padding-left: 1.5em;
      margin-bottom: 0.85em;
    }
    .md ul { list-style: disc; }
    .md ol { list-style: decimal; }
    .md li { margin-bottom: 0.2em; }
    .md li > ul, .md li > ol { margin-bottom: 0; }

    .md blockquote {
      border-left: 3px solid var(--accent);
      padding: 0.5rem 1rem;
      margin: 0.75em 0;
      background: var(--accent-dim);
      border-radius: 0 var(--radius) var(--radius) 0;
      color: var(--text-dim);
    }

    .md blockquote p { margin-bottom: 0; }

    .md hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 1.25em 0;
    }

    .md table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1em;
      font-size: var(--font-size-sm);
    }

    .md th {
      background: var(--surface-2);
      padding: 0.5rem 0.75rem;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid var(--border);
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .md td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--border);
    }

    .md tr:last-child td { border-bottom: none; }

    .md strong { font-weight: 700; color: var(--text); }
    .md em { font-style: italic; color: var(--text-dim); }
    .md del { text-decoration: line-through; color: var(--text-muted); }

    /* Code syntax highlight classes (optional, for when pre.language-* is set) */
    .md .hljs-comment { color: var(--text-muted); }
    .md .hljs-string { color: var(--green); }
    .md .hljs-keyword { color: var(--purple); }
    .md .hljs-number { color: var(--orange); }
    .md .hljs-function { color: var(--accent); }
  `;

  constructor() {
    super();
    this.content = '';
  }

  render() {
    const safeHtml = this._render(this.content || '');
    return html`<div class="md" .innerHTML=${safeHtml}></div>`;
  }

  // ─── Markdown renderer ───────────────────────────────────────────────────

  _render(md) {
    if (!md) {return '';}

    let html = md;

    // 1. Escape HTML entities first to prevent XSS
    // (We re-add safe HTML tags below via replacements)
    html = this._escapeHtml(html);

    // 2. Fenced code blocks (``` ... ```) — must be done before inline code
    html = html.replace(/```([a-zA-Z]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const cls = lang ? ` class="language-${this._escapeAttr(lang)}"` : '';
      return `<pre><code${cls}>${code.trim()}</code></pre>`;
    });

    // 3. Headings
    html = html.replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>');

    // 4. HR
    html = html.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, '<hr>');

    // 5. Blockquotes
    html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote><p>$1</p></blockquote>');
    // Merge consecutive blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

    // 6. Tables
    html = this._renderTables(html);

    // 7. Unordered lists
    html = this._renderList(html, /^[-*+]\s+(.+)$/gm, 'ul');

    // 8. Ordered lists
    html = this._renderList(html, /^\d+\.\s+(.+)$/gm, 'ol');

    // 9. Inline code (single backtick — skip content inside pre blocks)
    html = html.replace(/`([^`\n]+?)`/g, '<code>$1</code>');

    // 10. Bold + italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // 11. Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // 12. Links — filter dangerous protocols
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
      const safeHref = this._safeUrl(href);
      if (!safeHref) {return text;}
      return `<a href="${this._escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

    // 13. Auto-link bare URLs
    html = html.replace(/(?<!["[(>])https?:\/\/[^\s<>"']+/g, (url) => {
      return `<a href="${this._escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });

    // 14. Paragraphs: wrap lines not already wrapped in block elements
    html = this._wrapParagraphs(html);

    // 15. Newlines within paragraphs to <br>
    html = html.replace(/([^>\n])\n([^<\n])/g, '$1<br>$2');

    return html;
  }

  _renderTables(html) {
    // Match GitHub-flavored markdown table blocks
    const tableRegex = /^(\|.+\|\n)((?:\|[-:| ]+\|\n))((?:\|.+\|\n?)+)/gm;
    return html.replace(tableRegex, (_, header, sep, body) => {
      const headers = header.trim().split('|').filter(h => h.trim());
      const rows = body.trim().split('\n').map(row =>
        row.split('|').filter(c => c.trim())
      );

      const ths = headers.map(h => `<th>${h.trim()}</th>`).join('');
      const trs = rows.map(row =>
        `<tr>${row.map(c => `<td>${c.trim()}</td>`).join('')}</tr>`
      ).join('');

      return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    });
  }

  _renderList(html, pattern, tag) {
    // Find consecutive list items and wrap in ul/ol
    const lines = html.split('\n');
    const result = [];
    let inList = false;

    for (const line of lines) {
      const isUl = tag === 'ul' && /^[-*+]\s+/.test(line);
      const isOl = tag === 'ol' && /^\d+\.\s+/.test(line);
      const isList = isUl || isOl;

      if (isList) {
        if (!inList) { result.push(`<${tag}>`); inList = true; }
        const content = line.replace(/^(?:[-*+]|\d+\.)\s+/, '');
        result.push(`<li>${content}</li>`);
      } else {
        if (inList) { result.push(`</${tag}>`); inList = false; }
        result.push(line);
      }
    }
    if (inList) {result.push(`</${tag}>`);}
    return result.join('\n');
  }

  _wrapParagraphs(html) {
    // Lines that aren't block-level elements become <p> tags
    const blockTags = /^<(h[1-6]|ul|ol|li|blockquote|pre|table|thead|tbody|tr|th|td|hr)/;
    const lines = html.split('\n');
    const result = [];
    let p = [];

    const flushP = () => {
      const text = p.join(' ').trim();
      if (text) {result.push(`<p>${text}</p>`);}
      p = [];
    };

    for (const line of lines) {
      if (!line.trim()) {
        flushP();
        continue;
      }
      if (blockTags.test(line.trim()) || line.trim().startsWith('</')) {
        flushP();
        result.push(line);
      } else {
        p.push(line);
      }
    }
    flushP();
    return result.join('\n');
  }

  /** Escape HTML special characters */
  _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Escape for use in HTML attribute values */
  _escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Block dangerous URL schemes */
  _safeUrl(href) {
    if (!href) {return null;}
    const trimmed = href.trim().toLowerCase();
    const BLOCKED = ['javascript:', 'data:', 'vbscript:', 'blob:'];
    for (const scheme of BLOCKED) {
      if (trimmed.startsWith(scheme)) {return null;}
    }
    return href;
  }
}

customElements.define('oasis-markdown', OasisMarkdown);
