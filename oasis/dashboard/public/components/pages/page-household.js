import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';

// ---------------------------------------------------------------------------
// Helper: ISO Week string  "YYYY-WNN"
// ---------------------------------------------------------------------------
function getCurrentWeek() {
  const now = new Date();
  // Use ISO week: week containing Thursday
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const daysSinceW1 = Math.floor((now - startOfWeek1) / 86400000);
  const weekNum = Math.floor(daysSinceW1 / 7) + 1;
  const year = weekNum > 52 ? now.getFullYear() : now.getFullYear();
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function addWeeks(weekStr, delta) {
  const [yearStr, wStr] = weekStr.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);
  // Convert week+year to a Monday date, then add/sub 7*delta days
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const monday = new Date(startOfWeek1);
  monday.setDate(monday.getDate() + (week - 1) * 7 + delta * 7);
  const newJan4 = new Date(monday.getFullYear(), 0, 4);
  const newW1Start = new Date(newJan4);
  newW1Start.setDate(newJan4.getDate() - ((newJan4.getDay() + 6) % 7));
  const newWeek = Math.floor((monday - newW1Start) / (7 * 86400000)) + 1;
  return `${monday.getFullYear()}-W${String(newWeek).padStart(2, '0')}`;
}

function weekLabel(weekStr) {
  const [yearStr, wStr] = weekStr.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const monday = new Date(startOfWeek1);
  monday.setDate(monday.getDate() + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  return `Week ${week} — ${fmt.format(monday)}–${fmt.format(sunday)}, ${year}`;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---------------------------------------------------------------------------
// Markdown → sanitised HTML renderer
// ---------------------------------------------------------------------------
function renderMarkdown(text) {
  if (!text) {return '';}
  // Escape HTML entities first
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Tables (must be before other block processing)
  s = s.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (match, header, body) => {
    const heads = header.split('|').map(c => c.trim()).filter(Boolean);
    const rows = body.trim().split('\n').map(r => r.split('|').map(c => c.trim()).filter(Boolean));
    const ths = heads.map(h => `<th>${h}</th>`).join('');
    const trs = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  });

  // Fenced code blocks
  s = s.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);

  // HR
  s = s.replace(/^---+$/gm, '<hr>');

  // Block-level: headers
  s = s.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  s = s.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Blockquotes
  s = s.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists (group consecutive)
  s = s.replace(/((?:^[-*+]\s+.+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[-*+]\s+/, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  s = s.replace(/((?:^\d+\.\s+.+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\.\s+/, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // Inline: bold, italic, code, links
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links — block dangerous schemes
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const clean = href.trim().toLowerCase();
    if (/^(javascript|data|vbscript):/.test(clean)) {return label;}
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Paragraphs: wrap non-block lines
  const lines = s.split('\n');
  const out = [];
  let para = [];
  const blockTags = /^<(h[1-6]|ul|ol|li|pre|blockquote|table|tr|thead|tbody|hr|p)/;
  for (const line of lines) {
    if (blockTags.test(line.trim()) || line.trim() === '') {
      if (para.length) { out.push(`<p>${para.join(' ')}</p>`); para = []; }
      if (line.trim()) {out.push(line);}
    } else {
      para.push(line);
    }
  }
  if (para.length) {out.push(`<p>${para.join(' ')}</p>`);}
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown ↔ Structured preference parsing helpers
// ---------------------------------------------------------------------------
function parseMarkdownSections(md) {
  // Returns { _preamble, [sectionTitle]: { text, items } }
  // _preamble captures everything before the first H2 (e.g. H1 title)
  const sections = {};
  let preamble = '';
  let current = null;
  for (const line of (md || '').split('\n')) {
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);
    if (h2) {
      current = h2[1].trim();
      sections[current] = { text: '', items: [] };
    } else if (h3) {
      current = h3[1].trim();
      sections[current] = { text: '', items: [] };
    } else if (current) {
      // Skip horizontal rules (---) so they don't bleed into section text
      if (/^-{3,}\s*$/.test(line)) {continue;}
      const item = line.match(/^[-*]\s+(.+)/);
      if (item) {
        sections[current].items.push(item[1].trim());
      } else if (line.trim()) {
        sections[current].text += (sections[current].text ? '\n' : '') + line;
      }
    } else {
      // Before first section — capture preamble (H1, blank lines, etc.)
      if (line.trim()) {
        preamble += (preamble ? '\n' : '') + line;
      }
    }
  }
  if (preamble) {sections._preamble = { text: preamble, items: [] };}
  return sections;
}

function sectionsToMarkdown(sections) {
  let md = '';
  // Output preamble first (H1 title etc.)
  if (sections._preamble?.text) {
    md += sections._preamble.text + '\n\n';
  }
  for (const [title, data] of Object.entries(sections)) {
    if (title === '_preamble') {continue;}
    md += `## ${title}\n`;
    if (data.items && data.items.length) {
      md += data.items.map(i => `- ${i}`).join('\n') + '\n';
    }
    if (data.text) {md += data.text + '\n';}
    md += '\n';
  }
  return md.trim();
}

// ---------------------------------------------------------------------------
// PageHousehold component
// ---------------------------------------------------------------------------
class PageHousehold extends LitElement {
  static properties = {
    _activeTab: { type: String },

    // --- Meal Plan ---
    _week: { type: String },
    _weekData: { type: Object },
    _weekLoading: { type: Boolean },
    _expandedDay: { type: String },
    _feedbackDay: { type: String },
    _feedbackType: { type: String },
    _feedbackReason: { type: String },
    _feedbackLoading: { type: Boolean },
    _refreshLoading: { type: Object },
    _shoppingOpen: { type: Boolean },
    _shoppingSelectedDays: { type: Array },
    _shoppingList: { type: Object },
    _shoppingLoading: { type: Boolean },

    // --- Preferences ---
    _prefSection: { type: String },
    _prefFoodMd: { type: String },
    _prefLeisureMd: { type: String },
    _prefDateNightMd: { type: String },
    _prefFoodSections: { type: Object },
    _prefLeisureSections: { type: Object },
    _prefDateNightSections: { type: Object },
    _prefFoodRaw: { type: Boolean },
    _prefLeisureRaw: { type: Boolean },
    _prefDateNightRaw: { type: Boolean },
    _prefSaving: { type: String },
    _prefLoading: { type: Boolean },

    // --- Date Night ---
    _dateNightIdeas: { type: Array },
    _dateNightLoading: { type: Boolean },
    _dateNightRequestLoading: { type: Boolean },
    _dateNightRequestResult: { type: String },
    _dateNightHistory: { type: Array },
    _dateNightHistoryLoading: { type: Boolean },
  };

  constructor() {
    super();
    this._activeTab = 'meal';

    // Meal Plan
    this._week = getCurrentWeek();
    this._weekData = {};
    this._weekLoading = false;
    this._expandedDay = null;
    this._feedbackDay = null;
    this._feedbackType = null;
    this._feedbackReason = '';
    this._feedbackLoading = false;
    this._refreshLoading = {};
    this._shoppingOpen = false;
    this._shoppingSelectedDays = [...DAYS];
    this._shoppingList = null;
    this._shoppingLoading = false;

    // Preferences
    this._prefSection = 'food';
    this._prefFoodMd = '';
    this._prefLeisureMd = '';
    this._prefDateNightMd = '';
    this._prefFoodSections = {};
    this._prefLeisureSections = {};
    this._prefDateNightSections = {};
    this._prefFoodRaw = false;
    this._prefLeisureRaw = false;
    this._prefDateNightRaw = false;
    this._prefSaving = null;
    this._prefLoading = false;

    // Date Night
    this._dateNightIdeas = [];
    this._dateNightLoading = false;
    this._dateNightRequestLoading = false;
    this._dateNightRequestResult = null;
    this._dateNightHistory = [];
    this._dateNightHistoryLoading = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._fetchWeek();
  }

  // -------------------------------------------------------------------------
  // API: Meal Plan
  // -------------------------------------------------------------------------
  async _fetchWeek() {
    this._weekLoading = true;
    try {
      const data = await api.get(`/api/recipes/${this._week}`);
      // API returns { week, days: [ { day, exists, title, cookTime }, ... ] }
      // Convert to a dictionary keyed by day name for rendering
      const byDay = {};
      if (data && Array.isArray(data.days)) {
        for (const d of data.days) {
          if (d.exists) {byDay[d.day] = d;}
        }
      }
      this._weekData = byDay;
    } catch {
      this._weekData = {};
    } finally {
      this._weekLoading = false;
    }
  }

  _prevWeek() {
    this._week = addWeeks(this._week, -1);
    this._expandedDay = null;
    this._weekData = {};
    this._shoppingList = null;
    this._fetchWeek();
  }

  _nextWeek() {
    this._week = addWeeks(this._week, 1);
    this._expandedDay = null;
    this._weekData = {};
    this._shoppingList = null;
    this._fetchWeek();
  }

  async _toggleDay(day) {
    if (this._expandedDay === day) {
      this._expandedDay = null;
    } else {
      this._expandedDay = day;
      // Fetch full recipe content if not already loaded
      const recipe = this._weekData[day];
      if (recipe && !recipe.content) {
        try {
          const data = await api.get(`/api/recipes/${this._week}/${day}`);
          if (data && data.content) {
            recipe.content = data.content;
            // Extract structured meta from markdown for badge rendering
            const metaPatterns = {
              prepTime: /\*\*Prep\s*time:\*\*\s*(.+)/i,
              totalTime: /\*\*Total\s*time:\*\*\s*(.+)/i,
              servings: /\*\*(?:Yields|Servings?):\*\*\s*(.+)/i,
            };
            for (const [key, pat] of Object.entries(metaPatterns)) {
              const m = data.content.match(pat);
              if (m && !recipe[key]) {recipe[key] = m[1].trim();}
            }
            this.requestUpdate();
          }
        } catch (err) {
          console.warn(`Failed to load recipe content for ${day}:`, err);
        }
      }
    }
    this._feedbackDay = null;
    this._feedbackType = null;
    this._feedbackReason = '';
  }

  _startFeedback(day, type) {
    this._feedbackDay = day;
    this._feedbackType = type;
    this._feedbackReason = '';
  }

  _cancelFeedback() {
    this._feedbackDay = null;
    this._feedbackType = null;
    this._feedbackReason = '';
  }

  async _submitFeedback() {
    if (!this._feedbackDay || !this._feedbackType) {return;}
    if (this._feedbackType === 'replace' && !this._feedbackReason.trim()) {return;}
    this._feedbackLoading = true;
    try {
      await api.post(
        `/api/recipes/${this._week}/${this._feedbackDay}/feedback`,
        { action: this._feedbackType, reason: this._feedbackReason.trim() }
      );
      // Update local state to reflect feedback
      const recipe = this._weekData[this._feedbackDay];
      if (recipe) {
        this._weekData = {
          ...this._weekData,
          [this._feedbackDay]: {
            ...recipe,
            liked: this._feedbackType === 'like' ? true : recipe.liked,
            replaced: this._feedbackType === 'replace' ? true : recipe.replaced,
          },
        };
      }
      this._cancelFeedback();
    } catch {
      // api.js shows toast on error
    } finally {
      this._feedbackLoading = false;
    }
  }

  async _refreshDay(day) {
    this._refreshLoading = { ...this._refreshLoading, [day]: true };
    try {
      const data = await api.post(`/api/recipes/${this._week}/${day}/refresh`);
      if (data) {
        this._weekData = { ...this._weekData, [day]: data };
      }
    } catch {
      // handled by api.js
    } finally {
      this._refreshLoading = { ...this._refreshLoading, [day]: false };
    }
  }

  _toggleShoppingDay(day) {
    if (this._shoppingSelectedDays.includes(day)) {
      this._shoppingSelectedDays = this._shoppingSelectedDays.filter(d => d !== day);
    } else {
      this._shoppingSelectedDays = [...this._shoppingSelectedDays, day];
    }
  }

  _toggleAllShoppingDays() {
    this._shoppingSelectedDays = this._shoppingSelectedDays.length === DAYS.length ? [] : [...DAYS];
  }

  async _generateShoppingList(daysOverride) {
    const days = daysOverride || this._shoppingSelectedDays;
    if (!days.length) {return;}
    this._shoppingLoading = true;
    try {
      const data = await api.post(`/api/recipes/${this._week}/shopping-list`, { days });
      // Transform API response { sections: { "Produce": [...] } } into
      // { categories: [{ name: "Produce", items: [...] }] }
      if (data && data.sections && !data.categories) {
        data.categories = Object.entries(data.sections).map(([name, items]) => ({ name, items }));
      }
      this._shoppingList = data;
    } catch {
      // handled
    } finally {
      this._shoppingLoading = false;
    }
  }

  _copyShoppingList() {
    if (!this._shoppingList) {return;}
    const cats = this._shoppingList.categories || [];
    const lines = cats.map(cat =>
      `${cat.name}\n${(cat.items || []).map(i => `  - ${i.name || i}${i.quantity ? ` (${i.quantity})` : ''}`).join('\n')}`
    ).join('\n\n');
    navigator.clipboard.writeText(lines).then(() => {
      if (typeof window.__oasisToast === 'function') {window.__oasisToast('Shopping list copied!', 'ok');}
    });
  }

  _copyTargetLinks() {
    if (!this._shoppingList) {return;}
    const cats = this._shoppingList.categories || [];
    const links = [];
    for (const cat of cats) {
      for (const item of (cat.items || [])) {
        const name = item.name || item;
        links.push(`${name}: https://www.target.com/s?searchTerm=${encodeURIComponent(name)}`);
      }
    }
    navigator.clipboard.writeText(links.join('\n')).then(() => {
      if (typeof window.__oasisToast === 'function') {window.__oasisToast('Target links copied!', 'ok');}
    });
  }

  _openAllInTarget() {
    if (!this._shoppingList) {return;}
    const cats = this._shoppingList.categories || [];
    const items = [];
    for (const cat of cats) {
      for (const item of (cat.items || [])) {
        items.push(item.name || item);
      }
    }
    if (items.length > 5) {
      if (!confirm(`Open ${items.length} tabs in Target?`)) {return;}
    }
    for (const name of items) {
      window.open(`https://www.target.com/s?searchTerm=${encodeURIComponent(name)}`, '_blank', 'noopener');
    }
  }

  // -------------------------------------------------------------------------
  // API: Preferences
  // -------------------------------------------------------------------------
  async _loadPreferences() {
    if (this._prefLoading || this._prefFoodMd) {return;}
    this._prefLoading = true;
    try {
      const [food, leisure, dateNight] = await Promise.allSettled([
        api.get('/api/preferences/food'),
        api.get('/api/preferences/leisure'),
        api.get('/api/preferences/date-night'),
      ]);
      const extractMd = (r) => {
        if (r.status === 'fulfilled' && r.value) {
          return typeof r.value === 'string' ? r.value : (r.value.content || r.value.text || '');
        }
        return '';
      };
      this._prefFoodMd = extractMd(food);
      this._prefLeisureMd = extractMd(leisure);
      this._prefDateNightMd = extractMd(dateNight);
      this._prefFoodSections = parseMarkdownSections(this._prefFoodMd);
      this._prefLeisureSections = parseMarkdownSections(this._prefLeisureMd);
      this._prefDateNightSections = parseMarkdownSections(this._prefDateNightMd);
    } catch {
      // handled
    } finally {
      this._prefLoading = false;
    }
  }

  async _savePreferences(category) {
    this._prefSaving = category;
    try {
      let md = '';
      if (category === 'food') {
        md = this._prefFoodRaw ? this._prefFoodMd : sectionsToMarkdown(this._prefFoodSections);
      } else if (category === 'leisure') {
        md = this._prefLeisureRaw ? this._prefLeisureMd : sectionsToMarkdown(this._prefLeisureSections);
      } else if (category === 'date-night') {
        md = this._prefDateNightRaw ? this._prefDateNightMd : sectionsToMarkdown(this._prefDateNightSections);
      }
      const result = await api.put(`/api/preferences/${category}`, { content: md });
      if (result) {
        if (typeof window.__oasisToast === 'function') {window.__oasisToast('Preferences saved', 'ok');}
      } else {
        if (typeof window.__oasisToast === 'function') {window.__oasisToast('Failed to save preferences', 'error');}
      }
    } catch {
      if (typeof window.__oasisToast === 'function') {window.__oasisToast('Failed to save preferences', 'error');}
    } finally {
      this._prefSaving = null;
    }
  }

  _updateSectionItems(category, section, items) {
    if (category === 'food') {
      this._prefFoodSections = {
        ...this._prefFoodSections,
        [section]: { ...this._prefFoodSections[section], items },
      };
    } else if (category === 'leisure') {
      this._prefLeisureSections = {
        ...this._prefLeisureSections,
        [section]: { ...this._prefLeisureSections[section], items },
      };
    } else if (category === 'date-night') {
      this._prefDateNightSections = {
        ...this._prefDateNightSections,
        [section]: { ...this._prefDateNightSections[section], items },
      };
    }
  }

  _updateSectionText(category, section, text) {
    if (category === 'food') {
      this._prefFoodSections = {
        ...this._prefFoodSections,
        [section]: { ...this._prefFoodSections[section], text },
      };
    } else if (category === 'leisure') {
      this._prefLeisureSections = {
        ...this._prefLeisureSections,
        [section]: { ...this._prefLeisureSections[section], text },
      };
    } else if (category === 'date-night') {
      this._prefDateNightSections = {
        ...this._prefDateNightSections,
        [section]: { ...this._prefDateNightSections[section], text },
      };
    }
  }

  // -------------------------------------------------------------------------
  // API: Date Night
  // -------------------------------------------------------------------------
  async _loadDateNightIdeas() {
    if (this._dateNightIdeas.length || this._dateNightLoading) {return;}
    this._dateNightLoading = true;
    try {
      const data = await api.get('/api/preferences/date-night');
      // Parse ideas from preferences or return empty
      this._dateNightIdeas = Array.isArray(data?.ideas) ? data.ideas : [];
    } catch {
      this._dateNightIdeas = [];
    } finally {
      this._dateNightLoading = false;
    }
  }

  async _requestDateNightIdeas() {
    this._dateNightRequestLoading = true;
    this._dateNightRequestResult = null;
    try {
      let resultText = '';
      await api.stream('/api/chat/stream', {
        agentId: 'anorak',
        message: 'Generate 3 creative date night ideas for this weekend in South Florida. For each idea include: the activity or restaurant name, a brief description, estimated cost, and a link if available. Use the date-night preferences file for context on what Fred and Courtney enjoy. Format your response as markdown.',
      }, (event) => {
        if (event.type === 'token' && event.data?.text) {
          const text = event.data.text;
          // Filter out non-response signals
          if (text === 'NO_REPLY' || text.startsWith('{')) {return;}
          resultText = text;
          this._dateNightRequestResult = resultText;
        } else if (event.type === 'error') {
          this._dateNightRequestResult = event.data?.text || 'Failed to generate ideas';
        }
      });
      if (!resultText) {
        this._dateNightRequestResult = 'Anorak did not generate ideas — this may happen if the gateway is busy. Try again in a moment.';
      }
    } catch {
      this._dateNightRequestResult = 'Failed to reach Anorak — check gateway status.';
    } finally {
      this._dateNightRequestLoading = false;
    }
  }

  async _loadDateNightHistory() {
    if (this._dateNightHistory.length || this._dateNightHistoryLoading) {return;}
    this._dateNightHistoryLoading = true;
    try {
      // Date night history stored in curator workspace
      const data = await api.get('/api/curator/file?path=lifestyle/date-nights.json').catch(() => null);
      this._dateNightHistory = Array.isArray(data) ? data : (data?.history || []);
    } catch {
      this._dateNightHistory = [];
    } finally {
      this._dateNightHistoryLoading = false;
    }
  }

  // -------------------------------------------------------------------------
  // Tab change
  // -------------------------------------------------------------------------
  _setTab(tab) {
    this._activeTab = tab;
    if (tab === 'preferences') {this._loadPreferences();}
    if (tab === 'datenight') { this._loadDateNightIdeas(); this._loadDateNightHistory(); }
  }

  // -------------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------------
  static styles = css`
    :host {
      display: block;
      font-family: "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace;
      color: var(--text, #e0e6f0);
      background: var(--bg, #0a0e17);
      min-height: 100%;
    }

    /* ---- Page header ---- */
    .page-header {
      padding: 24px 28px 16px;
      border-bottom: 1px solid var(--border, #2a3550);
    }
    .page-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text, #e0e6f0);
      letter-spacing: 0.5px;
      margin: 0 0 4px;
    }
    .page-subtitle {
      font-size: 12px;
      color: var(--text-dim, #7a8ba8);
      margin: 0;
    }

    /* ---- Tabs ---- */
    .tabs {
      display: flex;
      gap: 0;
      padding: 0 28px;
      border-bottom: 1px solid var(--border, #2a3550);
      background: var(--surface, #131926);
    }
    .tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-dim, #7a8ba8);
      font-family: inherit;
      font-size: 13px;
      padding: 12px 18px;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
      margin-bottom: -1px;
    }
    .tab-btn:hover { color: var(--text, #e0e6f0); }
    .tab-btn.active {
      color: var(--accent, #00d4ff);
      border-bottom-color: var(--accent, #00d4ff);
    }

    /* ---- Content area ---- */
    .tab-content {
      padding: 24px 28px;
    }

    /* ---- Week navigation ---- */
    .week-nav {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .week-nav-btn {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      font-family: inherit;
      font-size: 16px;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .week-nav-btn:hover { background: var(--surface-3, #222d42); }
    .week-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--text, #e0e6f0);
      flex: 1;
    }

    /* ---- Day grid ---- */
    .day-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    @media (max-width: 900px) {
      .day-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 500px) {
      .day-grid { grid-template-columns: 1fr; }
    }

    .day-card {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 10px;
      padding: 14px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      min-height: 90px;
    }
    .day-card:hover { border-color: var(--accent, #00d4ff); background: var(--surface-2, #1a2235); }
    .day-card.expanded { border-color: var(--accent, #00d4ff); background: var(--surface-2, #1a2235); }
    .day-card.empty { opacity: 0.4; cursor: default; }
    .day-card.empty:hover { border-color: var(--border, #2a3550); background: var(--surface, #131926); }

    .day-name {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-dim, #7a8ba8);
      margin-bottom: 6px;
    }
    .day-recipe-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text, #e0e6f0);
      margin-bottom: 6px;
      line-height: 1.3;
    }
    .day-badges {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      background: var(--surface-3, #222d42);
      color: var(--text-dim, #7a8ba8);
      border: 1px solid var(--border, #2a3550);
    }
    .badge.accent { background: var(--accent-dim, rgba(0,212,255,0.15)); color: var(--accent, #00d4ff); border-color: transparent; }
    .day-feedback-icons {
      font-size: 13px;
      margin-left: auto;
    }

    /* ---- Recipe detail ---- */
    .recipe-detail {
      background: var(--surface, #131926);
      border: 1px solid var(--accent, #00d4ff);
      border-radius: 10px;
      padding: 22px;
      margin-bottom: 20px;
    }
    .recipe-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text, #e0e6f0);
      margin: 0 0 14px;
    }
    .recipe-meta {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .recipe-meta-item {
      font-size: 11px;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 6px;
      padding: 4px 10px;
      color: var(--text-dim, #7a8ba8);
    }
    .recipe-meta-item span { color: var(--text, #e0e6f0); font-weight: 600; }
    .recipe-section-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--accent, #00d4ff);
      margin: 18px 0 8px;
    }
    .recipe-body {
      font-size: 13px;
      color: var(--text, #e0e6f0);
      line-height: 1.6;
    }
    .recipe-body h1, .recipe-body h2, .recipe-body h3 {
      color: var(--text, #e0e6f0);
      font-size: 14px;
      margin: 14px 0 6px;
    }
    .recipe-body ul, .recipe-body ol { padding-left: 20px; margin: 6px 0; }
    .recipe-body li { margin-bottom: 3px; }
    .recipe-body table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .recipe-body th, .recipe-body td {
      border: 1px solid var(--border, #2a3550);
      padding: 5px 10px;
      text-align: left;
    }
    .recipe-body th { background: var(--surface-2, #1a2235); color: var(--text-dim, #7a8ba8); }
    .recipe-body code { background: var(--surface-3, #222d42); padding: 1px 4px; border-radius: 3px; }
    .recipe-body pre { background: var(--surface-3, #222d42); padding: 10px; border-radius: 6px; overflow-x: auto; }
    .recipe-body blockquote {
      border-left: 3px solid var(--accent, #00d4ff);
      margin: 8px 0;
      padding: 6px 12px;
      color: var(--text-dim, #7a8ba8);
    }
    .recipe-body a { color: var(--accent, #00d4ff); }
    .recipe-body p { margin: 6px 0; }
    .recipe-body hr { border: none; border-top: 1px solid var(--border, #2a3550); margin: 12px 0; }

    /* ---- Feedback bar ---- */
    .feedback-bar {
      display: flex;
      gap: 10px;
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--border, #2a3550);
      flex-wrap: wrap;
    }
    .feedback-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      font-family: inherit;
      font-size: 12px;
      padding: 7px 14px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .feedback-btn:hover { background: var(--surface-3, #222d42); border-color: var(--accent, #00d4ff); }
    .feedback-btn.like:hover { border-color: var(--green, #22c55e); }
    .feedback-btn.replace:hover { border-color: var(--yellow, #eab308); }
    .feedback-btn.refresh:hover { border-color: var(--purple, #a855f7); }

    .feedback-input-row {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .feedback-input {
      flex: 1;
      min-width: 200px;
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      font-family: inherit;
      font-size: 12px;
      padding: 7px 10px;
      border-radius: 6px;
      resize: vertical;
    }
    .feedback-input:focus { outline: none; border-color: var(--accent, #00d4ff); }
    .btn-sm {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      border: 1px solid var(--accent, #00d4ff);
      color: var(--accent, #00d4ff);
      font-family: inherit;
      font-size: 12px;
      padding: 7px 14px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-sm:hover { background: rgba(0,212,255,0.25); }
    .btn-sm:disabled { opacity: 0.5; cursor: default; }
    .btn-cancel {
      background: none;
      border: 1px solid var(--border, #2a3550);
      color: var(--text-dim, #7a8ba8);
      font-family: inherit;
      font-size: 12px;
      padding: 7px 12px;
      border-radius: 6px;
      cursor: pointer;
    }

    /* ---- Shopping panel ---- */
    .shopping-toggle-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      font-family: inherit;
      font-size: 13px;
      padding: 9px 16px;
      border-radius: 7px;
      cursor: pointer;
      margin-bottom: 16px;
      transition: background 0.15s;
    }
    .shopping-toggle-btn:hover { background: var(--surface-3, #222d42); }

    .shopping-panel {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 10px;
      padding: 18px;
      margin-bottom: 24px;
    }
    .shopping-panel-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text, #e0e6f0);
      margin-bottom: 14px;
    }
    .day-checkboxes {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .day-check-label {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--text-dim, #7a8ba8);
      cursor: pointer;
    }
    .day-check-label input[type="checkbox"] { accent-color: var(--accent, #00d4ff); cursor: pointer; }
    .shopping-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .btn-primary {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      border: 1px solid var(--accent, #00d4ff);
      color: var(--accent, #00d4ff);
      font-family: inherit;
      font-size: 12px;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-primary:hover { background: rgba(0,212,255,0.25); }
    .btn-primary:disabled { opacity: 0.5; cursor: default; }

    .shopping-list-result { margin-top: 14px; }
    .shopping-cat-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--accent, #00d4ff);
      margin: 14px 0 6px;
    }
    .shopping-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text, #e0e6f0);
      padding: 4px 0;
      border-bottom: 1px solid var(--border, #2a3550);
    }
    .shopping-item:last-child { border-bottom: none; }
    .shopping-item-qty { color: var(--text-dim, #7a8ba8); font-size: 11px; }
    .shopping-item-link {
      margin-left: auto;
      font-size: 10px;
      color: var(--accent, #00d4ff);
      text-decoration: none;
    }
    .shopping-item-link:hover { text-decoration: underline; }
    .shopping-copy-bar {
      display: flex;
      gap: 8px;
      margin-top: 14px;
      flex-wrap: wrap;
    }

    /* ---- Loading / empty states ---- */
    .loading-row {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-dim, #7a8ba8);
      font-size: 13px;
      padding: 20px 0;
    }
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border, #2a3550);
      border-top-color: var(--accent, #00d4ff);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .empty-state {
      color: var(--text-muted, #4a5568);
      font-size: 13px;
      padding: 20px 0;
      text-align: center;
    }

    /* ---- Preferences ---- */
    .pref-sub-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .pref-sub-btn {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      color: var(--text-dim, #7a8ba8);
      font-family: inherit;
      font-size: 12px;
      padding: 7px 14px;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .pref-sub-btn:hover { border-color: var(--accent, #00d4ff); color: var(--text, #e0e6f0); }
    .pref-sub-btn.active {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      border-color: var(--accent, #00d4ff);
      color: var(--accent, #00d4ff);
    }

    .pref-section {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 10px;
      margin-bottom: 14px;
      overflow: hidden;
    }
    .pref-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .pref-section-header:hover { background: var(--surface-2, #1a2235); }
    .pref-section-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text, #e0e6f0);
    }
    .pref-section-chevron { color: var(--text-dim, #7a8ba8); font-size: 11px; }
    .pref-section-body { padding: 0 18px 18px; }

    .pref-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-dim, #7a8ba8);
      margin: 14px 0 6px;
    }
    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 6px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
    }
    .tag-remove {
      background: none;
      border: none;
      color: var(--text-dim, #7a8ba8);
      cursor: pointer;
      font-size: 12px;
      padding: 0;
      line-height: 1;
      display: flex;
      align-items: center;
    }
    .tag-remove:hover { color: var(--red, #ef4444); }
    .tag-add-row {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .tag-input {
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      font-family: inherit;
      font-size: 12px;
      padding: 5px 10px;
      border-radius: 6px;
      flex: 1;
      max-width: 200px;
    }
    .tag-input:focus { outline: none; border-color: var(--accent, #00d4ff); }
    .tag-add-btn {
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      color: var(--accent, #00d4ff);
      font-family: inherit;
      font-size: 13px;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    .tag-add-btn:hover { background: var(--accent-dim, rgba(0,212,255,0.15)); }

    .pref-textarea {
      width: 100%;
      box-sizing: border-box;
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      font-family: inherit;
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      resize: vertical;
      min-height: 80px;
    }
    .pref-textarea:focus { outline: none; border-color: var(--accent, #00d4ff); }

    .pref-number-input {
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      font-family: inherit;
      font-size: 12px;
      padding: 6px 10px;
      border-radius: 6px;
      width: 80px;
    }
    .pref-number-input:focus { outline: none; border-color: var(--accent, #00d4ff); }

    .pref-toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: var(--text, #e0e6f0);
      margin: 6px 0;
    }
    .pref-toggle input[type="checkbox"] { accent-color: var(--accent, #00d4ff); width: 16px; height: 16px; cursor: pointer; }

    .pref-save-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--border, #2a3550);
    }
    .raw-toggle {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--text-dim, #7a8ba8);
      cursor: pointer;
    }
    .raw-toggle input { accent-color: var(--accent, #00d4ff); cursor: pointer; }

    .family-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .family-card {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      padding: 12px;
    }
    .family-name {
      font-size: 13px;
      font-weight: 700;
      color: var(--text, #e0e6f0);
      margin-bottom: 4px;
    }
    .family-age {
      font-size: 10px;
      color: var(--text-dim, #7a8ba8);
      margin-bottom: 10px;
    }

    /* ---- Date Night ---- */
    .dn-ideas-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }
    .dn-card {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 10px;
      padding: 16px;
    }
    .dn-card-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text, #e0e6f0);
      margin-bottom: 6px;
    }
    .dn-card-desc {
      font-size: 12px;
      color: var(--text-dim, #7a8ba8);
      line-height: 1.5;
      margin-bottom: 10px;
    }
    .dn-card-meta {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .dn-badge {
      font-size: 10px;
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      color: var(--text-dim, #7a8ba8);
      padding: 2px 8px;
      border-radius: 10px;
    }
    .dn-badge.cost { color: var(--green, #22c55e); border-color: var(--green, #22c55e); background: rgba(34,197,94,0.1); }
    .dn-badge.location { color: var(--accent, #00d4ff); border-color: transparent; background: var(--accent-dim, rgba(0,212,255,0.15)); }

    .dn-request-section {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 10px;
      padding: 18px;
      margin-bottom: 24px;
    }
    .dn-section-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text, #e0e6f0);
      margin-bottom: 12px;
    }
    .dn-result {
      margin-top: 14px;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      padding: 14px;
      font-size: 13px;
      color: var(--text, #e0e6f0);
      line-height: 1.6;
    }
    .dn-result h1, .dn-result h2, .dn-result h3 { color: var(--text, #e0e6f0); font-size: 13px; margin: 10px 0 4px; }
    .dn-result ul, .dn-result ol { padding-left: 18px; margin: 6px 0; }
    .dn-result li { margin-bottom: 4px; }
    .dn-result strong { color: var(--accent, #00d4ff); }
    .dn-result a { color: var(--accent, #00d4ff); }
    .dn-result p { margin: 6px 0; }

    .dn-history-list { list-style: none; padding: 0; margin: 0; }
    .dn-history-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border, #2a3550);
      font-size: 12px;
    }
    .dn-history-item:last-child { border-bottom: none; }
    .dn-history-date { color: var(--text-dim, #7a8ba8); min-width: 90px; }
    .dn-history-what { color: var(--text, #e0e6f0); flex: 1; }
    .dn-history-rating { color: var(--yellow, #eab308); }

    /* ---- Section divider ---- */
    .section-divider {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--accent, #00d4ff);
      margin: 22px 0 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border, #2a3550);
    }
  `;

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  _renderDayCard(day, idx) {
    const recipe = this._weekData[day];
    const isExpanded = this._expandedDay === day;
    const isEmpty = !recipe;
    return html`
      <div
        class="day-card ${isEmpty ? 'empty' : ''} ${isExpanded ? 'expanded' : ''}"
        @click=${isEmpty ? null : () => this._toggleDay(day)}
        title="${isEmpty ? 'No recipe' : recipe.title}"
      >
        <div class="day-name">${DAY_LABELS[idx]}</div>
        ${isEmpty
          ? html`<div style="color:var(--text-muted,#4a5568);font-size:11px;font-style:italic;">No meal planned</div>`
          : html`
            <div class="day-recipe-title">${recipe.title}</div>
            <div class="day-badges">
              ${recipe.cookTime || recipe.cook_time
                ? html`<span class="badge accent">${recipe.cookTime || recipe.cook_time}</span>`
                : ''}
              <span class="day-feedback-icons">
                ${recipe.liked ? '❤️' : ''}${recipe.replaced ? '🔄' : ''}
              </span>
            </div>
          `}
      </div>
    `;
  }

  _renderRecipeDetail(day) {
    const recipe = this._weekData[day];
    if (!recipe) {return '';}
    const isRefreshing = this._refreshLoading[day];
    const feedbackActive = this._feedbackDay === day;
    // Strip H1 title and metadata block from markdown (shown in header/badges above)
    const rawContent = recipe.content || recipe.body || recipe.markdown || '';
    const mdContent = rawContent
      .replace(/^#\s+.+\n+/, '')
      .replace(/^\*\*(?:Yields|Servings?|Prep\s*time|Cook\s*time|Total\s*time|Cuisine|Course):\*\*\s*.+\n?/gim, '')
      .replace(/^\n+/, '');

    return html`
      <div class="recipe-detail">
        <div class="recipe-title">${recipe.title}</div>

        <div class="recipe-meta">
          ${recipe.prepTime || recipe.prep_time
            ? html`<div class="recipe-meta-item">Prep <span>${recipe.prepTime || recipe.prep_time}</span></div>`
            : ''}
          ${recipe.cookTime || recipe.cook_time
            ? html`<div class="recipe-meta-item">Cook <span>${recipe.cookTime || recipe.cook_time}</span></div>`
            : ''}
          ${recipe.totalTime || recipe.total_time
            ? html`<div class="recipe-meta-item">Total <span>${recipe.totalTime || recipe.total_time}</span></div>`
            : ''}
          ${recipe.servings
            ? html`<div class="recipe-meta-item">Serves <span>${recipe.servings}</span></div>`
            : ''}
        </div>

        ${mdContent
          ? html`<div class="recipe-body" .innerHTML=${renderMarkdown(mdContent)}></div>`
          : html`
            ${recipe.ingredients?.length ? html`
              <div class="recipe-section-title">Ingredients</div>
              <ul class="recipe-body">
                ${recipe.ingredients.map(i => html`<li>${i}</li>`)}
              </ul>
            ` : ''}
            ${recipe.instructions?.length ? html`
              <div class="recipe-section-title">Instructions</div>
              <ol class="recipe-body">
                ${recipe.instructions.map(i => html`<li>${i}</li>`)}
              </ol>
            ` : ''}
            ${recipe.kidFriendlyNotes || recipe.kid_friendly_notes ? html`
              <div class="recipe-section-title">Kid-Friendly Notes</div>
              <div class="recipe-body">${recipe.kidFriendlyNotes || recipe.kid_friendly_notes}</div>
            ` : ''}
          `}

        <!-- Feedback bar -->
        <div class="feedback-bar">
          <button class="feedback-btn like"
            @click=${(e) => { e.stopPropagation(); this._startFeedback(day, 'like'); }}
          >❤️ Like</button>
          <button class="feedback-btn replace"
            @click=${(e) => { e.stopPropagation(); this._startFeedback(day, 'replace'); }}
          >🔄 Replace</button>
          <button class="feedback-btn refresh"
            ?disabled=${isRefreshing}
            @click=${(e) => { e.stopPropagation(); this._refreshDay(day); }}
          >
            ${isRefreshing ? html`<span class="spinner" style="width:12px;height:12px;"></span>` : '🔁'}
            Refresh Recipe
          </button>
        </div>

        ${feedbackActive ? html`
          <div class="feedback-input-row" @click=${(e) => e.stopPropagation()}>
            <textarea
              class="feedback-input"
              placeholder="${this._feedbackType === 'replace' ? 'Reason (required)...' : 'Reason (optional)...'}"
              rows="2"
              .value=${this._feedbackReason}
              @input=${(e) => { this._feedbackReason = e.target.value; }}
            ></textarea>
            <button
              class="btn-sm"
              ?disabled=${this._feedbackLoading || (this._feedbackType === 'replace' && !this._feedbackReason.trim())}
              @click=${this._submitFeedback}
            >
              ${this._feedbackLoading ? html`<span class="spinner" style="width:11px;height:11px;"></span>` : 'Submit'}
            </button>
            <button class="btn-cancel" @click=${this._cancelFeedback}>Cancel</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderMealTab() {
    return html`
      <!-- Week navigation -->
      <div class="week-nav">
        <button class="week-nav-btn" @click=${this._prevWeek}>&#8592;</button>
        <span class="week-label">${weekLabel(this._week)}</span>
        <button class="week-nav-btn" @click=${this._nextWeek}>&#8594;</button>
      </div>

      ${this._weekLoading
        ? html`<div class="loading-row"><div class="spinner"></div> Loading week...</div>`
        : html`
          <!-- Day grid -->
          <div class="day-grid">
            ${DAYS.map((day, idx) => this._renderDayCard(day, idx))}
          </div>

          <!-- Expanded recipe detail -->
          ${this._expandedDay ? this._renderRecipeDetail(this._expandedDay) : ''}
        `}

      <!-- Shopping list panel toggle -->
      <button class="shopping-toggle-btn" @click=${() => { this._shoppingOpen = !this._shoppingOpen; }}>
        🛒 Shopping List ${this._shoppingOpen ? '▲' : '▼'}
      </button>

      ${this._shoppingOpen ? html`
        <div class="shopping-panel">
          <div class="shopping-panel-title">Generate Shopping List</div>

          <div class="day-checkboxes">
            <label class="day-check-label" style="color:var(--accent,#00d4ff);">
              <input type="checkbox"
                .checked=${this._shoppingSelectedDays.length === DAYS.length}
                @change=${this._toggleAllShoppingDays}
              /> All
            </label>
            ${DAYS.map((day, idx) => html`
              <label class="day-check-label">
                <input type="checkbox"
                  .checked=${this._shoppingSelectedDays.includes(day)}
                  @change=${() => this._toggleShoppingDay(day)}
                /> ${DAY_LABELS[idx].slice(0, 3)}
              </label>
            `)}
          </div>

          <div class="shopping-actions">
            <button class="btn-primary"
              ?disabled=${this._shoppingLoading || !this._shoppingSelectedDays.length}
              @click=${() => this._generateShoppingList()}
            >
              ${this._shoppingLoading ? html`<span class="spinner" style="width:11px;height:11px;display:inline-block;"></span>` : ''}
              Generate for Selected
            </button>
            <button class="btn-primary"
              ?disabled=${this._shoppingLoading}
              @click=${() => this._generateShoppingList(DAYS)}
            >Full Week</button>
          </div>

          ${this._shoppingList ? html`
            <div class="shopping-list-result">
              ${(this._shoppingList.categories || []).map(cat => html`
                <div class="shopping-cat-title">${cat.name || cat.category}</div>
                ${(cat.items || []).map(item => {
                  const name = item.name || item;
                  const qty = item.quantity || item.qty || '';
                  const targetUrl = item.targetUrl || `https://www.target.com/s?searchTerm=${encodeURIComponent(item.searchName || name)}`;
                  return html`
                    <div class="shopping-item">
                      <span>${name}</span>
                      ${qty ? html`<span class="shopping-item-qty">${qty}</span>` : ''}
                      <a class="shopping-item-link"
                        href="${targetUrl}"
                        target="_blank" rel="noopener noreferrer"
                      >Target ↗</a>
                    </div>
                  `;
                })}
              `)}
              <div class="shopping-copy-bar">
                <button class="btn-sm" @click=${this._copyShoppingList}>📋 Copy List</button>
                <button class="btn-sm" @click=${this._copyTargetLinks}>🔗 Copy Target Links</button>
                <button class="btn-sm" @click=${this._openAllInTarget}>🎯 Open All in Target</button>
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}
    `;
  }

  // ---- Preferences helpers ----
  _renderTagSection(category, sections, sectionKey, label) {
    const items = sections[sectionKey]?.items || [];
    // Each section gets its own add-input state tracked by a data attribute approach
    const inputId = `tag-input-${category}-${sectionKey.replace(/\s+/g, '-')}`;
    return html`
      <div class="pref-label">${label || sectionKey}</div>
      <div class="tag-list">
        ${items.map((item, i) => html`
          <span class="tag">
            ${item}
            <button class="tag-remove" title="Remove"
              @click=${() => {
                const newItems = items.filter((_, idx) => idx !== i);
                this._updateSectionItems(category, sectionKey, newItems);
              }}
            >&#x2715;</button>
          </span>
        `)}
      </div>
      <div class="tag-add-row">
        <input type="text" class="tag-input" id="${inputId}"
          placeholder="Add item..."
          @keydown=${(e) => {
            if (e.key === 'Enter') {
              const val = e.target.value.trim();
              if (val) {
                this._updateSectionItems(category, sectionKey, [...items, val]);
                e.target.value = '';
              }
            }
          }}
        />
        <button class="tag-add-btn" @click=${(e) => {
          const input = this.shadowRoot.getElementById(inputId);
          if (input && input.value.trim()) {
            this._updateSectionItems(category, sectionKey, [...items, input.value.trim()]);
            input.value = '';
          }
        }}>+</button>
      </div>
    `;
  }

  _renderTextSection(category, sections, sectionKey, label, placeholder = '') {
    const text = sections[sectionKey]?.text || '';
    return html`
      <div class="pref-label">${label || sectionKey}</div>
      <textarea class="pref-textarea"
        placeholder="${placeholder}"
        .value=${text}
        @input=${(e) => this._updateSectionText(category, sectionKey, e.target.value)}
      ></textarea>
    `;
  }

  _renderFoodPreferences() {
    const sections = this._prefFoodSections;
    const raw = this._prefFoodRaw;
    const saving = this._prefSaving === 'food';

    const familyMembers = [
      { name: 'Fred', age: null },
      { name: 'Courtney', age: null },
      { name: 'Lucas', age: 13 },
      { name: 'Elliott', age: 9 },
      { name: 'Finley', age: 7 },
    ];

    return html`
      <div class="pref-sub-content">
        ${raw ? html`
          <div class="pref-label">Raw Markdown</div>
          <textarea class="pref-textarea" style="min-height:300px;"
            .value=${this._prefFoodMd}
            @input=${(e) => { this._prefFoodMd = e.target.value; }}
          ></textarea>
        ` : html`

          <div class="section-divider">Family Members</div>
          <div class="family-grid">
            ${familyMembers.map(m => {
              const restrictionKey = `${m.name} Restrictions`;
              const favKey = `${m.name} Favorites`;
              const restrictions = sections[restrictionKey]?.items || [];
              const favorites = sections[favKey]?.items || [];
              return html`
                <div class="family-card">
                  <div class="family-name">${m.name}</div>
                  ${m.age ? html`<div class="family-age">Age ${m.age}</div>` : ''}
                  ${this._renderTagSection('food', sections, restrictionKey, 'Restrictions')}
                  ${this._renderTagSection('food', sections, favKey, 'Favorites')}
                </div>
              `;
            })}
          </div>

          ${this._renderTagSection('food', sections, 'Shared Restrictions', 'Shared Restrictions')}
          ${this._renderTagSection('food', sections, 'Safe Proteins', 'Safe Proteins — Everyone')}
          ${this._renderTagSection('food', sections, 'Fred Only Proteins', 'Safe Proteins — Fred Only')}
          ${this._renderTagSection('food', sections, 'Cuisine Preferences', 'Cuisine Preferences')}
          ${this._renderTextSection('food', sections, 'Cooking Strategy', 'Cooking Strategy Notes',
            'e.g. Dual-protein meals — chicken for Courtney + beef for Fred in tacos')}
        `}

        <div class="pref-save-row">
          <button class="btn-primary" ?disabled=${saving}
            @click=${() => this._savePreferences('food')}
          >
            ${saving ? html`<span class="spinner" style="width:11px;height:11px;display:inline-block;"></span>` : ''}
            Save Food Preferences
          </button>
          <label class="raw-toggle">
            <input type="checkbox" .checked=${raw}
              @change=${(e) => { this._prefFoodRaw = e.target.checked; }}
            /> Raw Edit
          </label>
        </div>
      </div>
    `;
  }

  _renderLeisurePreferences() {
    const sections = this._prefLeisureSections;
    const raw = this._prefLeisureRaw;
    const saving = this._prefSaving === 'leisure';

    return html`
      ${raw ? html`
        <div class="pref-label">Raw Markdown</div>
        <textarea class="pref-textarea" style="min-height:300px;"
          .value=${this._prefLeisureMd}
          @input=${(e) => { this._prefLeisureMd = e.target.value; }}
        ></textarea>
      ` : html`
        <div class="section-divider">Activities</div>
        ${this._renderTagSection('leisure', sections, 'Outdoor Activities', 'Outdoor Activities')}
        ${this._renderTagSection('leisure', sections, 'Indoor Activities', 'Indoor Activities')}
        ${this._renderTagSection('leisure', sections, 'Events & Entertainment', 'Events & Entertainment')}

        <div class="section-divider">Travel</div>
        ${this._renderTagSection('leisure', sections, 'Preferred Cruise Ports', 'Preferred Cruise Ports')}

        <div class="pref-label">Options</div>
        <div class="pref-toggle">
          <input type="checkbox"
            .checked=${(sections['Options']?.text || '').includes('family-friendly')}
          /> Family-Friendly Requirement
        </div>
        <div class="pref-toggle">
          <input type="checkbox"
            .checked=${(sections['Options']?.text || '').includes('school-calendar')}
          /> School Calendar Awareness
        </div>

        <div class="section-divider">Deal Alerts</div>
        <div class="pref-label">Alert when &gt; X% below typical price</div>
        <input type="number" class="pref-number-input"
          min="0" max="100"
          placeholder="30"
          .value=${sections['Deal Alert Threshold']?.text || ''}
          @input=${(e) => this._updateSectionText('leisure', 'Deal Alert Threshold', e.target.value)}
        /> %
      `}

      <div class="pref-save-row">
        <button class="btn-primary" ?disabled=${saving}
          @click=${() => this._savePreferences('leisure')}
        >
          ${saving ? html`<span class="spinner" style="width:11px;height:11px;display:inline-block;"></span>` : ''}
          Save Leisure Preferences
        </button>
        <label class="raw-toggle">
          <input type="checkbox" .checked=${raw}
            @change=${(e) => { this._prefLeisureRaw = e.target.checked; }}
          /> Raw Edit
        </label>
      </div>
    `;
  }

  _renderDateNightPreferences() {
    const sections = this._prefDateNightSections;
    const raw = this._prefDateNightRaw;
    const saving = this._prefSaving === 'date-night';

    const priceLabels = ['$', '$$', '$$$', '$$$$'];

    return html`
      ${raw ? html`
        <div class="pref-label">Raw Markdown</div>
        <textarea class="pref-textarea" style="min-height:300px;"
          .value=${this._prefDateNightMd}
          @input=${(e) => { this._prefDateNightMd = e.target.value; }}
        ></textarea>
      ` : html`
        <div class="section-divider">Restaurant Preferences</div>
        ${this._renderTagSection('date-night', sections, 'Cuisine Types', 'Cuisine Types')}
        ${this._renderTagSection('date-night', sections, 'Ambiance', 'Ambiance (romantic, casual, upscale, trendy...)')}
        ${this._renderTagSection('date-night', sections, 'Locations', 'Location Preferences')}

        <div class="pref-label">Price Range</div>
        <div style="display:flex;gap:8px;">
          ${priceLabels.map(p => {
            const current = sections['Price Range']?.text || '$$';
            return html`
              <button
                style="background:${current.includes(p) ? 'var(--accent-dim)' : 'var(--surface-3)'};border:1px solid ${current.includes(p) ? 'var(--accent)' : 'var(--border)'};color:${current.includes(p) ? 'var(--accent)' : 'var(--text-dim)'};border-radius:6px;padding:5px 12px;font-family:inherit;font-size:12px;cursor:pointer;"
                @click=${() => this._updateSectionText('date-night', 'Price Range', p)}
              >${p}</button>
            `;
          })}
        </div>

        <div class="section-divider">Activity Preferences</div>
        ${this._renderTagSection('date-night', sections, 'Activity Types', 'Activity Types')}
        <div class="pref-label">Setting Preference</div>
        <div style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text-dim);">
          Outdoor
          <input type="range" min="0" max="100"
            .value=${sections['Setting Preference']?.text || '50'}
            style="accent-color:var(--accent);width:120px;"
            @input=${(e) => this._updateSectionText('date-night', 'Setting Preference', e.target.value)}
          />
          Indoor
        </div>

        <div class="section-divider">Logistics</div>
        ${this._renderTextSection('date-night', sections, 'Babysitter Notes', 'Babysitter Availability',
          'Notes about babysitter availability...')}

        <div class="pref-label">Budget Range</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:12px;color:var(--text-dim);">$</span>
          <input type="number" class="pref-number-input"
            placeholder="Min"
            .value=${sections['Budget Min']?.text || ''}
            @input=${(e) => this._updateSectionText('date-night', 'Budget Min', e.target.value)}
          />
          <span style="font-size:12px;color:var(--text-dim);">— $</span>
          <input type="number" class="pref-number-input"
            placeholder="Max"
            .value=${sections['Budget Max']?.text || ''}
            @input=${(e) => this._updateSectionText('date-night', 'Budget Max', e.target.value)}
          />
        </div>

        <div class="pref-label">Preferred Days</div>
        <div style="display:flex;gap:12px;">
          ${['Friday', 'Saturday', 'Sunday'].map(day => {
            const items = sections['Preferred Days']?.items || [];
            return html`
              <label class="pref-toggle">
                <input type="checkbox"
                  .checked=${items.includes(day)}
                  @change=${(e) => {
                    const cur = sections['Preferred Days']?.items || [];
                    const newItems = e.target.checked ? [...cur, day] : cur.filter(d => d !== day);
                    this._updateSectionItems('date-night', 'Preferred Days', newItems);
                  }}
                /> ${day}
              </label>
            `;
          })}
        </div>
      `}

      <div class="pref-save-row">
        <button class="btn-primary" ?disabled=${saving}
          @click=${() => this._savePreferences('date-night')}
        >
          ${saving ? html`<span class="spinner" style="width:11px;height:11px;display:inline-block;"></span>` : ''}
          Save Date Night Preferences
        </button>
        <label class="raw-toggle">
          <input type="checkbox" .checked=${raw}
            @change=${(e) => { this._prefDateNightRaw = e.target.checked; }}
          /> Raw Edit
        </label>
      </div>
    `;
  }

  _renderPreferencesTab() {
    if (this._prefLoading) {
      return html`<div class="loading-row"><div class="spinner"></div> Loading preferences...</div>`;
    }
    return html`
      <div class="pref-sub-tabs">
        <button class="pref-sub-btn ${this._prefSection === 'food' ? 'active' : ''}"
          @click=${() => { this._prefSection = 'food'; }}>🍽️ Food</button>
        <button class="pref-sub-btn ${this._prefSection === 'leisure' ? 'active' : ''}"
          @click=${() => { this._prefSection = 'leisure'; }}>🎯 Leisure</button>
        <button class="pref-sub-btn ${this._prefSection === 'date-night' ? 'active' : ''}"
          @click=${() => { this._prefSection = 'date-night'; }}>💑 Date Night</button>
      </div>

      ${this._prefSection === 'food' ? this._renderFoodPreferences() : ''}
      ${this._prefSection === 'leisure' ? this._renderLeisurePreferences() : ''}
      ${this._prefSection === 'date-night' ? this._renderDateNightPreferences() : ''}
    `;
  }

  _renderDateNightTab() {
    return html`
      <!-- Upcoming suggestions -->
      <div class="section-divider">Upcoming Ideas from Anorak</div>
      ${this._dateNightLoading
        ? html`<div class="loading-row"><div class="spinner"></div> Loading ideas...</div>`
        : this._dateNightIdeas.length
          ? html`
            <div class="dn-ideas-grid">
              ${this._dateNightIdeas.map(idea => html`
                <div class="dn-card">
                  <div class="dn-card-title">${idea.title || idea.name || 'Date Night Idea'}</div>
                  <div class="dn-card-desc">${idea.description || idea.desc || ''}</div>
                  <div class="dn-card-meta">
                    ${idea.restaurant || idea.activity
                      ? html`<span class="dn-badge">${idea.restaurant || idea.activity}</span>`
                      : ''}
                    ${idea.cost || idea.estimatedCost || idea.estimated_cost
                      ? html`<span class="dn-badge cost">~${idea.cost || idea.estimatedCost || idea.estimated_cost}</span>`
                      : ''}
                    ${idea.location
                      ? html`<span class="dn-badge location">📍 ${idea.location}</span>`
                      : ''}
                  </div>
                </div>
              `)}
            </div>
          `
          : html`<div class="empty-state">No ideas yet — generate some below.</div>`}

      <!-- Quick request -->
      <div class="dn-request-section">
        <div class="dn-section-title">Quick Request</div>
        <button class="btn-primary"
          ?disabled=${this._dateNightRequestLoading}
          @click=${this._requestDateNightIdeas}
        >
          ${this._dateNightRequestLoading
            ? html`<span class="spinner" style="width:11px;height:11px;display:inline-block;"></span> Asking Anorak...`
            : '✨ Generate New Ideas for This Weekend'}
        </button>
        ${this._dateNightRequestResult ? html`
          <div class="dn-result" .innerHTML=${renderMarkdown(this._dateNightRequestResult)}></div>
        ` : ''}
      </div>

      <!-- Past date nights -->
      <div class="section-divider">Past Date Nights</div>
      ${this._dateNightHistoryLoading
        ? html`<div class="loading-row"><div class="spinner"></div> Loading history...</div>`
        : this._dateNightHistory.length
          ? html`
            <ul class="dn-history-list">
              ${this._dateNightHistory.map(entry => html`
                <li class="dn-history-item">
                  <span class="dn-history-date">${entry.date || '—'}</span>
                  <span class="dn-history-what">${entry.what || entry.description || '—'}</span>
                  ${entry.rating != null
                    ? html`<span class="dn-history-rating">${'★'.repeat(Math.round(entry.rating))}${'☆'.repeat(5 - Math.round(entry.rating))}</span>`
                    : ''}
                </li>
              `)}
            </ul>
          `
          : html`<div class="empty-state">No date night history tracked yet.</div>`}
    `;
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------
  render() {
    return html`
      <div class="page-header">
        <div class="page-title">Household</div>
        <div class="page-subtitle">Anorak — Meal planning, preferences &amp; date nights</div>
      </div>

      <div class="tabs">
        <button class="tab-btn ${this._activeTab === 'meal' ? 'active' : ''}"
          @click=${() => this._setTab('meal')}>🍽️ Meal Plan</button>
        <button class="tab-btn ${this._activeTab === 'preferences' ? 'active' : ''}"
          @click=${() => this._setTab('preferences')}>⚙️ Preferences</button>
        <button class="tab-btn ${this._activeTab === 'datenight' ? 'active' : ''}"
          @click=${() => this._setTab('datenight')}>💑 Date Night</button>
      </div>

      <div class="tab-content">
        ${this._activeTab === 'meal' ? this._renderMealTab() : ''}
        ${this._activeTab === 'preferences' ? this._renderPreferencesTab() : ''}
        ${this._activeTab === 'datenight' ? this._renderDateNightTab() : ''}
      </div>
    `;
  }
}

customElements.define('page-household', PageHousehold);
