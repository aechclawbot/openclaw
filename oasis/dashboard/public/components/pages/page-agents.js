import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';
import { store } from '/app/store.js';
import { router } from '/app/router.js';
import { eventBus } from '/app/events.js';

// --- Helper Functions ---

function timeAgo(iso) {
  if (!iso) {return 'never';}
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) {return `${s}s ago`;}
  const m = Math.floor(s / 60);
  if (m < 60) {return `${m}m ago`;}
  const h = Math.floor(m / 60);
  if (h < 24) {return `${h}h ago`;}
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function resolveModelId(model) {
  if (!model) {return null;}
  if (typeof model === 'string') {return model;}
  if (typeof model === 'object') {return model.primary ?? model.id ?? model.name ?? null;}
  return null;
}

function shortModelName(id) {
  const resolved = resolveModelId(id);
  if (!resolved) {return '—';}
  let name = resolved.includes('/') ? resolved.split('/').pop() : resolved;
  name = name.replace(/-\d{4}[-\d]*$/, '');
  return name;
}

function escapeHtml(str) {
  if (!str) {return '';}
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Minimal markdown renderer: bold, italic, code, headers, paragraphs, lists, blockquote, hr
function renderMarkdown(text) {
  if (!text) {return '';}
  let html = escapeHtml(text);
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // Unordered list items
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  // Ordered list items
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // HR
  html = html.replace(/^---+$/gm, '<hr>');
  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  // Clean up <p> around block-level
  html = html.replace(/<p>(<h[1-6]>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr>)<\/p>/g, '$1');
  html = html.replace(/<p>(<li>)/g, '$1');
  html = html.replace(/(<\/li>)<\/p>/g, '$1');
  return html;
}

// WORKSPACE_FILES: preferred display order for known files
const WORKSPACE_FILES_ORDER = [
  'IDENTITY.md', 'SOUL.md', 'DIRECTIVES.md', 'TOOLS.md',
  'CONTACTS.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md', 'BOOT.md',
];

function fileTypeIcon(type) {
  switch (type) {
    case 'json': return '{} ';
    case 'yaml': return '\u2699 ';   // gear
    case 'txt': return '\uD83D\uDCC4 '; // page icon
    default: return '';
  }
}

function getFileTypeFromName(name) {
  if (name.endsWith('.json')) {return 'json';}
  if (name.endsWith('.yaml') || name.endsWith('.yml')) {return 'yaml';}
  if (name.endsWith('.txt')) {return 'txt';}
  if (name.endsWith('.md')) {return 'markdown';}
  return 'unknown';
}

const DETAIL_TABS = ['info', 'sessions', 'workspace', 'message', 'cron'];

class PageAgents extends LitElement {
  static properties = {
    // Grid view
    agents: { type: Array },
    agentsLoading: { type: Boolean },

    // Detail view
    selectedAgentId: { type: String },
    selectedAgent: { type: Object },
    agentDetailLoading: { type: Boolean },
    activeTab: { type: String },

    // Info tab
    modelEditValue: { type: String },
    modelSaving: { type: Boolean },
    modelSaveError: { type: String },
    modelSaveOk: { type: Boolean },
    _modelDirty: { type: Boolean },
    availableModels: { type: Array },
    _fallbacks: { type: Array },
    _savedFallbacks: { type: Array },

    // Sessions tab
    sessions: { type: Array },
    sessionsLoading: { type: Boolean },
    sessionSearch: { type: String },
    selectedSession: { type: Object },
    sessionTranscript: { type: Array },
    transcriptLoading: { type: Boolean },

    // Clear memory
    clearMemoryState: { type: String },  // 'idle' | 'confirm' | 'clearing'

    // Workspace tab
    workspaceFiles: { type: Array },
    selectedWorkspaceFile: { type: String },
    workspaceContent: { type: String },
    workspacePreview: { type: Boolean },
    workspaceLoading: { type: Boolean },
    workspaceSaving: { type: Boolean },
    workspaceSaveError: { type: String },
    workspaceSaveOk: { type: Boolean },
    workspaceEdited: { type: Boolean },

    // Message tab
    messageInput: { type: String },
    messageSending: { type: Boolean },
    messageResponse: { type: Object },

    // Cron tab
    cronJobs: { type: Array },
    cronLoading: { type: Boolean },
  };

  constructor() {
    super();
    this.agents = [];
    this.agentsLoading = true;
    this.selectedAgentId = null;
    this.selectedAgent = null;
    this.agentDetailLoading = false;
    this.activeTab = 'info';

    this.modelEditValue = '';
    this.modelSaving = false;
    this.modelSaveError = '';
    this.modelSaveOk = false;
    this._modelDirty = false;
    this.availableModels = [];
    this._fallbacks = [];
    this._savedFallbacks = [];

    this.sessions = [];
    this.sessionsLoading = false;
    this.sessionSearch = '';
    this.selectedSession = null;
    this.sessionTranscript = [];
    this.transcriptLoading = false;

    this.clearMemoryState = 'idle';
    this._clearMemoryTimer = null;

    this.workspaceFiles = [];
    this.selectedWorkspaceFile = 'IDENTITY.md';
    this.workspaceContent = '';
    this.workspacePreview = false;
    this.workspaceLoading = false;
    this.workspaceSaving = false;
    this.workspaceSaveError = '';
    this.workspaceSaveOk = false;
    this.workspaceEdited = false;

    this.messageInput = '';
    this.messageSending = false;
    this.messageResponse = null;

    this.cronJobs = [];
    this.cronLoading = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._fetchAgents();
    // Check if a route param is already set
    this._syncRouteParam();
    this._unsubRoute = router.onChange((path) => this._onRouteChange(path));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._unsubRoute) {this._unsubRoute();}
    if (this._clearMemoryTimer) {clearTimeout(this._clearMemoryTimer);}
  }

  _syncRouteParam() {
    // Try multiple methods to detect agent ID from the URL
    let id = null;
    try {
      const params = router.params ? router.params() : null;
      id = params?.id ?? null;
    } catch {
      // no-op if router has no params API
    }
    // Fallback: parse the hash directly
    if (!id) {
      const hash = window.location.hash || '';
      const match = hash.match(/^#?\/agents\/([^/]+)/);
      if (match) {id = decodeURIComponent(match[1]);}
    }
    if (id && id !== this.selectedAgentId) {
      this.selectedAgentId = id;
      this._loadAgentDetail(id);
    }
  }

  _onRouteChange(route) {
    // Accept route object or string
    const path = typeof route === 'string' ? route : (route?.path ?? '');
    const match = path.match(/^#?\/agents\/([^/]+)/);
    if (match) {
      const id = match[1];
      if (id !== this.selectedAgentId) {
        this.selectedAgentId = id;
        this.activeTab = 'info';
        this._loadAgentDetail(id);
      }
    } else if (path.includes('/agents') && !path.match(/\/agents\/.+/)) {
      this._clearDetail();
    }
  }

  async _fetchAgents() {
    this.agentsLoading = true;
    try {
      const data = await api.get('/api/agents');
      this.agents = Array.isArray(data) ? data : (data.agents ?? []);
    } catch {
      this.agents = [];
    } finally {
      this.agentsLoading = false;
    }
  }

  async _loadAgentDetail(id) {
    this.agentDetailLoading = true;
    this.selectedAgent = null;
    try {
      const [data, modelsData] = await Promise.all([
        api.get(`/api/agents/${id}`),
        api.get('/api/models'),
      ]);
      const agent = data.agent ?? data;
      this.selectedAgent = agent;
      this.modelEditValue = resolveModelId(agent.model ?? agent.defaultModel) ?? '';
      // Initialize fallbacks from agent model config
      const modelObj = agent.model && typeof agent.model === 'object' ? agent.model : {};
      this._fallbacks = Array.isArray(modelObj.fallbacks) ? [...modelObj.fallbacks] : [];
      this._savedFallbacks = [...this._fallbacks];
      this._savedModelValue = this.modelEditValue;
      this._modelDirty = false;
      this.modelSaveOk = false;
      // Store available models
      this.availableModels = Array.isArray(modelsData) ? modelsData : (modelsData?.models ?? []);
      // Pre-load first tab data
      this._loadTabData(this.activeTab, id);
    } catch {
      this.selectedAgent = { id, name: id, error: true };
    } finally {
      this.agentDetailLoading = false;
    }
  }

  _clearDetail() {
    this.selectedAgentId = null;
    this.selectedAgent = null;
    this.activeTab = 'info';
    this.selectedSession = null;
    this.sessionTranscript = [];
    this.clearMemoryState = 'idle';
  }

  _selectAgent(id) {
    router.navigate(`#/agents/${id}`);
    this.selectedAgentId = id;
    this.activeTab = 'info';
    this._loadAgentDetail(id);
  }

  _goBack() {
    router.navigate('/agents');
    this._clearDetail();
  }

  _setTab(tab) {
    this.activeTab = tab;
    if (this.selectedAgentId) {
      this._loadTabData(tab, this.selectedAgentId);
    }
  }

  _loadTabData(tab, id) {
    if (tab === 'sessions' && !this.sessions.length) {
      this._fetchSessions(id);
    } else if (tab === 'workspace') {
      this._fetchWorkspaceFileList(id).then(() => {
        this._fetchWorkspaceFile(id, this.selectedWorkspaceFile);
      });
    } else if (tab === 'cron') {
      this._fetchCron(id);
    }
  }

  // --- Model edit ---

  _checkModelDirty() {
    const primaryChanged = this.modelEditValue !== (this._savedModelValue ?? '');
    const fallbacksChanged = JSON.stringify(this._fallbacks) !== JSON.stringify(this._savedFallbacks);
    this._modelDirty = primaryChanged || fallbacksChanged;
    this.modelSaveOk = false;
  }

  async _saveModel() {
    this.modelSaving = true;
    this.modelSaveError = '';
    this.modelSaveOk = false;
    try {
      await api.put(`/api/agents/${this.selectedAgentId}/model`, {
        primary: this.modelEditValue,
        fallbacks: this._fallbacks,
      });
      // Update local agent
      if (this.selectedAgent) {
        this.selectedAgent = {
          ...this.selectedAgent,
          model: { primary: this.modelEditValue, fallbacks: [...this._fallbacks] },
        };
      }
      this._savedModelValue = this.modelEditValue;
      this._savedFallbacks = [...this._fallbacks];
      this._modelDirty = false;
      this.modelSaveOk = true;
      setTimeout(() => { this.modelSaveOk = false; }, 3000);
    } catch (e) {
      this.modelSaveError = e.message ?? 'Failed to save model';
    } finally {
      this.modelSaving = false;
    }
  }

  // --- Fallback management ---

  _moveFallback(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this._fallbacks.length) {return;}
    const arr = [...this._fallbacks];
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    this._fallbacks = arr;
    this._checkModelDirty();
  }

  _removeFallback(index) {
    this._fallbacks = this._fallbacks.filter((_, i) => i !== index);
    this._checkModelDirty();
  }

  _addFallback(e) {
    const value = e.target.value;
    if (!value) {return;}
    if (!this._fallbacks.includes(value)) {
      this._fallbacks = [...this._fallbacks, value];
    }
    e.target.value = '';
    this._checkModelDirty();
  }

  // --- Sessions ---

  async _fetchSessions(agentId) {
    this.sessionsLoading = true;
    try {
      const data = await api.get(`/api/sessions?agentId=${agentId}`);
      this.sessions = Array.isArray(data) ? data : (data.sessions ?? []);
    } catch {
      this.sessions = [];
    } finally {
      this.sessionsLoading = false;
    }
  }

  get _filteredSessions() {
    if (!this.sessionSearch.trim()) {return this.sessions;}
    const q = this.sessionSearch.toLowerCase();
    return this.sessions.filter(s =>
      (s.key ?? '').toLowerCase().includes(q) ||
      (s.channel ?? s.lastChannel ?? '').toLowerCase().includes(q) ||
      (s.derivedTitle ?? '').toLowerCase().includes(q)
    );
  }

  async _selectSession(session) {
    this.selectedSession = session;
    this.sessionTranscript = [];
    this.transcriptLoading = true;
    try {
      const data = await api.get(`/api/sessions/${encodeURIComponent(session.key)}/transcript`);
      this.sessionTranscript = Array.isArray(data) ? data : (data.messages ?? data.transcript ?? []);
    } catch {
      this.sessionTranscript = [];
    } finally {
      this.transcriptLoading = false;
    }
  }

  async _resetSession(sessionId, e) {
    e.stopPropagation();
    if (!confirm('Reset this session? This will clear the session state.')) {return;}
    try {
      await api.post(`/api/sessions/${encodeURIComponent(sessionId)}/reset`);
      this._fetchSessions(this.selectedAgentId);
      if (this.selectedSession?.key === sessionId) {
        this.selectedSession = null;
        this.sessionTranscript = [];
      }
    } catch (err) {
      alert('Failed to reset session: ' + (err.message ?? err));
    }
  }

  async _deleteSession(sessionId, e) {
    e.stopPropagation();
    if (!confirm('Delete this session permanently? This cannot be undone.')) {return;}
    try {
      await api.delete(`/api/sessions/${encodeURIComponent(sessionId)}`);
      this.sessions = this.sessions.filter(s => s.key !== sessionId);
      if (this.selectedSession?.key === sessionId) {
        this.selectedSession = null;
        this.sessionTranscript = [];
      }
    } catch (err) {
      alert('Failed to delete session: ' + (err.message ?? err));
    }
  }

  // --- Clear Memory ---

  _clickClearMemory() {
    if (this.clearMemoryState === 'idle') {
      this.clearMemoryState = 'confirm';
      this._clearMemoryTimer = setTimeout(() => {
        this.clearMemoryState = 'idle';
      }, 4000);
    } else if (this.clearMemoryState === 'confirm') {
      clearTimeout(this._clearMemoryTimer);
      this._doClearMemory();
    }
  }

  async _doClearMemory() {
    this.clearMemoryState = 'clearing';
    try {
      await api.post(`/api/agents/${this.selectedAgentId}/clear-memory`, { scope: 'sessions' });
      this.clearMemoryState = 'idle';
      // Refresh sessions
      this._fetchSessions(this.selectedAgentId);
    } catch (err) {
      alert('Failed to clear memory: ' + (err.message ?? err));
      this.clearMemoryState = 'idle';
    }
  }

  // --- Workspace ---

  async _fetchWorkspaceFileList(agentId) {
    try {
      const data = await api.get(`/api/agents/${agentId}/workspace/files`);
      const apiFiles = Array.isArray(data) ? data : (data?.files ?? []);
      // Sort: known files first (in preferred order), then extras alphabetically
      const knownOrder = new Map(WORKSPACE_FILES_ORDER.map((name, i) => [name, i]));
      const sorted = [...apiFiles].toSorted((a, b) => {
        const aIdx = knownOrder.has(a.name) ? knownOrder.get(a.name) : 9999;
        const bIdx = knownOrder.has(b.name) ? knownOrder.get(b.name) : 9999;
        if (aIdx !== bIdx) {return aIdx - bIdx;}
        return a.name.localeCompare(b.name);
      });
      this.workspaceFiles = sorted;
      // If selected file not in list, pick first available
      if (sorted.length && !sorted.find(f => f.name === this.selectedWorkspaceFile)) {
        this.selectedWorkspaceFile = sorted[0].name;
      }
    } catch {
      this.workspaceFiles = [];
    }
  }

  async _fetchWorkspaceFile(agentId, filename) {
    this.workspaceLoading = true;
    this.workspaceContent = '';
    this.workspaceEdited = false;
    this.workspaceSaveOk = false;
    this.workspaceSaveError = '';
    try {
      const data = await api.get(`/api/agents/${agentId}/workspace/files/${filename}`);
      this.workspaceContent = typeof data === 'string' ? data : (data.content ?? JSON.stringify(data, null, 2));
    } catch {
      this.workspaceContent = '';
    } finally {
      this.workspaceLoading = false;
    }
  }

  _selectWorkspaceFile(filename) {
    if (this.workspaceEdited && !confirm('You have unsaved changes. Discard them?')) {return;}
    this.selectedWorkspaceFile = filename;
    this._fetchWorkspaceFile(this.selectedAgentId, filename);
  }

  _onWorkspaceInput(e) {
    this.workspaceContent = e.target.value;
    this.workspaceEdited = true;
    this.workspaceSaveOk = false;
  }

  async _saveWorkspaceFile() {
    this.workspaceSaving = true;
    this.workspaceSaveError = '';
    this.workspaceSaveOk = false;
    try {
      await api.put(
        `/api/agents/${this.selectedAgentId}/workspace/files/${this.selectedWorkspaceFile}`,
        { content: this.workspaceContent }
      );
      this.workspaceEdited = false;
      this.workspaceSaveOk = true;
      setTimeout(() => { this.workspaceSaveOk = false; }, 2000);
    } catch (e) {
      this.workspaceSaveError = e.message ?? 'Save failed';
    } finally {
      this.workspaceSaving = false;
    }
  }

  get _currentFileEditable() {
    const f = this.workspaceFiles.find(f => f.name === this.selectedWorkspaceFile);
    return f ? f.editable : false;
  }

  get _currentFileType() {
    const f = this.workspaceFiles.find(f => f.name === this.selectedWorkspaceFile);
    return f?.type || getFileTypeFromName(this.selectedWorkspaceFile);
  }

  // --- Message Tab ---

  async _sendMessage() {
    if (!this.messageInput.trim()) {return;}
    this.messageSending = true;
    this.messageResponse = null;
    try {
      const data = await api.post(`/api/agents/${this.selectedAgentId}/message`, {
        message: this.messageInput,
      });
      this.messageResponse = data;
      this.messageInput = '';
    } catch (e) {
      this.messageResponse = { error: e.message ?? 'Failed to send message' };
    } finally {
      this.messageSending = false;
    }
  }

  _onMessageKeydown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      this._sendMessage();
    }
  }

  // --- Cron Tab ---

  async _fetchCron(agentId) {
    this.cronLoading = true;
    try {
      const data = await api.get('/api/cron');
      const all = Array.isArray(data) ? data : (data.jobs ?? []);
      this.cronJobs = all.filter(j => j.agentId === agentId || j.agent === agentId);
    } catch {
      this.cronJobs = [];
    } finally {
      this.cronLoading = false;
    }
  }

  async _toggleCronJob(job) {
    try {
      await api.post(`/api/cron/${job.id}/toggle`);
      this._fetchCron(this.selectedAgentId);
    } catch (e) {
      alert('Toggle failed: ' + (e.message ?? e));
    }
  }

  async _runCronNow(job) {
    try {
      await api.post(`/api/cron/${job.id}/run`);
      this._fetchCron(this.selectedAgentId);
    } catch (e) {
      alert('Run failed: ' + (e.message ?? e));
    }
  }

  // ========================
  // RENDER
  // ========================

  render() {
    if (this.selectedAgentId && (this.agentDetailLoading || this.selectedAgent)) {
      return this._renderDetail();
    }
    return this._renderGrid();
  }

  // --- Grid View ---

  _renderGrid() {
    return html`
      <div class="page-agents">
        <div class="page-header">
          <h1 class="page-title">Agents</h1>
          <span class="agent-count-badge">${this.agents.length} agents</span>
        </div>

        ${this.agentsLoading
          ? html`<div class="agent-grid">${[1,2,3,4,5,6].map(() => html`<div class="agent-tile skeleton-tile"></div>`)}</div>`
          : this.agents.length === 0
            ? html`<div class="empty-state">No agents found.</div>`
            : html`
              <div class="agent-grid">
                ${this.agents.map(agent => this._renderAgentTile(agent))}
              </div>
            `}
      </div>
    `;
  }

  _renderAgentTile(agent) {
    const isActive = agent.activeSession || agent.status === 'active';
    const toolsCount = agent.tools?.length ?? agent.toolsCount ?? 0;
    const sessionCount = agent.sessionCount ?? agent.sessions ?? 0;
    const subagents = agent.subagents ?? agent.subAgents ?? [];
    return html`
      <div class="agent-tile" @click=${() => this._selectAgent(agent.id)}>
        <div class="tile-header">
          <span class="tile-emoji">${agent.emoji ?? '🤖'}</span>
          <span class="status-dot ${isActive ? 'green' : 'gray'}" title="${isActive ? 'Active session' : 'Idle'}"></span>
        </div>
        <div class="tile-name">${agent.name ?? agent.id}</div>
        <div class="model-badge">${shortModelName(agent.model ?? agent.defaultModel)}</div>
        <div class="tile-meta">
          ${toolsCount > 0 ? html`<span class="meta-item">🔧 ${toolsCount} tools</span>` : ''}
          ${sessionCount > 0 ? html`<span class="meta-item">💬 ${sessionCount} sessions</span>` : ''}
        </div>
        ${subagents.length > 0 ? html`
          <div class="tile-subagents">
            ${subagents.slice(0, 3).map(sub => html`<span class="subagent-chip">${sub.emoji ?? '🤖'} ${sub.name ?? sub}</span>`)}
            ${subagents.length > 3 ? html`<span class="subagent-chip">+${subagents.length - 3}</span>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  // --- Detail View ---

  _renderDetail() {
    const agent = this.selectedAgent;
    if (this.agentDetailLoading) {
      return html`
        <div class="page-agents">
          <div class="detail-loading">Loading agent…</div>
        </div>
      `;
    }
    if (!agent) {return html``;}
    const isActive = agent.activeSession || agent.status === 'active';
    return html`
      <div class="page-agents">
        <div class="detail-header">
          <button class="btn btn-ghost" @click=${() => this._goBack()}>← Back</button>
          <div class="detail-agent-info">
            <span class="detail-emoji">${agent.emoji ?? '🤖'}</span>
            <div>
              <div class="detail-name">${agent.name ?? agent.id}</div>
              <div class="detail-model">${shortModelName(agent.model ?? agent.defaultModel)}</div>
            </div>
            <span class="status-dot ${isActive ? 'green' : 'gray'}" title="${isActive ? 'Active' : 'Idle'}"></span>
          </div>
        </div>

        <div class="tab-bar">
          ${DETAIL_TABS.map(tab => html`
            <button
              class="tab-btn ${this.activeTab === tab ? 'active' : ''}"
              @click=${() => this._setTab(tab)}
            >${tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
          `)}
        </div>

        <div class="tab-content">
          ${this.activeTab === 'info' ? this._renderInfoTab(agent) : ''}
          ${this.activeTab === 'sessions' ? this._renderSessionsTab() : ''}
          ${this.activeTab === 'workspace' ? this._renderWorkspaceTab() : ''}
          ${this.activeTab === 'message' ? this._renderMessageTab() : ''}
          ${this.activeTab === 'cron' ? this._renderCronTab() : ''}
        </div>
      </div>
    `;
  }

  // --- Info Tab ---

  _renderInfoTab(agent) {
    const tools = agent.tools ?? [];
    const subagents = agent.subagents ?? agent.subAgents ?? [];
    // Models already in fallbacks or set as primary — exclude from dropdown
    const usedModels = new Set([this.modelEditValue, ...this._fallbacks]);
    const dropdownModels = this.availableModels.filter(m => {
      const id = typeof m === 'string' ? m : (m.id ?? '');
      return id && !usedModels.has(id);
    });
    return html`
      <div class="info-tab">
        <!-- Model -->
        <section class="info-section">
          <h3 class="info-section-title">Primary Model</h3>
          <div class="model-edit-row">
            <input
              class="input"
              type="text"
              list="model-datalist"
              .value=${this.modelEditValue}
              @input=${e => { this.modelEditValue = e.target.value; this._checkModelDirty(); }}
              placeholder="e.g. claude-opus-4-6"
            />
            <datalist id="model-datalist">
              ${this.availableModels.map(m => {
                const id = typeof m === 'string' ? m : (m.id ?? '');
                return html`<option value="${id}"></option>`;
              })}
            </datalist>
            <button class="btn ${this._modelDirty ? 'btn-warning' : 'btn-primary'}" @click=${() => this._saveModel()} ?disabled=${this.modelSaving}>
              ${this.modelSaving ? 'Saving\u2026' : this._modelDirty ? 'Save *' : 'Save'}
            </button>
            ${this.modelSaveOk ? html`<span class="save-ok-indicator">Saved</span>` : ''}
          </div>
          ${this.modelSaveError ? html`<div class="error-msg">${this.modelSaveError}</div>` : ''}
        </section>

        <!-- Fallback Models -->
        <section class="info-section">
          <h3 class="info-section-title">Fallback Chain</h3>
          ${this._fallbacks.length > 0 ? html`
            <div class="fallback-manage-list">
              ${this._fallbacks.map((m, i) => html`
                <div class="fallback-manage-item">
                  <span class="fallback-index">${i + 1}</span>
                  <span class="fallback-model-name">${m}</span>
                  <div class="fallback-actions">
                    <button
                      class="btn btn-sm btn-ghost"
                      @click=${() => this._moveFallback(i, -1)}
                      ?disabled=${i === 0}
                      title="Move up"
                    >&#9650;</button>
                    <button
                      class="btn btn-sm btn-ghost"
                      @click=${() => this._moveFallback(i, 1)}
                      ?disabled=${i === this._fallbacks.length - 1}
                      title="Move down"
                    >&#9660;</button>
                    <button
                      class="btn btn-sm btn-danger"
                      @click=${() => this._removeFallback(i)}
                      title="Remove"
                    >&times;</button>
                  </div>
                </div>
              `)}
            </div>
          ` : html`<div class="fallback-empty">No fallback models configured.</div>`}
          <div class="fallback-add-row">
            <select class="input fallback-select" @change=${e => this._addFallback(e)}>
              <option value="">Add fallback model…</option>
              ${dropdownModels.map(m => {
                const id = typeof m === 'string' ? m : (m.id ?? '');
                const label = typeof m === 'string' ? m : (m.name ?? m.id ?? '');
                return html`<option value="${id}">${label}</option>`;
              })}
            </select>
          </div>
        </section>

        <!-- Tools -->
        ${tools.length > 0 ? html`
          <section class="info-section">
            <h3 class="info-section-title">Tools (${tools.length})</h3>
            <div class="tools-list">
              ${tools.map(t => html`<span class="tool-badge">${typeof t === 'string' ? t : (t.name ?? JSON.stringify(t))}</span>`)}
            </div>
          </section>
        ` : ''}

        <!-- Subagents -->
        ${subagents.length > 0 ? html`
          <section class="info-section">
            <h3 class="info-section-title">Subagents</h3>
            <div class="subagent-list">
              ${subagents.map(sub => html`
                <div class="subagent-item">
                  <span class="subagent-emoji">${sub.emoji ?? '🤖'}</span>
                  <span class="subagent-name">${sub.name ?? sub.id ?? sub}</span>
                </div>
              `)}
            </div>
          </section>
        ` : ''}

        <!-- Identity -->
        ${agent.identity || agent.identityMd ? html`
          <section class="info-section">
            <h3 class="info-section-title">Identity</h3>
            ${typeof agent.identity === 'object' && agent.identity !== null
              ? html`
                <div class="identity-fields">
                  ${agent.identity.name ? html`<div class="info-row"><span class="info-label">Name:</span> ${agent.identity.name}</div>` : ''}
                  ${agent.identity.theme ? html`<div class="info-row"><span class="info-label">Theme:</span> ${agent.identity.theme}</div>` : ''}
                  ${agent.identity.emoji ? html`<div class="info-row"><span class="info-label">Emoji:</span> ${agent.identity.emoji}</div>` : ''}
                </div>`
              : html`<div class="markdown-render" .innerHTML=${renderMarkdown(agent.identity ?? agent.identityMd)}></div>`
            }
          </section>
        ` : ''}
      </div>
    `;
  }

  // --- Sessions Tab ---

  _renderSessionsTab() {
    if (this.selectedSession) {
      return this._renderTranscript();
    }
    const filtered = this._filteredSessions;
    return html`
      <div class="sessions-tab">
        <div class="sessions-toolbar">
          <input
            class="input search-input"
            type="search"
            placeholder="Search sessions…"
            .value=${this.sessionSearch}
            @input=${e => { this.sessionSearch = e.target.value; }}
          />
          <button
            class="btn btn-danger ${this.clearMemoryState === 'confirm' ? 'danger-confirm' : ''}"
            @click=${() => this._clickClearMemory()}
            ?disabled=${this.clearMemoryState === 'clearing'}
          >
            ${this.clearMemoryState === 'idle' ? 'Clear Memory' :
              this.clearMemoryState === 'confirm' ? 'Confirm Clear?' :
              'Clearing…'}
          </button>
        </div>

        ${this.sessionsLoading
          ? html`<div class="loading-msg">Loading sessions…</div>`
          : filtered.length === 0
            ? html`<div class="empty-state">No sessions found.</div>`
            : html`
              <div class="session-list">
                ${filtered.map(s => this._renderSessionRow(s))}
              </div>
            `}
      </div>
    `;
  }

  _renderSessionRow(session) {
    return html`
      <div class="session-row" @click=${() => this._selectSession(session)}>
        <div class="session-row-left">
          <span class="session-id">${session.derivedTitle || session.key}</span>
          <span class="session-channel">${session.channel || session.lastChannel || '—'}</span>
        </div>
        <div class="session-row-right">
          <span class="session-time">${timeAgo(session.updatedAt ? new Date(session.updatedAt).toISOString() : null)}</span>
          <span class="session-msgs">${session.model || '—'}</span>
          <button class="btn btn-sm" @click=${e => this._resetSession(session.key, e)}>Reset</button>
          <button class="btn btn-sm btn-danger" @click=${e => this._deleteSession(session.key, e)}>Delete</button>
        </div>
      </div>
    `;
  }

  _renderTranscript() {
    return html`
      <div class="transcript-view">
        <button class="btn btn-ghost" @click=${() => { this.selectedSession = null; this.sessionTranscript = []; }}>
          ← Back to Sessions
        </button>
        <div class="transcript-meta">
          <strong>${this.selectedSession.id}</strong>
          <span class="text-dim">${this.selectedSession.channel ?? ''}</span>
          <span class="text-muted">${timeAgo(this.selectedSession.createdAt)}</span>
        </div>

        <div class="transcript-messages">
          ${this.transcriptLoading
            ? html`<div class="loading-msg">Loading transcript…</div>`
            : this.sessionTranscript.length === 0
              ? html`<div class="empty-state">No messages.</div>`
              : this.sessionTranscript.map(msg => this._renderTranscriptMsg(msg))}
        </div>
      </div>
    `;
  }

  _renderTranscriptMsg(msg) {
    const role = msg.role ?? msg.type ?? 'unknown';
    const isUser = role === 'user' || role === 'human';
    const isAgent = role === 'assistant' || role === 'agent' || role === 'ai';
    const content = msg.content ?? msg.text ?? msg.message ?? '';

    // Handle content as array (Anthropic format)
    if (Array.isArray(content)) {
      return html`
        <div class="msg-wrapper ${isUser ? 'msg-user' : 'msg-agent'}">
          ${content.map(block => this._renderContentBlock(block, isUser))}
        </div>
      `;
    }

    return html`
      <div class="msg-wrapper ${isUser ? 'msg-user' : 'msg-agent'}">
        <div class="msg-bubble ${isUser ? 'bubble-user' : 'bubble-agent'}">
          ${msg.timestamp ? html`<div class="msg-time">${timeAgo(msg.timestamp)}</div>` : ''}
          <div class="msg-text">${content}</div>
        </div>
      </div>
    `;
  }

  _renderContentBlock(block, isUser) {
    if (typeof block === 'string') {
      return html`
        <div class="msg-bubble ${isUser ? 'bubble-user' : 'bubble-agent'}">
          <div class="msg-text">${block}</div>
        </div>
      `;
    }
    if (block.type === 'text') {
      return html`
        <div class="msg-bubble ${isUser ? 'bubble-user' : 'bubble-agent'}">
          <div class="msg-text">${block.text}</div>
        </div>
      `;
    }
    if (block.type === 'thinking') {
      return html`
        <details class="thinking-block">
          <summary>Thinking…</summary>
          <div class="thinking-content">${block.thinking ?? block.text ?? ''}</div>
        </details>
      `;
    }
    if (block.type === 'tool_use') {
      return html`
        <details class="tool-call-block">
          <summary>🔧 ${block.name ?? 'tool_call'}</summary>
          <pre class="tool-args">${JSON.stringify(block.input ?? block.args ?? {}, null, 2)}</pre>
        </details>
      `;
    }
    if (block.type === 'tool_result') {
      return html`
        <details class="tool-result-block">
          <summary>📤 Tool Result${block.is_error ? ' (error)' : ''}</summary>
          <pre class="tool-args">${typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '', null, 2)}</pre>
        </details>
      `;
    }
    // Fallback
    return html`
      <div class="msg-bubble bubble-agent">
        <pre class="tool-args">${JSON.stringify(block, null, 2)}</pre>
      </div>
    `;
  }

  // --- Workspace Tab ---

  _renderWorkspaceTab() {
    const isEditable = this._currentFileEditable;
    const fileType = this._currentFileType;
    const isCodeFile = fileType === 'json' || fileType === 'yaml';
    return html`
      <div class="workspace-tab">
        <div class="workspace-sidebar">
          ${this.workspaceFiles.length === 0
            ? html`<div class="loading-msg" style="padding:var(--space-2)">Loading files…</div>`
            : this.workspaceFiles.map(f => {
                const fType = f.type || getFileTypeFromName(f.name);
                const icon = fileTypeIcon(fType);
                return html`
                  <button
                    class="ws-file-btn ${this.selectedWorkspaceFile === f.name ? 'active' : ''}"
                    @click=${() => this._selectWorkspaceFile(f.name)}
                  >
                    <span class="ws-file-name">${icon}${f.name}</span>
                    ${!f.editable ? html`<span class="readonly-tag">readonly</span>` : ''}
                  </button>
                `;
              })}
        </div>

        <div class="workspace-editor">
          <div class="ws-toolbar">
            <span class="ws-filename">${this.selectedWorkspaceFile}</span>
            <div class="ws-toolbar-right">
              ${isEditable ? html`
                <button
                  class="btn btn-sm ${this.workspacePreview ? 'active' : ''}"
                  @click=${() => { this.workspacePreview = !this.workspacePreview; }}
                >Preview</button>
                <button
                  class="btn btn-sm btn-primary"
                  @click=${() => this._saveWorkspaceFile()}
                  ?disabled=${this.workspaceSaving || !this.workspaceEdited}
                >${this.workspaceSaving ? 'Saving…' : this.workspaceSaveOk ? 'Saved ✓' : 'Save'}</button>
              ` : html`<span class="readonly-badge">Read-only</span>`}
            </div>
          </div>

          ${this.workspaceSaveError ? html`<div class="error-msg">${this.workspaceSaveError}</div>` : ''}

          ${this.workspaceLoading
            ? html`<div class="loading-msg">Loading…</div>`
            : !isEditable && isCodeFile
              ? html`
                <div class="ws-code-viewer">
                  <pre class="ws-code-block"><code>${this.workspaceContent}</code></pre>
                </div>
              `
              : this.workspacePreview && isEditable
                ? html`
                  <div class="ws-split">
                    <textarea
                      class="ws-textarea"
                      .value=${this.workspaceContent}
                      @input=${e => this._onWorkspaceInput(e)}
                      ?readonly=${!isEditable}
                      spellcheck="false"
                    ></textarea>
                    <div class="ws-preview markdown-render" .innerHTML=${renderMarkdown(this.workspaceContent)}></div>
                  </div>
                `
                : html`
                  <textarea
                    class="ws-textarea ws-textarea-full"
                    .value=${this.workspaceContent}
                    @input=${e => this._onWorkspaceInput(e)}
                    ?readonly=${!isEditable}
                    spellcheck="false"
                  ></textarea>
                `}
        </div>
      </div>
    `;
  }

  // --- Message Tab ---

  _renderMessageTab() {
    const resp = this.messageResponse;
    return html`
      <div class="message-tab">
        <div class="message-output">
          ${!resp && !this.messageSending
            ? html`<div class="empty-state msg-placeholder">Send a message to talk with this agent.</div>`
            : ''}
          ${this.messageSending
            ? html`<div class="loading-msg">Agent is thinking…</div>`
            : ''}
          ${resp && !this.messageSending ? html`
            <div class="agent-response">
              ${resp.error
                ? html`<div class="error-msg">${resp.error}</div>`
                : html`
                  ${resp.thinking ? html`
                    <details class="thinking-block">
                      <summary>Thinking…</summary>
                      <div class="thinking-content">${resp.thinking}</div>
                    </details>
                  ` : ''}
                  <div class="response-text markdown-render" .innerHTML=${renderMarkdown(resp.content ?? resp.response ?? resp.text ?? JSON.stringify(resp))}></div>
                `}
            </div>
          ` : ''}
        </div>

        <div class="message-input-area">
          <textarea
            class="input message-textarea"
            placeholder="Type a message… (Ctrl+Enter to send)"
            .value=${this.messageInput}
            @input=${e => { this.messageInput = e.target.value; }}
            @keydown=${e => this._onMessageKeydown(e)}
            ?disabled=${this.messageSending}
            rows="3"
          ></textarea>
          <button
            class="btn btn-primary"
            @click=${() => this._sendMessage()}
            ?disabled=${this.messageSending || !this.messageInput.trim()}
          >${this.messageSending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    `;
  }

  // --- Cron Tab ---

  _renderCronTab() {
    return html`
      <div class="cron-tab">
        ${this.cronLoading
          ? html`<div class="loading-msg">Loading cron jobs…</div>`
          : this.cronJobs.length === 0
            ? html`<div class="empty-state">No cron jobs for this agent.</div>`
            : html`
              <div class="cron-list">
                ${this.cronJobs.map(job => this._renderCronRow(job))}
              </div>
            `}
      </div>
    `;
  }

  _renderCronRow(job) {
    const isEnabled = job.enabled !== false && job.status !== 'disabled';
    const statusColor = job.status === 'error' || job.lastStatus === 'error'
      ? 'var(--red)'
      : isEnabled ? 'var(--green)' : 'var(--text-muted)';
    return html`
      <div class="cron-row">
        <div class="cron-row-left">
          <span class="status-dot" style="background:${statusColor};box-shadow:0 0 6px ${statusColor}"></span>
          <div class="cron-info">
            <div class="cron-name">${job.name ?? job.id}</div>
            <div class="cron-schedule">${job.schedule ?? job.cron ?? '—'}</div>
            ${job.lastRun ? html`<div class="cron-last">Last run: ${timeAgo(job.lastRun)}</div>` : ''}
            ${job.lastError ? html`<div class="cron-error">${job.lastError}</div>` : ''}
          </div>
        </div>
        <div class="cron-row-right">
          <button class="btn btn-sm" @click=${() => this._toggleCronJob(job)}>
            ${isEnabled ? 'Disable' : 'Enable'}
          </button>
          <button class="btn btn-sm" @click=${() => this._runCronNow(job)}>Run Now</button>
        </div>
      </div>
    `;
  }

  // ========================
  // STYLES
  // ========================

  static styles = css`
    :host {
      display: block;
      font-family: var(--font-sans);
      color: var(--text);
    }

    /* Page layout */
    .page-agents {
      padding: var(--space-6);
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
    }

    .page-header {
      display: flex;
      align-items: center;
      gap: var(--space-4);
    }
    .page-title {
      margin: 0;
      font-size: var(--font-size-2xl);
      font-weight: 700;
    }
    .agent-count-badge {
      font-size: var(--font-size-sm);
      color: var(--text-dim);
      background: var(--surface-2);
      border: 1px solid var(--border);
      padding: 2px 10px;
      border-radius: var(--radius-full);
    }

    /* Status dots */
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-dot.green {
      background: var(--green);
      box-shadow: 0 0 6px var(--green);
    }
    .status-dot.gray { background: var(--text-muted); }

    /* Agent Grid (tile view) */
    .agent-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--space-4);
    }

    .agent-tile {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-4);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      transition: border-color var(--transition), box-shadow var(--transition), transform var(--transition);
      min-height: 120px;
    }
    .agent-tile:hover {
      border-color: var(--accent);
      box-shadow: var(--shadow-glow);
      transform: translateY(-2px);
    }

    .skeleton-tile {
      animation: shimmer 1.4s infinite;
      background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
      background-size: 200% 100%;
      cursor: default;
    }
    .skeleton-tile:hover { transform: none; border-color: var(--border); box-shadow: none; }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .tile-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .tile-emoji { font-size: 2rem; }
    .tile-name { font-size: var(--font-size-md); font-weight: 700; }
    .model-badge {
      font-size: var(--font-size-xs);
      background: var(--accent-dim);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: var(--radius-full);
      width: fit-content;
      font-family: var(--font-mono);
    }
    .tile-meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .meta-item {
      font-size: var(--font-size-xs);
      color: var(--text-dim);
    }
    .tile-subagents {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
    }
    .subagent-chip {
      font-size: var(--font-size-xs);
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-full);
      padding: 1px 6px;
      color: var(--text-dim);
    }

    /* Detail header */
    .detail-header {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding-bottom: var(--space-4);
      border-bottom: 1px solid var(--border);
    }
    .detail-agent-info {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex: 1;
    }
    .detail-emoji { font-size: 2rem; }
    .detail-name { font-size: var(--font-size-xl); font-weight: 700; }
    .detail-model { font-size: var(--font-size-sm); color: var(--text-dim); }

    /* Tabs */
    .tab-bar {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border);
    }
    .tab-btn {
      padding: var(--space-3) var(--space-5);
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--text-dim);
      font-family: var(--font-sans);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: color var(--transition), border-color var(--transition);
      margin-bottom: -1px;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    .tab-content {
      padding-top: var(--space-4);
    }

    /* Info Tab */
    .info-tab {
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
    }
    .info-section {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .info-section-title {
      margin: 0;
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      font-size: var(--font-size-xs);
      letter-spacing: 0.08em;
    }
    .model-edit-row {
      display: flex;
      gap: var(--space-3);
      align-items: center;
    }
    .model-edit-row .input { flex: 1; }
    .btn-warning {
      background: var(--amber-500, #f59e0b);
      color: #000;
      border: none;
      font-weight: 600;
    }
    .btn-warning:hover { background: var(--amber-400, #fbbf24); }
    .save-ok-indicator {
      color: var(--green-400, #4ade80);
      font-size: 0.85rem;
      font-weight: 600;
      animation: fadeIn 0.2s ease-in;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .fallback-chain {
      margin: 0;
      padding-left: var(--space-5);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .fallback-chain li { font-size: var(--font-size-sm); font-family: var(--font-mono); }
    .fallback-chain li.primary { color: var(--accent); }

    /* Fallback management */
    .fallback-manage-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .fallback-manage-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: border-color var(--transition);
    }
    .fallback-manage-item:hover {
      border-color: var(--accent);
    }
    .fallback-index {
      font-size: var(--font-size-xs);
      font-weight: 700;
      color: var(--text-muted);
      width: 20px;
      text-align: center;
      flex-shrink: 0;
    }
    .fallback-model-name {
      flex: 1;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .fallback-actions {
      display: flex;
      gap: 2px;
      flex-shrink: 0;
    }
    .fallback-actions .btn {
      padding: 2px 6px;
      font-size: var(--font-size-xs);
      min-width: 24px;
    }
    .fallback-empty {
      font-size: var(--font-size-sm);
      color: var(--text-muted);
      padding: var(--space-2) 0;
    }
    .fallback-add-row {
      display: flex;
      gap: var(--space-3);
      margin-top: var(--space-2);
    }
    .fallback-select {
      flex: 1;
      max-width: 400px;
    }

    .info-label {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .tools-list {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .tool-badge {
      font-size: var(--font-size-xs);
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-full);
      padding: 2px 10px;
      font-family: var(--font-mono);
      color: var(--text-dim);
    }

    .subagent-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .subagent-item {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--font-size-sm);
    }
    .subagent-emoji { font-size: 1.2rem; }
    .subagent-name { font-weight: 500; }

    /* Markdown render */
    .markdown-render {
      font-size: var(--font-size-sm);
      line-height: 1.7;
      color: var(--text-dim);
    }
    .markdown-render h1, .markdown-render h2, .markdown-render h3 {
      color: var(--text);
      margin: var(--space-4) 0 var(--space-2) 0;
    }
    .markdown-render h1 { font-size: var(--font-size-xl); }
    .markdown-render h2 { font-size: var(--font-size-lg); }
    .markdown-render h3 { font-size: var(--font-size-md); }
    .markdown-render p { margin: var(--space-2) 0; }
    .markdown-render code {
      font-family: var(--font-mono);
      background: var(--surface-3);
      padding: 1px 5px;
      border-radius: var(--radius-sm);
      font-size: 0.9em;
    }
    .markdown-render blockquote {
      border-left: 3px solid var(--accent);
      padding-left: var(--space-3);
      color: var(--text-muted);
      margin: var(--space-2) 0;
    }
    .markdown-render li { margin: 2px 0; padding-left: var(--space-2); }
    .markdown-render hr { border: none; border-top: 1px solid var(--border); margin: var(--space-4) 0; }

    /* Sessions Tab */
    .sessions-tab {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .sessions-toolbar {
      display: flex;
      gap: var(--space-3);
      align-items: center;
    }
    .search-input { flex: 1; }

    .session-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .session-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-3) var(--space-4);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      transition: background var(--transition), border-color var(--transition);
      gap: var(--space-4);
    }
    .session-row:hover { background: var(--surface-2); border-color: var(--accent); }
    .session-row-left {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .session-id {
      font-size: var(--font-size-sm);
      font-family: var(--font-mono);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-channel {
      font-size: var(--font-size-xs);
      color: var(--text-dim);
    }
    .session-row-right {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-shrink: 0;
    }
    .session-time, .session-msgs {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
    }

    /* Transcript */
    .transcript-view {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .transcript-meta {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      font-size: var(--font-size-sm);
      padding: var(--space-3) var(--space-4);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    .text-dim { color: var(--text-dim); }
    .text-muted { color: var(--text-muted); }

    .transcript-messages {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
    }

    .msg-wrapper {
      display: flex;
      flex-direction: column;
      max-width: 80%;
      gap: var(--space-2);
    }
    .msg-user { align-self: flex-end; align-items: flex-end; }
    .msg-agent { align-self: flex-start; align-items: flex-start; }

    .msg-bubble {
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      line-height: 1.6;
    }
    .bubble-user {
      background: var(--accent-dim);
      border: 1px solid rgba(0,212,255,0.3);
      color: var(--text);
    }
    .bubble-agent {
      background: var(--surface-2);
      border: 1px solid var(--border);
    }
    .msg-time {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      margin-bottom: var(--space-1);
    }
    .msg-text { white-space: pre-wrap; word-break: break-word; }

    .thinking-block, .tool-call-block, .tool-result-block {
      font-size: var(--font-size-sm);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .thinking-block { border-color: var(--purple); }
    .tool-call-block { border-color: var(--accent); }
    .tool-result-block { border-color: var(--green); }

    details > summary {
      padding: var(--space-2) var(--space-3);
      cursor: pointer;
      color: var(--text-dim);
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--surface-2);
      list-style: none;
    }
    details > summary::marker { display: none; }
    details > summary::-webkit-details-marker { display: none; }
    details > summary::before { content: '▶ '; font-size: 0.7em; }
    details[open] > summary::before { content: '▼ '; }

    .thinking-content {
      padding: var(--space-3);
      color: var(--text-muted);
      font-style: italic;
      font-size: var(--font-size-xs);
      white-space: pre-wrap;
    }
    .tool-args {
      margin: 0;
      padding: var(--space-3);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--text-dim);
      overflow-x: auto;
      white-space: pre;
      background: var(--surface-3);
    }

    /* Workspace Tab */
    .workspace-tab {
      display: flex;
      gap: var(--space-4);
      min-height: 500px;
    }

    .workspace-sidebar {
      width: 160px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border-right: 1px solid var(--border);
      padding-right: var(--space-3);
    }
    .ws-file-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border: none;
      border-radius: var(--radius);
      background: transparent;
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      cursor: pointer;
      text-align: left;
      transition: background var(--transition), color var(--transition);
    }
    .ws-file-btn:hover { background: var(--surface-2); color: var(--text); }
    .ws-file-btn.active { background: var(--accent-dim); color: var(--accent); }

    .readonly-tag {
      font-size: 10px;
      padding: 1px 4px;
      border-radius: var(--radius-sm);
      background: var(--surface-3);
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .readonly-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      background: var(--surface-3);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border: 1px solid var(--border);
    }

    .ws-code-viewer {
      flex: 1;
      overflow: auto;
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }
    .ws-code-block {
      margin: 0;
      padding: var(--space-4);
      background: #1a1a2e;
      color: #c8d6e5;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
      min-height: 400px;
      box-sizing: border-box;
    }
    .ws-code-block code {
      font-family: inherit;
      font-size: inherit;
      color: inherit;
    }

    .workspace-editor {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      min-width: 0;
    }
    .ws-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ws-filename {
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      font-weight: 600;
      color: var(--text-dim);
    }
    .ws-toolbar-right { display: flex; align-items: center; gap: var(--space-2); }

    .ws-textarea {
      width: 100%;
      min-height: 400px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      padding: var(--space-4);
      line-height: 1.6;
      resize: vertical;
      box-sizing: border-box;
      transition: border-color var(--transition);
    }
    .ws-textarea:focus {
      outline: none;
      border-color: var(--accent);
    }
    .ws-textarea[readonly] { color: var(--text-dim); }
    .ws-textarea-full { width: 100%; }

    .ws-split {
      display: flex;
      gap: var(--space-4);
      flex: 1;
    }
    .ws-split .ws-textarea {
      flex: 1;
      min-width: 0;
    }
    .ws-preview {
      flex: 1;
      min-width: 0;
      padding: var(--space-4);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow-y: auto;
      min-height: 400px;
    }

    @media (max-width: 700px) {
      .workspace-tab { flex-direction: column; }
      .workspace-sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; border-right: none; border-bottom: 1px solid var(--border); padding-right: 0; padding-bottom: var(--space-3); }
      .ws-split { flex-direction: column; }
    }

    /* Message Tab */
    .message-tab {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .message-output {
      min-height: 200px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-4);
    }
    .msg-placeholder { text-align: center; padding-top: var(--space-8); }
    .agent-response { display: flex; flex-direction: column; gap: var(--space-3); }
    .response-text {
      font-size: var(--font-size-sm);
      line-height: 1.7;
    }

    .message-input-area {
      display: flex;
      gap: var(--space-3);
      align-items: flex-end;
    }
    .message-textarea {
      flex: 1;
      resize: none;
      min-height: 80px;
    }

    /* Cron Tab */
    .cron-tab {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .cron-list { display: flex; flex-direction: column; gap: var(--space-3); }
    .cron-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: var(--space-4);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      gap: var(--space-4);
    }
    .cron-row-left { display: flex; align-items: flex-start; gap: var(--space-3); flex: 1; }
    .cron-info { display: flex; flex-direction: column; gap: 4px; }
    .cron-name { font-weight: 600; font-size: var(--font-size-sm); }
    .cron-schedule { font-size: var(--font-size-xs); font-family: var(--font-mono); color: var(--text-dim); }
    .cron-last { font-size: var(--font-size-xs); color: var(--text-muted); }
    .cron-error { font-size: var(--font-size-xs); color: var(--red); }
    .cron-row-right { display: flex; gap: var(--space-2); flex-shrink: 0; }

    /* Shared input / button styles */
    .input {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: var(--font-size-sm);
      padding: var(--space-2) var(--space-3);
      transition: border-color var(--transition);
      min-width: 0;
    }
    .input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: background var(--transition), border-color var(--transition);
      white-space: nowrap;
    }
    .btn:hover:not(:disabled) {
      background: var(--surface-3);
      border-color: var(--accent);
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-sm { padding: var(--space-1) var(--space-3); font-size: var(--font-size-xs); }
    .btn-ghost {
      background: transparent;
      border-color: transparent;
      color: var(--text-dim);
    }
    .btn-ghost:hover:not(:disabled) { background: var(--surface-2); color: var(--text); border-color: var(--border); }
    .btn-primary {
      background: var(--accent-dim);
      border-color: var(--accent);
      color: var(--accent);
    }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-danger {
      border-color: var(--red);
      color: var(--red);
      background: var(--red-dim);
    }
    .btn-danger:hover:not(:disabled) { background: rgba(239,68,68,0.25); }
    .danger-confirm {
      background: var(--red);
      color: #fff;
      animation: pulse-red 0.5s ease;
    }
    @keyframes pulse-red {
      0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6); }
      70% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
      100% { box-shadow: none; }
    }
    .btn.active {
      background: var(--accent-dim);
      border-color: var(--accent);
      color: var(--accent);
    }

    /* States */
    .empty-state {
      color: var(--text-muted);
      font-size: var(--font-size-sm);
      padding: var(--space-8);
      text-align: center;
    }
    .loading-msg {
      color: var(--text-dim);
      font-size: var(--font-size-sm);
      padding: var(--space-4);
      text-align: center;
    }
    .detail-loading {
      color: var(--text-dim);
      font-size: var(--font-size-md);
      padding: var(--space-8);
      text-align: center;
    }
    .error-msg {
      font-size: var(--font-size-sm);
      color: var(--red);
      padding: var(--space-2) var(--space-3);
      background: var(--red-dim);
      border-radius: var(--radius);
    }
  `;
}

customElements.define('page-agents', PageAgents);
