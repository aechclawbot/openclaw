import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';
import { store } from '/app/store.js';
import { eventBus } from '/app/events.js';

// --- Markdown Renderer ---
function renderMarkdown(text) {
  if (!text) {return '';}

  // HTML escape first
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const codeContent = codeLines.join('\n');
      output.push(`<pre><code class="language-${lang}">${codeContent}</code></pre>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      output.push('<hr>');
      i++;
      continue;
    }

    // Headers
    const h4 = line.match(/^#{4}\s+(.*)/);
    const h3 = line.match(/^#{3}\s+(.*)/);
    const h2 = line.match(/^#{2}\s+(.*)/);
    const h1 = line.match(/^#{1}\s+(.*)/);
    if (h4) { output.push(`<h4>${inlineMarkdown(h4[1])}</h4>`); i++; continue; }
    if (h3) { output.push(`<h3>${inlineMarkdown(h3[1])}</h3>`); i++; continue; }
    if (h2) { output.push(`<h2>${inlineMarkdown(h2[1])}</h2>`); i++; continue; }
    if (h1) { output.push(`<h1>${inlineMarkdown(h1[1])}</h1>`); i++; continue; }

    // Blockquote
    if (line.startsWith('&gt;')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('&gt;')) {
        quoteLines.push(lines[i].replace(/^&gt;\s?/, ''));
        i++;
      }
      output.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|?[-| :]+\|?$/)) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const headerRow = parseTableRow(tableLines[0]);
      const bodyRows = tableLines.slice(2).map(parseTableRow);
      const thead = `<thead><tr>${headerRow.map(c => `<th>${inlineMarkdown(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${bodyRows.map(r => `<tr>${r.map(c => `<td>${inlineMarkdown(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      output.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        listItems.push(`<li>${inlineMarkdown(lines[i].replace(/^[-*+]\s/, ''))}</li>`);
        i++;
      }
      output.push(`<ul>${listItems.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(`<li>${inlineMarkdown(lines[i].replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      output.push(`<ol>${listItems.join('')}</ol>`);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^[#>|`\-*+]/) && !/^\d+\./.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      output.push(`<p>${inlineMarkdown(paraLines.join(' '))}</p>`);
    } else {
      i++;
    }
  }

  return output.join('\n');
}

function parseTableRow(row) {
  return row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function inlineMarkdown(text) {
  if (!text) {return '';}
  // Bold+italic
  text = text.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links — block dangerous URLs
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safe = /^(javascript|data|vbscript):/i.test(url.trim()) ? '#' : url;
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  // Strikethrough
  text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');
  return text;
}

// --- Helpers ---
function formatDuration(seconds) {
  if (!seconds) {return '0s';}
  if (seconds < 60) {return `${Math.round(seconds)}s`;}
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) {return `${m}m ${s}s`;}
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function formatDateTime(iso) {
  if (!iso && iso !== 0) {return '—';}

  // Handle numeric timestamps (epoch seconds or milliseconds)
  if (typeof iso === 'number') {
    const ms = iso < 1e12 ? iso * 1000 : iso;
    const d = new Date(ms);
    if (isNaN(d.getTime())) {return '—';}
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  // Handle malformed timestamps that have both a UTC offset and trailing Z
  // e.g. "2026-02-27T16:40:09.902318+00:00Z" — strip the trailing Z when an offset is present
  let cleaned = String(iso);
  if (/[+-]\d{2}:\d{2}Z$/.test(cleaned)) {
    cleaned = cleaned.slice(0, -1);
  }

  // Handle numeric strings (e.g., "1709123456789")
  if (/^\d+$/.test(cleaned)) {
    const num = parseInt(cleaned, 10);
    const ms = num < 1e12 ? num * 1000 : num;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
  }

  const d = new Date(cleaned);
  if (isNaN(d.getTime())) {return '—';}
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso) {
  if (!iso) {return 'never';}
  let cleaned = String(iso);
  if (/[+-]\d{2}:\d{2}Z$/.test(cleaned)) {cleaned = cleaned.slice(0, -1);}
  const diff = Date.now() - new Date(cleaned).getTime();
  if (isNaN(diff)) {return 'never';}
  const s = Math.floor(diff / 1000);
  if (s < 60) {return `${s}s ago`;}
  const m = Math.floor(s / 60);
  if (m < 60) {return `${m}m ago`;}
  const h = Math.floor(m / 60);
  if (h < 24) {return `${h}h ago`;}
  const day = Math.floor(h / 24);
  return `${day}d ago`;
}

function escapeHtml(str) {
  if (!str) {return '';}
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlight(text, query) {
  if (!query || !text) {return escapeHtml(text);}
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(${esc})`, 'gi');
  return escapeHtml(text).replace(rx, '<mark>$1</mark>');
}

function speakerColor(name) {
  if (!name || name === 'Unknown') {return 'var(--text-muted)';}
  const palette = ['var(--accent)', 'var(--green)', 'var(--purple)', 'var(--orange)', 'var(--yellow)'];
  let hash = 0;
  for (let c of name) {hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;}
  return palette[Math.abs(hash) % palette.length];
}

// --- Main Component ---
class PageKnowledge extends LitElement {
  static properties = {
    _activeTab: { type: String },

    // Library
    _tree: { type: Array },
    _treeLoading: { type: Boolean },
    _treeError: { type: String },
    _treeSearch: { type: String },
    _expandedFolders: { type: Object },
    _activeFile: { type: String },
    _fileContent: { type: String },
    _fileLoading: { type: Boolean },
    _fileError: { type: String },
    _editMode: { type: Boolean },
    _editContent: { type: String },
    _editDirty: { type: Boolean },
    _editSaving: { type: Boolean },
    _editPreview: { type: Boolean },
    _chatOpen: { type: Boolean },
    _chatMessages: { type: Array },
    _chatInput: { type: String },
    _chatLoading: { type: Boolean },
    _searchQuery: { type: String },
    _searchResults: { type: Array },
    _searchLoading: { type: Boolean },
    _searchActive: { type: Boolean },

    // Voice pipeline
    _voiceStats: { type: Object },
    _voicePipeline: { type: Object },
    _voiceLoading: { type: Boolean },
    _pipelineLogs: { type: Array },
    _logsOpen: { type: Boolean },
    _logsTailSize: { type: Number },
    _voiceRefreshInterval: { type: Number },

    // Transcripts
    _transcripts: { type: Array },
    _transcriptsLoading: { type: Boolean },
    _transcriptSearch: { type: String },
    _transcriptPage: { type: Number },
    _transcriptPageSize: { type: Number },
    _transcriptTotal: { type: Number },
    _transcriptDetail: { type: Object },
    _transcriptDetailOpen: { type: Boolean },
    _transcriptDetailLoading: { type: Boolean },
    _transcriptLabelSpeaker: { type: Object },
    _transcriptPlaybackSpeed: { type: Number },
    _transcriptActiveUtterance: { type: Number },

    // Conversations
    _conversationView: { type: Boolean },
    _conversations: { type: Array },
    _conversationsLoading: { type: Boolean },
    _conversationPage: { type: Number },
    _conversationTotal: { type: Number },
    _expandedConversation: { type: String },
    _expandedConversationData: { type: Object },
    _expandedConversationLoading: { type: Boolean },

    // Speakers
    _profiles: { type: Array },
    _profilesLoading: { type: Boolean },
    _candidates: { type: Array },
    _candidatesLoading: { type: Boolean },
    _renameTarget: { type: String },
    _renameName: { type: String },
    _approveTarget: { type: String },
    _approveName: { type: String },
    _confirmDelete: { type: Object },
    _ingestionStatus: { type: Object },
    _toast: { type: Object },
    _editingUtterance: { type: Number },
    _transcriptCurrentTime: { type: Number },
    _showCreateProfile: { type: Boolean },
    _createProfileName: { type: String },
    _createProfileFile: { type: Object },
    _createProfileLoading: { type: Boolean },
    _selectedCandidates: { type: Array },
    _showMergeModal: { type: Boolean },
    _mergeTarget: { type: Object },
    _mergeLoading: { type: Boolean },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace;
      color: var(--text);
      background: var(--bg);
      overflow: hidden;
    }

    /* ── Page Header ─────────────────────────── */
    .page-header {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-6) 0;
    }
    .page-title {
      margin: 0;
      font-size: 1.75rem;
      font-weight: 700;
      font-family: var(--font-sans);
    }
    .page-subtitle {
      font-size: var(--font-size-sm);
      color: var(--text-dim);
      font-family: var(--font-sans);
    }

    /* ── Tab Bar ─────────────────────────────── */
    .tab-bar {
      display: flex;
      gap: 0;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 20px;
      flex-shrink: 0;
    }
    .tab-btn {
      padding: 12px 18px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-dim);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      transition: color 0.15s, border-color 0.15s;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    /* ── Tab Content ─────────────────────────── */
    .tab-content {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* ── Library Layout ──────────────────────── */
    .library-layout {
      display: flex;
      height: 100%;
      overflow: hidden;
    }

    .tree-panel {
      width: 280px;
      min-width: 180px;
      max-width: 500px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: horizontal;
    }
    .tree-search {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .tree-search input {
      width: 100%;
      box-sizing: border-box;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: inherit;
      font-size: 11px;
      padding: 6px 10px;
      outline: none;
    }
    .tree-search input:focus { border-color: var(--accent); }
    .tree-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .tree-folder {
      user-select: none;
    }
    .tree-folder-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-dim);
      transition: background 0.1s;
    }
    .tree-folder-header:hover { background: var(--surface-2); }
    .tree-arrow {
      display: inline-block;
      font-size: 9px;
      width: 12px;
      transition: transform 0.15s;
      color: var(--text-muted);
    }
    .tree-arrow.open { transform: rotate(90deg); }
    .tree-folder-icon { font-size: 13px; }
    .tree-folder-name { flex: 1; }
    .tree-children { padding-left: 16px; }
    .tree-file {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-dim);
      border-radius: 4px;
      margin: 1px 4px;
      transition: background 0.1s, color 0.1s;
    }
    .tree-file:hover { background: var(--surface-2); color: var(--text); }
    .tree-file.active {
      background: var(--accent-dim);
      color: var(--accent);
    }
    .tree-file-icon { font-size: 11px; }

    /* ── Doc Viewer ───────────────────────────── */
    .doc-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .doc-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .doc-search {
      flex: 1;
      max-width: 360px;
    }
    .doc-search input {
      width: 100%;
      box-sizing: border-box;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: inherit;
      font-size: 11px;
      padding: 6px 10px;
      outline: none;
    }
    .doc-search input:focus { border-color: var(--accent); }
    .doc-title {
      font-size: 13px;
      color: var(--text-dim);
      letter-spacing: 0.03em;
      margin-right: auto;
    }
    .doc-actions { display: flex; gap: 6px; align-items: center; }
    .dirty-badge {
      font-size: 10px;
      color: var(--yellow);
      padding: 2px 6px;
      border: 1px solid var(--yellow);
      border-radius: 4px;
    }
    .doc-body {
      flex: 1;
      overflow: hidden;
      display: flex;
    }
    .doc-viewer {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px;
    }
    .doc-viewer-inner {
      max-width: 820px;
    }
    /* Markdown styles inside shadow DOM */
    .doc-viewer-inner h1 { font-size: 1.5em; color: var(--text); margin: 0 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .doc-viewer-inner h2 { font-size: 1.25em; color: var(--text); margin: 20px 0 8px; }
    .doc-viewer-inner h3 { font-size: 1.1em; color: var(--accent); margin: 16px 0 6px; }
    .doc-viewer-inner h4 { font-size: 1em; color: var(--text-dim); margin: 12px 0 4px; }
    .doc-viewer-inner p { margin: 8px 0; line-height: 1.7; font-size: 13px; color: var(--text); }
    .doc-viewer-inner a { color: var(--accent); text-decoration: none; }
    .doc-viewer-inner a:hover { text-decoration: underline; }
    .doc-viewer-inner code {
      background: var(--surface-3);
      color: var(--accent);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 11px;
    }
    .doc-viewer-inner pre {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px 16px;
      overflow-x: auto;
      margin: 12px 0;
    }
    .doc-viewer-inner pre code {
      background: none;
      padding: 0;
      font-size: 12px;
      color: var(--text);
    }
    .doc-viewer-inner ul, .doc-viewer-inner ol {
      padding-left: 22px;
      margin: 8px 0;
      font-size: 13px;
    }
    .doc-viewer-inner li { margin: 4px 0; line-height: 1.6; }
    .doc-viewer-inner blockquote {
      border-left: 3px solid var(--accent);
      margin: 12px 0;
      padding: 8px 16px;
      background: var(--surface-2);
      border-radius: 0 4px 4px 0;
      color: var(--text-dim);
      font-size: 13px;
    }
    .doc-viewer-inner table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 12px;
    }
    .doc-viewer-inner th {
      background: var(--surface-3);
      color: var(--accent);
      padding: 8px 12px;
      text-align: left;
      border: 1px solid var(--border);
    }
    .doc-viewer-inner td {
      padding: 7px 12px;
      border: 1px solid var(--border);
      color: var(--text);
    }
    .doc-viewer-inner tr:hover td { background: var(--surface-2); }
    .doc-viewer-inner hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
    .doc-viewer-inner strong { color: var(--text); }
    .doc-viewer-inner em { color: var(--text-dim); font-style: italic; }
    .doc-viewer-inner del { color: var(--text-muted); text-decoration: line-through; }
    .doc-viewer-inner mark { background: rgba(0,212,255,0.2); color: var(--accent); border-radius: 2px; padding: 0 2px; }

    /* Edit mode */
    .doc-edit-wrap {
      flex: 1;
      display: flex;
      gap: 0;
      overflow: hidden;
    }
    .doc-edit-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    textarea.doc-textarea {
      flex: 1;
      background: var(--surface);
      color: var(--text);
      border: none;
      border-right: 1px solid var(--border);
      font-family: inherit;
      font-size: 12px;
      padding: 24px;
      resize: none;
      outline: none;
      line-height: 1.6;
    }
    .doc-preview-pane {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px;
      border-left: 1px solid var(--border);
    }
    .doc-preview-label {
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 6px 12px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    /* AI Chat Panel */
    .chat-panel {
      width: 350px;
      background: var(--surface);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width 0.2s;
    }
    .chat-panel.closed { width: 0; overflow: hidden; }
    .chat-header {
      display: flex;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .chat-header-title { flex: 1; font-size: 12px; color: var(--text); font-weight: 600; }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .chat-msg {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .chat-msg-label {
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .chat-msg-user .chat-msg-label { color: var(--accent); }
    .chat-msg-body {
      background: var(--surface-2);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--text);
    }
    .chat-msg-user .chat-msg-body {
      background: var(--accent-dim);
      border: 1px solid rgba(0,212,255,0.2);
    }
    .chat-input-row {
      display: flex;
      gap: 6px;
      padding: 10px 12px;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .chat-input-row input {
      flex: 1;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: inherit;
      font-size: 11px;
      padding: 7px 10px;
      outline: none;
    }
    .chat-input-row input:focus { border-color: var(--accent); }
    .chat-typing {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      color: var(--text-muted);
      font-size: 11px;
    }
    .dot { width: 4px; height: 4px; background: var(--accent); border-radius: 50%; animation: pulse 1.2s infinite; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse { 0%,80%,100% { opacity: 0.2; } 40% { opacity: 1; } }

    /* Search results */
    .search-results {
      flex: 1;
      overflow-y: auto;
      padding: 16px 24px;
    }
    .search-result-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .search-result-card:hover { border-color: var(--accent); background: var(--surface-2); }
    .search-result-path { font-size: 10px; color: var(--accent); margin-bottom: 4px; }
    .search-result-excerpt {
      font-size: 12px;
      color: var(--text-dim);
      line-height: 1.5;
    }
    .search-empty { padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px; }

    /* People cards */
    .people-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
      padding: 24px;
    }
    .person-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .person-name { font-size: 14px; color: var(--text); font-weight: 600; margin-bottom: 4px; }
    .person-role { font-size: 11px; color: var(--accent); margin-bottom: 8px; }
    .person-info { font-size: 11px; color: var(--text-dim); line-height: 1.6; }

    /* ── Voice Pipeline ───────────────────────── */
    .pipeline-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .stats-grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 18px;
    }
    .stat-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px; }
    .stat-value { font-size: 28px; color: var(--accent); font-weight: 700; }
    .stat-sub { font-size: 11px; color: var(--text-dim); margin-top: 4px; }

    /* Pipeline flow */
    .pipeline-flow {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
    }
    .pipeline-flow-title { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px; }
    .pipeline-stages {
      display: flex;
      align-items: center;
      gap: 0;
      overflow-x: auto;
    }
    .pipeline-stage {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      min-width: 100px;
    }
    .pipeline-stage-icon {
      font-size: 24px;
      position: relative;
    }
    .stage-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      position: absolute;
      bottom: -2px;
      right: -2px;
    }
    .stage-dot.ok { background: var(--green); }
    .stage-dot.active { background: var(--green); animation: pulse 1s infinite; }
    .stage-dot.processing { background: var(--yellow); animation: pulse 1s infinite; }
    .stage-dot.warn { background: var(--yellow); }
    .stage-dot.error { background: var(--red); }
    .stage-dot.offline { background: var(--red); }
    .stage-dot.off { background: var(--text-muted); }
    .stage-dot.idle { background: var(--text-muted); }
    .pipeline-stage-name { font-size: 11px; color: var(--text-dim); text-align: center; }
    .pipeline-arrow { color: var(--text-muted); font-size: 18px; padding: 0 6px; margin-top: -16px; }

    /* Queue stats */
    .queue-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .queue-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      text-align: center;
    }
    .queue-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; }
    .queue-value { font-size: 22px; margin-top: 6px; font-weight: 700; }
    .queue-value.inbox { color: var(--accent); }
    .queue-value.processing { color: var(--yellow); }
    .queue-value.done { color: var(--green); }
    .queue-value.error { color: var(--red); }

    /* Stage detail cards */
    .stage-cards {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
    }
    .stage-detail-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .stage-detail-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
      cursor: pointer;
    }
    .stage-detail-header-icon { font-size: 16px; }
    .stage-detail-header-name { flex: 1; font-size: 12px; color: var(--text); font-weight: 600; }
    .stage-detail-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
    .stage-row { display: flex; justify-content: space-between; font-size: 11px; }
    .stage-row-label { color: var(--text-dim); }
    .stage-row-value { color: var(--text); }

    /* Logs */
    .logs-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .logs-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
      cursor: pointer;
    }
    .logs-title { flex: 1; font-size: 12px; color: var(--text); font-weight: 600; }
    .logs-body {
      height: 200px;
      overflow-y: auto;
      font-size: 11px;
      padding: 10px;
      background: #050810;
    }
    .log-line {
      padding: 1px 0;
      font-family: inherit;
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .log-line.info { color: var(--text-dim); }
    .log-line.warn { color: var(--yellow); }
    .log-line.error { color: var(--red); }
    .log-line.debug { color: var(--text-muted); }
    .logs-tail-select {
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: 3px;
      color: var(--text);
      font-family: inherit;
      font-size: 10px;
      padding: 2px 6px;
    }

    /* ── Transcripts ──────────────────────────── */
    .transcripts-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .transcripts-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .transcripts-toolbar input {
      flex: 1;
      max-width: 340px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: inherit;
      font-size: 11px;
      padding: 6px 10px;
      outline: none;
    }
    .transcripts-toolbar input:focus { border-color: var(--accent); }
    .bulk-actions { display: flex; gap: 6px; margin-left: auto; }
    .transcript-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .transcript-card:hover { border-color: var(--accent); background: var(--surface-2); }
    .tc-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .tc-datetime { font-size: 11px; color: var(--text-dim); }
    .tc-duration { font-size: 10px; color: var(--text-muted); background: var(--surface-2); border: 1px solid var(--border); padding: 2px 7px; border-radius: 4px; }
    .tc-status { font-size: 10px; padding: 2px 7px; border-radius: 4px; }
    .tc-status.ok { color: var(--green); background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.2); }
    .tc-status.processing { color: var(--yellow); background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.2); }
    .tc-status.failed { color: var(--red); background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); }
    .tc-confidence { font-size: 10px; color: var(--text-muted); margin-left: auto; }
    .tc-speakers { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .speaker-badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid;
    }
    .tc-preview { font-size: 12px; color: var(--text-dim); line-height: 1.5; }
    .tc-footer { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
    .tc-actions { display: flex; gap: 6px; margin-left: auto; }

    /* ── Conversations ────────────────────────── */
    .view-toggle {
      display: flex;
      gap: 0;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .view-toggle button {
      padding: 4px 12px;
      background: none;
      border: none;
      color: var(--text-dim);
      font-family: inherit;
      font-size: 10px;
      cursor: pointer;
      letter-spacing: 0.03em;
      transition: background 0.15s, color 0.15s;
    }
    .view-toggle button:hover { color: var(--text); }
    .view-toggle button.active {
      background: var(--accent);
      color: var(--bg);
    }
    .conversation-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .conversation-card:hover { border-color: var(--accent); background: var(--surface-2); }
    .conversation-card.expanded { border-color: var(--accent); }
    .conv-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .conv-date { font-size: 11px; color: var(--text-dim); }
    .conv-time-range { font-size: 10px; color: var(--text-muted); }
    .conv-duration { font-size: 10px; color: var(--text-muted); background: var(--surface-2); border: 1px solid var(--border); padding: 2px 7px; border-radius: 4px; }
    .conv-meta { font-size: 10px; color: var(--text-muted); margin-left: auto; display: flex; gap: 10px; }
    .conv-speakers { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .conv-preview { font-size: 12px; color: var(--text-dim); line-height: 1.5; }
    .conv-expanded {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .conv-utterances {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 400px;
      overflow-y: auto;
    }
    .conv-utterance {
      display: flex;
      gap: 8px;
      font-size: 12px;
      line-height: 1.5;
    }
    .conv-utt-speaker {
      font-weight: 600;
      white-space: nowrap;
      min-width: 70px;
      font-size: 11px;
    }
    .conv-utt-text { color: var(--text-dim); flex: 1; }
    .conv-utt-time { font-size: 10px; color: var(--text-muted); white-space: nowrap; }

    /* Pagination */
    .pagination {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: var(--surface);
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .page-info { font-size: 11px; color: var(--text-dim); flex: 1; }
    .page-size-select {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: inherit;
      font-size: 11px;
      padding: 4px 8px;
    }

    /* Transcript Detail Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      width: min(820px, 92vw);
      height: min(680px, 88vh);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-header {
      display: flex;
      align-items: center;
      padding: 14px 18px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .modal-title { flex: 1; font-size: 14px; color: var(--text); font-weight: 600; }
    .modal-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
    .modal-footer {
      padding: 12px 18px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--surface-2);
      flex-shrink: 0;
    }
    .utterances-list { display: flex; flex-direction: column; gap: 10px; }
    .utterance-row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .utterance-speaker {
      min-width: 90px;
      flex-shrink: 0;
    }
    .utterance-speaker select {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: inherit;
      font-size: 10px;
      padding: 3px 6px;
      width: 100%;
    }
    .utterance-ts { font-size: 10px; color: var(--text-muted); min-width: 40px; margin-top: 6px; }
    .utterance-text { font-size: 12px; color: var(--text); line-height: 1.6; flex: 1; padding-top: 2px; }
    .speaker-timeline {
      display: flex;
      height: 20px;
      border-radius: 4px;
      overflow: hidden;
      gap: 1px;
      margin-bottom: 16px;
    }
    .timeline-seg { display: inline-block; height: 100%; }

    /* ── Speakers ─────────────────────────────── */
    .speakers-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .section-title {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 12px;
    }
    .profiles-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 14px;
    }
    .profile-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .profile-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .profile-header { display: flex; align-items: center; gap: 10px; }
    .profile-name-wrap { flex: 1; }
    .profile-name { font-size: 13px; color: var(--text); font-weight: 600; }
    .profile-enroll { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
    .profile-metrics { display: flex; flex-direction: column; gap: 4px; }
    .metric-row { display: flex; justify-content: space-between; font-size: 11px; }
    .metric-label { color: var(--text-dim); }
    .metric-value { color: var(--text); }
    .profile-actions { display: flex; gap: 6px; margin-top: 4px; }
    .rename-inline { display: flex; gap: 6px; }
    .rename-inline input {
      flex: 1;
      background: var(--surface-2);
      border: 1px solid var(--accent);
      border-radius: 4px;
      color: var(--text);
      font-family: inherit;
      font-size: 11px;
      padding: 4px 8px;
      outline: none;
    }
    .candidates-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 14px;
    }
    .candidate-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .candidate-header { display: flex; align-items: center; gap: 8px; }
    .candidate-id { font-size: 11px; color: var(--text-dim); }
    .candidate-samples { font-size: 10px; color: var(--text-muted); margin-left: auto; }
    .approve-input-row { display: flex; gap: 6px; }
    .approve-input-row input {
      flex: 1;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: inherit;
      font-size: 11px;
      padding: 5px 8px;
      outline: none;
    }
    .approve-input-row input:focus { border-color: var(--green); }
    .audio-player {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
    }
    .audio-player audio { flex: 1; height: 24px; }

    /* ── Profile Samples ─────────────────────── */
    .profile-samples {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
    }
    .profile-samples-title {
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .sample-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sample-item audio { width: 100%; height: 24px; }
    .sample-transcript {
      font-size: 11px;
      color: var(--text-dim);
      line-height: 1.4;
      padding: 4px 6px;
      background: var(--surface-2);
      border-radius: 4px;
      max-height: 48px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .enrollment-stats {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-top: 4px;
      border-top: 1px solid var(--border);
    }

    /* ── Transcript Audio Controls ────────────── */
    .playback-speed-controls {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .playback-speed-controls .speed-btn {
      padding: 2px 6px;
      font-size: 10px;
      border-radius: 3px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text-dim);
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
    .playback-speed-controls .speed-btn:hover { background: var(--surface-3); }
    .playback-speed-controls .speed-btn.active {
      background: var(--accent-dim);
      border-color: rgba(0,212,255,0.3);
      color: var(--accent);
    }
    .utterance-row.active-utterance {
      background: rgba(0,212,255,0.06);
      border-left: 2px solid var(--accent);
      padding-left: 8px;
      border-radius: 4px;
    }
    .utterance-row {
      transition: background 0.15s, border-left 0.15s;
      cursor: pointer;
      border-left: 2px solid transparent;
      padding-left: 8px;
    }
    .utterance-row:hover { background: rgba(255,255,255,0.02); }
    .mini-play-btn {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text-dim);
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
      flex-shrink: 0;
    }
    .mini-play-btn:hover { background: var(--surface-3); color: var(--accent); border-color: rgba(0,212,255,0.3); }
    .mini-play-btn.playing { color: var(--accent); border-color: rgba(0,212,255,0.3); background: var(--accent-dim); }

    /* ── Common Buttons ───────────────────────── */
    .btn {
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
      white-space: nowrap;
    }
    .btn:hover { background: var(--surface-3); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-accent {
      background: var(--accent-dim);
      border-color: rgba(0,212,255,0.3);
      color: var(--accent);
    }
    .btn-accent:hover { background: rgba(0,212,255,0.25); }
    .btn-green { background: rgba(34,197,94,0.1); border-color: rgba(34,197,94,0.3); color: var(--green); }
    .btn-green:hover { background: rgba(34,197,94,0.2); }
    .btn-red { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.3); color: var(--red); }
    .btn-red:hover { background: rgba(239,68,68,0.2); }
    .btn-yellow { background: rgba(234,179,8,0.1); border-color: rgba(234,179,8,0.3); color: var(--yellow); }
    .btn-yellow:hover { background: rgba(234,179,8,0.2); }
    .btn-sm { padding: 3px 8px; font-size: 10px; }
    .btn-icon { padding: 4px 8px; }

    /* ── Loading / Error ──────────────────────── */
    .loading-spinner {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      gap: 8px;
      color: var(--text-muted);
      font-size: 12px;
    }
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error-msg { color: var(--red); font-size: 12px; padding: 16px; }
    .empty-msg { color: var(--text-muted); font-size: 12px; padding: 32px; text-align: center; }

    /* Confirm dialog */
    .confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .confirm-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      width: min(360px, 90vw);
    }
    .confirm-title { font-size: 14px; color: var(--text); margin-bottom: 10px; }
    .confirm-body { font-size: 12px; color: var(--text-dim); margin-bottom: 18px; line-height: 1.6; }
    .confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

    /* --- Pipeline dual-input layout --- */
    .pipeline-dual-input { display:flex; align-items:center; gap:12px; padding:16px; background:var(--bg-card); border-radius:10px; overflow-x:auto; }
    .pipeline-input-sources { display:flex; flex-direction:column; gap:8px; }
    .pipeline-source { display:flex; align-items:center; gap:8px; }
    .toggle-btn { font-size:10px; padding:2px 10px; border-radius:10px; border:none; cursor:pointer; font-weight:600; }
    .toggle-btn.active { background:var(--green); color:#000; }
    .toggle-btn.paused { background:var(--yellow); color:#000; }
    .watch-folder-card { background:var(--bg-card); border-radius:10px; padding:16px; margin-top:12px; }
    .watch-folder-card .card-title { font-size:13px; font-weight:600; margin-bottom:10px; }
    .status-active { color:var(--green); }
    .status-paused { color:var(--yellow); }
    .status-processing { color:var(--accent); }
    .status-error { color:var(--red); }

    /* --- Toast notifications --- */
    .toast { position:fixed; bottom:24px; right:24px; padding:10px 18px; border-radius:8px; font-size:12px; font-weight:500; z-index:10000; animation:toast-in 0.3s ease; }
    .toast-success { background:var(--green); color:#000; }
    .toast-error { background:var(--red); color:#fff; }
    @keyframes toast-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }

    /* --- Inline text editing --- */
    .utterance-text { cursor:text; position:relative; flex:1; }
    .utterance-text:hover .editable-text { border-left:2px solid var(--text-muted); padding-left:6px; }
    .utterance-text.editing { border-left:2px solid var(--accent); padding-left:4px; }
    .utterance-edit-input { width:100%; background:var(--bg-input, #1a1a2e); color:var(--text); border:1px solid var(--accent); border-radius:4px; padding:4px 6px; font-family:inherit; font-size:inherit; resize:vertical; min-height:24px; }
    .editable-text { display:inline; }

    /* --- Active utterance & timeline --- */
    .utterance-row.active-utterance { border-left:3px solid var(--accent); padding-left:9px; background:rgba(var(--accent-rgb, 255,107,53),0.08); }
    .speaker-timeline { position:relative; }
    .timeline-position { position:absolute; top:0; bottom:0; width:2px; background:var(--accent); transition:left 0.2s linear; pointer-events:none; }

    /* --- Upload zone --- */
    .upload-zone { border:2px dashed var(--border); border-radius:8px; padding:16px; text-align:center; cursor:pointer; }
    .upload-zone:hover { border-color:var(--accent); }

    /* --- Candidate checkbox --- */
    .candidate-card { position:relative; }
    .candidate-checkbox { position:absolute; top:8px; right:8px; }

    /* --- Pending Curator Badge --- */
    .pending-curator-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(255, 152, 0, 0.15);
      color: #ff9800;
      border: 1px solid rgba(255, 152, 0, 0.3);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .pending-curator-badge::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #ff9800;
      animation: pulse 2s ease-in-out infinite;
    }

    /* --- Job Status Summary Grid --- */
    .job-status-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
      margin-top: 12px;
      padding: 12px;
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
    }
    .job-status-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px;
      border-radius: 6px;
      background: rgba(255,255,255,0.05);
    }
    .job-status-item .count {
      font-size: 1.5rem;
      font-weight: 700;
      line-height: 1;
    }
    .job-status-item .label {
      font-size: 0.7rem;
      color: var(--text-secondary, #999);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }
    .job-status-item.pending-curator .count { color: #ff9800; }
    .job-status-item.failed .count { color: #f44336; }
    .job-status-item.complete .count, .job-status-item.curator-synced .count { color: #4caf50; }
    .job-status-item.processing .count { color: #2196f3; }
  `;

  constructor() {
    super();
    this._activeTab = 'library';

    // Library
    this._tree = [];
    this._treeLoading = true;
    this._treeError = null;
    this._treeSearch = '';
    this._expandedFolders = {};
    this._activeFile = null;
    this._fileContent = '';
    this._fileLoading = false;
    this._fileError = null;
    this._editMode = false;
    this._editContent = '';
    this._editDirty = false;
    this._editSaving = false;
    this._editPreview = false;
    this._chatOpen = false;
    this._chatMessages = [];
    this._chatInput = '';
    this._chatLoading = false;
    this._searchQuery = '';
    this._searchResults = [];
    this._searchLoading = false;
    this._searchActive = false;
    this._searchDebounce = null;

    // Library insights
    this._insights = null;
    this._insightsLoading = false;

    // Voice pipeline
    this._voiceStats = null;
    this._voicePipeline = null;
    this._voiceLoading = true;
    this._pipelineLogs = [];
    this._logsOpen = false;
    this._logsTailSize = 100;
    this._voiceRefreshInterval = null;

    // Transcripts
    this._transcripts = [];
    this._transcriptsLoading = true;
    this._transcriptSearch = '';
    this._transcriptPage = 1;
    this._transcriptPageSize = 25;
    this._transcriptTotal = 0;
    this._transcriptDetail = null;
    this._transcriptDetailOpen = false;
    this._transcriptDetailLoading = false;
    this._transcriptLabelSpeaker = {};
    this._transcriptPlaybackSpeed = 1;
    this._transcriptActiveUtterance = -1;
    this._transcriptSearchDebounce = null;
    this._transcriptAudioTimeupdateHandler = null;

    // Conversations
    this._conversationView = false;
    this._conversations = [];
    this._conversationsLoading = false;
    this._conversationPage = 1;
    this._conversationTotal = 0;
    this._expandedConversation = null;
    this._expandedConversationData = null;
    this._expandedConversationLoading = false;

    // Speakers
    this._profiles = [];
    this._profilesLoading = true;
    this._candidates = [];
    this._candidatesLoading = true;
    this._renameTarget = null;
    this._renameName = '';
    this._approveTarget = null;
    this._approveName = '';
    this._confirmDelete = null;
    this._ingestionStatus = { microphone: { active: false }, watchFolder: { active: false } };
    this._toast = null;
    this._editingUtterance = -1;
    this._transcriptCurrentTime = 0;
    this._showCreateProfile = false;
    this._createProfileName = '';
    this._createProfileFile = null;
    this._createProfileLoading = false;
    this._selectedCandidates = [];
    this._showMergeModal = false;
    this._mergeTarget = { type: 'new', name: '' };
    this._mergeLoading = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadTree();
    this._loadInsights();
    if (this._activeTab === 'pipeline') {
      this._startVoiceRefresh();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopVoiceRefresh();
    clearTimeout(this._searchDebounce);
    clearTimeout(this._transcriptSearchDebounce);
  }

  // ── Tab switching ────────────────────────────
  _setTab(tab) {
    this._activeTab = tab;
    if (tab === 'pipeline') {
      this._loadVoice();
      this._startVoiceRefresh();
    } else {
      this._stopVoiceRefresh();
    }
    if (tab === 'transcripts') {
      this._loadTranscripts();
      if (this._conversationView) {this._loadConversations();}
    }
    if (tab === 'speakers') { this._loadProfiles(); this._loadCandidates(); }
  }

  // ── Library ──────────────────────────────────
  async _loadInsights() {
    this._insightsLoading = true;
    try {
      this._insights = await api.get('/api/curator/insights');
    } catch (e) {
      this._insights = null;
    }
    this._insightsLoading = false;
    this.requestUpdate();
  }

  async _loadTree() {
    this._treeLoading = true;
    this._treeError = null;
    try {
      const data = await api.get('/api/curator/tree');
      this._tree = Array.isArray(data) ? data : (data.tree || []);
    } catch (e) {
      this._treeError = e.message || 'Failed to load file tree';
    }
    this._treeLoading = false;
  }

  async _loadFile(path) {
    if (this._editDirty) {
      if (!confirm('Discard unsaved changes?')) {return;}
    }
    this._activeFile = path;
    this._fileLoading = true;
    this._fileError = null;
    this._editMode = false;
    this._editDirty = false;
    this._searchActive = false;
    try {
      const data = await api.get(`/api/curator/file?path=${encodeURIComponent(path)}`);
      this._fileContent = typeof data === 'string' ? data : (data.content || '');
    } catch (e) {
      this._fileError = e.message || 'Failed to load file';
    }
    this._fileLoading = false;
  }

  _toggleFolder(path) {
    this._expandedFolders = {
      ...this._expandedFolders,
      [path]: !this._expandedFolders[path]
    };
  }

  _startEdit() {
    this._editContent = this._fileContent;
    this._editMode = true;
    this._editDirty = false;
  }

  _cancelEdit() {
    if (this._editDirty && !confirm('Discard changes?')) {return;}
    this._editMode = false;
    this._editDirty = false;
  }

  _onEditInput(e) {
    this._editContent = e.target.value;
    this._editDirty = true;
  }

  async _saveFile() {
    if (!this._activeFile) {return;}
    this._editSaving = true;
    try {
      await api.put('/api/curator/file', { path: this._activeFile, content: this._editContent });
      this._fileContent = this._editContent;
      this._editDirty = false;
      this._editMode = false;
    } catch (e) {
      alert('Save failed: ' + (e.message || 'Unknown error'));
    }
    this._editSaving = false;
  }

  _onSearchInput(e) {
    const q = e.target.value;
    this._searchQuery = q;
    clearTimeout(this._searchDebounce);
    if (!q.trim()) {
      this._searchActive = false;
      this._searchResults = [];
      return;
    }
    this._searchDebounce = setTimeout(() => this._runSearch(q), 300);
  }

  async _runSearch(q) {
    this._searchActive = true;
    this._searchLoading = true;
    try {
      const data = await api.get(`/api/curator/search?q=${encodeURIComponent(q)}`);
      this._searchResults = Array.isArray(data) ? data : (data.results || []);
    } catch (e) {
      this._searchResults = [];
    }
    this._searchLoading = false;
  }

  // AI Chat
  _openChat() { this._chatOpen = true; }
  _closeChat() { this._chatOpen = false; }

  async _sendChat() {
    const msg = this._chatInput.trim();
    if (!msg || this._chatLoading) {return;}
    this._chatMessages = [...this._chatMessages, { role: 'user', text: msg }];
    this._chatInput = '';
    this._chatLoading = true;
    const assistantIdx = this._chatMessages.length;
    this._chatMessages = [...this._chatMessages, { role: 'assistant', text: '' }];

    try {
      const response = await fetch('/api/curator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          context: this._fileContent,
          history: this._chatMessages.slice(0, -1).slice(-20)
        })
      });

      if (!response.ok) {throw new Error(`HTTP ${response.status}`);}
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) {break;}
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const chunk = line.slice(6);
              if (chunk === '[DONE]') {continue;}
              try {
                const parsed = JSON.parse(chunk);
                const text = parsed.text || parsed.delta || parsed.content || '';
                const msgs = [...this._chatMessages];
                msgs[assistantIdx] = { role: 'assistant', text: msgs[assistantIdx].text + text };
                this._chatMessages = msgs;
              } catch {}
            }
          }
        }
      } else {
        const data = await response.json();
        const text = data.text || data.message || data.response || '';
        const msgs = [...this._chatMessages];
        msgs[assistantIdx] = { role: 'assistant', text };
        this._chatMessages = msgs;
      }
    } catch (e) {
      const msgs = [...this._chatMessages];
      msgs[assistantIdx] = { role: 'assistant', text: `Error: ${e.message}` };
      this._chatMessages = msgs;
    }
    this._chatLoading = false;
  }

  _onChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
  }

  // People directory parser
  _parsePeople(markdown) {
    const people = [];
    const sections = markdown.split(/\n#{2,3}\s+/);
    for (const sec of sections.slice(1)) {
      const lines = sec.split('\n');
      const name = lines[0].trim();
      const info = {};
      for (const line of lines.slice(1)) {
        const m = line.match(/^\*\*(.*?)\*\*[:\s]+(.*)/);
        if (m) {info[m[1].trim()] = m[2].trim();}
      }
      if (name) {people.push({ name, ...info });}
    }
    return people;
  }

  // Revenue tracker parser
  _parseRevenue(markdown) {
    const rows = [];
    let inTable = false;
    for (const line of markdown.split('\n')) {
      if (line.includes('|')) {
        if (line.match(/^\|?[-| :]+\|?$/)) { inTable = true; continue; }
        const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
        if (cells.length > 1) {rows.push(cells);}
      }
    }
    return rows;
  }

  _filterTree(items, query) {
    if (!query) {return items;}
    const q = query.toLowerCase();
    return items.reduce((acc, item) => {
      if (item.type === 'file') {
        if (item.name.toLowerCase().includes(q)) {acc.push(item);}
      } else if (item.type === 'directory' || item.type === 'folder') {
        const children = this._filterTree(item.children || [], query);
        if (children.length > 0 || item.name.toLowerCase().includes(q)) {
          acc.push({ ...item, children });
        }
      }
      return acc;
    }, []);
  }

  // ── Voice Pipeline ──────────────────────────
  _startVoiceRefresh() {
    if (this._voiceRefreshInterval) {return;}
    this._voiceRefreshInterval = setInterval(() => { this._loadVoice(); this._loadIngestionStatus(); }, 5000);
    this._loadVoice();
    this._loadIngestionStatus();
  }

  _stopVoiceRefresh() {
    if (this._voiceRefreshInterval) {
      clearInterval(this._voiceRefreshInterval);
      this._voiceRefreshInterval = null;
    }
  }

  async _loadVoice() {
    try {
      const [stats, pipeline] = await Promise.allSettled([
        api.get('/api/voice/stats'),
        api.get('/api/voice/pipeline')
      ]);
      if (stats.status === 'fulfilled') {this._voiceStats = stats.value;}
      if (pipeline.status === 'fulfilled') {this._voicePipeline = pipeline.value;}
      if (this._logsOpen) {this._loadLogs();}
    } catch {}
    this._voiceLoading = false;
  }

  async _loadLogs() {
    try {
      const data = await api.get(`/api/docker/logs/audio-listener?tail=${this._logsTailSize}`);
      this._pipelineLogs = Array.isArray(data) ? data : (data.logs || []);
    } catch {}
  }

  _toggleLogs() {
    this._logsOpen = !this._logsOpen;
    if (this._logsOpen) {this._loadLogs();}
  }

  _stageStatus(stage) {
    const p = this._voicePipeline;
    if (!p) {return 'idle';}
    const s = p[stage];
    if (!s) {return 'idle';}
    return s.status || 'idle';
  }

  _logLevel(line) {
    if (typeof line === 'object') {return line.level || 'info';}
    const l = (line || '').toLowerCase();
    if (l.includes('error') || l.includes('exception')) {return 'error';}
    if (l.includes('warn')) {return 'warn';}
    if (l.includes('debug')) {return 'debug';}
    return 'info';
  }

  _logText(line) {
    if (typeof line === 'object') {return `${line.timestamp || ''} ${line.message || ''}`.trim();}
    return line;
  }

  // ── Transcripts ──────────────────────────────
  async _loadTranscripts() {
    this._transcriptsLoading = true;
    try {
      const params = new URLSearchParams({
        page: this._transcriptPage,
        limit: this._transcriptPageSize,
      });
      if (this._transcriptSearch) {params.set('q', this._transcriptSearch);}
      const data = await api.get(`/api/voice/transcripts?${params}`);
      this._transcripts = data.items || data.transcripts || [];
      this._transcriptTotal = data.total || this._transcripts.length;
    } catch { this._transcripts = []; }
    this._transcriptsLoading = false;
  }

  _onTranscriptSearch(e) {
    this._transcriptSearch = e.target.value;
    clearTimeout(this._transcriptSearchDebounce);
    this._transcriptSearchDebounce = setTimeout(() => {
      this._transcriptPage = 1;
      this._loadTranscripts();
    }, 300);
  }

  _transcriptPagePrev() {
    if (this._transcriptPage <= 1) {return;}
    this._transcriptPage--;
    this._loadTranscripts();
  }

  _transcriptPageNext() {
    const maxPage = Math.ceil(this._transcriptTotal / this._transcriptPageSize);
    if (this._transcriptPage >= maxPage) {return;}
    this._transcriptPage++;
    this._loadTranscripts();
  }

  _onTranscriptPageSize(e) {
    this._transcriptPageSize = Number(e.target.value);
    this._transcriptPage = 1;
    this._loadTranscripts();
  }

  async _openTranscriptDetail(id) {
    this._transcriptDetailOpen = true;
    this._transcriptDetailLoading = true;
    this._transcriptDetail = null;
    this._transcriptLabelSpeaker = {};
    this._transcriptPlaybackSpeed = 1;
    this._transcriptActiveUtterance = -1;
    try {
      const data = await api.get(`/api/voice/transcripts/${id}`);
      this._transcriptDetail = data;
      // Pre-populate label map from existing utterances
      const labels = {};
      for (const u of (data.utterances || [])) {
        if (u.speaker) {labels[u.speaker] = u.speakerName || u.speaker;}
      }
      this._transcriptLabelSpeaker = labels;
    } catch (e) {
      this._transcriptDetail = { error: e.message };
    }
    this._transcriptDetailLoading = false;
  }

  _closeTranscriptDetail() {
    this._transcriptDetailOpen = false;
    this._transcriptDetail = null;
    this._transcriptPlaybackSpeed = 1;
    this._transcriptActiveUtterance = -1;
  }

  _onTranscriptAudioLoaded(e) {
    const audio = e.target;
    if (audio) {audio.playbackRate = this._transcriptPlaybackSpeed;}
  }

  _onTranscriptAudioTimeUpdate(e) {
    const audio = e.target;
    if (!audio || !this._transcriptDetail) {return;}
    this._transcriptCurrentTime = audio.currentTime;
    const currentTime = audio.currentTime;
    const utterances = this._transcriptDetail.utterances || [];
    let activeIdx = -1;
    for (let i = 0; i < utterances.length; i++) {
      const u = utterances[i];
      if (u.start != null && u.end != null && currentTime >= u.start && currentTime <= u.end) {
        activeIdx = i;
        break;
      }
    }
    if (activeIdx !== this._transcriptActiveUtterance) {
      this._transcriptActiveUtterance = activeIdx;
      // Scroll active utterance into view
      if (activeIdx >= 0) {
        const modalBody = this.shadowRoot?.querySelector('.modal-body');
        const rows = modalBody?.querySelectorAll('.utterance-row');
        if (rows && rows[activeIdx]) {
          rows[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }

  _setPlaybackSpeed(speed) {
    this._transcriptPlaybackSpeed = speed;
    const audio = this.shadowRoot?.querySelector('#transcript-detail-audio');
    if (audio) {audio.playbackRate = speed;}
  }

  _seekToUtterance(u) {
    if (u.start == null) {return;}
    const audio = this.shadowRoot?.querySelector('#transcript-detail-audio');
    if (!audio) {return;}
    audio.currentTime = u.start;
    if (audio.paused) {audio.play();}
  }

  _toggleTranscriptCardAudio(t, e) {
    e.stopPropagation();
    const audio = this.shadowRoot?.querySelector(`audio[data-card-audio="${t.id}"]`);
    const btn = this.shadowRoot?.querySelector(`button[data-audio-id="${t.id}"]`);
    if (!audio) {return;}

    // Stop any other playing card audio
    const allAudios = this.shadowRoot?.querySelectorAll('audio[data-card-audio]') || [];
    const allBtns = this.shadowRoot?.querySelectorAll('.mini-play-btn') || [];
    for (const other of allAudios) {
      if (other !== audio && !other.paused) {
        other.pause();
        other.currentTime = 0;
      }
    }
    for (const otherBtn of allBtns) {
      if (otherBtn !== btn) {otherBtn.classList.remove('playing');}
    }

    if (audio.paused) {
      audio.play();
      if (btn) { btn.classList.add('playing'); btn.innerHTML = '&#9646;&#9646;'; }
    } else {
      audio.pause();
      if (btn) { btn.classList.remove('playing'); btn.innerHTML = '&#9654;'; }
    }
  }

  _onCardAudioEnded(id, e) {
    e.stopPropagation();
    const btn = this.shadowRoot?.querySelector(`button[data-audio-id="${id}"]`);
    if (btn) { btn.classList.remove('playing'); btn.innerHTML = '&#9654;'; }
  }

  async _retryTranscript(id, e) {
    e.stopPropagation();
    try {
      await api.post(`/api/voice/transcripts/${id}/retry`, {});
      this._loadTranscripts();
    } catch (er) { alert('Retry failed: ' + er.message); }
  }

  _confirmDeleteTranscript(id, e) {
    e.stopPropagation();
    this._confirmDelete = { type: 'transcript', id, label: `transcript ${id}` };
  }

  async _saveTranscriptLabels() {
    if (!this._transcriptDetail) {return;}
    try {
      await api.post(`/api/voice/transcripts/${this._transcriptDetail.id}/label-speaker`, {
        labels: this._transcriptLabelSpeaker
      });
      this._loadTranscripts();
    } catch (e) { alert('Save failed: ' + e.message); }
  }

  async _onUtteranceSpeakerChange(speakerId, e) {
    const name = e.target.value;
    this._transcriptLabelSpeaker = { ...this._transcriptLabelSpeaker, [speakerId]: name };
    this.requestUpdate();
    if (!this._transcriptDetail || !name) {return;}
    try {
      const resp = await api.post(`/api/voice/transcripts/${this._transcriptDetail.id}/label-speaker`, { speakerId, name });
      this._showToast(`Labeled ${speakerId} as "${name}"`);
      if (resp && resp.curatorStatus === 're-evaluating') {
        this._showToast('All speakers identified — syncing to Curator', 'success');
      }
    } catch (err) {
      this._showToast(`Label failed: ${err.message}`, 'error');
    }
  }

  async _retryAllPending() {
    try {
      // Retry all pending transcripts individually
      const data = await api.get('/api/voice/transcripts?limit=100');
      const transcripts = Array.isArray(data) ? data : (data?.transcripts || []);
      const pending = transcripts.filter(t => t.status === 'pending' || t.pipeline_status === 'pending');
      for (const t of pending) {
        await api.post(`/api/voice/transcripts/${t.id}/retry`).catch(() => {});
      }
      this._loadTranscripts();
    } catch (e) { alert('Failed: ' + e.message); }
  }

  // ── Conversations ───────────────────────────────
  _toggleConversationView() {
    this._conversationView = !this._conversationView;
    if (this._conversationView && this._conversations.length === 0) {
      this._loadConversations();
    }
  }

  async _loadConversations() {
    this._conversationsLoading = true;
    try {
      const params = new URLSearchParams({
        page: this._conversationPage,
        limit: 20,
      });
      const data = await api.get(`/api/voice/conversations?${params}`);
      this._conversations = data.conversations || [];
      this._conversationTotal = data.total || this._conversations.length;
    } catch {
      this._conversations = [];
    }
    this._conversationsLoading = false;
  }

  _convPagePrev() {
    if (this._conversationPage <= 1) {return;}
    this._conversationPage--;
    this._loadConversations();
  }

  _convPageNext() {
    const maxPage = Math.ceil(this._conversationTotal / 20);
    if (this._conversationPage >= maxPage) {return;}
    this._conversationPage++;
    this._loadConversations();
  }

  async _toggleExpandConversation(id) {
    if (this._expandedConversation === id) {
      this._expandedConversation = null;
      this._expandedConversationData = null;
      return;
    }
    this._expandedConversation = id;
    this._expandedConversationData = null;
    this._expandedConversationLoading = true;
    try {
      const data = await api.get(`/api/voice/conversations/${id}`);
      this._expandedConversationData = data;
    } catch {
      this._expandedConversationData = { error: 'Failed to load conversation' };
    }
    this._expandedConversationLoading = false;
  }

  // ── Speakers ──────────────────────────────────
  async _loadProfiles() {
    this._profilesLoading = true;
    try {
      const data = await api.get('/api/voice/profiles');
      this._profiles = Array.isArray(data) ? data : (data.profiles || []);
    } catch { this._profiles = []; }
    this._profilesLoading = false;
  }

  async _loadCandidates() {
    this._candidatesLoading = true;
    try {
      const data = await api.get('/api/voice/candidates');
      this._candidates = Array.isArray(data) ? data : (data.candidates || []);
    } catch { this._candidates = []; }
    this._candidatesLoading = false;
  }

  _startRename(id, currentName) {
    this._renameTarget = id;
    this._renameName = currentName;
  }

  _cancelRename() { this._renameTarget = null; }

  async _saveRename() {
    if (!this._renameTarget || !this._renameName.trim()) {return;}
    try {
      await api.patch(`/api/voice/profiles/${this._renameTarget}`, { newName: this._renameName.trim() });
      await this._loadProfiles();
    } catch (e) { alert('Rename failed: ' + e.message); }
    this._renameTarget = null;
  }

  _confirmDeleteProfile(id, name) {
    this._confirmDelete = { type: 'profile', id, label: `profile "${name}"` };
  }

  _startApprove(id) { this._approveTarget = id; this._approveName = ''; }
  _cancelApprove() { this._approveTarget = null; }

  async _saveApprove(id) {
    const name = this._approveName.trim();
    if (!name) {return;}
    try {
      await api.post(`/api/voice/candidates/${id}/approve`, { name });
      await Promise.all([this._loadProfiles(), this._loadCandidates()]);
    } catch (e) { alert('Approve failed: ' + e.message); }
    this._approveTarget = null;
  }

  async _rejectCandidate(id) {
    try {
      await api.post(`/api/voice/candidates/${id}/reject`, {});
      this._loadCandidates();
    } catch (e) { alert('Reject failed: ' + e.message); }
  }

  _confirmDeleteCandidate(id) {
    this._confirmDelete = { type: 'candidate', id, label: `candidate ${id}` };
  }

  async _executeDelete() {
    const d = this._confirmDelete;
    if (!d) {return;}
    this._confirmDelete = null;
    try {
      if (d.type === 'transcript') {
        await api.delete(`/api/voice/transcripts/${d.id}`);
        this._loadTranscripts();
      } else if (d.type === 'profile') {
        await api.delete(`/api/voice/profiles/${d.id}`);
        this._loadProfiles();
      } else if (d.type === 'candidate') {
        await api.delete(`/api/voice/candidates/${d.id}`);
        this._loadCandidates();
      }
    } catch (e) { alert('Delete failed: ' + e.message); }
  }

  // ── Render ───────────────────────────────────
  render() {
    return html`
      <div class="page-header">
        <h1 class="page-title">Knowledge</h1>
        <span class="page-subtitle">Library, voice pipeline, transcripts & speaker profiles</span>
      </div>
      <div class="tab-bar">
        ${['library', 'pipeline', 'transcripts', 'speakers'].map(tab => html`
          <button class="tab-btn ${this._activeTab === tab ? 'active' : ''}"
                  @click=${() => this._setTab(tab)}>
            ${tab === 'library' ? 'Library' :
              tab === 'pipeline' ? 'Voice Pipeline' :
              tab === 'transcripts' ? 'Transcripts' : 'Speakers'}
          </button>
        `)}
      </div>
      <div class="tab-content">
        ${this._activeTab === 'library' ? this._renderLibrary() : ''}
        ${this._activeTab === 'pipeline' ? this._renderPipeline() : ''}
        ${this._activeTab === 'transcripts' ? this._renderTranscripts() : ''}
        ${this._activeTab === 'speakers' ? this._renderSpeakers() : ''}
      </div>
      ${this._transcriptDetailOpen ? this._renderTranscriptModal() : ''}
      ${this._confirmDelete ? this._renderConfirmDialog() : ''}
      ${this._showCreateProfile ? this._renderCreateProfileModal() : ''}
      ${this._showMergeModal ? this._renderMergeModal() : ''}
      ${this._toast ? html`<div class="toast toast-${this._toast.type}">${this._toast.message}</div>` : ''}
    `;
  }

  // ── Library Render ───────────────────────────
  _renderInsightsBar() {
    if (!this._insights) {return '';}
    const i = this._insights;
    const fredFiles = (i.fredLibrary || []).slice(0, 5);
    const profiles = (i.recentProfiles || []).slice(0, 5);
    const ago = (d) => {
      const ms = Date.now() - new Date(d).getTime();
      const h = Math.floor(ms / 3600000);
      if (h < 1) {return `${Math.floor(ms / 60000)}m ago`;}
      if (h < 24) {return `${h}h ago`;}
      return `${Math.floor(h / 24)}d ago`;
    };
    return html`
      <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;letter-spacing:0.5px">Fred's Knowledge</div>
          ${fredFiles.map(f => html`
            <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;cursor:pointer;color:var(--text)"
                 @click=${() => { this._loadFile(`library/fred/${f.name}`); }}>
              <span>${f.name.replace('.md', '')}</span>
              <span style="color:var(--text-dim);font-size:11px">${ago(f.modified)}</span>
            </div>
          `)}
        </div>
        <div style="flex:1;min-width:200px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;letter-spacing:0.5px">Recent Profiles</div>
          ${profiles.map(p => html`
            <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;cursor:pointer;color:var(--text)"
                 @click=${() => { this._loadFile(`profiles/${p.path.split('/').pop()}`); }}>
              <span style="text-transform:capitalize">${p.name}</span>
              <span style="color:var(--text-dim);font-size:11px">${ago(p.modified)}</span>
            </div>
          `)}
        </div>
        <div style="min-width:120px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;letter-spacing:0.5px">Last 7 Days</div>
          <div style="font-size:28px;font-weight:600;color:var(--accent)">${i.recentTranscriptCount ?? 0}</div>
          <div style="font-size:11px;color:var(--text-dim)">transcripts</div>
        </div>
      </div>
    `;
  }

  _renderLibrary() {
    return html`
      ${this._renderInsightsBar()}
      <div class="library-layout">
        <div class="tree-panel">
          <div class="tree-search">
            <input type="text" placeholder="Filter files..." .value=${this._treeSearch}
                   @input=${e => { this._treeSearch = e.target.value; this.requestUpdate(); }} />
          </div>
          <div class="tree-body">
            ${this._treeLoading ? html`<div class="loading-spinner"><div class="spinner"></div>Loading...</div>` : ''}
            ${this._treeError ? html`<div class="error-msg">${this._treeError}</div>` : ''}
            ${!this._treeLoading && !this._treeError ? this._renderTree(
              this._filterTree(this._tree, this._treeSearch), ''
            ) : ''}
          </div>
        </div>
        <div class="doc-panel">
          <div class="doc-toolbar">
            <div class="doc-search">
              <input type="text" placeholder="Search library..." .value=${this._searchQuery}
                     @input=${this._onSearchInput.bind(this)} />
            </div>
            ${this._activeFile && !this._searchActive ? html`
              <span class="doc-title">${this._activeFile.split('/').pop()}</span>
            ` : ''}
            <div class="doc-actions">
              ${this._editDirty ? html`<span class="dirty-badge">Unsaved</span>` : ''}
              ${this._activeFile && !this._editMode && !this._searchActive ? html`
                <button class="btn btn-sm btn-accent" @click=${this._startEdit.bind(this)}>Edit</button>
                <button class="btn btn-sm" @click=${this._openChat.bind(this)}>AI Chat</button>
              ` : ''}
              ${this._editMode ? html`
                <button class="btn btn-sm" @click=${() => this._editPreview = !this._editPreview}>
                  ${this._editPreview ? 'Hide Preview' : 'Preview'}
                </button>
                <button class="btn btn-sm btn-green" ?disabled=${this._editSaving}
                        @click=${this._saveFile.bind(this)}>
                  ${this._editSaving ? 'Saving...' : 'Save'}
                </button>
                <button class="btn btn-sm" @click=${this._cancelEdit.bind(this)}>Cancel</button>
              ` : ''}
            </div>
          </div>
          <div class="doc-body">
            ${this._searchActive ? this._renderSearchResults() : this._renderDocViewer()}
            <div class="chat-panel ${this._chatOpen ? '' : 'closed'}">
              ${this._chatOpen ? this._renderChatPanel() : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderTree(items, parentPath) {
    if (!items || items.length === 0) {return html`<div class="empty-msg" style="font-size:11px">No files</div>`;}
    return items.map(item => {
      const path = parentPath ? `${parentPath}/${item.name}` : item.name;
      if (item.type === 'directory' || item.type === 'folder') {
        const open = !!this._expandedFolders[path];
        return html`
          <div class="tree-folder">
            <div class="tree-folder-header" @click=${() => this._toggleFolder(path)}>
              <span class="tree-arrow ${open ? 'open' : ''}">▶</span>
              <span class="tree-folder-icon">📁</span>
              <span class="tree-folder-name">${item.name}</span>
            </div>
            ${open ? html`<div class="tree-children">${this._renderTree(item.children || [], path)}</div>` : ''}
          </div>
        `;
      } else {
        const active = this._activeFile === path;
        return html`
          <div class="tree-file ${active ? 'active' : ''}" @click=${() => this._loadFile(path)}>
            <span class="tree-file-icon">📄</span>
            <span>${item.name}</span>
          </div>
        `;
      }
    });
  }

  _renderDocViewer() {
    if (!this._activeFile) {
      return html`<div class="empty-msg">Select a file from the tree to view it.</div>`;
    }
    if (this._fileLoading) {
      return html`<div class="loading-spinner"><div class="spinner"></div>Loading...</div>`;
    }
    if (this._fileError) {
      return html`<div class="error-msg">Error: ${this._fileError}</div>`;
    }
    if (this._editMode) {
      return html`
        <div class="doc-edit-wrap">
          <div class="doc-edit-area">
            <div class="doc-preview-label">EDITOR</div>
            <textarea class="doc-textarea" .value=${this._editContent}
                      @input=${this._onEditInput.bind(this)}></textarea>
          </div>
          ${this._editPreview ? html`
            <div class="doc-edit-area">
              <div class="doc-preview-label">PREVIEW</div>
              <div class="doc-preview-pane doc-viewer-inner">
                <div .innerHTML=${renderMarkdown(this._editContent)}></div>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Special sub-views
    if (this._activeFile === 'people/directory.md') {
      return this._renderPeopleDirectory();
    }
    if (this._activeFile === 'revenue/tracker.md') {
      return this._renderRevenueTracker();
    }

    return html`
      <div class="doc-viewer">
        <div class="doc-viewer-inner" .innerHTML=${renderMarkdown(this._fileContent)}></div>
      </div>
    `;
  }

  _renderPeopleDirectory() {
    const people = this._parsePeople(this._fileContent);
    if (people.length === 0) {
      return html`
        <div class="doc-viewer">
          <div class="doc-viewer-inner" .innerHTML=${renderMarkdown(this._fileContent)}></div>
        </div>
      `;
    }
    return html`
      <div class="doc-viewer" style="padding:0">
        <div class="people-grid">
          ${people.map(p => html`
            <div class="person-card">
              <div class="person-name">${p.name}</div>
              ${p.Role || p.Company ? html`<div class="person-role">${p.Role || ''}${p.Role && p.Company ? ' @ ' : ''}${p.Company || ''}</div>` : ''}
              <div class="person-info">
                ${p.Email ? html`<div>✉ ${p.Email}</div>` : ''}
                ${p.Phone ? html`<div>📞 ${p.Phone}</div>` : ''}
                ${p.Notes ? html`<div style="margin-top:6px;color:var(--text-dim)">${p.Notes}</div>` : ''}
              </div>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  _renderRevenueTracker() {
    const rows = this._parseRevenue(this._fileContent);
    if (rows.length < 2) {
      return html`
        <div class="doc-viewer">
          <div class="doc-viewer-inner" .innerHTML=${renderMarkdown(this._fileContent)}></div>
        </div>
      `;
    }
    const headers = rows[0];
    const dataRows = rows.slice(1);
    return html`
      <div class="doc-viewer">
        <div class="doc-viewer-inner">
          <h2>Revenue Tracker</h2>
          <table>
            <thead>
              <tr>${headers.map(h => html`<th>${h}</th>`)}</tr>
            </thead>
            <tbody>
              ${dataRows.map((row, ri) => html`
                <tr style="${row[0]?.toLowerCase() === 'total' ? 'font-weight:700;color:var(--accent)' : ''}">
                  ${row.map((cell, ci) => {
                    const isNum = ci > 0 && cell && !isNaN(cell.replace(/[$,]/g, ''));
                    const num = isNum ? parseFloat(cell.replace(/[$,]/g, '')) : null;
                    return html`<td style="${isNum ? 'text-align:right' : ''}">
                      ${isNum ? html`
                        <span style="color:${num > 0 ? 'var(--green)' : num < 0 ? 'var(--red)' : 'var(--text)'}">
                          ${num > 0 ? '▲ ' : num < 0 ? '▼ ' : ''}${cell}
                        </span>
                      ` : cell}
                    </td>`;
                  })}
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderSearchResults() {
    if (this._searchLoading) {
      return html`<div class="loading-spinner"><div class="spinner"></div>Searching...</div>`;
    }
    if (this._searchResults.length === 0) {
      return html`<div class="search-results"><div class="search-empty">No results for "${this._searchQuery}"</div></div>`;
    }
    return html`
      <div class="search-results">
        ${this._searchResults.map(r => {
          // Search returns { file, matches, totalMatches }
          // file may be "library/foo.md" — strip "library/" prefix for _loadFile since tree paths are relative to library/
          const filePath = r.file || r.path || '';
          const loadPath = filePath.startsWith('library/') ? filePath.slice(8) : filePath;
          const excerpt = r.matches?.length > 0
            ? r.matches.map(m => m.text).join(' ... ')
            : (r.excerpt || r.preview || '');
          return html`
            <div class="search-result-card" @click=${() => this._loadFile(loadPath)}>
              <div class="search-result-path">${filePath}</div>
              <div class="search-result-excerpt" .innerHTML=${highlight(excerpt, this._searchQuery)}></div>
              ${r.totalMatches > 0 ? html`<div style="font-size:10px;color:var(--text-muted);margin-top:4px">${r.totalMatches} match${r.totalMatches !== 1 ? 'es' : ''}</div>` : ''}
            </div>
          `;
        })}
      </div>
    `;
  }

  _renderChatPanel() {
    return html`
      <div class="chat-header">
        <span class="chat-header-title">AI Chat</span>
        <button class="btn btn-icon btn-sm" @click=${this._closeChat.bind(this)}>✕</button>
      </div>
      <div class="chat-messages">
        ${this._chatMessages.length === 0 ? html`
          <div style="color:var(--text-muted);font-size:11px;padding:8px">
            Ask a question about this document.
          </div>
        ` : this._chatMessages.map(m => html`
          <div class="chat-msg chat-msg-${m.role}">
            <span class="chat-msg-label">${m.role === 'user' ? 'You' : 'Gemini'}</span>
            <div class="chat-msg-body">${m.text}</div>
          </div>
        `)}
        ${this._chatLoading ? html`
          <div class="chat-typing">
            <div class="dot"></div><div class="dot"></div><div class="dot"></div>
            <span>Thinking...</span>
          </div>
        ` : ''}
      </div>
      <div class="chat-input-row">
        <input type="text" placeholder="Ask about this doc..." .value=${this._chatInput}
               @input=${e => this._chatInput = e.target.value}
               @keydown=${this._onChatKeydown.bind(this)} />
        <button class="btn btn-sm btn-accent" ?disabled=${this._chatLoading}
                @click=${this._sendChat.bind(this)}>Send</button>
      </div>
    `;
  }

  // ── Pipeline Render ──────────────────────────
  _renderPipeline() {
    const s = this._voiceStats || {};
    const p = this._voicePipeline || {};
    const stageList = [
      { key: 'microphone', icon: '🎤', name: 'Microphone' },
      { key: 'listener', icon: '📡', name: 'Audio Listener' },
      { key: 'transcription', icon: '🗣️', name: 'AssemblyAI' },
      { key: 'speakerId', icon: '👤', name: 'Speaker ID' },
      { key: 'curatorSync', icon: '📚', name: 'Curator Sync' },
    ];
    const queueStats = p.queue || {};

    return html`
      <div class="pipeline-content">
        <!-- Stats grid -->
        <div class="stats-grid-3">
          <div class="stat-card">
            <div class="stat-label">Total Transcripts</div>
            <div class="stat-value">${s.totalTranscripts ?? '—'}</div>
            <div class="stat-sub">All time</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Known Speakers</div>
            <div class="stat-value">${s.knownSpeakers ?? '—'}</div>
            <div class="stat-sub">Enrolled profiles</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Pending Candidates</div>
            <div class="stat-value" style="color:var(--yellow)">${s.pendingCandidates ?? '—'}</div>
            <div class="stat-sub">Awaiting review</div>
          </div>
        </div>

        <!-- Pipeline flow -->
        <div class="pipeline-flow">
          <div class="pipeline-flow-title">Pipeline Status</div>
          <div class="pipeline-dual-input">
            <div class="pipeline-input-sources">
              <div class="pipeline-source">
                <div class="pipeline-stage">
                  <div class="pipeline-stage-icon">
                    🎤
                    <span class="stage-dot ${this._ingestionStatus?.microphone?.active ? 'ok' : 'warn'}"></span>
                  </div>
                  <div class="pipeline-stage-name">Microphone</div>
                </div>
                <button class="toggle-btn ${this._ingestionStatus?.microphone?.active ? 'active' : 'paused'}"
                        @click=${() => this._toggleIngestion('microphone')}>
                  ${this._ingestionStatus?.microphone?.active ? 'Active' : 'Paused'}
                </button>
              </div>
              <div class="pipeline-source">
                <div class="pipeline-stage">
                  <div class="pipeline-stage-icon">
                    📁
                    <span class="stage-dot ${this._ingestionStatus?.watchFolder?.active ? 'ok' : 'warn'}"></span>
                  </div>
                  <div class="pipeline-stage-name">Watch Folder</div>
                </div>
                <button class="toggle-btn ${this._ingestionStatus?.watchFolder?.active ? 'active' : 'paused'}"
                        @click=${() => this._toggleIngestion('watch-folder')}>
                  ${this._ingestionStatus?.watchFolder?.active ? 'Active' : 'Paused'}
                </button>
              </div>
            </div>
            <div class="pipeline-arrow">→</div>
            <div class="pipeline-stage">
              <div class="pipeline-stage-icon">📡<span class="stage-dot ${this._stageStatus('listener')}"></span></div>
              <div class="pipeline-stage-name">Audio Listener</div>
            </div>
            <div class="pipeline-arrow">→</div>
            <div class="pipeline-stage">
              <div class="pipeline-stage-icon">🗣️<span class="stage-dot ${this._stageStatus('transcription')}"></span></div>
              <div class="pipeline-stage-name">AssemblyAI</div>
            </div>
            <div class="pipeline-arrow">→</div>
            <div class="pipeline-stage">
              <div class="pipeline-stage-icon">👤<span class="stage-dot ${this._stageStatus('speakerId')}"></span></div>
              <div class="pipeline-stage-name">Speaker ID</div>
            </div>
            <div class="pipeline-arrow">→</div>
            <div class="pipeline-stage">
              <div class="pipeline-stage-icon">📚<span class="stage-dot ${this._stageStatus('curatorSync')}"></span></div>
              <div class="pipeline-stage-name">Curator Sync</div>
            </div>
          </div>
        </div>

        <!-- Queue stats -->
        <div class="queue-grid">
          <div class="queue-card">
            <div class="queue-label">Inbox</div>
            <div class="queue-value inbox">${queueStats.inbox ?? s.queueInbox ?? '—'}</div>
          </div>
          <div class="queue-card">
            <div class="queue-label">Processing</div>
            <div class="queue-value processing">${queueStats.processing ?? s.queueProcessing ?? '—'}</div>
          </div>
          <div class="queue-card">
            <div class="queue-label">Done Today</div>
            <div class="queue-value done">${queueStats.doneToday ?? s.doneToday ?? '—'}</div>
          </div>
          <div class="queue-card">
            <div class="queue-label">Errors</div>
            <div class="queue-value error">${queueStats.errors ?? s.errors ?? '—'}</div>
          </div>
        </div>

        <!-- Stage detail cards -->
        <div class="stage-cards">
          ${this._renderStageCard('📡', 'Audio Listener', [
            ['Container Status', p.listener?.containerStatus || '—'],
            ['Files Today', p.listener?.filesProcessedToday ?? '—'],
            ['Error Rate', p.listener?.errorRate != null ? `${(p.listener.errorRate * 100).toFixed(1)}%` : '—'],
            ['Last File', p.listener?.lastFile ? timeAgo(p.listener.lastFile) : '—'],
          ])}
          ${this._renderStageCard('🗣️', 'Transcription', [
            ['Queue Depth', p.transcription?.queueDepth ?? '—'],
            ['Avg Time', p.transcription?.avgProcessingTime ? formatDuration(p.transcription.avgProcessingTime) : '—'],
            ['Last Processed', p.transcription?.lastProcessed ? timeAgo(p.transcription.lastProcessed) : '—'],
          ])}
          ${this._renderStageCard('👤', 'Speaker ID', [
            ['Profiles Loaded', p.speakerId?.profilesLoaded ?? '—'],
            ['ID Rate', p.speakerId?.identificationRate != null ? `${(p.speakerId.identificationRate * 100).toFixed(1)}%` : '—'],
            ['Last Matched', p.speakerId?.lastMatched ? timeAgo(p.speakerId.lastMatched) : '—'],
          ])}
          ${this._renderStageCard('📚', 'Curator Sync', [
            ['Synced Today', p.curatorSync?.syncedToday ?? '—'],
            ['Pending', p.curatorSync?.pending ?? '—'],
            ['Last Sync', p.curatorSync?.lastSync ? timeAgo(p.curatorSync.lastSync) : '—'],
          ])}
        </div>

        ${p.watchFolder ? html`
          <div class="watch-folder-card">
            <div class="card-title">📁 Watch Folder</div>
            <div class="detail-grid-2">
              <div><span class="detail-label">Path</span><span class="detail-value" title="${this._ingestionStatus?.watchFolder?.path || ''}">${p.watchFolder.folderPath || '—'}</span></div>
              <div><span class="detail-label">Status</span><span class="detail-value status-${p.watchFolder.status}">${p.watchFolder.status}</span></div>
              <div><span class="detail-label">Files Detected</span><span class="detail-value">${p.watchFolder.filesDetected ?? '—'}</span></div>
              <div><span class="detail-label">Files Processed</span><span class="detail-value">${p.watchFolder.filesProcessed ?? '—'}</span></div>
              <div><span class="detail-label">Current File</span><span class="detail-value">${p.watchFolder.currentFile || 'None'}</span></div>
              <div><span class="detail-label">Last Processed</span><span class="detail-value">${p.watchFolder.lastProcessed ? timeAgo(p.watchFolder.lastProcessed) : '—'}</span></div>
            </div>
          </div>
        ` : ''}

        ${p.jobCounts ? html`
          <div class="section-header" style="margin-top: 16px;">
            <h3>Job Queue</h3>
          </div>
          <div class="job-status-summary">
            ${Object.entries(p.jobCounts).map(([status, count]) => html`
              <div class="job-status-item ${status.replace(/_/g, '-')}">
                <span class="count">${count}</span>
                <span class="label">${status.replace(/_/g, ' ')}</span>
              </div>
            `)}
          </div>
        ` : ''}

        <!-- Logs panel -->
        <div class="logs-panel">
          <div class="logs-header" @click=${this._toggleLogs.bind(this)}>
            <span style="font-size:10px;color:var(--text-muted)">▶</span>
            <span class="logs-title">Pipeline Logs</span>
            <select class="logs-tail-select" .value=${String(this._logsTailSize)}
                    @change=${e => { this._logsTailSize = Number(e.target.value); this._loadLogs(); }}
                    @click=${e => e.stopPropagation()}>
              <option value="50">50 lines</option>
              <option value="100">100 lines</option>
              <option value="200">200 lines</option>
            </select>
          </div>
          ${this._logsOpen ? html`
            <div class="logs-body">
              ${this._pipelineLogs.length === 0 ? html`<div class="log-line info">No logs available.</div>` : ''}
              ${this._pipelineLogs.map(line => html`
                <div class="log-line ${this._logLevel(line)}">${this._logText(line)}</div>
              `)}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  _renderStageCard(icon, name, rows) {
    return html`
      <div class="stage-detail-card">
        <div class="stage-detail-header">
          <span class="stage-detail-header-icon">${icon}</span>
          <span class="stage-detail-header-name">${name}</span>
        </div>
        <div class="stage-detail-body">
          ${rows.map(([label, value]) => html`
            <div class="stage-row">
              <span class="stage-row-label">${label}</span>
              <span class="stage-row-value">${value}</span>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  // ── Transcripts Render ───────────────────────
  _renderTranscripts() {
    return html`
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
        <div class="transcripts-toolbar">
          ${!this._conversationView ? html`
            <input type="text" placeholder="Search transcripts..." .value=${this._transcriptSearch}
                   @input=${this._onTranscriptSearch.bind(this)} />
          ` : html`<span></span>`}
          <div class="view-toggle">
            <button class="${!this._conversationView ? 'active' : ''}"
                    @click=${() => { this._conversationView = false; }}>Individual</button>
            <button class="${this._conversationView ? 'active' : ''}"
                    @click=${() => this._toggleConversationView()}>Conversations</button>
          </div>
          ${!this._conversationView ? html`
            <div class="bulk-actions">
              <button class="btn btn-sm btn-yellow" @click=${this._retryAllPending.bind(this)}>
                Retry All Pending
              </button>
            </div>
          ` : ''}
        </div>
        ${this._conversationView ? this._renderConversationList() : this._renderTranscriptList()}
      </div>
    `;
  }

  _renderTranscriptList() {
    const maxPage = Math.ceil(this._transcriptTotal / this._transcriptPageSize) || 1;
    return html`
      <div class="transcripts-content">
        ${this._transcriptsLoading ? html`<div class="loading-spinner"><div class="spinner"></div>Loading...</div>` : ''}
        ${!this._transcriptsLoading && this._transcripts.length === 0 ? html`<div class="empty-msg">No transcripts found.</div>` : ''}
        ${this._transcripts.map(t => this._renderTranscriptCard(t))}
      </div>
      <div class="pagination">
        <span class="page-info">
          ${this._transcriptTotal} total — Page ${this._transcriptPage} of ${maxPage}
        </span>
        <select class="page-size-select" .value=${String(this._transcriptPageSize)}
                @change=${this._onTranscriptPageSize.bind(this)}>
          <option value="10">10 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
        </select>
        <button class="btn btn-sm" ?disabled=${this._transcriptPage <= 1}
                @click=${this._transcriptPagePrev.bind(this)}>← Prev</button>
        <button class="btn btn-sm" ?disabled=${this._transcriptPage >= maxPage}
                @click=${this._transcriptPageNext.bind(this)}>Next →</button>
      </div>
    `;
  }

  _renderConversationList() {
    const maxPage = Math.ceil(this._conversationTotal / 20) || 1;
    return html`
      <div class="transcripts-content">
        ${this._conversationsLoading ? html`<div class="loading-spinner"><div class="spinner"></div>Loading...</div>` : ''}
        ${!this._conversationsLoading && this._conversations.length === 0 ? html`<div class="empty-msg">No conversations found. Conversations are generated when transcripts are stitched together.</div>` : ''}
        ${this._conversations.map(c => this._renderConversationCard(c))}
      </div>
      <div class="pagination">
        <span class="page-info">
          ${this._conversationTotal} total — Page ${this._conversationPage} of ${maxPage}
        </span>
        <button class="btn btn-sm" ?disabled=${this._conversationPage <= 1}
                @click=${this._convPagePrev.bind(this)}>← Prev</button>
        <button class="btn btn-sm" ?disabled=${this._conversationPage >= maxPage}
                @click=${this._convPageNext.bind(this)}>Next →</button>
      </div>
    `;
  }

  _renderConversationCard(c) {
    const isExpanded = this._expandedConversation === c.id;
    const speakers = c.speakers || [];
    const startTime = c.startTime ? formatDateTime(c.startTime) : '—';
    const timeRange = c.startTime && c.endTime
      ? `${new Date(c.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} – ${new Date(c.endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
      : '';

    return html`
      <div class="conversation-card ${isExpanded ? 'expanded' : ''}" @click=${() => this._toggleExpandConversation(c.id)}>
        <div class="conv-header">
          <span class="conv-date">${startTime}</span>
          ${timeRange ? html`<span class="conv-time-range">${timeRange}</span>` : ''}
          ${c.duration ? html`<span class="conv-duration">${formatDuration(c.duration)}</span>` : ''}
          <div class="conv-meta">
            <span>${c.transcriptCount || 0} segment${(c.transcriptCount || 0) !== 1 ? 's' : ''}</span>
            <span>${c.totalWords || 0} words</span>
          </div>
        </div>
        <div class="conv-speakers">
          ${speakers.map(sp => html`
            <span class="speaker-badge" style="color:${speakerColor(sp)};border-color:${speakerColor(sp)}40">${sp}</span>
          `)}
          ${speakers.length === 0 ? html`<span class="speaker-badge" style="color:var(--text-muted);border-color:var(--border)">Unknown</span>` : ''}
        </div>
        ${isExpanded ? this._renderExpandedConversation() : ''}
      </div>
    `;
  }

  _renderExpandedConversation() {
    const data = this._expandedConversationData;
    if (this._expandedConversationLoading) {
      return html`<div class="conv-expanded"><div class="loading-spinner"><div class="spinner"></div>Loading...</div></div>`;
    }
    if (!data) {return '';}
    if (data.error) {
      return html`<div class="conv-expanded"><div class="error-msg">${data.error}</div></div>`;
    }

    const utterances = data.utterances || [];
    return html`
      <div class="conv-expanded" @click=${e => e.stopPropagation()}>
        <div class="conv-utterances">
          ${utterances.length === 0 ? html`<div class="empty-msg">No utterances available.</div>` : ''}
          ${utterances.map(u => html`
            <div class="conv-utterance">
              <span class="conv-utt-speaker" style="color:${speakerColor(u.speaker)}">${u.speaker || 'Unknown'}</span>
              <span class="conv-utt-text">${u.text || ''}</span>
              ${u.start != null ? html`<span class="conv-utt-time">${formatDuration(u.start)}</span>` : ''}
            </div>
          `)}
        </div>
      </div>
    `;
  }

  _renderTranscriptCard(t) {
    const speakers = t.speakers || [];
    const status = t.pipelineStatus || t.pipeline_status || t.status || 'complete';
    const statusClass = status === 'done' || status === 'completed' || status === 'complete' ? 'ok' :
                        status === 'processing' || status === 'transcribing' || status === 'identifying' ? 'processing' :
                        status === 'failed' || status === 'error' || status === 'speaker_id_failed' ? 'failed' : 'ok';
    return html`
      <div class="transcript-card" @click=${() => this._openTranscriptDetail(t.id)}>
        <div class="tc-header">
          <span class="tc-datetime">${formatDateTime(t.timestamp)}</span>
          ${t.duration ? html`<span class="tc-duration">${formatDuration(t.duration)}</span>` : ''}
          <span class="tc-status ${statusClass}">${status}</span>
          ${t.confidence != null ? html`<span class="tc-confidence">conf: ${(t.confidence * 100).toFixed(0)}%</span>` : ''}
          ${(() => {
            const si = t.speaker_identification || {};
            const unid = si.unidentified || [];
            return unid.length > 0
              ? html`<span class="pending-curator-badge">Pending Curator</span>`
              : '';
          })()}
        </div>
        <div class="tc-speakers">
          ${speakers.map(sp => html`
            <span class="speaker-badge" style="color:${speakerColor(sp.name || sp)};border-color:${speakerColor(sp.name || sp)}40">
              ${sp.name || sp}
            </span>
          `)}
          ${speakers.length === 0 ? html`<span class="speaker-badge" style="color:var(--text-muted);border-color:var(--border)">Unknown</span>` : ''}
        </div>
        ${(t.preview || t.transcript) ? html`
          <div class="tc-preview">${(t.preview || t.transcript || '').slice(0, 200)}${(t.preview || t.transcript || '').length > 200 ? '…' : ''}</div>
        ` : html`<div class="tc-preview" style="color:var(--text-muted);font-style:italic">No transcript text available</div>`}
        <div class="tc-footer">
          ${(t.audioUrl || t.audioPath) ? html`
            <button class="mini-play-btn" data-audio-id="${t.id}"
                    @click=${e => this._toggleTranscriptCardAudio(t, e)}
                    title="Play audio">&#9654;</button>
            <audio data-card-audio="${t.id}"
                   src="${t.audioUrl || `/api/voice/audio/${t.audioPath}`}"
                   preload="none" style="display:none"
                   @ended=${e => this._onCardAudioEnded(t.id, e)}
                   @click=${e => e.stopPropagation()}></audio>
          ` : ''}
          <div class="tc-actions">
            <button class="btn btn-sm btn-yellow" @click=${e => this._retryTranscript(t.id, e)}>Retry</button>
            <button class="btn btn-sm btn-red" @click=${e => this._confirmDeleteTranscript(t.id, e)}>Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderTranscriptModal() {
    const t = this._transcriptDetail;
    const speakers = t ? [...new Set((t.utterances || []).map(u => u.speaker).filter(Boolean))] : [];
    const profiles = this._profiles.map(p => p.name).filter(Boolean);

    // Build timeline segments
    const totalDur = t?.duration || 1;
    const segmentsByUtterance = (t?.utterances || []).filter(u => u.start != null && u.end != null);

    return html`
      <div class="modal-overlay" @click=${e => { if (e.target === e.currentTarget) {this._closeTranscriptDetail();} }}>
        <div class="modal-box">
          <div class="modal-header">
            <span class="modal-title">
              ${t ? formatDateTime(t.timestamp) : 'Loading...'}
              ${t?.duration ? html` — ${formatDuration(t.duration)}` : ''}
            </span>
            <button class="btn btn-sm" @click=${this._closeTranscriptDetail.bind(this)}>✕</button>
          </div>
          <div class="modal-body">
            ${this._transcriptDetailLoading ? html`<div class="loading-spinner"><div class="spinner"></div>Loading...</div>` : ''}
            ${t?.error ? html`<div class="error-msg">Error: ${t.error}</div>` : ''}
            ${t && !t.error ? html`
              <!-- Speaker timeline -->
              ${segmentsByUtterance.length > 0 ? html`
                <div class="speaker-timeline">
                  ${segmentsByUtterance.map(u => {
                    const pct = ((u.end - u.start) / totalDur * 100).toFixed(2);
                    return html`<span class="timeline-seg" title="${u.speakerName || u.speaker}: ${u.text?.slice(0, 40)}"
                                      style="width:${pct}%;background:${speakerColor(u.speakerName || u.speaker)};opacity:0.7"></span>`;
                  })}
                  <div class="timeline-position" style="left:${((this._transcriptCurrentTime || 0) / totalDur * 100).toFixed(2)}%"></div>
                </div>
              ` : ''}
              <!-- Audio player -->
              ${(t.audioUrl || t.audioPath) ? html`
                <div style="margin-bottom:14px">
                  <audio id="transcript-detail-audio"
                         src="${t.audioUrl || `/api/voice/audio/${t.audioPath}`}"
                         controls style="width:100%;height:32px"
                         @loadedmetadata=${this._onTranscriptAudioLoaded.bind(this)}
                         @timeupdate=${this._onTranscriptAudioTimeUpdate.bind(this)}
                         @ended=${() => { this._transcriptActiveUtterance = -1; }}></audio>
                  <div class="playback-speed-controls" style="margin-top:6px">
                    <span style="font-size:10px;color:var(--text-muted)">Speed:</span>
                    ${[0.5, 1, 1.5, 2].map(speed => html`
                      <button class="speed-btn ${this._transcriptPlaybackSpeed === speed ? 'active' : ''}"
                              @click=${() => this._setPlaybackSpeed(speed)}>
                        ${speed}x
                      </button>
                    `)}
                  </div>
                </div>
              ` : ''}
              <!-- Utterances -->
              <div class="utterances-list">
                ${(t.utterances || []).map((u, idx) => html`
                  <div class="utterance-row ${this._transcriptActiveUtterance === idx ? 'active-utterance' : ''}"
                       @click=${() => this._seekToUtterance(u)}>
                    <div class="utterance-speaker">
                      <select @change=${e => this._onUtteranceSpeakerChange(u.speaker, e)}
                              @click=${e => e.stopPropagation()}>
                        <option value="">Unknown</option>
                        ${profiles.map(name => html`
                          <option value="${name}"
                                  ?selected=${(this._transcriptLabelSpeaker[u.speaker] || u.speakerName) === name}>
                            ${name}
                          </option>
                        `)}
                        <option value="${u.speaker}" ?selected=${!this._transcriptLabelSpeaker[u.speaker] && !u.speakerName}>
                          ${u.speaker}
                        </option>
                      </select>
                    </div>
                    ${u.start != null ? html`<span class="utterance-ts">${formatDuration(u.start)}</span>` : ''}
                    <div class="utterance-text ${this._editingUtterance === idx ? 'editing' : ''}"
                         @click=${(e) => { e.stopPropagation(); this._startEditUtterance(idx); }}>
                      ${this._editingUtterance === idx ? html`
                        <textarea class="utterance-edit-input"
                                  .value=${u.text || ''}
                                  @blur=${(e) => this._saveUtteranceEdit(idx, e.target.value)}
                                  @keydown=${(e) => {
                                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this._saveUtteranceEdit(idx, e.target.value); }
                                    if (e.key === 'Escape') { e.preventDefault(); this._editingUtterance = -1; this.requestUpdate(); }
                                  }}
                                  @click=${(e) => e.stopPropagation()}></textarea>
                      ` : html`<span class="editable-text">${u.text || ''}</span>`}
                    </div>
                  </div>
                `)}
                ${(!t.utterances || t.utterances.length === 0) ? html`
                  <div class="empty-msg" style="padding:16px">No utterances available.</div>
                ` : ''}
              </div>
            ` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn" style="margin-left:auto" @click=${this._closeTranscriptDetail.bind(this)}>Close</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Speakers Render ──────────────────────────
  _renderSpeakers() {
    return html`
      <div class="speakers-content">
        <!-- Profiles -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="section-title">Speaker Profiles</div>
            <button class="btn btn-accent btn-sm" @click=${() => { this._showCreateProfile = true; }}>+ Create Profile</button>
          </div>
          ${this._profilesLoading ? html`<div class="loading-spinner"><div class="spinner"></div>Loading...</div>` : ''}
          ${!this._profilesLoading && this._profiles.length === 0 ? html`<div class="empty-msg">No profiles enrolled yet.</div>` : ''}
          <div class="profiles-grid">
            ${this._profiles.map(p => this._renderProfileCard(p))}
          </div>
        </div>

        <!-- Candidates -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="section-title">Unidentified Candidates</div>
            ${this._selectedCandidates.length >= 2 ? html`
              <button class="btn btn-accent btn-sm" @click=${() => this._showMergeModal = true}>
                Merge Selected (${this._selectedCandidates.length})
              </button>
            ` : ''}
          </div>
          ${this._candidatesLoading ? html`<div class="loading-spinner"><div class="spinner"></div>Loading...</div>` : ''}
          ${!this._candidatesLoading && this._candidates.length === 0 ? html`<div class="empty-msg" style="font-size:11px">No pending candidates.</div>` : ''}
          <div class="candidates-grid">
            ${this._candidates.map(c => this._renderCandidateCard(c))}
          </div>
        </div>
      </div>
    `;
  }

  _renderProfileCard(p) {
    const initials = (p.name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const color = speakerColor(p.name);
    const isRenaming = this._renameTarget === p.name;
    return html`
      <div class="profile-card">
        <div class="profile-header">
          <div class="profile-avatar" style="background:${color}22;color:${color};border:2px solid ${color}40">
            ${initials}
          </div>
          <div class="profile-name-wrap">
            ${isRenaming ? html`
              <div class="rename-inline">
                <input type="text" .value=${this._renameName}
                       @input=${e => this._renameName = e.target.value}
                       @keydown=${e => { if (e.key === 'Enter') {this._saveRename();} if (e.key === 'Escape') {this._cancelRename();} }} />
                <button class="btn btn-sm btn-green" @click=${this._saveRename.bind(this)}>✓</button>
                <button class="btn btn-sm" @click=${this._cancelRename.bind(this)}>✕</button>
              </div>
            ` : html`<div class="profile-name">${p.name}</div>`}
            <div class="profile-enroll">${p.numSamples ?? p.enrollmentCount ?? 0} samples enrolled</div>
          </div>
        </div>
        <div class="profile-metrics">
          ${p.confidence != null ? html`
            <div class="metric-row">
              <span class="metric-label">Avg Confidence</span>
              <span class="metric-value" style="color:${p.confidence > 0.7 ? 'var(--green)' : p.confidence > 0.4 ? 'var(--yellow)' : 'var(--red)'}">
                ${(p.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ` : ''}
          ${p.lastSeen != null ? html`
            <div class="metric-row">
              <span class="metric-label">Last Heard</span>
              <span class="metric-value">${timeAgo(p.lastSeen)}</span>
            </div>
          ` : ''}
          ${p.variance != null ? html`
            <div class="metric-row">
              <span class="metric-label">Variance</span>
              <span class="metric-value">${p.variance.toFixed(2)}</span>
            </div>
          ` : ''}
        </div>
        <!-- Enrollment Stats -->
        <div class="enrollment-stats">
          ${p.threshold != null ? html`
            <div class="metric-row">
              <span class="metric-label">Threshold</span>
              <span class="metric-value">${p.threshold}</span>
            </div>
          ` : ''}
          ${p.enrollmentMethod ? html`
            <div class="metric-row">
              <span class="metric-label">Method</span>
              <span class="metric-value" style="text-transform:capitalize">${p.enrollmentMethod}</span>
            </div>
          ` : ''}
          ${p.transcriptCount != null ? html`
            <div class="metric-row">
              <span class="metric-label">Transcripts</span>
              <span class="metric-value">${p.transcriptCount}</span>
            </div>
          ` : ''}
        </div>
        <!-- Sample Audio -->
        ${(p.sampleAudio && p.sampleAudio.length > 0) ? html`
          <div class="profile-samples">
            <div class="profile-samples-title">Samples (${p.sampleAudio.length})</div>
            ${p.sampleAudio.map((filename, i) => html`
              <div class="sample-item">
                <div class="audio-player">
                  <audio src="/api/voice/audio/${filename}" controls preload="none"></audio>
                </div>
                ${p.sampleTranscripts && p.sampleTranscripts[i] ? html`
                  <div class="sample-transcript">${p.sampleTranscripts[i]}</div>
                ` : ''}
              </div>
            `)}
          </div>
        ` : ''}
        <div class="profile-actions">
          <button class="btn btn-sm" @click=${() => this._startRename(p.name, p.name)}>Rename</button>
          <button class="btn btn-sm btn-accent"
                  @click=${() => { this._setTab('transcripts'); this._transcriptSearch = p.name; this._loadTranscripts(); }}>
            Transcripts
          </button>
          <button class="btn btn-sm btn-red" @click=${() => this._confirmDeleteProfile(p.name, p.name)}>Delete</button>
        </div>
      </div>
    `;
  }

  _renderCandidateCard(c) {
    const isApproving = this._approveTarget === c.speaker_id;
    return html`
      <div class="candidate-card">
        <label class="candidate-checkbox" @click=${e => e.stopPropagation()}>
          <input type="checkbox"
                 ?checked=${this._selectedCandidates.includes(c.speaker_id)}
                 @change=${e => this._toggleCandidateSelection(c.speaker_id, e.target.checked)} />
        </label>
        <div class="candidate-header">
          <span style="font-size:20px">👤</span>
          <span class="candidate-id">${c.speaker_id}</span>
          <span class="candidate-samples">${c.num_samples ?? 0} samples</span>
        </div>
        ${(c.sample_audio && c.sample_audio.some(Boolean)) ? html`
          <div class="candidate-samples-list">
            ${c.sample_audio.filter(Boolean).slice(0, 3).map((filename, i) => html`
              <div class="sample-item">
                <audio src="/api/voice/audio/${filename}" controls preload="none" style="width:100%;height:28px"></audio>
                ${c.sample_transcripts && c.sample_transcripts[i] ? html`
                  <div class="sample-transcript" style="font-size:10px;color:var(--text-dim);margin-top:2px">${c.sample_transcripts[i].slice(0, 100)}</div>
                ` : ''}
              </div>
            `)}
          </div>
        ` : ''}
        ${isApproving ? html`
          <div class="approve-input-row">
            <input type="text" placeholder="Speaker name..." .value=${this._approveName}
                   @input=${e => this._approveName = e.target.value}
                   @keydown=${e => { if (e.key === 'Enter') {this._saveApprove(c.speaker_id);} if (e.key === 'Escape') {this._cancelApprove();} }} />
            <button class="btn btn-sm btn-green" @click=${() => this._saveApprove(c.speaker_id)}>Enroll</button>
            <button class="btn btn-sm" @click=${this._cancelApprove.bind(this)}>x</button>
          </div>
        ` : html`
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-green" @click=${() => this._startApprove(c.speaker_id)}>Approve</button>
            <button class="btn btn-sm btn-yellow" @click=${() => this._rejectCandidate(c.speaker_id)}>Reject</button>
            <button class="btn btn-sm btn-red" @click=${() => this._confirmDeleteCandidate(c.speaker_id)}>Delete</button>
          </div>
        `}
      </div>
    `;
  }

  // --- Ingestion ---
  async _loadIngestionStatus() {
    try {
      this._ingestionStatus = await api.get('/api/voice/ingestion/status');
    } catch {}
  }

  async _toggleIngestion(source) {
    try {
      await api.post(`/api/voice/ingestion/${source}/toggle`);
      await this._loadIngestionStatus();
    } catch (e) {
      console.error('Toggle failed:', e);
    }
  }

  // --- Toast ---
  _showToast(message, type = 'success') {
    this._toast = { message, type };
    this.requestUpdate();
    setTimeout(() => { this._toast = null; this.requestUpdate(); }, 3000);
  }

  // --- Inline text editing ---
  _startEditUtterance(idx) {
    this._editingUtterance = idx;
    this.requestUpdate();
    requestAnimationFrame(() => {
      const textarea = this.shadowRoot?.querySelector('.utterance-edit-input');
      if (textarea) {
        textarea.focus();
        textarea.style.height = textarea.scrollHeight + 'px';
      }
    });
  }

  async _saveUtteranceEdit(idx, newText) {
    this._editingUtterance = -1;
    if (!this._transcriptDetail) {return;}
    const oldText = this._transcriptDetail.utterances[idx]?.text;
    if (newText === oldText) { this.requestUpdate(); return; }
    this._transcriptDetail.utterances[idx].text = newText;
    this.requestUpdate();
    try {
      await api.put(`/api/voice/transcripts/${this._transcriptDetail.id}/utterance`, { utteranceIndex: idx, text: newText });
      this._showToast('Text saved');
    } catch (err) {
      this._transcriptDetail.utterances[idx].text = oldText;
      this.requestUpdate();
      this._showToast(`Save failed: ${err.message}`, 'error');
    }
  }

  // --- Create Profile ---
  async _submitCreateProfile() {
    if (!this._createProfileName.trim() || !this._createProfileFile) {return;}
    this._createProfileLoading = true;
    try {
      const formData = new FormData();
      formData.append('name', this._createProfileName.trim());
      formData.append('audio', this._createProfileFile);
      const resp = await fetch('/api/voice/profiles/create', { method: 'POST', body: formData });
      const result = await resp.json();
      if (!resp.ok) {throw new Error(result.error || 'Failed');}
      this._showToast(`Profile '${this._createProfileName.trim()}' created`);
      this._showCreateProfile = false;
      this._createProfileName = '';
      this._createProfileFile = null;
      this._loadProfiles();
    } catch (err) {
      this._showToast(`Create failed: ${err.message}`, 'error');
    } finally {
      this._createProfileLoading = false;
    }
  }

  _renderCreateProfileModal() {
    return html`
      <div class="modal-overlay" @click=${e => { if (e.target === e.currentTarget) {this._showCreateProfile = false;} }}>
        <div class="modal-box" style="max-width:440px">
          <div class="modal-header">
            <span class="modal-title">Create Speaker Profile</span>
            <button class="btn btn-sm" @click=${() => this._showCreateProfile = false}>x</button>
          </div>
          <div class="modal-body" style="padding:16px">
            <div style="margin-bottom:12px">
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Speaker Name</label>
              <input type="text" placeholder="e.g. fred, courtney"
                     .value=${this._createProfileName}
                     @input=${e => this._createProfileName = e.target.value}
                     style="width:100%;padding:8px;background:var(--bg-input,#1a1a2e);color:var(--text);border:1px solid var(--border);border-radius:6px" />
            </div>
            <div style="margin-bottom:12px">
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Voice Sample Audio</label>
              <div class="upload-zone"
                   @dragover=${e => e.preventDefault()}
                   @drop=${e => { e.preventDefault(); this._createProfileFile = e.dataTransfer.files[0]; this.requestUpdate(); }}>
                ${this._createProfileFile ? html`
                  <div>Selected: ${this._createProfileFile.name}</div>
                ` : html`
                  <div style="color:var(--text-dim)">Drag & drop audio file or</div>
                `}
                <input type="file" accept=".wav,.mp3,.m4a" style="display:none" id="profile-audio-input"
                       @change=${e => { this._createProfileFile = e.target.files[0]; this.requestUpdate(); }} />
                <button class="btn btn-sm" @click=${() => this.shadowRoot.querySelector('#profile-audio-input').click()}>Browse</button>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            ${this._createProfileLoading ? html`<div class="spinner" style="width:16px;height:16px"></div>` : ''}
            <button class="btn btn-green"
                    ?disabled=${!this._createProfileName.trim() || !this._createProfileFile || this._createProfileLoading}
                    @click=${this._submitCreateProfile.bind(this)}>Create Profile</button>
            <button class="btn" @click=${() => this._showCreateProfile = false}>Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  // --- Candidate Selection & Merge ---
  _toggleCandidateSelection(speakerId, checked) {
    if (checked) {
      this._selectedCandidates = [...this._selectedCandidates, speakerId];
    } else {
      this._selectedCandidates = this._selectedCandidates.filter(id => id !== speakerId);
    }
  }

  async _submitMerge() {
    this._mergeLoading = true;
    try {
      const body = {
        candidateIds: this._selectedCandidates,
        target: this._mergeTarget.type === 'new'
          ? { type: 'new', name: this._mergeTarget.name.trim() }
          : { type: 'existing', profileName: this._mergeTarget.profileName },
      };
      await api.post('/api/voice/candidates/merge', body);
      this._showToast(`Merged ${this._selectedCandidates.length} candidates`);
      this._showMergeModal = false;
      this._selectedCandidates = [];
      this._mergeTarget = { type: 'new', name: '' };
      this._loadCandidates();
      this._loadProfiles();
    } catch (err) {
      this._showToast(`Merge failed: ${err.message}`, 'error');
    } finally {
      this._mergeLoading = false;
    }
  }

  _renderMergeModal() {
    return html`
      <div class="modal-overlay" @click=${e => { if (e.target === e.currentTarget) {this._showMergeModal = false;} }}>
        <div class="modal-box" style="max-width:420px">
          <div class="modal-header">
            <span class="modal-title">Merge ${this._selectedCandidates.length} Candidates</span>
            <button class="btn btn-sm" @click=${() => this._showMergeModal = false}>x</button>
          </div>
          <div class="modal-body" style="padding:16px">
            <div style="margin-bottom:12px">
              <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
                <input type="radio" name="merge-type" value="new"
                       ?checked=${this._mergeTarget.type === 'new'}
                       @change=${() => this._mergeTarget = { ...this._mergeTarget, type: 'new' }} />
                Create new profile
              </label>
              ${this._mergeTarget.type === 'new' ? html`
                <input type="text" placeholder="Speaker name..."
                       .value=${this._mergeTarget.name || ''}
                       @input=${e => this._mergeTarget = { ...this._mergeTarget, name: e.target.value }}
                       style="width:calc(100% - 24px);padding:8px;background:var(--bg-input,#1a1a2e);color:var(--text);border:1px solid var(--border);border-radius:6px;margin-left:24px" />
              ` : ''}
            </div>
            <div>
              <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
                <input type="radio" name="merge-type" value="existing"
                       ?checked=${this._mergeTarget.type === 'existing'}
                       @change=${() => this._mergeTarget = { ...this._mergeTarget, type: 'existing' }} />
                Merge into existing profile
              </label>
              ${this._mergeTarget.type === 'existing' ? html`
                <select @change=${e => this._mergeTarget = { ...this._mergeTarget, profileName: e.target.value }}
                        style="width:calc(100% - 24px);padding:8px;background:var(--bg-input,#1a1a2e);color:var(--text);border:1px solid var(--border);border-radius:6px;margin-left:24px">
                  <option value="">Select profile...</option>
                  ${this._profiles.map(p => html`<option value="${p.name}">${p.name}</option>`)}
                </select>
              ` : ''}
            </div>
          </div>
          <div class="modal-footer">
            ${this._mergeLoading ? html`<div class="spinner" style="width:16px;height:16px"></div>` : ''}
            <button class="btn btn-green"
                    ?disabled=${this._mergeLoading || (this._mergeTarget.type === 'new' && !this._mergeTarget.name?.trim()) || (this._mergeTarget.type === 'existing' && !this._mergeTarget.profileName)}
                    @click=${this._submitMerge.bind(this)}>Merge</button>
            <button class="btn" @click=${() => this._showMergeModal = false}>Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Confirm Dialog ───────────────────────────
  _renderConfirmDialog() {
    const d = this._confirmDelete;
    return html`
      <div class="confirm-overlay">
        <div class="confirm-box">
          <div class="confirm-title">Confirm Delete</div>
          <div class="confirm-body">
            Are you sure you want to delete ${d.label}? This action cannot be undone.
          </div>
          <div class="confirm-actions">
            <button class="btn btn-sm" @click=${() => this._confirmDelete = null}>Cancel</button>
            <button class="btn btn-sm btn-red" @click=${this._executeDelete.bind(this)}>Delete</button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('page-knowledge', PageKnowledge);
