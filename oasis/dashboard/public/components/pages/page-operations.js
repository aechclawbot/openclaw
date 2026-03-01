/**
 * OASIS Dashboard v3 — Operations Page
 * Combined operations center: Cron Jobs, Docker, Activity Feed, System Logs.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';
import { store } from '/app/store.js';
import { eventBus } from '/app/events.js';

// ─── Helper Functions ──────────────────────────────────────────────────────

/** Convert an ISO timestamp to a relative time string (e.g. "3m ago"). */
function timeAgo(iso) {
  if (!iso) {return '—';}
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {return 'just now';}
  const s = Math.floor(diff / 1000);
  if (s < 60) {return `${s}s ago`;}
  const m = Math.floor(s / 60);
  if (m < 60) {return `${m}m ago`;}
  const h = Math.floor(m / 60);
  if (h < 24) {return `${h}h ago`;}
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Convert a future ISO timestamp to a human-readable "in X" string. */
function timeUntil(iso) {
  if (!iso) {return '—';}
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) {return 'now';}
  const s = Math.floor(diff / 1000);
  if (s < 60) {return `in ${s}s`;}
  const m = Math.floor(s / 60);
  if (m < 60) {return `in ${m}m`;}
  const h = Math.floor(m / 60);
  if (h < 24) {return `in ${h}h`;}
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}

/** Format a duration in milliseconds as "1m 23s", "45s", etc. */
function formatDuration(ms) {
  if (ms == null || isNaN(ms)) {return '—';}
  const totalSecs = Math.floor(Math.abs(ms) / 1000);
  if (totalSecs < 60) {return `${totalSecs}s`;}
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) {return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;}
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

/** Format seconds of uptime as "2d 3h", "45m", etc. */
function formatUptime(secs) {
  if (secs == null || isNaN(secs)) {return '—';}
  const s = Math.floor(secs);
  if (s < 60) {return `${s}s`;}
  const m = Math.floor(s / 60);
  if (m < 60) {return `${m}m`;}
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) {return rm > 0 ? `${h}h ${rm}m` : `${h}h`;}
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

/** Format bytes as "1.2 GB", "345 MB", etc. */
function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) {return '—';}
  if (bytes < 1024) {return `${bytes} B`;}
  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
  if (bytes < 1024 * 1024 * 1024) {return `${(bytes / 1024 / 1024).toFixed(1)} MB`;}
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Strip ANSI escape codes from a string. */
function stripAnsi(str) {
  if (!str) {return '';}
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Parse a cron expression into a human-readable description.
 * Handles the 5-field standard format only.
 */
function parseCronExpression(expr) {
  if (!expr || typeof expr !== 'string') {return expr || '';}
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {return expr;}
  const [min, hour, dom, month, dow] = parts;

  // Common shortcuts
  if (expr === '* * * * *') {return 'Every minute';}
  if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') {return 'Every hour';}
  if (min !== '*' && hour !== '*' && dom === '*' && month === '*' && dow === '*') {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const suffix = h >= 12 ? 'PM' : 'AM';
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const displayM = m.toString().padStart(2, '0');
      return `Every day at ${displayH}:${displayM} ${suffix}`;
    }
  }
  // Interval patterns
  const stepMinMatch = min.match(/^\*\/(\d+)$/);
  if (stepMinMatch && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return `Every ${stepMinMatch[1]} minute${parseInt(stepMinMatch[1]) > 1 ? 's' : ''}`;
  }
  const stepHourMatch = hour.match(/^\*\/(\d+)$/);
  if (min === '0' && stepHourMatch && dom === '*' && month === '*' && dow === '*') {
    return `Every ${stepHourMatch[1]} hour${parseInt(stepHourMatch[1]) > 1 ? 's' : ''}`;
  }
  // Day of week patterns
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (min !== '*' && hour !== '*' && dom === '*' && month === '*' && dow !== '*') {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const d = parseInt(dow, 10);
    if (!isNaN(h) && !isNaN(m) && !isNaN(d) && d >= 0 && d <= 6) {
      const suffix = h >= 12 ? 'PM' : 'AM';
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const displayM = m.toString().padStart(2, '0');
      return `Every ${dayNames[d]} at ${displayH}:${displayM} ${suffix}`;
    }
  }
  return expr;
}

/** Determine log line CSS class based on content. */
function logLineClass(text) {
  const upper = text.toUpperCase();
  if (upper.includes('ERROR') || upper.includes('ERR ') || upper.includes('FATAL')) {return 'log-error';}
  if (upper.includes('WARN') || upper.includes('WARNING')) {return 'log-warn';}
  if (upper.includes('DEBUG') || upper.includes('TRACE')) {return 'log-debug';}
  return 'log-info';
}

/** Activity type → CSS color class */
function activityColorClass(type) {
  switch (type) {
    case 'message': return 'type-message';
    case 'session': return 'type-session';
    case 'cron': return 'type-cron';
    case 'agent': return 'type-agent';
    case 'error': return 'type-error';
    default: return 'type-system';
  }
}

/** Container status → badge class */
function containerStatusClass(status) {
  if (!status) {return 'badge-gray';}
  const s = status.toLowerCase();
  if (s === 'running') {return 'badge-green';}
  if (s === 'restarting' || s === 'paused') {return 'badge-yellow';}
  return 'badge-red';
}

// ─── Component ─────────────────────────────────────────────────────────────

class PageOperations extends LitElement {
  static properties = {
    _activeTab: { state: true },

    // Cron
    _cronJobs: { state: true },
    _cronLoading: { state: true },
    _cronError: { state: true },
    _showCronModal: { state: true },
    _cronModalMode: { state: true }, // 'create' | 'edit'
    _cronEditTarget: { state: true },
    _cronForm: { state: true },
    _cronSaving: { state: true },
    _showHistoryModal: { state: true },
    _historyJob: { state: true },
    _historyRuns: { state: true },
    _historyLoading: { state: true },
    _historyPage: { state: true },
    _agents: { state: true },

    // Docker
    _containers: { state: true },
    _dockerLoading: { state: true },
    _dockerError: { state: true },
    _containerLogs: { state: true },     // Map: name → lines[]
    _logsVisible: { state: true },       // Set: container names with visible logs
    _logsTailSize: { state: true },
    _dockerConfirm: { state: true },     // null | 'restart-all' | 'rebuild'

    // Activity
    _activity: { state: true },
    _activityLoading: { state: true },
    _activityTypeFilter: { state: true },
    _activityAgentFilter: { state: true },
    _activitySearch: { state: true },
    _activitySearchDebounce: { state: true },

    // Logs
    _logSource: { state: true }, // 'gateway' | 'audio-listener'
    _logLines: { state: true },
    _logLoading: { state: true },
    _logAutoRefresh: { state: true },
    _logInterval: { state: true },
    _logTailSize: { state: true },
    _logSearch: { state: true },
    _logLiveIndicator: { state: true },
  };

  constructor() {
    super();
    this._activeTab = 'cron';

    // Cron
    this._cronJobs = [];
    this._cronLoading = false;
    this._cronError = null;
    this._showCronModal = false;
    this._cronModalMode = 'create';
    this._cronEditTarget = null;
    this._cronForm = this._defaultCronForm();
    this._cronSaving = false;
    this._showHistoryModal = false;
    this._historyJob = null;
    this._historyRuns = [];
    this._historyLoading = false;
    this._historyPage = 0;
    this._agents = [];

    // Docker
    this._containers = [];
    this._dockerLoading = false;
    this._dockerError = null;
    this._containerLogs = new Map();
    this._logsVisible = new Set();
    this._logsTailSize = 100;
    this._dockerConfirm = null;

    // Activity
    this._activity = [];
    this._activityLoading = false;
    this._activityTypeFilter = 'all';
    this._activityAgentFilter = 'all';
    this._activitySearch = '';
    this._activitySearchDebounce = null;

    // Logs
    this._logSource = 'gateway';
    this._logLines = [];
    this._logLoading = false;
    this._logAutoRefresh = false;
    this._logInterval = 10;
    this._logTailSize = 100;
    this._logSearch = '';
    this._logLiveIndicator = false;

    // Internal timers
    this._cronTimer = null;
    this._dockerTimer = null;
    this._logTimer = null;

    // EventBus unsubscribe handles
    this._unsubs = [];
  }

  _defaultCronForm() {
    return {
      name: '',
      agentId: '',
      schedule: '',
      message: '',
      deliveryMode: 'announce',
      deliveryChannel: 'telegram',
      deliveryTarget: '',
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    this._loadAgents();
    this._loadCronJobs();
    this._loadContainers();
    this._loadActivity();

    // Start auto-refresh cycles
    this._cronTimer = setInterval(() => this._loadCronJobs(), 30_000);
    this._dockerTimer = setInterval(() => this._loadContainers(), 10_000);

    // Subscribe to live events from the event bus
    if (eventBus) {
      this._unsubs.push(
        eventBus.on('cron_update', () => this._loadCronJobs()),
        eventBus.on('activity', (evt) => this._prependActivity(evt.data || evt)),
        eventBus.on('container_update', () => this._loadContainers()),
      );
    }

    // Also listen for store changes
    const storeSub = store.subscribe('cronJobs', (jobs) => {
      if (Array.isArray(jobs)) {this._cronJobs = jobs;}
    });
    this._unsubs.push(storeSub);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._cronTimer);
    clearInterval(this._dockerTimer);
    clearTimeout(this._activitySearchDebounce);
    this._stopLogRefresh();
    for (const unsub of this._unsubs) {
      if (typeof unsub === 'function') {unsub();}
    }
    this._unsubs = [];
  }

  // ─── Data Loading ────────────────────────────────────────────────────────

  async _loadAgents() {
    try {
      const data = await api.get('/api/agents');
      this._agents = data?.agents || [];
    } catch {
      // Non-fatal; agents are optional for the cron form
      this._agents = [];
    }
  }

  async _loadCronJobs() {
    if (this._cronLoading) {return;}
    this._cronLoading = true;
    try {
      const data = await api.get('/api/cron');
      this._cronJobs = Array.isArray(data) ? data : (data?.jobs || []);
      this._cronError = null;
    } catch (err) {
      this._cronError = err.message || 'Failed to load cron jobs';
    } finally {
      this._cronLoading = false;
    }
  }

  async _loadContainers() {
    if (this._dockerLoading) {return;}
    this._dockerLoading = true;
    try {
      const data = await api.get('/api/docker/containers');
      this._containers = Array.isArray(data) ? data : (data?.containers || []);
      this._dockerError = null;
      // Refresh logs for any visible log panels
      for (const name of this._logsVisible) {
        this._fetchContainerLogs(name);
      }
    } catch (err) {
      this._dockerError = err.message || 'Failed to load containers';
    } finally {
      this._dockerLoading = false;
    }
  }

  async _fetchContainerLogs(name) {
    try {
      const data = await api.get(`/api/docker/logs/${encodeURIComponent(name)}?tail=${this._logsTailSize}`);
      const lines = Array.isArray(data?.lines) ? data.lines : (data?.logs || []);
      const updated = new Map(this._containerLogs);
      updated.set(name, lines);
      this._containerLogs = updated;
    } catch {
      // Silently fail for log refresh; don't disrupt container grid
    }
  }

  async _loadActivity() {
    this._activityLoading = true;
    try {
      const data = await api.get('/api/activity?limit=500');
      this._activity = Array.isArray(data) ? data : (data?.events || data?.activity || []);
    } catch {
      this._activity = [];
    } finally {
      this._activityLoading = false;
    }
  }

  _prependActivity(event) {
    if (!event) {return;}
    const MAX = 500;
    this._activity = [event, ...this._activity].slice(0, MAX);
  }

  async _loadLogs() {
    this._logLoading = true;
    try {
      const endpoint = this._logSource === 'gateway'
        ? `/api/logs/gateway?tail=${this._logTailSize}`
        : `/api/logs/audio-listener?tail=${this._logTailSize}`;
      const data = await api.get(endpoint);
      const rawLines = Array.isArray(data) ? data : (data?.lines || data?.logs || []);
      this._logLines = rawLines.map((l) => {
        if (typeof l === 'string') {return { text: l, stream: 'stdout' };}
        return l;
      });
    } catch (err) {
      this._logLines = [{ text: `Error: ${err.message}`, stream: 'stderr' }];
    } finally {
      this._logLoading = false;
    }
  }

  _startLogRefresh() {
    this._stopLogRefresh();
    this._loadLogs();
    this._logLiveIndicator = true;
    this._logTimer = setInterval(() => {
      this._loadLogs();
    }, this._logInterval * 1000);
  }

  _stopLogRefresh() {
    if (this._logTimer) {
      clearInterval(this._logTimer);
      this._logTimer = null;
    }
    this._logLiveIndicator = false;
  }

  // ─── Cron Actions ────────────────────────────────────────────────────────

  _openCreateCronModal() {
    this._cronForm = this._defaultCronForm();
    this._cronModalMode = 'create';
    this._cronEditTarget = null;
    this._showCronModal = true;
  }

  _openEditCronModal(job) {
    this._cronForm = {
      name: job.name || '',
      agentId: job.agentId || job.agent || '',
      schedule: job.schedule || '',
      message: job.message || '',
      deliveryMode: job.delivery?.mode || 'announce',
      deliveryChannel: job.delivery?.channel || 'telegram',
      deliveryTarget: job.delivery?.to || job.delivery?.target || '',
    };
    this._cronModalMode = 'edit';
    this._cronEditTarget = job;
    this._showCronModal = true;
  }

  _closeCronModal() {
    this._showCronModal = false;
    this._cronEditTarget = null;
  }

  async _saveCronJob() {
    const { name, agentId, schedule, message, deliveryMode, deliveryChannel, deliveryTarget } = this._cronForm;
    if (!name.trim() || !agentId || !schedule.trim()) {
      alert('Name, agent, and schedule are required.');
      return;
    }
    this._cronSaving = true;
    const payload = {
      name: name.trim(),
      agentId,
      schedule: schedule.trim(),
      message,
      delivery: {
        mode: deliveryMode,
        channel: deliveryChannel,
        to: deliveryTarget,
      },
    };
    try {
      if (this._cronModalMode === 'edit' && this._cronEditTarget?.id) {
        await api.put(`/api/cron/${this._cronEditTarget.id}`, payload);
      } else {
        await api.post('/api/cron', payload);
      }
      this._closeCronModal();
      await this._loadCronJobs();
    } catch (err) {
      alert(`Failed to save cron job: ${err.message}`);
    } finally {
      this._cronSaving = false;
    }
  }

  async _toggleCron(job) {
    try {
      await api.post(`/api/cron/${job.id}/toggle`);
      await this._loadCronJobs();
    } catch (err) {
      alert(`Toggle failed: ${err.message}`);
    }
  }

  async _runCronNow(job) {
    try {
      await api.post(`/api/cron/${job.id}/run`);
    } catch (err) {
      alert(`Run failed: ${err.message}`);
    }
  }

  async _deleteCron(job) {
    if (!confirm(`Delete cron job "${job.name}"?`)) {return;}
    try {
      await api.delete(`/api/cron/${job.id}`);
      await this._loadCronJobs();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  async _openHistoryModal(job) {
    this._historyJob = job;
    this._historyRuns = [];
    this._historyLoading = true;
    this._showHistoryModal = true;
    this._historyPage = 0;
    try {
      const data = await api.get(`/api/cron/${job.id}/runs`);
      this._historyRuns = Array.isArray(data) ? data : (data?.runs || []);
    } catch (err) {
      this._historyRuns = [];
    } finally {
      this._historyLoading = false;
    }
  }

  _closeHistoryModal() {
    this._showHistoryModal = false;
    this._historyJob = null;
    this._historyRuns = [];
  }

  async _bulkToggleCron(enable) {
    try {
      const jobs = this._cronJobs.filter((j) => j.enabled !== enable);
      await Promise.all(jobs.map((j) => api.post(`/api/cron/${j.id}/toggle`)));
      await this._loadCronJobs();
    } catch (err) {
      alert(`Bulk toggle failed: ${err.message}`);
    }
  }

  // ─── Docker Actions ───────────────────────────────────────────────────────

  async _containerAction(name, action) {
    try {
      await api.post(`/api/docker/containers/${encodeURIComponent(name)}/${action}`);
      // Slight delay to let Docker settle before refresh
      setTimeout(() => this._loadContainers(), 1500);
    } catch (err) {
      alert(`${action} failed: ${err.message}`);
    }
  }

  async _restartAll() {
    this._dockerConfirm = null;
    try {
      await api.post('/api/docker/restart-all');
      setTimeout(() => this._loadContainers(), 3000);
    } catch (err) {
      alert(`Restart all failed: ${err.message}`);
    }
  }

  async _rebuild() {
    this._dockerConfirm = null;
    try {
      await api.post('/api/docker/rebuild');
      setTimeout(() => this._loadContainers(), 5000);
    } catch (err) {
      alert(`Rebuild failed: ${err.message}`);
    }
  }

  _toggleContainerLogs(name) {
    const updated = new Set(this._logsVisible);
    if (updated.has(name)) {
      updated.delete(name);
    } else {
      updated.add(name);
      this._fetchContainerLogs(name);
    }
    this._logsVisible = updated;
  }

  // ─── Activity Actions ─────────────────────────────────────────────────────

  _handleActivitySearchInput(e) {
    const val = e.target.value;
    clearTimeout(this._activitySearchDebounce);
    this._activitySearchDebounce = setTimeout(() => {
      this._activitySearch = val;
    }, 250);
  }

  get _filteredActivity() {
    let items = this._activity;
    if (this._activityTypeFilter !== 'all') {
      items = items.filter((a) => a.type === this._activityTypeFilter);
    }
    if (this._activityAgentFilter !== 'all') {
      items = items.filter((a) => a.agent === this._activityAgentFilter);
    }
    if (this._activitySearch) {
      const q = this._activitySearch.toLowerCase();
      items = items.filter(
        (a) =>
          (a.message || '').toLowerCase().includes(q) ||
          (a.agent || '').toLowerCase().includes(q) ||
          (a.type || '').toLowerCase().includes(q),
      );
    }
    return items;
  }

  _exportActivityCsv() {
    const rows = this._filteredActivity.map((a) => [
      a.ts ? new Date(a.ts).toISOString() : '',
      a.type || '',
      a.agent || '',
      `"${(a.message || '').replace(/"/g, '""')}"`,
    ]);
    const header = 'timestamp,type,agent,message\n';
    const csv = header + rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Log Actions ──────────────────────────────────────────────────────────

  _handleAutoRefreshToggle(e) {
    this._logAutoRefresh = e.target.checked;
    if (this._logAutoRefresh) {
      this._startLogRefresh();
    } else {
      this._stopLogRefresh();
      this._loadLogs();
    }
  }

  _handleLogSourceChange(source) {
    this._logSource = source;
    this._logLines = [];
    if (this._logAutoRefresh) {
      this._startLogRefresh();
    } else {
      this._loadLogs();
    }
  }

  _downloadLogs() {
    const text = this._logLines.map((l) => stripAnsi(l.text || l)).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this._logSource}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  get _filteredLogLines() {
    if (!this._logSearch) {return this._logLines;}
    const q = this._logSearch.toLowerCase();
    return this._logLines.filter((l) => (l.text || l).toLowerCase().includes(q));
  }

  // ─── Form Helpers ─────────────────────────────────────────────────────────

  _updateCronForm(field, value) {
    this._cronForm = { ...this._cronForm, [field]: value };
  }

  // ─── Tab Switching ────────────────────────────────────────────────────────

  _switchTab(tab) {
    this._activeTab = tab;
    // Trigger data load for newly active tab if needed
    if (tab === 'logs' && this._logLines.length === 0) {
      this._loadLogs();
    }
  }

  // ─── Docker Stats Aggregation ─────────────────────────────────────────────

  get _dockerStats() {
    const running = this._containers.filter((c) => (c.status || '').toLowerCase() === 'running').length;
    const stopped = this._containers.length - running;
    const totalCpu = this._containers.reduce((sum, c) => sum + (c.cpuPercent || 0), 0);
    // memUsageMb is in megabytes from the API; convert to bytes for formatBytes()
    const totalMem = this._containers.reduce((sum, c) => sum + ((c.memUsageMb || 0) * 1048576), 0);
    return { running, stopped, totalCpu, totalMem };
  }

  get _uniqueActivityAgents() {
    const seen = new Set();
    for (const a of this._activity) {
      if (a.agent) {seen.add(a.agent);}
    }
    return [...seen].toSorted();
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  render() {
    return html`
      <div class="ops-page">
        <!-- Page Header -->
        <div class="page-header">
          <div class="page-header-text">
            <h1 class="page-title">Operations</h1>
            <p class="page-subtitle">Cron jobs, containers, activity, and system logs</p>
          </div>
        </div>

        <!-- Tabs -->
        <div class="tabs-bar" role="tablist">
          ${this._renderTabButton('cron', 'Cron Jobs', '⏰')}
          ${this._renderTabButton('docker', 'Docker', '🐳')}
          ${this._renderTabButton('activity', 'Activity', '📋')}
          ${this._renderTabButton('logs', 'Logs', '📄')}
        </div>

        <!-- Tab Content -->
        <div class="tab-content">
          ${this._activeTab === 'cron' ? this._renderCronTab() : ''}
          ${this._activeTab === 'docker' ? this._renderDockerTab() : ''}
          ${this._activeTab === 'activity' ? this._renderActivityTab() : ''}
          ${this._activeTab === 'logs' ? this._renderLogsTab() : ''}
        </div>

        <!-- Modals -->
        ${this._showCronModal ? this._renderCronModal() : ''}
        ${this._showHistoryModal ? this._renderHistoryModal() : ''}
        ${this._dockerConfirm ? this._renderDockerConfirm() : ''}
      </div>
    `;
  }

  _renderTabButton(id, label, icon) {
    const active = this._activeTab === id;
    return html`
      <button
        class="tab-btn ${active ? 'active' : ''}"
        role="tab"
        aria-selected="${active}"
        @click=${() => this._switchTab(id)}
      >
        <span class="tab-icon">${icon}</span>
        <span>${label}</span>
      </button>
    `;
  }

  // ─── Cron Tab ────────────────────────────────────────────────────────────

  _renderCronTab() {
    return html`
      <div class="section-header">
        <div class="header-actions">
          <button class="btn btn-ghost btn-sm" @click=${() => this._bulkToggleCron(true)}>Enable All</button>
          <button class="btn btn-ghost btn-sm" @click=${() => this._bulkToggleCron(false)}>Disable All</button>
          <button class="btn btn-primary btn-sm" @click=${this._openCreateCronModal}>+ New Job</button>
        </div>
      </div>

      ${this._cronError ? html`<div class="error-banner">${this._cronError}</div>` : ''}
      ${this._cronLoading && this._cronJobs.length === 0
        ? html`<div class="loading-state"><div class="spinner"></div> Loading cron jobs…</div>`
        : this._renderCronTable()
      }
    `;
  }

  _renderCronTable() {
    if (this._cronJobs.length === 0) {
      return html`
        <div class="empty-state">
          <div class="empty-icon">⏰</div>
          <div class="empty-text">No cron jobs configured</div>
          <button class="btn btn-primary btn-sm" @click=${this._openCreateCronModal}>Create First Job</button>
        </div>
      `;
    }

    return html`
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-toggle">On</th>
              <th class="col-name">Name</th>
              <th class="col-agent">Agent</th>
              <th class="col-schedule">Schedule</th>
              <th class="col-status">Status</th>
              <th class="col-last">Last Run</th>
              <th class="col-next">Next Run</th>
              <th class="col-errors">Errors</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this._cronJobs.map((job) => this._renderCronRow(job))}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderCronRow(job) {
    const enabled = job.enabled !== false;
    const errorCount = job.errorCount || job.consecutiveErrors || 0;
    const agent = this._agents.find((a) => a.id === (job.agentId || job.agent));

    return html`
      <tr class="table-row ${enabled ? '' : 'row-disabled'}">
        <td class="col-toggle">
          <label class="toggle-switch" title="${enabled ? 'Disable' : 'Enable'}">
            <input
              type="checkbox"
              .checked=${enabled}
              @change=${() => this._toggleCron(job)}
            />
            <span class="toggle-track"></span>
          </label>
        </td>
        <td class="col-name">
          <span class="job-name">${job.name}</span>
          ${job.message ? html`<div class="job-msg-preview">${job.message.substring(0, 60)}${job.message.length > 60 ? '…' : ''}</div>` : ''}
        </td>
        <td class="col-agent">
          ${agent
            ? html`<span class="agent-badge">${agent.emoji || '🤖'} ${agent.name}</span>`
            : html`<span class="agent-badge agent-badge-unknown">🤖 ${job.agentId || job.agent || '—'}</span>`
          }
        </td>
        <td class="col-schedule">
          <code class="cron-expr" title="${parseCronExpression(job.schedule)}">${job.schedule}</code>
          <div class="cron-desc">${parseCronExpression(job.schedule)}</div>
        </td>
        <td class="col-status">
          <span class="badge ${enabled ? 'badge-green' : 'badge-gray'}">${enabled ? 'enabled' : 'disabled'}</span>
        </td>
        <td class="col-last">
          <span class="time-cell" title="${job.lastRunAt || job.lastRun || ''}">
            ${timeAgo(job.lastRunAt || job.lastRun)}
          </span>
        </td>
        <td class="col-next">
          <span class="time-cell" title="${job.nextRunAt || job.nextRun || ''}">
            ${timeUntil(job.nextRunAt || job.nextRun)}
          </span>
        </td>
        <td class="col-errors">
          ${errorCount > 0
            ? html`<span class="badge badge-red">${errorCount}</span>`
            : html`<span class="text-muted">—</span>`
          }
        </td>
        <td class="col-actions">
          <div class="action-row">
            <button class="btn btn-ghost btn-icon-sm" title="Run Now" @click=${() => this._runCronNow(job)}>▶</button>
            <button class="btn btn-ghost btn-icon-sm" title="History" @click=${() => this._openHistoryModal(job)}>📜</button>
            <button class="btn btn-ghost btn-icon-sm" title="Edit" @click=${() => this._openEditCronModal(job)}>✎</button>
            <button class="btn btn-ghost btn-icon-sm danger" title="Delete" @click=${() => this._deleteCron(job)}>✕</button>
          </div>
        </td>
      </tr>
    `;
  }

  // ─── Cron Modal ───────────────────────────────────────────────────────────

  _renderCronModal() {
    const isEdit = this._cronModalMode === 'edit';
    const f = this._cronForm;

    return html`
      <div class="modal-overlay" @click=${(e) => e.target === e.currentTarget && this._closeCronModal()}>
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h3 class="modal-title">${isEdit ? 'Edit Cron Job' : 'New Cron Job'}</h3>
            <button class="btn btn-ghost btn-icon" @click=${this._closeCronModal}>✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <!-- Name -->
              <div class="input-group">
                <label class="input-label">Name *</label>
                <input
                  class="input"
                  type="text"
                  placeholder="e.g. Daily Market Report"
                  .value=${f.name}
                  @input=${(e) => this._updateCronForm('name', e.target.value)}
                />
              </div>

              <!-- Agent -->
              <div class="input-group">
                <label class="input-label">Agent *</label>
                <select
                  class="input"
                  .value=${f.agentId}
                  @change=${(e) => this._updateCronForm('agentId', e.target.value)}
                >
                  <option value="">Select agent…</option>
                  ${this._agents.map((a) => html`
                    <option value="${a.id}" ?selected=${f.agentId === a.id}>
                      ${a.emoji || '🤖'} ${a.name || a.id}
                    </option>
                  `)}
                </select>
              </div>

              <!-- Schedule -->
              <div class="input-group">
                <label class="input-label">Schedule * <span class="label-hint">(cron format: min hour dom month dow)</span></label>
                <input
                  class="input mono"
                  type="text"
                  placeholder="0 7 * * *"
                  .value=${f.schedule}
                  @input=${(e) => this._updateCronForm('schedule', e.target.value)}
                />
                ${f.schedule ? html`
                  <div class="cron-preview">${parseCronExpression(f.schedule)}</div>
                ` : ''}
              </div>

              <!-- Message -->
              <div class="input-group full-width">
                <label class="input-label">Message</label>
                <textarea
                  class="input textarea"
                  rows="3"
                  placeholder="Message sent to the agent when the cron fires…"
                  .value=${f.message}
                  @input=${(e) => this._updateCronForm('message', e.target.value)}
                ></textarea>
              </div>

              <!-- Delivery -->
              <div class="input-group full-width">
                <label class="input-label">Delivery</label>
                <div class="delivery-grid">
                  <div class="input-group">
                    <label class="input-label">Mode</label>
                    <select
                      class="input"
                      .value=${f.deliveryMode}
                      @change=${(e) => this._updateCronForm('deliveryMode', e.target.value)}
                    >
                      <option value="announce">announce</option>
                      <option value="standard">standard</option>
                    </select>
                  </div>
                  <div class="input-group">
                    <label class="input-label">Channel</label>
                    <select
                      class="input"
                      .value=${f.deliveryChannel}
                      @change=${(e) => this._updateCronForm('deliveryChannel', e.target.value)}
                    >
                      <option value="telegram">telegram</option>
                      <option value="whatsapp">whatsapp</option>
                    </select>
                  </div>
                  <div class="input-group">
                    <label class="input-label">Target (chat ID / phone)</label>
                    <input
                      class="input mono"
                      type="text"
                      placeholder="e.g. 7955595068"
                      .value=${f.deliveryTarget}
                      @input=${(e) => this._updateCronForm('deliveryTarget', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click=${this._closeCronModal}>Cancel</button>
            <button
              class="btn btn-primary"
              ?disabled=${this._cronSaving}
              @click=${this._saveCronJob}
            >
              ${this._cronSaving ? html`<span class="spinner"></span> Saving…` : (isEdit ? 'Save Changes' : 'Create Job')}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ─── History Modal ────────────────────────────────────────────────────────

  _renderHistoryModal() {
    const PAGE_SIZE = 20;
    const totalPages = Math.ceil(this._historyRuns.length / PAGE_SIZE);
    const page = this._historyPage;
    const pageRuns = this._historyRuns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    return html`
      <div class="modal-overlay" @click=${(e) => e.target === e.currentTarget && this._closeHistoryModal()}>
        <div class="modal modal-wide" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h3 class="modal-title">Run History — ${this._historyJob?.name}</h3>
            <button class="btn btn-ghost btn-icon" @click=${this._closeHistoryModal}>✕</button>
          </div>
          <div class="modal-body">
            ${this._historyLoading
              ? html`<div class="loading-state"><div class="spinner"></div> Loading history…</div>`
              : this._historyRuns.length === 0
                ? html`<div class="empty-state"><div class="empty-text">No runs recorded yet</div></div>`
                : html`
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${pageRuns.map((run) => html`
                        <tr class="table-row">
                          <td class="font-mono text-sm">${run.ts ? new Date(run.ts).toLocaleString() : '—'}</td>
                          <td>
                            <span class="badge ${run.status === 'ok' || run.status === 'success' ? 'badge-green' : 'badge-red'}">
                              ${run.status || 'unknown'}
                            </span>
                          </td>
                          <td class="font-mono text-sm">${formatDuration(run.duration)}</td>
                          <td class="run-output">
                            <details>
                              <summary class="run-summary">${(run.summary || run.output || '').substring(0, 80)}${(run.summary || run.output || '').length > 80 ? '…' : ''}</summary>
                              <pre class="run-detail">${run.summary || run.output || '—'}</pre>
                            </details>
                          </td>
                        </tr>
                      `)}
                    </tbody>
                  </table>
                  ${totalPages > 1 ? html`
                    <div class="pagination">
                      <button class="btn btn-ghost btn-sm" ?disabled=${page === 0} @click=${() => { this._historyPage = page - 1; }}>← Prev</button>
                      <span class="page-info">Page ${page + 1} / ${totalPages}</span>
                      <button class="btn btn-ghost btn-sm" ?disabled=${page >= totalPages - 1} @click=${() => { this._historyPage = page + 1; }}>Next →</button>
                    </div>
                  ` : ''}
                `
            }
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click=${this._closeHistoryModal}>Close</button>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Docker Tab ───────────────────────────────────────────────────────────

  _renderDockerTab() {
    const stats = this._dockerStats;

    return html`
      <div class="section-header">
        <div class="header-actions">
          <button class="btn btn-ghost btn-sm" @click=${() => { this._dockerConfirm = 'restart-all'; }}>↺ Restart All</button>
          <button class="btn btn-secondary btn-sm" @click=${() => { this._dockerConfirm = 'rebuild'; }}>⬆ Rebuild & Update</button>
        </div>
      </div>

      <!-- Summary Cards -->
      <div class="docker-summary-row">
        ${this._renderDockerStatCard('Running', stats.running, 'stat-green', '')}
        ${this._renderDockerStatCard('Stopped', stats.stopped, stats.stopped > 0 ? 'stat-red' : 'stat-dim', '')}
        ${this._renderDockerStatCard('Total CPU', `${stats.totalCpu.toFixed(1)}%`, 'stat-default', '')}
        ${this._renderDockerStatCard('Total Memory', formatBytes(stats.totalMem), 'stat-default', '')}
      </div>

      ${this._dockerError ? html`<div class="error-banner">${this._dockerError}</div>` : ''}
      ${this._dockerLoading && this._containers.length === 0
        ? html`<div class="loading-state"><div class="spinner"></div> Loading containers…</div>`
        : html`
          <div class="container-grid">
            ${this._containers.map((c) => this._renderContainerCard(c))}
            ${this._containers.length === 0 ? html`
              <div class="empty-state">
                <div class="empty-icon">🐳</div>
                <div class="empty-text">No containers found</div>
              </div>
            ` : ''}
          </div>
        `
      }
    `;
  }

  _renderDockerStatCard(label, value, colorClass, _icon) {
    return html`
      <div class="docker-stat-card">
        <div class="docker-stat-label">${label}</div>
        <div class="docker-stat-value ${colorClass}">${value}</div>
      </div>
    `;
  }

  _renderContainerCard(c) {
    const name = c.name || c.Names?.[0]?.replace(/^\//, '') || 'unknown';
    const status = c.status || c.Status || 'unknown';
    const isRunning = status.toLowerCase() === 'running';
    const hasStats = isRunning && c.statsAvailable;
    const cpu = isRunning ? (c.cpuPercent != null ? c.cpuPercent.toFixed(1) : '0.0') : 'N/A';
    // Backend returns memUsageMb/memLimitMb in megabytes; convert to bytes for formatBytes()
    const memUsage = (c.memUsageMb || 0) * 1048576;
    const memLimit = (c.memLimitMb || 0) * 1048576;
    const memPct = c.memPercent || (memLimit > 0 ? Math.min(100, (memUsage / memLimit) * 100) : 0);
    const memDisplay = isRunning ? formatBytes(memUsage) : 'N/A';
    // Backend returns uptimeMs in milliseconds; convert to seconds for formatUptime()
    const uptime = c.uptimeMs != null ? formatUptime(c.uptimeMs / 1000) : '—';
    const uptimeDisplay = isRunning && c.uptimeMs != null && c.uptimeMs < 10000 ? 'starting...' : uptime;
    const restarts = c.restartCount ?? c.RestartCount ?? 0;
    const health = c.health || c.Health?.Status;
    const logsShown = this._logsVisible.has(name);
    const showLogToggle = ['oasis', 'audio-listener'].includes(name);
    const logs = this._containerLogs.get(name) || [];

    return html`
      <div class="container-card">
        <div class="container-header">
          <div class="container-name-row">
            <span class="container-name">${name}</span>
            ${health ? html`<span class="badge badge-green health-badge">${health}</span>` : ''}
            <span class="badge ${containerStatusClass(status)} ml-auto">${status}</span>
          </div>
        </div>
        <div class="container-stats">
          <div class="stat-row">
            <span class="stat-key">CPU</span>
            <span class="stat-val mono">${isRunning ? `${cpu}%` : cpu}</span>
          </div>
          <div class="stat-row">
            <span class="stat-key">Memory</span>
            <span class="stat-val mono">${isRunning ? `${memDisplay}${memLimit > 0 ? ` / ${formatBytes(memLimit)}` : ''}` : memDisplay}</span>
          </div>
          ${isRunning && hasStats && memLimit > 0 ? html`
            <div class="mem-bar-wrapper">
              <div class="mem-bar" style="width: ${memPct.toFixed(1)}%; background: ${memPct > 85 ? 'var(--red)' : memPct > 65 ? 'var(--yellow)' : 'var(--accent)'}"></div>
            </div>
          ` : ''}
          <div class="stat-row">
            <span class="stat-key">Uptime</span>
            <span class="stat-val mono">${uptimeDisplay}</span>
          </div>
          <div class="stat-row">
            <span class="stat-key">Restarts</span>
            <span class="stat-val mono ${restarts > 0 ? 'text-yellow' : ''}">${restarts}</span>
          </div>
        </div>
        <div class="container-actions">
          ${isRunning
            ? html`
              <button class="btn btn-ghost btn-sm" @click=${() => this._containerAction(name, 'stop')}>■ Stop</button>
              <button class="btn btn-ghost btn-sm" @click=${() => this._containerAction(name, 'restart')}>↺ Restart</button>
            `
            : html`
              <button class="btn btn-secondary btn-sm" @click=${() => this._containerAction(name, 'start')}>▶ Start</button>
            `
          }
          ${showLogToggle ? html`
            <button class="btn btn-ghost btn-sm" @click=${() => this._toggleContainerLogs(name)}>
              ${logsShown ? '▲ Hide Logs' : '▼ Show Logs'}
            </button>
          ` : ''}
        </div>

        <!-- Inline log viewer -->
        ${logsShown ? html`
          <div class="inline-log-panel">
            <div class="log-panel-header">
              <span class="log-panel-title">${name} logs</span>
              <div class="log-panel-controls">
                <label class="select-wrapper">
                  <select
                    class="select-sm"
                    .value=${String(this._logsTailSize)}
                    @change=${(e) => {
                      this._logsTailSize = parseInt(e.target.value);
                      this._fetchContainerLogs(name);
                    }}
                  >
                    <option value="50">50 lines</option>
                    <option value="100">100 lines</option>
                    <option value="200">200 lines</option>
                    <option value="500">500 lines</option>
                  </select>
                </label>
                <button class="btn btn-ghost btn-icon-sm" title="Refresh" @click=${() => this._fetchContainerLogs(name)}>↻</button>
              </div>
            </div>
            <div class="log-output">
              ${logs.length === 0
                ? html`<div class="log-empty">No log output</div>`
                : logs.map((line, i) => {
                    const text = typeof line === 'string' ? line : (line.text || '');
                    const clean = stripAnsi(text);
                    return html`<div class="log-line ${logLineClass(clean)}"><span class="line-num">${i + 1}</span>${clean}</div>`;
                  })
              }
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ─── Docker Confirm Dialog ────────────────────────────────────────────────

  _renderDockerConfirm() {
    const isRebuild = this._dockerConfirm === 'rebuild';
    const title = isRebuild ? 'Rebuild & Update' : 'Restart All Containers';
    const msg = isRebuild
      ? 'This will pull the latest code from upstream, rebuild Docker images, and restart all containers. This may take several minutes.'
      : 'This will restart all running containers. In-flight requests will be interrupted.';
    const confirmAction = isRebuild ? () => this._rebuild() : () => this._restartAll();

    return html`
      <div class="modal-overlay" @click=${(e) => e.target === e.currentTarget && (this._dockerConfirm = null)}>
        <div class="modal modal-sm" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h3 class="modal-title">${title}</h3>
          </div>
          <div class="modal-body">
            <p class="confirm-message">${msg}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click=${() => { this._dockerConfirm = null; }}>Cancel</button>
            <button class="btn btn-danger" @click=${confirmAction}>Continue</button>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Activity Tab ─────────────────────────────────────────────────────────

  _renderActivityTab() {
    const filtered = this._filteredActivity;

    return html`
      <div class="section-header">
        <div class="header-actions">
          <button class="btn btn-ghost btn-sm" @click=${this._exportActivityCsv}>⬇ Export CSV</button>
          <button class="btn btn-ghost btn-sm" @click=${this._loadActivity}>↻ Refresh</button>
        </div>
      </div>

      <!-- Filter Bar -->
      <div class="filter-bar">
        <select
          class="input filter-select"
          .value=${this._activityTypeFilter}
          @change=${(e) => { this._activityTypeFilter = e.target.value; }}
        >
          <option value="all">All Types</option>
          <option value="message">Message</option>
          <option value="session">Session</option>
          <option value="cron">Cron</option>
          <option value="agent">Agent</option>
          <option value="system">System</option>
          <option value="error">Error</option>
        </select>

        <select
          class="input filter-select"
          .value=${this._activityAgentFilter}
          @change=${(e) => { this._activityAgentFilter = e.target.value; }}
        >
          <option value="all">All Agents</option>
          ${this._uniqueActivityAgents.map((a) => html`<option value="${a}">${a}</option>`)}
        </select>

        <input
          class="input filter-search"
          type="text"
          placeholder="Search activity…"
          @input=${this._handleActivitySearchInput}
        />
      </div>

      ${this._activityLoading && this._activity.length === 0
        ? html`<div class="loading-state"><div class="spinner"></div> Loading activity…</div>`
        : filtered.length === 0
          ? html`<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No activity events found</div></div>`
          : html`
            <div class="activity-feed">
              ${filtered.map((event) => this._renderActivityEvent(event))}
            </div>
          `
      }
    `;
  }

  _renderActivityEvent(event) {
    const ts = event.ts || event.timestamp;
    const relTime = ts ? timeAgo(typeof ts === 'number' ? new Date(ts).toISOString() : ts) : '—';
    const fullTime = ts ? new Date(typeof ts === 'number' ? ts : ts).toLocaleString() : '';
    const typeClass = activityColorClass(event.type);
    const agentObj = this._agents.find((a) => a.id === event.agent);

    return html`
      <div class="activity-event animate-fade-in">
        <div class="activity-meta">
          <span class="activity-time" title="${fullTime}">${relTime}</span>
          <span class="activity-type-badge ${typeClass}">${event.type || 'system'}</span>
          ${event.agent ? html`
            <span class="activity-agent-badge">
              ${agentObj?.emoji || '🤖'} ${event.agent}
            </span>
          ` : ''}
        </div>
        <div class="activity-message">${event.message || event.description || '—'}</div>
      </div>
    `;
  }

  // ─── Logs Tab ─────────────────────────────────────────────────────────────

  _renderLogsTab() {
    const filtered = this._filteredLogLines;

    return html`
      <div class="section-header">
        <div class="header-actions">
          <button class="btn btn-ghost btn-sm" @click=${this._downloadLogs}>⬇ Download</button>
          <button class="btn btn-ghost btn-sm" @click=${() => { this._logLines = []; this._loadLogs(); }}>Clear</button>
        </div>
      </div>

      <!-- Source Selector -->
      <div class="log-source-tabs">
        <button
          class="log-source-btn ${this._logSource === 'gateway' ? 'active' : ''}"
          @click=${() => this._handleLogSourceChange('gateway')}
        >Gateway</button>
        <button
          class="log-source-btn ${this._logSource === 'audio-listener' ? 'active' : ''}"
          @click=${() => this._handleLogSourceChange('audio-listener')}
        >Audio Listener</button>
      </div>

      <!-- Controls -->
      <div class="log-controls">
        <label class="refresh-toggle">
          <input
            type="checkbox"
            .checked=${this._logAutoRefresh}
            @change=${this._handleAutoRefreshToggle}
          />
          <span>Auto-refresh</span>
          ${this._logLiveIndicator ? html`<span class="live-dot" title="Live"></span>` : ''}
        </label>

        ${this._logAutoRefresh ? html`
          <select
            class="select-sm"
            .value=${String(this._logInterval)}
            @change=${(e) => {
              this._logInterval = parseInt(e.target.value);
              if (this._logAutoRefresh) {this._startLogRefresh();}
            }}
          >
            <option value="5">5s</option>
            <option value="10">10s</option>
            <option value="30">30s</option>
          </select>
        ` : ''}

        <select
          class="select-sm"
          .value=${String(this._logTailSize)}
          @change=${(e) => {
            this._logTailSize = parseInt(e.target.value);
            this._loadLogs();
          }}
        >
          <option value="50">50 lines</option>
          <option value="100">100 lines</option>
          <option value="200">200 lines</option>
          <option value="500">500 lines</option>
        </select>

        <input
          class="input log-search"
          type="text"
          placeholder="Search logs…"
          .value=${this._logSearch}
          @input=${(e) => { this._logSearch = e.target.value; }}
        />

        <button class="btn btn-ghost btn-sm" @click=${this._loadLogs}>↻ Refresh</button>
      </div>

      ${this._logLoading && this._logLines.length === 0
        ? html`<div class="loading-state"><div class="spinner"></div> Loading logs…</div>`
        : html`
          <div class="log-viewer">
            ${filtered.length === 0
              ? html`<div class="log-empty">No log output${this._logSearch ? ' matching filter' : ''}</div>`
              : filtered.map((line, i) => {
                  const text = typeof line === 'string' ? line : (line.text || '');
                  const clean = stripAnsi(text);
                  const cls = logLineClass(clean);
                  const highlight = this._logSearch
                    ? clean.toLowerCase().includes(this._logSearch.toLowerCase())
                    : false;
                  return html`
                    <div class="log-line ${cls} ${highlight ? 'log-highlight' : ''}">
                      <span class="line-num">${i + 1}</span>${clean}
                    </div>
                  `;
                })
            }
          </div>
        `
      }
    `;
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

  static styles = css`
    :host {
      display: block;
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      color: var(--text, #e0e6f0);
    }

    /* ── Page Header ─────────────────────────────────────────────────────── */
    .ops-page {
      padding: 0 1.5rem;
    }

    .page-header {
      margin-bottom: 1.25rem;
    }

    .page-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text, #e0e6f0);
      letter-spacing: -0.02em;
      margin: 0;
    }

    .page-subtitle {
      font-size: 0.875rem;
      color: var(--text-dim, #7a8ba8);
      margin: 0.25rem 0 0;
    }

    /* ── Tabs ────────────────────────────────────────────────────────────── */
    .tabs-bar {
      display: flex;
      gap: 0;
      border-bottom: 2px solid var(--border, #2a3550);
      margin-bottom: 1.5rem;
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.6rem 1.25rem;
      border: none;
      background: transparent;
      color: var(--text-dim, #7a8ba8);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: color 150ms ease, border-color 150ms ease;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: var(--text, #e0e6f0);
    }

    .tab-btn.active {
      color: var(--accent, #00d4ff);
      border-bottom-color: var(--accent, #00d4ff);
    }

    .tab-icon {
      font-size: 1rem;
    }

    .tab-content {
      min-height: 300px;
    }

    /* ── Section Header ──────────────────────────────────────────────────── */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .section-title {
      font-size: 0.75rem;
      font-family: var(--font-mono, monospace);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted, #4a5568);
      margin: 0;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    /* ── Buttons ─────────────────────────────────────────────────────────── */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      padding: 0.45rem 0.9rem;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
      white-space: nowrap;
      user-select: none;
      text-decoration: none;
    }

    .btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      pointer-events: none;
    }

    .btn-primary {
      background: var(--accent, #00d4ff);
      color: var(--bg, #0a0e17);
      border-color: var(--accent, #00d4ff);
      font-weight: 600;
    }

    .btn-primary:hover {
      background: color-mix(in srgb, var(--accent, #00d4ff) 85%, white 15%);
    }

    .btn-secondary {
      background: var(--surface-2, #1a2235);
      color: var(--text, #e0e6f0);
      border-color: var(--border, #2a3550);
    }

    .btn-secondary:hover {
      background: var(--surface-3, #222d42);
      border-color: var(--accent, #00d4ff);
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.12);
      color: var(--red, #ef4444);
      border-color: var(--red, #ef4444);
    }

    .btn-danger:hover {
      background: var(--red, #ef4444);
      color: white;
    }

    .btn-ghost {
      background: transparent;
      color: var(--text-dim, #7a8ba8);
      border-color: transparent;
    }

    .btn-ghost:hover {
      background: var(--surface-2, #1a2235);
      color: var(--text, #e0e6f0);
    }

    .btn-sm {
      padding: 0.3rem 0.65rem;
      font-size: 0.8rem;
    }

    .btn-icon {
      padding: 0.45rem;
      width: 34px;
      height: 34px;
    }

    .btn-icon-sm {
      padding: 0.2rem 0.4rem;
      font-size: 0.8rem;
      min-width: 28px;
      height: 28px;
    }

    .btn-ghost.danger:hover {
      color: var(--red, #ef4444);
      background: rgba(239, 68, 68, 0.1);
    }

    /* ── Table ───────────────────────────────────────────────────────────── */
    .table-wrapper {
      overflow-x: auto;
      border-radius: 8px;
      border: 1px solid var(--border, #2a3550);
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    .data-table th {
      padding: 0.6rem 0.85rem;
      text-align: left;
      font-size: 0.7rem;
      font-family: var(--font-mono, monospace);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted, #4a5568);
      background: var(--surface, #131926);
      border-bottom: 1px solid var(--border, #2a3550);
      white-space: nowrap;
    }

    .table-row td {
      padding: 0.65rem 0.85rem;
      border-bottom: 1px solid var(--border, #2a3550);
      vertical-align: middle;
    }

    .table-row:last-child td {
      border-bottom: none;
    }

    .table-row:hover td {
      background: var(--surface-2, #1a2235);
    }

    .table-row.row-disabled td {
      opacity: 0.55;
    }

    /* ── Cron specific ───────────────────────────────────────────────────── */
    .job-name {
      font-weight: 600;
      color: var(--text, #e0e6f0);
    }

    .job-msg-preview {
      font-size: 0.75rem;
      color: var(--text-muted, #4a5568);
      margin-top: 2px;
      font-style: italic;
    }

    .cron-expr {
      font-family: var(--font-mono, monospace);
      font-size: 0.8rem;
      color: var(--accent, #00d4ff);
    }

    .cron-desc {
      font-size: 0.72rem;
      color: var(--text-muted, #4a5568);
      margin-top: 2px;
    }

    .cron-preview {
      font-size: 0.72rem;
      color: var(--accent, #00d4ff);
      margin-top: 0.25rem;
      font-family: var(--font-mono, monospace);
    }

    .time-cell {
      font-family: var(--font-mono, monospace);
      font-size: 0.8rem;
      color: var(--text-dim, #7a8ba8);
      white-space: nowrap;
    }

    .action-row {
      display: flex;
      align-items: center;
      gap: 0.2rem;
      flex-wrap: nowrap;
    }

    /* ── Toggle Switch ───────────────────────────────────────────────────── */
    .toggle-switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }

    .toggle-switch input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-track {
      display: block;
      width: 36px;
      height: 20px;
      border-radius: 10px;
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      transition: background 150ms ease, border-color 150ms ease;
      position: relative;
    }

    .toggle-track::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--text-muted, #4a5568);
      transition: transform 150ms ease, background 150ms ease;
    }

    .toggle-switch input:checked + .toggle-track {
      background: rgba(0, 212, 255, 0.2);
      border-color: var(--accent, #00d4ff);
    }

    .toggle-switch input:checked + .toggle-track::after {
      transform: translateX(16px);
      background: var(--accent, #00d4ff);
    }

    /* ── Agent Badge ─────────────────────────────────────────────────────── */
    .agent-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.15rem 0.55rem;
      border-radius: 4px;
      font-size: 0.78rem;
      font-weight: 500;
      background: var(--accent-dim, rgba(0,212,255,0.15));
      color: var(--accent, #00d4ff);
      white-space: nowrap;
    }

    .agent-badge-unknown {
      background: var(--surface-3, #222d42);
      color: var(--text-dim, #7a8ba8);
    }

    /* ── Badges ──────────────────────────────────────────────────────────── */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 600;
      font-family: var(--font-mono, monospace);
      letter-spacing: 0.03em;
      white-space: nowrap;
    }

    .badge-green {
      background: rgba(34, 197, 94, 0.15);
      color: var(--green, #22c55e);
    }

    .badge-red {
      background: rgba(239, 68, 68, 0.15);
      color: var(--red, #ef4444);
    }

    .badge-yellow {
      background: rgba(234, 179, 8, 0.15);
      color: var(--yellow, #eab308);
    }

    .badge-gray {
      background: var(--surface-3, #222d42);
      color: var(--text-muted, #4a5568);
    }

    .ml-auto { margin-left: auto; }

    /* ── Inputs ──────────────────────────────────────────────────────────── */
    .input {
      width: 100%;
      padding: 0.45rem 0.75rem;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 6px;
      color: var(--text, #e0e6f0);
      font-size: 0.875rem;
      font-family: inherit;
      transition: border-color 120ms ease;
      outline: none;
      box-sizing: border-box;
    }

    .input:focus {
      border-color: var(--accent, #00d4ff);
    }

    .input::placeholder {
      color: var(--text-muted, #4a5568);
    }

    .input.mono {
      font-family: var(--font-mono, monospace);
      font-size: 0.82rem;
    }

    .textarea {
      resize: vertical;
      min-height: 72px;
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }

    .input-label {
      font-size: 0.72rem;
      font-family: var(--font-mono, monospace);
      color: var(--text-dim, #7a8ba8);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .label-hint {
      font-size: 0.68rem;
      color: var(--text-muted, #4a5568);
      text-transform: none;
      letter-spacing: 0;
    }

    /* ── Selects ─────────────────────────────────────────────────────────── */
    .select-sm {
      padding: 0.25rem 0.5rem;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 5px;
      color: var(--text, #e0e6f0);
      font-size: 0.8rem;
      font-family: inherit;
      cursor: pointer;
      outline: none;
    }

    .select-sm:focus {
      border-color: var(--accent, #00d4ff);
    }

    select.input option {
      background: var(--surface, #131926);
    }

    /* ── Error / Loading / Empty States ──────────────────────────────────── */
    .error-banner {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid var(--red, #ef4444);
      border-radius: 6px;
      padding: 0.6rem 1rem;
      color: var(--red, #ef4444);
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }

    .loading-state {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: var(--text-dim, #7a8ba8);
      font-size: 0.875rem;
      padding: 2rem;
      justify-content: center;
    }

    .spinner {
      display: inline-block;
      width: 1em;
      height: 1em;
      border: 2px solid var(--border, #2a3550);
      border-top-color: var(--accent, #00d4ff);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 3rem;
      color: var(--text-dim, #7a8ba8);
    }

    .empty-icon {
      font-size: 2.5rem;
      opacity: 0.5;
    }

    .empty-text {
      font-size: 0.9rem;
    }

    .text-muted {
      color: var(--text-muted, #4a5568);
    }

    .text-yellow {
      color: var(--yellow, #eab308);
    }

    .font-mono {
      font-family: var(--font-mono, monospace);
    }

    .text-sm {
      font-size: 0.875rem;
    }

    /* ── Modal ───────────────────────────────────────────────────────────── */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1.5rem;
      animation: fadeIn 150ms ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 10px;
      width: 100%;
      max-width: 540px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
      animation: scaleIn 150ms ease;
    }

    @keyframes scaleIn {
      from { transform: scale(0.97); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .modal-wide {
      max-width: 720px;
    }

    .modal-sm {
      max-width: 400px;
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border, #2a3550);
      flex-shrink: 0;
    }

    .modal-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text, #e0e6f0);
      margin: 0;
    }

    .modal-body {
      padding: 1.25rem;
      overflow-y: auto;
      flex: 1;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--border, #2a3550);
      flex-shrink: 0;
    }

    /* ── Form Grid ───────────────────────────────────────────────────────── */
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .form-grid .full-width {
      grid-column: 1 / -1;
    }

    .delivery-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.75rem;
    }

    /* ── History Modal ───────────────────────────────────────────────────── */
    .run-output {
      max-width: 280px;
    }

    .run-summary {
      font-size: 0.8rem;
      color: var(--text-dim, #7a8ba8);
      cursor: pointer;
      list-style: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .run-detail {
      margin-top: 0.5rem;
      font-family: var(--font-mono, monospace);
      font-size: 0.75rem;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--text-dim, #7a8ba8);
      background: var(--surface-2, #1a2235);
      padding: 0.5rem;
      border-radius: 4px;
    }

    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      margin-top: 1rem;
    }

    .page-info {
      font-size: 0.82rem;
      color: var(--text-dim, #7a8ba8);
      font-family: var(--font-mono, monospace);
    }

    /* ── Docker ──────────────────────────────────────────────────────────── */
    .docker-summary-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    .docker-stat-card {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .docker-stat-label {
      font-size: 0.7rem;
      font-family: var(--font-mono, monospace);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-muted, #4a5568);
    }

    .docker-stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      font-family: var(--font-mono, monospace);
    }

    .stat-green { color: var(--green, #22c55e); }
    .stat-red { color: var(--red, #ef4444); }
    .stat-default { color: var(--text, #e0e6f0); }
    .stat-dim { color: var(--text-dim, #7a8ba8); }

    .container-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 0.85rem;
    }

    .container-card {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      padding: 1rem;
      transition: border-color 150ms ease;
    }

    .container-card:hover {
      border-color: var(--accent, #00d4ff);
    }

    .container-header {
      margin-bottom: 0.75rem;
    }

    .container-name-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .container-name {
      font-weight: 700;
      font-family: var(--font-mono, monospace);
      font-size: 0.9rem;
      color: var(--text, #e0e6f0);
    }

    .health-badge {
      font-size: 0.65rem;
    }

    .container-stats {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      margin-bottom: 0.75rem;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .stat-key {
      font-size: 0.75rem;
      color: var(--text-muted, #4a5568);
      font-family: var(--font-mono, monospace);
    }

    .stat-val {
      font-size: 0.8rem;
      color: var(--text-dim, #7a8ba8);
    }

    .stat-val.mono {
      font-family: var(--font-mono, monospace);
    }

    .mem-bar-wrapper {
      height: 4px;
      background: var(--surface-3, #222d42);
      border-radius: 2px;
      overflow: hidden;
      margin: 2px 0;
    }

    .mem-bar {
      height: 100%;
      border-radius: 2px;
      transition: width 500ms ease;
    }

    .container-actions {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    /* ── Container Inline Logs ───────────────────────────────────────────── */
    .inline-log-panel {
      margin-top: 0.75rem;
      border-top: 1px solid var(--border, #2a3550);
      padding-top: 0.75rem;
    }

    .log-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.4rem;
    }

    .log-panel-title {
      font-size: 0.75rem;
      font-family: var(--font-mono, monospace);
      color: var(--text-muted, #4a5568);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .log-panel-controls {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }

    .select-wrapper { display: inline-flex; }

    .log-output {
      background: var(--bg, #0a0e17);
      border: 1px solid var(--border, #2a3550);
      border-radius: 6px;
      padding: 0.5rem;
      max-height: 240px;
      overflow-y: auto;
    }

    /* ── Docker Confirm ──────────────────────────────────────────────────── */
    .confirm-message {
      font-size: 0.875rem;
      color: var(--text-dim, #7a8ba8);
      line-height: 1.6;
      margin: 0;
    }

    /* ── Activity Feed ───────────────────────────────────────────────────── */
    .filter-bar {
      display: flex;
      gap: 0.6rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-select {
      width: auto;
      min-width: 140px;
      padding: 0.35rem 0.65rem;
    }

    .filter-search {
      flex: 1;
      min-width: 180px;
    }

    .activity-feed {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .activity-event {
      display: grid;
      grid-template-columns: 260px 1fr;
      align-items: start;
      gap: 0.75rem;
      padding: 0.6rem 0.85rem;
      border-bottom: 1px solid var(--border, #2a3550);
      transition: background 100ms ease;
    }

    .activity-event:hover {
      background: var(--surface-2, #1a2235);
    }

    .activity-event:last-child {
      border-bottom: none;
    }

    .activity-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      min-width: 0;
    }

    .activity-time {
      font-size: 0.75rem;
      color: var(--text-muted, #4a5568);
      font-family: var(--font-mono, monospace);
      white-space: nowrap;
    }

    .activity-type-badge {
      font-size: 0.7rem;
      font-weight: 600;
      font-family: var(--font-mono, monospace);
      padding: 0.1rem 0.45rem;
      border-radius: 4px;
      white-space: nowrap;
    }

    .type-message {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      color: var(--accent, #00d4ff);
    }

    .type-session {
      background: rgba(34, 197, 94, 0.15);
      color: var(--green, #22c55e);
    }

    .type-cron {
      background: rgba(168, 85, 247, 0.15);
      color: var(--purple, #a855f7);
    }

    .type-agent {
      background: rgba(249, 115, 22, 0.15);
      color: var(--orange, #f97316);
    }

    .type-error {
      background: rgba(239, 68, 68, 0.15);
      color: var(--red, #ef4444);
    }

    .type-system {
      background: var(--surface-3, #222d42);
      color: var(--text-dim, #7a8ba8);
    }

    .activity-agent-badge {
      font-size: 0.72rem;
      padding: 0.1rem 0.4rem;
      background: var(--surface-3, #222d42);
      border-radius: 4px;
      color: var(--text-dim, #7a8ba8);
      white-space: nowrap;
    }

    .activity-message {
      font-size: 0.875rem;
      color: var(--text-dim, #7a8ba8);
      line-height: 1.5;
      word-break: break-word;
    }

    @keyframes fadeInEvent {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .animate-fade-in {
      animation: fadeInEvent 200ms ease;
    }

    /* ── Logs Tab ────────────────────────────────────────────────────────── */
    .log-source-tabs {
      display: flex;
      gap: 0.3rem;
      margin-bottom: 0.75rem;
      border-bottom: 1px solid var(--border, #2a3550);
      padding-bottom: 0.5rem;
    }

    .log-source-btn {
      padding: 0.35rem 0.85rem;
      border-radius: 5px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-dim, #7a8ba8);
      font-size: 0.82rem;
      cursor: pointer;
      transition: background 120ms, color 120ms, border-color 120ms;
    }

    .log-source-btn:hover {
      background: var(--surface-2, #1a2235);
      color: var(--text, #e0e6f0);
    }

    .log-source-btn.active {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      color: var(--accent, #00d4ff);
      border-color: var(--accent, #00d4ff);
    }

    .log-controls {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }

    .refresh-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.82rem;
      color: var(--text-dim, #7a8ba8);
      cursor: pointer;
    }

    .refresh-toggle input {
      accent-color: var(--accent, #00d4ff);
      cursor: pointer;
    }

    .live-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: var(--green, #22c55e);
      border-radius: 50%;
      box-shadow: 0 0 6px var(--green, #22c55e);
      animation: pulseLive 2s ease-in-out infinite;
    }

    @keyframes pulseLive {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .log-search {
      flex: 1;
      min-width: 160px;
      max-width: 300px;
      font-family: var(--font-mono, monospace);
      font-size: 0.8rem;
    }

    .log-viewer {
      background: var(--bg, #0a0e17);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      padding: 0.5rem;
      font-family: var(--font-mono, monospace);
      font-size: 0.8rem;
      min-height: 320px;
      max-height: 600px;
      overflow-y: auto;
    }

    /* ── Log Lines ───────────────────────────────────────────────────────── */
    .log-line {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.12rem 0.25rem;
      border-radius: 2px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .line-num {
      min-width: 36px;
      color: var(--text-muted, #4a5568);
      font-size: 0.72rem;
      text-align: right;
      flex-shrink: 0;
      user-select: none;
      margin-top: 1px;
    }

    .log-error { color: var(--red, #ef4444); }
    .log-warn  { color: var(--yellow, #eab308); }
    .log-info  { color: var(--text, #e0e6f0); }
    .log-debug { color: var(--text-muted, #4a5568); }

    .log-highlight {
      background: rgba(234, 179, 8, 0.1);
      outline: 1px solid rgba(234, 179, 8, 0.3);
      border-radius: 2px;
    }

    .log-empty {
      color: var(--text-muted, #4a5568);
      font-size: 0.82rem;
      text-align: center;
      padding: 2rem;
    }

    /* ── Responsive ──────────────────────────────────────────────────────── */
    @media (max-width: 768px) {
      .docker-summary-row {
        grid-template-columns: repeat(2, 1fr);
      }

      .activity-event {
        grid-template-columns: 1fr;
      }

      .form-grid {
        grid-template-columns: 1fr;
      }

      .delivery-grid {
        grid-template-columns: 1fr;
      }

      .container-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 480px) {
      .docker-summary-row {
        grid-template-columns: 1fr 1fr;
      }

      .tabs-bar {
        overflow-x: auto;
        scrollbar-width: none;
      }

      .tabs-bar::-webkit-scrollbar {
        display: none;
      }
    }
  `;
}

customElements.define('page-operations', PageOperations);
export default PageOperations;
