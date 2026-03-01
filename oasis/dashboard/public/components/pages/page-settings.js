import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';
import { store } from '/app/store.js';
import { router } from '/app/router.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds) {
  if (!seconds && seconds !== 0) {return '—';}
  const s = Math.floor(Number(seconds));
  if (s < 60) {return `${s}s`;}
  const m = Math.floor(s / 60);
  if (m < 60) {return `${m}m ${s % 60}s`;}
  const h = Math.floor(m / 60);
  if (h < 24) {return `${h}h ${m % 60}m`;}
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function shortModelName(id) {
  const resolved = (typeof id === 'object' && id) ? (id.primary ?? id.id ?? id.name ?? null) : id;
  if (!resolved || typeof resolved !== 'string') {return '—';}
  const name = resolved.includes('/') ? resolved.split('/').pop() : resolved;
  return name.replace(/-\d{4}[-\d]*$/, '');
}

function showToast(msg, type = 'ok') {
  if (typeof window.__oasisToast === 'function') {
    window.__oasisToast(msg, type);
  }
}

// Redact sensitive-looking values
function redact(val) {
  if (!val) {return '—';}
  const s = String(val);
  if (s.length < 8) {return '••••';}
  return s.substring(0, 4) + '••••••••' + s.substring(s.length - 2);
}

const CHANNEL_SENSITIVE_KEYS = new Set([
  'token', 'apiKey', 'api_key', 'secret', 'password', 'botToken',
  'webhook', 'webhookSecret', 'accessToken', 'botApiKey',
]);

function isSensitiveKey(key) {
  return CHANNEL_SENSITIVE_KEYS.has(key) ||
    key.toLowerCase().includes('token') ||
    key.toLowerCase().includes('secret') ||
    key.toLowerCase().includes('key') ||
    key.toLowerCase().includes('password');
}

const CHANNEL_ICONS = {
  telegram: '✈️',
  whatsapp: '💬',
  discord: '🎮',
  slack: '💼',
  signal: '🔒',
  imessage: '💙',
  sms: '📱',
  matrix: '🔷',
  msteams: '🟦',
  voice: '📞',
  web: '🌐',
};

function channelIcon(name) {
  if (!name) {return '📡';}
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(CHANNEL_ICONS)) {
    if (lower.includes(k)) {return v;}
  }
  return '📡';
}

const REFRESH_OPTIONS = [
  { value: '5000', label: '5s' },
  { value: '10000', label: '10s' },
  { value: '15000', label: '15s' },
  { value: '30000', label: '30s' },
  { value: '60000', label: '60s' },
  { value: '120000', label: '2m' },
  { value: '0', label: 'disabled' },
];

const REFRESH_KEYS = ['home', 'treasury', 'voice', 'docker'];
const REFRESH_LABELS = {
  home: 'Home page',
  treasury: 'Treasury',
  voice: 'Voice pipeline',
  docker: 'Docker containers',
};
const REFRESH_DEFAULTS = {
  home: '30000',
  treasury: '60000',
  voice: '10000',
  docker: '10000',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

class PageSettings extends LitElement {
  static properties = {
    // Accordion open state
    openSections: { type: Object },

    // Section 1 — Gateway
    health: { type: Object },
    healthLoading: { type: Boolean },
    wsLatency: { type: Number },
    wsConnected: { type: Boolean },
    gatewayInfo: { type: Object },

    // Section 2 — Agent Config
    modelList: { type: Array },
    modelsLoading: { type: Boolean },
    defaultModel: { type: String },
    defaultFallbacks: { type: Array },
    modelSaving: { type: Boolean },
    modelSaveOk: { type: Boolean },
    fallbackAddValue: { type: String },
    defaultAgent: { type: String },
    agentList: { type: Array },
    agentSaving: { type: Boolean },
    agentSaveOk: { type: Boolean },

    // Section 3 — Routing Bindings
    bindings: { type: Array },
    bindingsLoading: { type: Boolean },
    bindingsSaving: { type: Boolean },
    bindingAgentList: { type: Array },
    bindingAgentsLoading: { type: Boolean },
    newBinding: { type: Object },
    deleteConfirmIdx: { type: Number },

    // Section 4 — Channels
    channels: { type: Array },
    channelsLoading: { type: Boolean },
    channelDetailId: { type: String },
    channelDetail: { type: Object },
    channelDetailLoading: { type: Boolean },
    channelDetailOpen: { type: Boolean },

    // Section 5 — Plugins, Hooks & Skills
    pluginsInfo: { type: Object },
    hooksInfo: { type: Object },
    skillsInfo: { type: Object },

    // Section 6 — Appearance
    theme: { type: String },
    refreshIntervals: { type: Object },

    // Section 7 — System Info
    sysInfo: { type: Object },

    // Restart indicator
    _needsRestart: { type: Boolean },
  };

  constructor() {
    super();
    this.openSections = { gateway: true, agentConfig: false, routing: false, channels: false, extensions: false, appearance: false, sysInfo: false };

    // Section 1
    this.health = null;
    this.healthLoading = false;
    this.wsLatency = null;
    this.wsConnected = false;
    this.gatewayInfo = null;

    // Section 2
    this.modelList = [];
    this.modelsLoading = false;
    this.defaultModel = '';
    this.defaultFallbacks = [];
    this.modelSaving = false;
    this.modelSaveOk = false;
    this.fallbackAddValue = '';
    this.defaultAgent = '';
    this.agentList = [];
    this.agentSaving = false;
    this.agentSaveOk = false;

    // Section 3
    this.bindings = [];
    this.bindingsLoading = false;
    this.bindingsSaving = false;
    this.bindingAgentList = [];
    this.bindingAgentsLoading = false;
    this.newBinding = { channel: 'telegram', peer: '', type: 'direct', agentId: '' };
    this.deleteConfirmIdx = -1;

    // Section 4
    this.channels = [];
    this.channelsLoading = false;
    this.channelDetailId = null;
    this.channelDetail = null;
    this.channelDetailLoading = false;
    this.channelDetailOpen = false;

    // Section 5
    this.pluginsInfo = {};
    this.hooksInfo = {};
    this.skillsInfo = {};

    // Section 6
    this.theme = localStorage.getItem('oasis-theme') || 'dark';
    const savedIntervals = JSON.parse(localStorage.getItem('oasis-refresh-intervals') || '{}');
    this.refreshIntervals = { ...REFRESH_DEFAULTS, ...savedIntervals };

    // Section 7
    this.sysInfo = null;

    // Restart indicator
    this._needsRestart = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._fetchHealth();
    this._fetchModels();
    this._pingWs();
  }

  // ---------------------------------------------------------------------------
  // Accordion
  // ---------------------------------------------------------------------------

  _toggleSection(key) {
    this.openSections = { ...this.openSections, [key]: !this.openSections[key] };
    // Lazy load on first open
    if (this.openSections[key]) {
      this._onSectionOpen(key);
    }
  }

  _onSectionOpen(key) {
    if (key === 'routing' && !this.bindings.length && !this.bindingsLoading) {this._fetchBindings();}
    if (key === 'routing' && !this.bindingAgentList.length) {this._fetchBindingAgents();}
    if (key === 'channels' && !this.channels.length && !this.channelsLoading) {this._fetchChannels();}
    if (key === 'extensions' && !this.pluginsInfo.loaded) {this._fetchSettings();}
    if (key === 'sysInfo') {this._fetchHealth();}
  }

  // ---------------------------------------------------------------------------
  // Data — Health
  // ---------------------------------------------------------------------------

  async _fetchHealth() {
    this.healthLoading = true;
    try {
      const data = await api.get('/api/health');
      this.health = data;
      this.sysInfo = data;
    } catch {
      this.health = null;
    } finally {
      this.healthLoading = false;
    }
  }

  _pingWs() {
    // Attempt to measure WS latency using existing ws connection from store/eventBus
    const ws = window.__oasisWs;
    if (!ws) {
      this.wsConnected = false;
      return;
    }
    this.wsConnected = ws.readyState === WebSocket.OPEN;
    if (this.wsConnected) {
      const t = Date.now();
      // A simple heuristic: if the store has a lastPing, use it
      if (window.__oasisWsLatency != null) {
        this.wsLatency = window.__oasisWsLatency;
      } else {
        this.wsLatency = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Data — Models
  // ---------------------------------------------------------------------------

  async _fetchModels() {
    this.modelsLoading = true;
    try {
      const data = await api.get('/api/models');
      this.modelList = Array.isArray(data) ? data : (data.models ?? []);
      // Load current settings from the structured endpoint
      await this._fetchSettings();
    } catch {
      this.modelList = [];
    } finally {
      this.modelsLoading = false;
    }
  }

  async _fetchSettings() {
    try {
      const settings = await api.get('/api/settings');
      this.defaultModel = settings?.defaultModel ?? '';
      this.defaultFallbacks = settings?.fallbacks ?? [];
      this.defaultAgent = settings?.defaultAgent ?? '';
      this.agentList = settings?.agents ?? [];
      this.gatewayInfo = settings?.gateway ?? null;
      this.hooksInfo = { loaded: true, ...settings?.hooks };
      this.skillsInfo = { loaded: true, ...settings?.skills };
      this.pluginsInfo = { loaded: true, ...settings?.plugins };
    } catch {
      // Keep existing values on error
    }
  }

  async _saveDefaultModel() {
    this.modelSaving = true;
    this.modelSaveOk = false;
    try {
      const result = await api.post('/api/settings', { defaultModel: this.defaultModel, fallbacks: this.defaultFallbacks });
      if (result?.ok) {
        const reloadMsg = result.reloadStatus === 'applied'
          ? 'Saved & applied immediately'
          : 'Saved — gateway restart required to take effect';
        showToast(reloadMsg, 'ok');
        this.modelSaveOk = true;
        this._needsRestart = result.reloadStatus !== 'applied';
        setTimeout(() => { this.modelSaveOk = false; }, 2500);
      } else {
        showToast('Failed to save model: ' + (result?.error || 'unknown error'), 'error');
      }
    } catch (e) {
      showToast('Failed to save model: ' + (e?.message || 'error'), 'error');
    } finally {
      this.modelSaving = false;
    }
  }

  async _saveDefaultAgent() {
    this.agentSaving = true;
    this.agentSaveOk = false;
    try {
      const result = await api.post('/api/settings', { defaultAgent: this.defaultAgent });
      if (result?.ok) {
        const reloadMsg = result.reloadStatus === 'applied'
          ? 'Saved & applied immediately'
          : 'Saved — gateway restart required to take effect';
        showToast(reloadMsg, 'ok');
        this.agentSaveOk = true;
        this._needsRestart = result.reloadStatus !== 'applied';
        setTimeout(() => { this.agentSaveOk = false; }, 2500);
      } else {
        showToast('Failed to save agent: ' + (result?.error || 'unknown error'), 'error');
      }
    } catch (e) {
      showToast('Failed to save agent: ' + (e?.message || 'error'), 'error');
    } finally {
      this.agentSaving = false;
    }
  }

  _addDefaultFallback(modelId) {
    const val = (modelId || this.fallbackAddValue || '').trim();
    if (val && !this.defaultFallbacks.includes(val)) {
      this.defaultFallbacks = [...this.defaultFallbacks, val];
      this.fallbackAddValue = '';
    }
  }

  _removeDefaultFallback(m) {
    this.defaultFallbacks = this.defaultFallbacks.filter(x => x !== m);
  }

  _moveDefaultFallbackUp(idx) {
    if (idx <= 0) {return;}
    const arr = [...this.defaultFallbacks];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    this.defaultFallbacks = arr;
  }

  _moveDefaultFallbackDown(idx) {
    if (idx >= this.defaultFallbacks.length - 1) {return;}
    const arr = [...this.defaultFallbacks];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    this.defaultFallbacks = arr;
  }

  // ---------------------------------------------------------------------------
  // Data — Bindings
  // ---------------------------------------------------------------------------

  async _fetchBindings() {
    this.bindingsLoading = true;
    try {
      const data = await api.get('/api/bindings');
      this.bindings = Array.isArray(data) ? data : (data.bindings ?? []);
    } catch {
      this.bindings = [];
    } finally {
      this.bindingsLoading = false;
    }
  }

  async _fetchBindingAgents() {
    this.bindingAgentsLoading = true;
    try {
      const data = await api.get('/api/agents');
      this.bindingAgentList = Array.isArray(data) ? data : (data.agents ?? []);
    } catch {
      this.bindingAgentList = [];
    } finally {
      this.bindingAgentsLoading = false;
    }
  }

  async _saveBindings() {
    this.bindingsSaving = true;
    try {
      await api.put('/api/bindings', { bindings: this.bindings });
      showToast('Routing bindings saved', 'ok');
    } catch (e) {
      showToast('Failed to save bindings: ' + (e?.message || 'error'), 'error');
    } finally {
      this.bindingsSaving = false;
    }
  }

  _addBinding() {
    const b = { ...this.newBinding };
    if (!b.channel || !b.agentId) {
      showToast('Channel and agent are required', 'error');
      return;
    }
    this.bindings = [...this.bindings, b];
    this.newBinding = { channel: 'telegram', peer: '', type: 'direct', agentId: '' };
  }

  _deleteBinding(idx) {
    if (this.deleteConfirmIdx === idx) {
      this.bindings = this.bindings.filter((_, i) => i !== idx);
      this.deleteConfirmIdx = -1;
    } else {
      this.deleteConfirmIdx = idx;
      // Auto-reset confirm after 3s
      setTimeout(() => { if (this.deleteConfirmIdx === idx) {this.deleteConfirmIdx = -1;} }, 3000);
    }
  }

  _moveBindingUp(idx) {
    if (idx <= 0) {return;}
    const arr = [...this.bindings];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    this.bindings = arr;
  }

  _moveBindingDown(idx) {
    if (idx >= this.bindings.length - 1) {return;}
    const arr = [...this.bindings];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    this.bindings = arr;
  }

  _updateNewBinding(field, value) {
    this.newBinding = { ...this.newBinding, [field]: value };
  }

  _agentName(id) {
    const a = this.bindingAgentList.find(x => (x.id ?? x) === id);
    if (!a) {return id;}
    const emoji = a.emoji ?? '';
    const name = a.name ?? id;
    return emoji ? `${emoji} ${name}` : name;
  }

  // ---------------------------------------------------------------------------
  // Data — Channels
  // ---------------------------------------------------------------------------

  async _fetchChannels() {
    this.channelsLoading = true;
    try {
      const data = await api.get('/api/channels');
      this.channels = Array.isArray(data) ? data : (data.channels ?? []);
    } catch {
      this.channels = [];
    } finally {
      this.channelsLoading = false;
    }
  }

  async _openChannelDetail(id) {
    this.channelDetailId = id;
    this.channelDetailOpen = true;
    this.channelDetailLoading = true;
    this.channelDetail = null;
    try {
      const data = await api.get(`/api/channels/${id}`);
      this.channelDetail = data;
    } catch {
      this.channelDetail = { error: true };
    } finally {
      this.channelDetailLoading = false;
    }
  }

  _closeChannelDetail() {
    this.channelDetailOpen = false;
    this.channelDetailId = null;
    this.channelDetail = null;
  }

  async _toggleChannel(id, enabled) {
    try {
      await api.patch(`/api/channels/${id}`, { enabled });
      this.channels = this.channels.map(c => (c.id ?? c.name) === id ? { ...c, enabled } : c);
      showToast(`Channel ${enabled ? 'enabled' : 'disabled'}`, 'ok');
    } catch (e) {
      showToast('Failed to update channel: ' + (e?.message || 'error'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Appearance & Preferences
  // ---------------------------------------------------------------------------

  _setTheme(t) {
    this.theme = t;
    localStorage.setItem('oasis-theme', t);
    document.documentElement.setAttribute('data-theme', t);
    showToast(`Theme set to ${t}`, 'ok');
  }

  _setRefreshInterval(key, value) {
    this.refreshIntervals = { ...this.refreshIntervals, [key]: value };
    localStorage.setItem('oasis-refresh-intervals', JSON.stringify(this.refreshIntervals));
  }

  async _clearTreasuryCache() {
    try {
      await api.post('/api/treasury/cache/clear');
      showToast('Treasury cache cleared', 'ok');
    } catch (e) {
      showToast('Failed to clear cache: ' + (e?.message || 'error'), 'error');
    }
  }

  async _clearAllCaches() {
    try {
      await api.post('/api/treasury/cache/clear');
      showToast('All caches cleared', 'ok');
    } catch (e) {
      showToast('Failed to clear caches: ' + (e?.message || 'error'), 'error');
    }
  }

  async _restartGateway() {
    try {
      await api.post('/api/docker/containers/oasis/restart');
      showToast('Gateway restarting...', 'ok');
      this._needsRestart = false;
    } catch (e) {
      showToast('Failed to restart: ' + (e?.message || 'error'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  static styles = css`
    :host {
      display: block;
      padding: 24px;
      color: var(--text, #e0e6f0);
      font-family: "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace;
      min-height: 100%;
      box-sizing: border-box;
    }
    h2 { margin: 0 0 4px 0; font-size: 22px; }
    h3 { margin: 0 0 8px 0; }
    h4 { margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted, #4a5568); }

    .page-header { margin-bottom: 24px; }
    .page-header p { margin: 0; color: var(--text-dim, #7a8ba8); font-size: 13px; }

    /* Accordion */
    .accordion { display: flex; flex-direction: column; gap: 10px; }
    .accordion-item { border: 1px solid var(--border, #2a3550); border-radius: 12px; overflow: hidden; }
    .accordion-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px; background: var(--surface-2, #1a2235);
      cursor: pointer; user-select: none; transition: background 0.15s;
    }
    .accordion-header:hover { background: var(--surface-3, #222d42); }
    .accordion-title {
      display: flex; align-items: center; gap: 10px;
      font-size: 14px; font-weight: 700; color: var(--text, #e0e6f0);
    }
    .accordion-title .icon { font-size: 18px; }
    .accordion-meta { font-size: 12px; color: var(--text-muted, #4a5568); margin-left: auto; margin-right: 12px; }
    .chevron { transition: transform 0.25s; display: inline-block; color: var(--text-muted, #4a5568); }
    .chevron.open { transform: rotate(90deg); }
    .accordion-body {
      padding: 20px;
      border-top: 1px solid var(--border, #2a3550);
      background: var(--surface, #131926);
    }

    /* Status card */
    .status-card {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550); border-radius: 10px; padding: 16px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
    }
    @media (max-width: 600px) { .status-card { grid-template-columns: 1fr; } }
    .status-row { display: flex; flex-direction: column; gap: 3px; }
    .status-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted, #4a5568); }
    .status-value { font-size: 13px; color: var(--text, #e0e6f0); }
    .status-dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 50%;
      margin-right: 6px; flex-shrink: 0;
    }
    .status-dot.green { background: var(--green, #22c55e); box-shadow: 0 0 6px rgba(34,197,94,0.5); }
    .status-dot.red { background: var(--red, #ef4444); }
    .status-dot.gray { background: var(--text-muted, #4a5568); }
    .status-badge {
      display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 12px; font-size: 11px;
    }
    .status-badge.connected { background: rgba(34,197,94,0.15); color: var(--green, #22c55e); border: 1px solid rgba(34,197,94,0.3); }
    .status-badge.disconnected { background: rgba(239,68,68,0.1); color: var(--red, #ef4444); border: 1px solid rgba(239,68,68,0.3); }
    .status-badge.unknown { background: var(--surface-3, #222d42); color: var(--text-muted, #4a5568); border: 1px solid var(--border, #2a3550); }

    /* Form */
    .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-dim, #7a8ba8); }
    input[type="text"], select {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550); border-radius: 6px;
      color: var(--text, #e0e6f0); font-family: inherit; font-size: 13px;
      padding: 8px 12px; outline: none; transition: border-color 0.15s;
      width: 100%; box-sizing: border-box;
    }
    input:focus, select:focus { border-color: var(--accent, #00d4ff); }
    .field-hint { font-size: 11px; color: var(--text-muted, #4a5568); }

    /* Fallback list */
    .fallback-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
    .fallback-item {
      display: flex; align-items: center; gap: 8px; padding: 6px 10px;
      background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550); border-radius: 6px;
    }
    .fallback-item span { flex: 1; font-size: 12px; color: var(--text, #e0e6f0); }

    /* Bindings table */
    .bindings-table-wrap { overflow-x: auto; margin-bottom: 16px; }
    .bindings-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .bindings-table th {
      text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted, #4a5568);
      background: var(--surface-2, #1a2235); border-bottom: 2px solid var(--border, #2a3550);
    }
    .bindings-table td {
      padding: 8px 10px; border-bottom: 1px solid rgba(42,53,80,0.5);
      color: var(--text, #e0e6f0); vertical-align: middle;
    }
    .bindings-table tr:hover td { background: rgba(26,34,53,0.5); }
    .priority-num {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 50%;
      background: var(--surface-3, #222d42); border: 1px solid var(--border, #2a3550);
      font-size: 11px; color: var(--text-dim, #7a8ba8);
    }
    .ch-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 12px; font-size: 11px;
      background: var(--accent-dim, rgba(0,212,255,0.1));
      border: 1px solid rgba(0,212,255,0.2); color: var(--accent, #00d4ff);
    }
    .agent-cell { display: flex; align-items: center; gap: 6px; }
    .actions-cell { display: flex; align-items: center; gap: 4px; }

    /* Add binding form */
    .add-binding-form {
      background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550);
      border-radius: 8px; padding: 14px;
    }
    .add-binding-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px; }

    /* Channel grid */
    .channel-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .channel-card {
      background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550);
      border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px;
    }
    .channel-card-header { display: flex; align-items: center; gap: 8px; }
    .channel-icon { font-size: 22px; }
    .channel-name { font-size: 14px; font-weight: 700; color: var(--text, #e0e6f0); }
    .channel-card-footer { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }

    /* Toggle switch */
    .toggle-wrap { display: flex; align-items: center; gap: 8px; }
    .toggle-wrap span { font-size: 12px; color: var(--text-dim, #7a8ba8); }
    .toggle {
      position: relative; display: inline-block; width: 40px; height: 22px;
    }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      border-radius: 22px; transition: 0.2s;
    }
    .slider:before {
      position: absolute; content: "";
      height: 14px; width: 14px; left: 3px; bottom: 3px;
      background: var(--text-muted, #4a5568); border-radius: 50%; transition: 0.2s;
    }
    input:checked + .slider { background: rgba(0,212,255,0.25); border-color: var(--accent, #00d4ff); }
    input:checked + .slider:before { transform: translateX(18px); background: var(--accent, #00d4ff); }

    /* Modal overlay */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(10,14,23,0.85);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000; padding: 20px;
    }
    .modal {
      background: var(--surface, #131926); border: 1px solid var(--border, #2a3550);
      border-radius: 14px; padding: 24px; max-width: 600px; width: 100%;
      max-height: 80vh; overflow-y: auto; position: relative;
    }
    .modal-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px;
    }
    .modal-header h3 { margin: 0; font-size: 16px; }
    .modal-close {
      background: none; border: none; font-size: 20px; cursor: pointer;
      color: var(--text-dim, #7a8ba8); line-height: 1; padding: 4px;
    }
    .modal-close:hover { color: var(--text, #e0e6f0); }

    /* Channel detail */
    .channel-detail-rows { display: flex; flex-direction: column; gap: 8px; }
    .channel-detail-row {
      display: flex; gap: 12px; padding: 8px 12px;
      background: var(--surface-2, #1a2235); border-radius: 6px;
    }
    .channel-detail-key { font-size: 11px; color: var(--text-muted, #4a5568); min-width: 130px; flex-shrink: 0; }
    .channel-detail-val { font-size: 12px; color: var(--text, #e0e6f0); word-break: break-all; }

    /* Appearance */
    .theme-options { display: flex; gap: 10px; margin-bottom: 20px; }
    .theme-option {
      display: flex; align-items: center; gap: 8px; padding: 10px 18px;
      border-radius: 8px; border: 2px solid var(--border, #2a3550);
      cursor: pointer; transition: all 0.15s; background: var(--surface-2, #1a2235);
      font-size: 13px; color: var(--text-dim, #7a8ba8);
    }
    .theme-option:hover { border-color: rgba(0,212,255,0.4); }
    .theme-option.selected { border-color: var(--accent, #00d4ff); color: var(--accent, #00d4ff); background: var(--accent-dim, rgba(0,212,255,0.1)); }

    /* Refresh intervals table */
    .refresh-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
    .refresh-table td { padding: 8px 10px; border-bottom: 1px solid rgba(42,53,80,0.5); }
    .refresh-table td:first-child { color: var(--text-dim, #7a8ba8); }
    .refresh-table select { width: auto; padding: 4px 8px; }

    /* Cache buttons */
    .cache-actions { display: flex; gap: 10px; flex-wrap: wrap; }

    /* System info */
    .sysinfo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
    .sysinfo-item {
      background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550);
      border-radius: 8px; padding: 12px 14px;
    }
    .sysinfo-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted, #4a5568); margin-bottom: 4px; }
    .sysinfo-value { font-size: 13px; color: var(--text, #e0e6f0); }

    /* Buttons */
    .btn {
      padding: 8px 18px; border-radius: 7px; border: none;
      font-family: inherit; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all 0.15s;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-ghost { background: transparent; border: 1px solid var(--border, #2a3550); color: var(--text-dim, #7a8ba8); }
    .btn-ghost:hover:not(:disabled) { border-color: rgba(0,212,255,0.5); color: var(--text, #e0e6f0); }
    .btn-accent { background: var(--accent, #00d4ff); color: #0a0e17; }
    .btn-accent:hover:not(:disabled) { background: #26dbff; }
    .btn-green { background: var(--green, #22c55e); color: #0a0e17; }
    .btn-green:hover:not(:disabled) { background: #34d96e; }
    .btn-danger { background: transparent; border: 1px solid var(--red, #ef4444); color: var(--red, #ef4444); padding: 4px 8px; font-size: 11px; }
    .btn-danger-confirm { background: var(--red, #ef4444); color: #fff; padding: 4px 8px; font-size: 11px; }
    .btn-sm { padding: 4px 10px; font-size: 11px; }
    .btn-icon { padding: 3px 7px; background: transparent; border: 1px solid var(--border, #2a3550); color: var(--text-dim, #7a8ba8); font-size: 11px; }
    .btn-icon:hover:not(:disabled) { border-color: rgba(0,212,255,0.5); color: var(--accent, #00d4ff); }

    .save-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
    .save-ok { font-size: 12px; color: var(--green, #22c55e); }

    .divider { border: none; border-top: 1px solid var(--border, #2a3550); margin: 18px 0; }
    a { color: var(--accent, #00d4ff); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .loading-text { color: var(--text-muted, #4a5568); font-size: 13px; }
    code { background: var(--surface-3, #222d42); padding: 1px 5px; border-radius: 3px; font-size: 11px; }

    .allowlist-wrap { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .allowlist-badge {
      padding: 2px 8px; border-radius: 12px; font-size: 11px;
      background: rgba(168,85,247,0.1); border: 1px solid rgba(168,85,247,0.3); color: var(--purple, #a855f7);
    }
  `;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  render() {
    return html`
      <div class="page-header">
        <h2>Settings</h2>
        <p>Gateway connection, agent configuration, routing, channels, plugins, and preferences</p>
      </div>

      <div class="accordion">
        ${this._renderGatewaySection()}
        ${this._renderAgentConfigSection()}
        ${this._renderRoutingSection()}
        ${this._renderChannelsSection()}
        ${this._renderExtensionsSection()}
        ${this._renderAppearanceSection()}
        ${this._renderSysInfoSection()}
      </div>

      ${this.channelDetailOpen ? this._renderChannelDetailModal() : ''}
    `;
  }

  // ---------------------------------------------------------------------------
  // Section 1: Gateway
  // ---------------------------------------------------------------------------

  _renderGatewaySection() {
    const isOpen = this.openSections.gateway;
    const h = this.health;
    const connected = h && !h.error;
    return html`
      <div class="accordion-item">
        <div class="accordion-header" @click="${() => this._toggleSection('gateway')}">
          <div class="accordion-title">
            <span class="icon">🔌</span>
            Gateway Connection
          </div>
          <span class="accordion-meta">
            ${connected ? html`<span class="status-badge connected"><span class="status-dot green"></span>Connected</span>` :
              html`<span class="status-badge disconnected"><span class="status-dot red"></span>Disconnected</span>`}
          </span>
          <span class="chevron ${isOpen ? 'open' : ''}">▶</span>
        </div>
        ${isOpen ? html`
          <div class="accordion-body">
            ${this.healthLoading ? html`<span class="loading-text">Loading gateway status...</span>` : html`
              <div class="status-card">
                <div class="status-row">
                  <span class="status-label">Connection</span>
                  <span class="status-value">
                    ${connected
                      ? html`<span class="status-badge connected"><span class="status-dot green"></span>Connected</span>`
                      : html`<span class="status-badge disconnected"><span class="status-dot red"></span>Disconnected</span>`}
                  </span>
                </div>
                <div class="status-row">
                  <span class="status-label">Gateway URL</span>
                  <span class="status-value"><code>${window.location.origin}</code></span>
                </div>
                <div class="status-row">
                  <span class="status-label">Uptime</span>
                  <span class="status-value">${h?.uptime != null ? formatUptime(h.uptime) : '—'}</span>
                </div>
                <div class="status-row">
                  <span class="status-label">Version</span>
                  <span class="status-value">${h?.version ?? '3.0.0'}</span>
                </div>
                <div class="status-row">
                  <span class="status-label">WebSocket</span>
                  <span class="status-value">
                    ${this.wsConnected
                      ? html`<span class="status-badge connected"><span class="status-dot green"></span>Connected${this.wsLatency != null ? html` <span style="font-size:10px;margin-left:4px">${this.wsLatency}ms</span>` : ''}</span>`
                      : html`<span class="status-badge unknown"><span class="status-dot gray"></span>Unknown</span>`}
                  </span>
                </div>
                <div class="status-row">
                  <span class="status-label">Node.js</span>
                  <span class="status-value">${h?.nodeVersion ?? '—'}</span>
                </div>
                ${this.gatewayInfo ? html`
                  <div class="status-row">
                    <span class="status-label">Port</span>
                    <span class="status-value"><code>${this.gatewayInfo.port}</code></span>
                  </div>
                  <div class="status-row">
                    <span class="status-label">Mode</span>
                    <span class="status-value">${this.gatewayInfo.mode}</span>
                  </div>
                  <div class="status-row">
                    <span class="status-label">Bind</span>
                    <span class="status-value">${this.gatewayInfo.bind}</span>
                  </div>
                ` : ''}
              </div>
            `}
            <div style="margin-top:12px">
              <button class="btn btn-ghost btn-sm" @click="${this._fetchHealth}">
                ↻ Refresh
              </button>
            </div>
            ${this._needsRestart ? html`
              <div style="margin-top:12px;padding:10px;background:var(--yellow-dim, rgba(234,179,8,0.1));border:1px solid var(--yellow, #eab308);border-radius:8px;display:flex;align-items:center;gap:12px">
                <span style="font-size:0.8rem;color:var(--yellow, #eab308)">Pending changes require gateway restart</span>
                <button class="btn btn-sm" style="background:var(--yellow, #eab308);color:#0a0e17;font-weight:700" @click=${() => this._restartGateway()}>
                  Restart Gateway
                </button>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Section 2: Agent Config
  // ---------------------------------------------------------------------------

  _renderAgentConfigSection() {
    const isOpen = this.openSections.agentConfig;
    const modelOptions = this.modelList.map(m => ({ id: m.id ?? m, name: shortModelName(m.id ?? m) }));
    const availableFallbacks = modelOptions.filter(m => m.id !== this.defaultModel && !this.defaultFallbacks.includes(m.id));

    return html`
      <div class="accordion-item">
        <div class="accordion-header" @click="${() => this._toggleSection('agentConfig')}">
          <div class="accordion-title">
            <span class="icon">🤖</span>
            Agent Configuration
          </div>
          ${!isOpen && this.defaultModel ? html`
            <span class="accordion-meta">${shortModelName(this.defaultModel)}</span>
          ` : ''}
          <span class="chevron ${isOpen ? 'open' : ''}">▶</span>
        </div>
        ${isOpen ? html`
          <div class="accordion-body">
            <!-- Default Agent -->
            <div class="form-group">
              <label>Default Agent</label>
              ${this.agentList.length === 0
                ? html`<span class="loading-text">Loading agents...</span>`
                : html`
                  <select .value="${this.defaultAgent}" @change="${(e) => { this.defaultAgent = e.target.value; }}">
                    ${this.agentList.map(a => html`
                      <option value="${a.id}" ?selected="${this.defaultAgent === a.id}">
                        ${a.emoji ? a.emoji + ' ' : ''}${a.name || a.id}${a.isDefault ? ' (current)' : ''}
                      </option>
                    `)}
                  </select>
                  <span class="field-hint">The agent that handles messages by default when no routing binding matches.</span>
                `}
              <div class="save-row" style="margin-top:4px">
                <button class="btn btn-accent btn-sm" @click="${this._saveDefaultAgent}" ?disabled="${this.agentSaving}">
                  ${this.agentSaving ? 'Saving...' : 'Save Agent'}
                </button>
                ${this.agentSaveOk ? html`<span class="save-ok">✓ Saved</span>` : ''}
              </div>
            </div>

            <hr class="divider" />

            <!-- Default Model -->
            <div class="form-group">
              <label>Default Model</label>
              ${this.modelsLoading
                ? html`<span class="loading-text">Loading models...</span>`
                : html`
                  <select .value="${this.defaultModel}" @change="${(e) => { this.defaultModel = e.target.value; }}">
                    ${modelOptions.map(m => html`<option value="${m.id}" ?selected="${this.defaultModel === m.id}">${m.name}</option>`)}
                    ${modelOptions.length === 0 ? html`<option value="">No models available</option>` : ''}
                  </select>
                `}
            </div>

            <div class="form-group">
              <label>Default Fallback Chain</label>
              <div class="fallback-list">
                ${this.defaultFallbacks.map((m, idx) => html`
                  <div class="fallback-item">
                    <span>${idx + 1}. ${m.includes('/') ? m.split('/').pop() : m}</span>
                    <button class="btn btn-icon" @click="${() => this._moveDefaultFallbackUp(idx)}" ?disabled="${idx === 0}">▲</button>
                    <button class="btn btn-icon" @click="${() => this._moveDefaultFallbackDown(idx)}" ?disabled="${idx === this.defaultFallbacks.length - 1}">▼</button>
                    <button class="btn btn-danger" @click="${() => this._removeDefaultFallback(m)}">✕</button>
                  </div>
                `)}
              </div>
              ${availableFallbacks.length > 0 ? html`
                <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
                  <select id="dfb-add" style="flex:1">
                    <option value="">— Add Fallback —</option>
                    ${availableFallbacks.map(m => html`<option value="${m.id}">${m.name}</option>`)}
                  </select>
                  <button class="btn btn-ghost btn-sm" @click="${() => {
                    const sel = this.shadowRoot.querySelector('#dfb-add');
                    if (sel?.value) { this._addDefaultFallback(sel.value); sel.value = ''; }
                  }}">Add</button>
                </div>
              ` : ''}
            </div>

            <div class="save-row">
              <button class="btn btn-accent" @click="${this._saveDefaultModel}" ?disabled="${this.modelSaving}">
                ${this.modelSaving ? 'Saving...' : 'Save Model & Fallbacks'}
              </button>
              ${this.modelSaveOk ? html`<span class="save-ok">✓ Saved</span>` : ''}
            </div>

            ${this.agentList.length > 0 ? html`
              <div style="margin-top:20px">
                <h4>Per-Agent Model Overrides</h4>
                <div style="display:grid;gap:6px">
                  ${this.agentList.map(a => html`
                    <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface-2, #1a2235);border-radius:6px;font-size:0.8rem">
                      <span>${a.emoji || ''} ${a.name || a.id}</span>
                      <span style="margin-left:auto;color:var(--text-muted, #4a5568)">${a.model ? shortModelName(a.model) : 'default'}</span>
                    </div>
                  `)}
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Section 3: Routing Bindings
  // ---------------------------------------------------------------------------

  _renderRoutingSection() {
    const isOpen = this.openSections.routing;
    return html`
      <div class="accordion-item">
        <div class="accordion-header" @click="${() => this._toggleSection('routing')}">
          <div class="accordion-title">
            <span class="icon">🗺️</span>
            Routing Bindings
          </div>
          ${!isOpen && this.bindings.length ? html`
            <span class="accordion-meta">${this.bindings.length} binding${this.bindings.length !== 1 ? 's' : ''}</span>
          ` : ''}
          <span class="chevron ${isOpen ? 'open' : ''}">▶</span>
        </div>
        ${isOpen ? html`
          <div class="accordion-body">
            ${this.bindingsLoading ? html`<span class="loading-text">Loading bindings...</span>` : html`
              <div class="bindings-table-wrap">
                <table class="bindings-table">
                  <thead>
                    <tr>
                      <th style="width:50px">#</th>
                      <th>Channel</th>
                      <th>Peer</th>
                      <th>Type</th>
                      <th>Agent</th>
                      <th style="width:130px">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.bindings.length === 0 ? html`
                      <tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No bindings configured</td></tr>
                    ` : this.bindings.map((b, idx) => {
                      // Bindings may use match.channel/match.peer or flat channel/peer
                      const channel = b.match?.channel || b.channel || '—';
                      const peer = b.match?.peer?.id || b.match?.peer || b.peer || 'any';
                      const kind = b.match?.peer?.kind || b.type || 'any';
                      return html`
                      <tr>
                        <td><span class="priority-num">${idx + 1}</span></td>
                        <td>
                          <span class="ch-badge">
                            ${channelIcon(channel)} ${channel}
                          </span>
                        </td>
                        <td style="color:var(--text-dim)">${typeof peer === 'object' ? JSON.stringify(peer) : peer}</td>
                        <td style="color:var(--text-dim)">${kind}</td>
                        <td>
                          <div class="agent-cell">
                            <span>${this._agentName(b.agentId ?? b.agent)}</span>
                          </div>
                        </td>
                        <td>
                          <div class="actions-cell">
                            <button class="btn btn-icon" @click="${() => this._moveBindingUp(idx)}" ?disabled="${idx === 0}" title="Move up">▲</button>
                            <button class="btn btn-icon" @click="${() => this._moveBindingDown(idx)}" ?disabled="${idx === this.bindings.length - 1}" title="Move down">▼</button>
                            <button
                              class="${this.deleteConfirmIdx === idx ? 'btn btn-danger-confirm btn-sm' : 'btn btn-danger btn-sm'}"
                              @click="${() => this._deleteBinding(idx)}"
                              title="${this.deleteConfirmIdx === idx ? 'Click again to confirm' : 'Delete'}"
                            >
                              ${this.deleteConfirmIdx === idx ? 'Confirm' : '✕'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    `; })}
                  </tbody>
                </table>
              </div>

              <!-- Add Binding -->
              <div class="add-binding-form">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:10px">Add Binding</div>
                <div class="add-binding-grid">
                  <div class="form-group" style="margin-bottom:0">
                    <label>Channel</label>
                    <select .value="${this.newBinding.channel}" @change="${(e) => this._updateNewBinding('channel', e.target.value)}">
                      <option value="telegram">telegram</option>
                      <option value="whatsapp">whatsapp</option>
                      <option value="voice-call">voice-call</option>
                      <option value="discord">discord</option>
                      <option value="signal">signal</option>
                      <option value="slack">slack</option>
                    </select>
                  </div>
                  <div class="form-group" style="margin-bottom:0">
                    <label>Peer</label>
                    <input type="text" .value="${this.newBinding.peer}" placeholder="any / chatId / phone" @input="${(e) => this._updateNewBinding('peer', e.target.value)}" />
                  </div>
                  <div class="form-group" style="margin-bottom:0">
                    <label>Type</label>
                    <select .value="${this.newBinding.type}" @change="${(e) => this._updateNewBinding('type', e.target.value)}">
                      <option value="direct">direct</option>
                      <option value="group">group</option>
                      <option value="any">any</option>
                    </select>
                  </div>
                  <div class="form-group" style="margin-bottom:0">
                    <label>Agent</label>
                    <select .value="${this.newBinding.agentId}" @change="${(e) => this._updateNewBinding('agentId', e.target.value)}">
                      <option value="">— Select Agent —</option>
                      ${this.bindingAgentList.map(a => {
                        const id = a.id ?? a;
                        const name = a.name ?? id;
                        const em = a.emoji ?? '';
                        return html`<option value="${id}">${em ? em + ' ' : ''}${name}</option>`;
                      })}
                    </select>
                  </div>
                </div>
                <button class="btn btn-accent btn-sm" @click="${this._addBinding}">+ Add Binding</button>
              </div>

              <div class="save-row" style="margin-top:12px">
                <button class="btn btn-green" @click="${this._saveBindings}" ?disabled="${this.bindingsSaving}">
                  ${this.bindingsSaving ? 'Saving...' : 'Save Order'}
                </button>
              </div>
            `}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Section 4: Channel Status
  // ---------------------------------------------------------------------------

  _renderChannelsSection() {
    const isOpen = this.openSections.channels;
    return html`
      <div class="accordion-item">
        <div class="accordion-header" @click="${() => this._toggleSection('channels')}">
          <div class="accordion-title">
            <span class="icon">📡</span>
            Channel Status
          </div>
          ${!isOpen && this.channels.length ? html`
            <span class="accordion-meta">${this.channels.length} channel${this.channels.length !== 1 ? 's' : ''}</span>
          ` : ''}
          <span class="chevron ${isOpen ? 'open' : ''}">▶</span>
        </div>
        ${isOpen ? html`
          <div class="accordion-body">
            ${this.channelsLoading ? html`<span class="loading-text">Loading channels...</span>` : html`
              ${this.channels.length === 0 ? html`
                <span style="color:var(--text-muted);font-size:13px">No channels configured.</span>
              ` : html`
                ${(() => {
                  const voiceChannel = this.channels.find(c => c.id === 'voice-call' || c.type === 'voice');
                  return voiceChannel ? html`
                    <div style="margin-bottom:16px;padding:16px;background:var(--surface-2, #1a2235);border:1px solid var(--border, #2a3550);border-radius:10px">
                      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                        <span style="font-size:1.2rem">📞</span>
                        <span style="font-weight:700;font-size:0.9rem">${voiceChannel.name || 'Phone Line'}</span>
                        <span class="status-badge ${voiceChannel.enabled ? 'connected' : 'disconnected'}" style="margin-left:auto">
                          <span class="status-dot ${voiceChannel.enabled ? 'green' : 'red'}"></span>
                          ${voiceChannel.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      ${voiceChannel.fromNumber ? html`<div style="font-size:0.8rem;color:var(--text-dim, #7a8ba8);margin-bottom:4px">Number: <span style="color:var(--text, #e0e6f0)">${voiceChannel.fromNumber}</span></div>` : ''}
                      ${voiceChannel.provider ? html`<div style="font-size:0.8rem;color:var(--text-dim, #7a8ba8);margin-bottom:4px">Provider: <span style="color:var(--text, #e0e6f0)">${voiceChannel.provider}</span></div>` : ''}
                      <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
                        <div class="toggle-wrap">
                          <label class="toggle">
                            <input
                              type="checkbox"
                              ?checked="${voiceChannel.enabled}"
                              @change="${(e) => this._toggleChannel(voiceChannel.id, e.target.checked)}"
                            />
                            <span class="slider"></span>
                          </label>
                          <span>${voiceChannel.enabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        <button class="btn btn-ghost btn-sm" @click="${() => this._openChannelDetail(voiceChannel.id)}">Details</button>
                      </div>
                    </div>
                  ` : '';
                })()}
                <div class="channel-grid">
                  ${this.channels.map(ch => {
                    const id = ch.id ?? ch.name;
                    const name = ch.name ?? id;
                    const status = ch.status ?? (ch.connected ? 'connected' : ch.enabled === false ? 'disabled' : 'unknown');
                    const enabled = ch.enabled !== false;
                    return html`
                      <div class="channel-card">
                        <div class="channel-card-header">
                          <span class="channel-icon">${channelIcon(name)}</span>
                          <div style="flex:1">
                            <div class="channel-name">${name}</div>
                            ${ch.fromNumber ? html`<div style="font-size:11px;color:var(--accent)">${ch.fromNumber}</div>` : ''}
                            ${ch.dmPolicy ? html`<div style="font-size:11px;color:var(--text-muted)">${ch.dmPolicy}</div>` : ''}
                            ${ch.provider ? html`<div style="font-size:11px;color:var(--text-muted)">Provider: ${ch.provider}</div>` : ''}
                          </div>
                          <span class="status-badge ${status === 'connected' ? 'connected' : status === 'disconnected' ? 'disconnected' : 'unknown'}">
                            <span class="status-dot ${status === 'connected' ? 'green' : status === 'disconnected' ? 'red' : 'gray'}"></span>
                            ${status}
                          </span>
                        </div>

                        <div class="channel-card-footer">
                          <div class="toggle-wrap">
                            <label class="toggle">
                              <input
                                type="checkbox"
                                ?checked="${enabled}"
                                @change="${(e) => this._toggleChannel(id, e.target.checked)}"
                              />
                              <span class="slider"></span>
                            </label>
                            <span>${enabled ? 'Enabled' : 'Disabled'}</span>
                          </div>
                          <button class="btn btn-ghost btn-sm" @click="${() => this._openChannelDetail(id)}">Details</button>
                        </div>
                      </div>
                    `;
                  })}
                </div>
              `}
              <div style="margin-top:12px">
                <button class="btn btn-ghost btn-sm" @click="${this._fetchChannels}">↻ Refresh</button>
              </div>
            `}
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderChannelDetailModal() {
    const ch = this.channelDetail;
    const displayName = ch?.name || this.channelDetailId;
    return html`
      <div class="modal-overlay" @click="${(e) => { if (e.target === e.currentTarget) {this._closeChannelDetail();} }}">
        <div class="modal">
          <div class="modal-header">
            <h3>${channelIcon(this.channelDetailId)} ${displayName} — Channel Details</h3>
            <button class="modal-close" @click="${this._closeChannelDetail}">x</button>
          </div>

          ${this.channelDetailLoading ? html`<span class="loading-text">Loading...</span>` :
            !ch ? html`<span class="loading-text">No data</span>` :
            ch.error ? html`<span style="color:var(--red)">Failed to load channel details.</span>` :
            html`
              <div class="channel-detail-rows">
                ${Object.entries(ch).filter(([k]) => k !== 'config').map(([k, v]) => {
                  // Skip internal fields
                  if (k === 'error') {return '';}
                  // Render arrays (allowFrom, allowlist)
                  if ((k === 'allowlist' || k === 'allowFrom') && Array.isArray(v)) {
                    return html`
                      <div class="channel-detail-row" style="flex-direction:column">
                        <span class="channel-detail-key" style="margin-bottom:6px">${k}</span>
                        <div class="allowlist-wrap">
                          ${v.length ? v.map(e => html`<span class="allowlist-badge">${e}</span>`) : html`<span style="color:var(--text-muted);font-size:12px">empty (open)</span>`}
                        </div>
                      </div>
                    `;
                  }
                  // Skip deeply nested objects
                  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                    return html`
                      <div class="channel-detail-row">
                        <span class="channel-detail-key">${k}</span>
                        <span class="channel-detail-val" style="color:var(--text-muted)">[object]</span>
                      </div>
                    `;
                  }
                  const displayVal = isSensitiveKey(k) ? redact(String(v)) : (Array.isArray(v) ? v.join(', ') : String(v ?? '—'));
                  return html`
                    <div class="channel-detail-row">
                      <span class="channel-detail-key">${k}</span>
                      <span class="channel-detail-val ${isSensitiveKey(k) ? 'redacted' : ''}">${displayVal}</span>
                    </div>
                  `;
                })}
                ${ch.config ? html`
                  <hr class="divider" />
                  <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:8px">Configuration</div>
                  ${Object.entries(ch.config).map(([k, v]) => {
                    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                      return html`
                        <div class="channel-detail-row">
                          <span class="channel-detail-key">${k}</span>
                          <span class="channel-detail-val" style="color:var(--text-muted)">[object]</span>
                        </div>
                      `;
                    }
                    const displayVal = isSensitiveKey(k) ? redact(String(v)) : (Array.isArray(v) ? v.join(', ') : String(v ?? '—'));
                    return html`
                      <div class="channel-detail-row">
                        <span class="channel-detail-key">${k}</span>
                        <span class="channel-detail-val ${isSensitiveKey(k) ? 'redacted' : ''}">${displayVal}</span>
                      </div>
                    `;
                  })}
                ` : ''}
              </div>
            `}
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Section 5: Plugins, Hooks & Skills
  // ---------------------------------------------------------------------------

  _renderExtensionsSection() {
    const isOpen = this.openSections.extensions;
    const plugins = this.pluginsInfo || {};
    const hooks = this.hooksInfo || {};
    const skills = this.skillsInfo || {};
    const pluginEntries = Object.entries(plugins).filter(([k]) => k !== 'loaded');
    const skillEntries = skills.entries || [];
    const hookEntries = hooks.entries || [];

    return html`
      <div class="accordion-item">
        <div class="accordion-header" @click="${() => this._toggleSection('extensions')}">
          <div class="accordion-title">
            <span class="icon">🧩</span>
            Plugins, Hooks &amp; Skills
          </div>
          ${!isOpen && pluginEntries.length ? html`
            <span class="accordion-meta">${pluginEntries.length} plugin${pluginEntries.length !== 1 ? 's' : ''}, ${skillEntries.length} skill${skillEntries.length !== 1 ? 's' : ''}</span>
          ` : ''}
          <span class="chevron ${isOpen ? 'open' : ''}">▶</span>
        </div>
        ${isOpen ? html`
          <div class="accordion-body">
            <!-- Plugins -->
            <h4>Plugins</h4>
            ${pluginEntries.length === 0 ? html`
              <span style="color:var(--text-muted);font-size:13px">No plugins loaded. Open this section to fetch data.</span>
            ` : html`
              <div class="channel-grid" style="margin-bottom:20px">
                ${pluginEntries.map(([id, info]) => html`
                  <div class="channel-card">
                    <div class="channel-card-header">
                      <span class="channel-icon">${id === 'voice-call' ? '📞' : id === 'telegram' ? '✈️' : id === 'whatsapp' ? '💬' : '🔌'}</span>
                      <div style="flex:1">
                        <div class="channel-name">${id}</div>
                      </div>
                      <span class="status-badge ${info.enabled ? 'connected' : 'disconnected'}">
                        <span class="status-dot ${info.enabled ? 'green' : 'red'}"></span>
                        ${info.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                `)}
              </div>
            `}

            <hr class="divider" />

            <!-- Hooks -->
            <h4>Hooks</h4>
            <div class="status-card" style="margin-bottom:20px">
              <div class="status-row">
                <span class="status-label">Hooks</span>
                <span class="status-value">
                  ${hooks.enabled
                    ? html`<span class="status-badge connected"><span class="status-dot green"></span>Enabled</span>`
                    : html`<span class="status-badge disconnected"><span class="status-dot red"></span>Disabled</span>`}
                </span>
              </div>
              <div class="status-row">
                <span class="status-label">Internal Hooks</span>
                <span class="status-value">
                  ${hooks.internal
                    ? html`<span class="status-badge connected"><span class="status-dot green"></span>Enabled</span>`
                    : html`<span class="status-badge disconnected"><span class="status-dot red"></span>Disabled</span>`}
                </span>
              </div>
              ${hookEntries.length > 0 ? html`
                <div class="status-row" style="grid-column:1/-1">
                  <span class="status-label">Internal Hook Entries</span>
                  <span class="status-value">
                    <div class="allowlist-wrap">
                      ${hookEntries.map(e => html`<span class="allowlist-badge">${e}</span>`)}
                    </div>
                  </span>
                </div>
              ` : ''}
            </div>

            <hr class="divider" />

            <!-- Skills -->
            <h4>Skills</h4>
            ${skillEntries.length === 0
              ? html`<span style="color:var(--text-muted);font-size:13px">No skills configured.</span>`
              : html`
                <div class="status-card">
                  <div class="status-row" style="grid-column:1/-1">
                    <span class="status-label">Installed Skills (${skillEntries.length})</span>
                    <span class="status-value">
                      <div class="allowlist-wrap">
                        ${skillEntries.map(s => html`<span class="allowlist-badge">${s}</span>`)}
                      </div>
                    </span>
                  </div>
                  <div class="status-row">
                    <span class="status-label">Node Manager</span>
                    <span class="status-value">${skills.nodeManager || 'npm'}</span>
                  </div>
                </div>
              `}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Section 6: Appearance
  // ---------------------------------------------------------------------------

  _renderAppearanceSection() {
    const isOpen = this.openSections.appearance;
    return html`
      <div class="accordion-item">
        <div class="accordion-header" @click="${() => this._toggleSection('appearance')}">
          <div class="accordion-title">
            <span class="icon">🎨</span>
            Appearance &amp; Preferences
          </div>
          <span class="chevron ${isOpen ? 'open' : ''}">▶</span>
        </div>
        ${isOpen ? html`
          <div class="accordion-body">
            <div class="form-group">
              <label>Theme</label>
              <div class="theme-options">
                <div
                  class="theme-option ${this.theme === 'dark' ? 'selected' : ''}"
                  @click="${() => this._setTheme('dark')}"
                >
                  🌙 Dark
                </div>
                <div
                  class="theme-option ${this.theme === 'light' ? 'selected' : ''}"
                  @click="${() => this._setTheme('light')}"
                >
                  ☀️ Light
                </div>
              </div>
            </div>

            <hr class="divider" />

            <div class="form-group">
              <label>Auto-Refresh Intervals</label>
              <table class="refresh-table">
                ${REFRESH_KEYS.map(key => html`
                  <tr>
                    <td>${REFRESH_LABELS[key]}</td>
                    <td>
                      <select
                        .value="${this.refreshIntervals[key] ?? REFRESH_DEFAULTS[key]}"
                        @change="${(e) => this._setRefreshInterval(key, e.target.value)}"
                      >
                        ${REFRESH_OPTIONS.map(opt => html`
                          <option value="${opt.value}" ?selected="${(this.refreshIntervals[key] ?? REFRESH_DEFAULTS[key]) === opt.value}">
                            ${opt.label}
                          </option>
                        `)}
                      </select>
                    </td>
                  </tr>
                `)}
              </table>
            </div>

            <hr class="divider" />

            <div class="form-group">
              <label>Cache Management</label>
              <div class="cache-actions">
                <button class="btn btn-ghost" @click="${this._clearTreasuryCache}">
                  Clear Treasury Cache
                </button>
                <button class="btn btn-ghost" @click="${this._clearAllCaches}">
                  Clear All Caches
                </button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Section 7: System Info
  // ---------------------------------------------------------------------------

  _renderSysInfoSection() {
    const isOpen = this.openSections.sysInfo;
    const si = this.sysInfo ?? this.health;
    return html`
      <div class="accordion-item">
        <div class="accordion-header" @click="${() => this._toggleSection('sysInfo')}">
          <div class="accordion-title">
            <span class="icon">🖥️</span>
            System Info
          </div>
          <span class="chevron ${isOpen ? 'open' : ''}">▶</span>
        </div>
        ${isOpen ? html`
          <div class="accordion-body">
            <div class="sysinfo-grid">
              <div class="sysinfo-item">
                <div class="sysinfo-label">Dashboard Version</div>
                <div class="sysinfo-value">3.0.0</div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Node.js Version</div>
                <div class="sysinfo-value">${si?.nodeVersion ?? '—'}</div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Platform</div>
                <div class="sysinfo-value">${si?.platform ?? '—'}${si?.arch ? ` (${si.arch})` : ''}</div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Gateway Version</div>
                <div class="sysinfo-value">${si?.version || '—'}</div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">WebSocket</div>
                <div class="sysinfo-value">
                  ${this.wsConnected
                    ? html`<span class="status-badge connected"><span class="status-dot green"></span>Connected</span>`
                    : html`<span class="status-badge disconnected"><span class="status-dot red"></span>Disconnected</span>`}
                  ${si?.wsClients != null ? html`<span style="font-size:11px;color:var(--text-muted);margin-left:6px">${si.wsClients} client${si.wsClients !== 1 ? 's' : ''}</span>` : ''}
                </div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Docker</div>
                <div class="sysinfo-value">
                  ${si?.dockerConnected
                    ? html`<span class="status-badge connected"><span class="status-dot green"></span>Connected</span>`
                    : si?.dockerConnected === false
                    ? html`<span class="status-badge disconnected"><span class="status-dot red"></span>Disconnected</span>`
                    : html`<span class="status-badge unknown"><span class="status-dot gray"></span>Unknown</span>`}
                </div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Gateway Token</div>
                <div class="sysinfo-value">
                  ${si?.gatewayTokenPresent !== undefined
                    ? (si.gatewayTokenPresent
                        ? html`<span style="color:var(--green)">✓ Present</span>`
                        : html`<span style="color:var(--red)">✗ Missing</span>`)
                    : html`<span style="color:var(--text-muted)">—</span>`}
                </div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Gateway Uptime</div>
                <div class="sysinfo-value">${si?.uptime != null ? formatUptime(si.uptime) : '—'}</div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Dashboard Uptime</div>
                <div class="sysinfo-value">${si?.dashboardUptime != null ? formatUptime(si.dashboardUptime) : '—'}</div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Memory (RSS / Heap)</div>
                <div class="sysinfo-value">${si?.memory ? `${si.memory.rss} MB / ${si.memory.heap} MB` : '—'}</div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Active Sessions</div>
                <div class="sysinfo-value">${si?.sessions ?? '—'}</div>
              </div>

              <div class="sysinfo-item">
                <div class="sysinfo-label">Agents Loaded</div>
                <div class="sysinfo-value">${si?.agents ?? '—'}</div>
              </div>
            </div>

            <div style="margin-top:14px">
              <button class="btn btn-ghost btn-sm" @click="${this._fetchHealth}">↻ Refresh</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
}

customElements.define('page-settings', PageSettings);
