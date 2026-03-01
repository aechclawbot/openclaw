import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';
import { store } from '/app/store.js';

// ─── Helper Functions ────────────────────────────────────────────────────────

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

function escapeHtml(str) {
  if (!str) {return '';}
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Only allow http/https/mailto URLs in rendered markdown
function sanitizeUrl(url) {
  if (!url) {return '#';}
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) {return trimmed;}
  return '#';
}

function renderMarkdown(text) {
  if (!text) {return '';}
  let out = escapeHtml(text);
  // Fenced code blocks (must come before inline code)
  out = out.replace(/```([^\n]*)\n([\s\S]*?)```/gm, (_m, _lang, code) =>
    `<pre class="code-block"><code>${code}</code></pre>`
  );
  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Headers
  out = out.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  out = out.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  out = out.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold / Italic
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links with sanitized URLs
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) =>
    `<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  // Blockquote
  out = out.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // Lists
  out = out.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  out = out.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  // HR
  out = out.replace(/^---+$/gm, '<hr>');
  // Paragraphs
  out = out.replace(/\n\n/g, '</p><p>');
  out = '<p>' + out + '</p>';
  // Clean up paragraphs around block-level tags
  out = out.replace(/<p>(<(?:h[1-3]|pre|blockquote|li|hr)[^>]*>)/g, '$1');
  out = out.replace(/(<\/(?:h[1-3]|pre|blockquote|li)>)<\/p>/g, '$1');
  out = out.replace(/<p>(<hr>)<\/p>/g, '$1');
  return out;
}

// ─── Severity / Status helpers ───────────────────────────────────────────────

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, warning: 3, low: 4, info: 5 };

function severityColor(sev) {
  switch ((sev ?? '').toLowerCase()) {
    case 'critical': return 'var(--red)';
    case 'high':     return 'var(--orange)';
    case 'warning':
    case 'medium':   return 'var(--yellow)';
    case 'info':     return 'var(--accent)';
    default:         return 'var(--text-muted)';
  }
}

function severityBg(sev) {
  switch ((sev ?? '').toLowerCase()) {
    case 'critical': return 'var(--red-dim)';
    case 'high':     return 'var(--orange-dim)';
    case 'warning':
    case 'medium':   return 'var(--yellow-dim)';
    case 'info':     return 'var(--accent-dim)';
    default:         return 'var(--surface-3)';
  }
}

function statusColor(s) {
  switch ((s ?? '').toLowerCase()) {
    case 'pending':           return 'var(--text-muted)';
    case 'planning':          return 'var(--yellow)';
    case 'awaiting_approval': return 'var(--orange)';
    case 'executing':
    case 'building':          return 'var(--accent)';
    case 'completed':
    case 'complete':
    case 'approved':          return 'var(--green)';
    case 'failed':            return 'var(--red)';
    case 'testing':           return 'var(--purple)';
    case 'planned':           return 'var(--blue)';
    case 'scheduled':         return 'var(--blue)';
    case 'requested':         return 'var(--text-muted)';
    default:                  return 'var(--text-muted)';
  }
}

function statusBg(s) {
  switch ((s ?? '').toLowerCase()) {
    case 'planning':          return 'var(--yellow-dim)';
    case 'awaiting_approval': return 'var(--orange-dim)';
    case 'executing':
    case 'building':          return 'var(--accent-dim)';
    case 'completed':
    case 'complete':
    case 'approved':          return 'var(--green-dim)';
    case 'failed':            return 'var(--red-dim)';
    case 'testing':           return 'var(--purple-dim)';
    case 'planned':           return 'var(--blue-dim)';
    case 'scheduled':         return 'var(--blue-dim)';
    default:                  return 'var(--surface-3)';
  }
}

function priorityColor(p) {
  switch ((p ?? '').toLowerCase()) {
    case 'high':   return 'var(--red)';
    case 'medium': return 'var(--yellow)';
    default:       return 'var(--text-muted)';
  }
}

function priorityBg(p) {
  switch ((p ?? '').toLowerCase()) {
    case 'high':   return 'var(--red-dim)';
    case 'medium': return 'var(--yellow-dim)';
    default:       return 'var(--surface-3)';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

class PageTools extends LitElement {
  static properties = {
    _activeTab: { type: String, state: true },

    // QA Audit
    _qaRunning:           { type: Boolean, state: true },
    _qaOutput:            { type: String,  state: true },
    _qaReport:            { type: Object,  state: true },
    _qaReports:           { type: Array,   state: true },
    _qaReportsLoading:    { type: Boolean, state: true },
    _qaSelectedFindings:  { type: Object,  state: true },
    _qaFilter:            { type: String,  state: true },
    _qaFilterCat:         { type: String,  state: true },
    _qaEditingId:         { type: String,  state: true },
    _qaEditValues:        { type: Object,  state: true },
    _qaFixRunning:        { type: Boolean, state: true },
    _qaFixOutput:         { type: String,  state: true },

    // Security Audit
    _secRunning:          { type: Boolean, state: true },
    _secOutput:           { type: String,  state: true },
    _secReport:           { type: Object,  state: true },
    _secReports:          { type: Array,   state: true },
    _secReportsLoading:   { type: Boolean, state: true },
    _secSelectedFindings: { type: Object,  state: true },
    _secFilter:           { type: String,  state: true },
    _secFixRunning:       { type: Boolean, state: true },
    _secFixOutput:        { type: String,  state: true },

    // Unified Tasks (merged TODOs + Features)
    _tasks:               { type: Array,   state: true },
    _tasksLoading:        { type: Boolean, state: true },
    _taskFormOpen:        { type: Boolean, state: true },
    _taskForm:            { type: Object,  state: true },
    _taskSubmitting:      { type: Boolean, state: true },
    _taskEditId:          { type: String,  state: true },
    _taskEditForm:        { type: Object,  state: true },
    _taskDeleteConfirmId: { type: String,  state: true },
    _taskDetailId:        { type: String,  state: true },
    _taskFilterStatus:    { type: String,  state: true },
    _taskFilterPriority:  { type: String,  state: true },
    _taskFilterType:      { type: String,  state: true },
    _taskSearch:          { type: String,  state: true },
    _taskProgressId:      { type: String,  state: true },
    _taskProgressOut:     { type: String,  state: true },

    // Ops Check
    _opsRunning:          { type: Boolean, state: true },
    _opsOutput:           { type: String,  state: true },

    // Planning workflow
    _taskPlanProgressId:  { type: String,  state: true },
    _taskPlanProgressOut: { type: String,  state: true },
    _taskScheduleId:      { type: String,  state: true },
    _taskScheduleTime:    { type: String,  state: true },
    _taskRunPostOp:       { type: Boolean, state: true },
  };

  constructor() {
    super();
    this._activeTab = 'tasks';

    this._qaRunning = false;
    this._qaOutput = '';
    this._qaReport = null;
    this._qaReports = [];
    this._qaReportsLoading = false;
    this._qaSelectedFindings = {};
    this._qaFilter = 'all';
    this._qaFilterCat = 'all';
    this._qaEditingId = null;
    this._qaEditValues = {};
    this._qaFixRunning = false;
    this._qaFixOutput = '';

    this._secRunning = false;
    this._secOutput = '';
    this._secReport = null;
    this._secReports = [];
    this._secReportsLoading = false;
    this._secSelectedFindings = {};
    this._secFilter = 'all';
    this._secFixRunning = false;
    this._secFixOutput = '';

    this._tasks = [];
    this._tasksLoading = false;
    this._taskFormOpen = false;
    this._taskForm = { title: '', description: '', priority: 'medium', type: 'task', context: '' };
    this._taskSubmitting = false;
    this._taskEditId = null;
    this._taskEditForm = {};
    this._taskDeleteConfirmId = null;
    this._taskDetailId = null;
    this._taskFilterStatus = 'active';
    this._taskFilterPriority = 'all';
    this._taskFilterType = 'all';
    this._taskSearch = '';
    this._taskProgressId = null;
    this._taskProgressOut = '';
    this._opsRunning = false;
    this._opsOutput = '';

    this._taskPlanProgressId = null;
    this._taskPlanProgressOut = '';
    this._taskScheduleId = null;
    this._taskScheduleTime = '';
    this._taskRunPostOp = true;

    // Polling timer registry: key -> intervalId
    this._pollers = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadTabData(this._activeTab);
    this._taskTimer = setInterval(() => {
      if (this._activeTab === 'tasks') {this._loadTasks();}
    }, 30_000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._taskTimer);
    Object.values(this._pollers).forEach(id => clearInterval(id));
  }

  _setTab(tab) {
    this._activeTab = tab;
    this._loadTabData(tab);
  }

  _loadTabData(tab) {
    if (tab === 'qa')            {this._loadQaReports();}
    else if (tab === 'security') {this._loadSecReports();}
    else if (tab === 'tasks')    {this._loadTasks();}
    else if (tab === 'ops')      {this._loadOpsStatus();}
  }

  async _loadOpsStatus() {
    try {
      const data = await api.get('/api/ops/status');
      if (data?.status === 'running') {
        this._opsRunning = true;
        this._opsOutput = data.output || '';
      } else if (data?.status !== 'idle') {
        this._opsOutput = data?.output || '';
      }
    } catch { /* ignore */ }
  }

  // ─── Poll helper ────────────────────────────────────────────────────────

  _startPoll(key, intervalMs, fn) {
    clearInterval(this._pollers[key]);
    this._pollers[key] = setInterval(fn, intervalMs);
  }

  _stopPoll(key) {
    clearInterval(this._pollers[key]);
    delete this._pollers[key];
  }

  // ─── QA Audit ───────────────────────────────────────────────────────────

  async _loadQaReports() {
    this._qaReportsLoading = true;
    try {
      const data = await api.get('/api/audit/qa/reports');
      this._qaReports = Array.isArray(data) ? data : (data?.reports ?? []);
      if (this._qaReports.length && !this._qaReport) {
        const latest = this._qaReports[0];
        if (latest?.findings) {this._qaReport = latest;}
      }
    } finally {
      this._qaReportsLoading = false;
    }
  }

  async _runQaAudit() {
    this._qaRunning = true;
    this._qaOutput = '';
    this._qaReport = null;
    try {
      await api.post('/api/audit/qa/trigger');
    } catch (e) {
      this._qaOutput = `Error: ${e?.message ?? 'Failed to start audit'}`;
      this._qaRunning = false;
      return;
    }
    this._startPoll('qa-run', 2000, async () => {
      try {
        const data = await api.get('/api/audit/qa/status');
        if (data?.output) {this._qaOutput = data.output;}
        const st = data?.status ?? '';
        if (st === 'complete' || st === 'done') {
          this._stopPoll('qa-run');
          this._qaRunning = false;
          if (data.report) {this._qaReport = data.report;}
          else {await this._loadQaReports();}
        } else if (st === 'error' || st === 'failed') {
          this._stopPoll('qa-run');
          this._qaRunning = false;
          this._qaOutput += '\n[Audit failed]';
        }
      } catch { /* keep polling */ }
    });
  }

  async _qaApproveAndFix() {
    const ids = Object.keys(this._qaSelectedFindings).filter(id => this._qaSelectedFindings[id]);
    if (!ids.length) {return;}
    const reportId = this._qaReport?.id;
    if (reportId) {
      await api.put(`/api/audit/qa/reports/${reportId}/approve`, { findingIds: ids });
    }
    await this._runQaFix();
  }

  async _qaApproveAutoFixable() {
    const ids = (this._qaReport?.findings ?? []).filter(f => f.autoFixable).map(f => f.id);
    if (!ids.length) {return;}
    this._qaSelectedFindings = Object.fromEntries(ids.map(id => [id, true]));
    await this._runQaFix();
  }

  async _runQaFix() {
    this._qaFixRunning = true;
    this._qaFixOutput = '';
    try {
      await api.post('/api/audit/qa/fix');
    } catch (e) {
      this._qaFixOutput = `Error: ${e?.message ?? 'Fix failed'}`;
      this._qaFixRunning = false;
      return;
    }
    this._startPoll('qa-fix', 2000, async () => {
      try {
        const data = await api.get('/api/audit/qa/status');
        if (data?.fixOutput) {this._qaFixOutput = data.fixOutput;}
        const st = data?.fixStatus ?? '';
        if (st === 'complete' || st === 'done') {
          this._stopPoll('qa-fix');
          this._qaFixRunning = false;
          await this._loadQaReports();
        } else if (st === 'error') {
          this._stopPoll('qa-fix');
          this._qaFixRunning = false;
        }
      } catch { /* keep polling */ }
    });
  }

  get _qaFiltered() {
    const findings = this._qaReport?.findings ?? [];
    return findings
      .filter(f => {
        if (this._qaFilter !== 'all' && (f.severity ?? '').toLowerCase() !== this._qaFilter) {return false;}
        if (this._qaFilterCat !== 'all' && f.category !== this._qaFilterCat) {return false;}
        return true;
      })
      .toSorted((a, b) =>
        (SEVERITY_ORDER[(a.severity ?? '').toLowerCase()] ?? 9) -
        (SEVERITY_ORDER[(b.severity ?? '').toLowerCase()] ?? 9)
      );
  }

  get _qaCategories() {
    return [...new Set((this._qaReport?.findings ?? []).map(f => f.category).filter(Boolean))];
  }

  // ─── Security Audit ──────────────────────────────────────────────────────

  async _loadSecReports() {
    this._secReportsLoading = true;
    try {
      const data = await api.get('/api/audit/security/reports');
      this._secReports = Array.isArray(data) ? data : (data?.reports ?? []);
      if (this._secReports.length && !this._secReport) {
        const latest = this._secReports[0];
        if (latest?.findings) {this._secReport = latest;}
      }
    } finally {
      this._secReportsLoading = false;
    }
  }

  async _runSecAudit() {
    this._secRunning = true;
    this._secOutput = '';
    this._secReport = null;
    try {
      await api.post('/api/audit/security/trigger');
    } catch (e) {
      this._secOutput = `Error: ${e?.message ?? 'Failed to start audit'}`;
      this._secRunning = false;
      return;
    }
    this._startPoll('sec-run', 2000, async () => {
      try {
        const data = await api.get('/api/audit/security/status');
        if (data?.output) {this._secOutput = data.output;}
        const st = data?.status ?? '';
        if (st === 'complete' || st === 'done') {
          this._stopPoll('sec-run');
          this._secRunning = false;
          if (data.report) {this._secReport = data.report;}
          else {await this._loadSecReports();}
        } else if (st === 'error' || st === 'failed') {
          this._stopPoll('sec-run');
          this._secRunning = false;
          this._secOutput += '\n[Audit failed]';
        }
      } catch { /* keep polling */ }
    });
  }

  async _secApproveAndFix() {
    const ids = Object.keys(this._secSelectedFindings).filter(id => this._secSelectedFindings[id]);
    if (!ids.length) {return;}
    const reportId = this._secReport?.id;
    if (reportId) {
      await api.put(`/api/audit/security/reports/${reportId}/approve`, { findingIds: ids });
    }
    this._secFixRunning = true;
    this._secFixOutput = '';
    try {
      await api.post('/api/audit/security/fix');
    } catch (e) {
      this._secFixOutput = `Error: ${e?.message ?? 'Fix failed'}`;
      this._secFixRunning = false;
      return;
    }
    this._startPoll('sec-fix', 2000, async () => {
      try {
        const data = await api.get('/api/audit/security/status');
        if (data?.fixOutput) {this._secFixOutput = data.fixOutput;}
        const st = data?.fixStatus ?? '';
        if (st === 'complete' || st === 'error') {
          this._stopPoll('sec-fix');
          this._secFixRunning = false;
          if (st === 'complete') {await this._loadSecReports();}
        }
      } catch { /* keep polling */ }
    });
  }

  get _secFiltered() {
    return (this._secReport?.findings ?? [])
      .filter(f => this._secFilter === 'all' || (f.severity ?? f.risk ?? '').toLowerCase() === this._secFilter)
      .toSorted((a, b) =>
        (SEVERITY_ORDER[(a.severity ?? a.risk ?? '').toLowerCase()] ?? 9) -
        (SEVERITY_ORDER[(b.severity ?? b.risk ?? '').toLowerCase()] ?? 9)
      );
  }

  // ─── Unified Tasks (TODOs + Features merged) ────────────────────────────

  async _loadTasks() {
    this._tasksLoading = true;
    try {
      const [todosData, featuresData] = await Promise.all([
        api.get('/api/todos'),
        api.get('/api/features'),
      ]);
      const todos = (Array.isArray(todosData) ? todosData : (todosData?.todos ?? [])).map(t => ({
        ...t,
        _source: 'todo',
        _type: t._type || 'task',
        _sortDate: t.created_at || t.createdAt || '',
      }));
      const features = (Array.isArray(featuresData) ? featuresData : (featuresData?.features ?? [])).map(f => ({
        ...f,
        _source: 'feature',
        _type: 'feature',
        _sortDate: f.createdAt || f.created_at || '',
      }));
      // Merge and sort by creation date (newest first)
      const merged = [...todos, ...features].toSorted((a, b) =>
        new Date(b._sortDate || 0).getTime() - new Date(a._sortDate || 0).getTime()
      );

      // Deduplicate: if a todo and feature have nearly identical titles, keep the feature
      const titleMap = new Map();
      const deduped = [];
      for (const t of merged) {
        const normTitle = (t.title ?? '').trim().toLowerCase();
        if (!normTitle) { deduped.push(t); continue; }
        const existing = titleMap.get(normTitle);
        if (!existing) {
          titleMap.set(normTitle, t);
          deduped.push(t);
        } else if (t._source === 'feature' && existing._source === 'todo') {
          // Replace the todo with the feature (richer lifecycle)
          const idx = deduped.indexOf(existing);
          if (idx >= 0) {deduped[idx] = t;}
          titleMap.set(normTitle, t);
        }
        // Otherwise keep existing (first one wins)
      }
      this._tasks = deduped;
    } finally {
      this._tasksLoading = false;
    }
  }

  async _createTask() {
    if (!this._taskForm.title.trim()) {return;}
    this._taskSubmitting = true;
    try {
      const taskType = this._taskForm.type || 'task';
      if (taskType === 'feature') {
        // Create as a feature request
        const created = await api.post('/api/features', {
          title: this._taskForm.title,
          description: this._taskForm.description,
          priority: this._taskForm.priority,
        });
        if (created) {
          this._tasks = [{ ...created, _source: 'feature', _type: 'feature', _sortDate: created.createdAt || '' }, ...this._tasks];
        }
      } else {
        // Create as a todo (task or bug)
        const created = await api.post('/api/todos', {
          title: this._taskForm.title,
          description: this._taskForm.description,
          priority: this._taskForm.priority,
          context: this._taskForm.context,
        });
        if (created) {
          // Mark the type on the todo via context prefix if bug
          const item = { ...created, _source: 'todo', _type: taskType, _sortDate: created.created_at || '' };
          this._tasks = [item, ...this._tasks];
        }
      }
      this._taskForm = { title: '', description: '', priority: 'medium', type: 'task', context: '' };
      this._taskFormOpen = false;
    } finally {
      this._taskSubmitting = false;
    }
  }

  _updateTaskLocal(id, patch) {
    this._tasks = this._tasks.map(t => t.id === id ? { ...t, ...patch } : t);
  }

  // --- TODO-type actions ---

  async _saveTask() {
    if (!this._taskEditId) {return;}
    const task = this._tasks.find(t => t.id === this._taskEditId);
    if (!task) {return;}
    try {
      if (task._source === 'feature') {
        const updated = await api.put(`/api/features/${this._taskEditId}`, this._taskEditForm);
        if (updated) {this._updateTaskLocal(this._taskEditId, updated);}
      } else {
        const updated = await api.patch(`/api/todos/${this._taskEditId}`, this._taskEditForm);
        this._updateTaskLocal(this._taskEditId, updated ?? this._taskEditForm);
      }
      this._taskEditId = null;
      this._taskEditForm = {};
    } catch { /* toast */ }
  }

  async _deleteTask(id) {
    const task = this._tasks.find(t => t.id === id);
    if (!task) {return;}
    try {
      if (task._source === 'feature') {
        // Features API doesn't have delete yet -- update status to rejected
        await api.put(`/api/features/${id}/reject`, { reason: 'Deleted from dashboard' });
      } else {
        await api.del(`/api/todos/${id}`);
      }
      this._tasks = this._tasks.filter(t => t.id !== id);
      this._taskDeleteConfirmId = null;
    } catch { /* toast */ }
  }

  _openEditTask(task) {
    this._taskEditId = task.id;
    if (task._source === 'feature') {
      this._taskEditForm = {
        title:       task.title       ?? '',
        description: task.description ?? '',
        priority:    task.priority    ?? 'medium',
        status:      task.status      ?? 'pending',
      };
    } else {
      this._taskEditForm = {
        title:       task.title       ?? '',
        description: task.description ?? '',
        priority:    task.priority    ?? 'medium',
        context:     task.context     ?? '',
        status:      task.status      ?? 'pending',
      };
    }
  }

  // --- Feature-type actions ---

  async _generatePlan(feat) {
    this._updateTaskLocal(feat.id, { status: 'Planning' });
    try {
      const updated = await api.post(`/api/features/${feat.id}/plan`);
      this._updateTaskLocal(feat.id, updated ?? { status: 'Planned' });
    } catch {
      this._updateTaskLocal(feat.id, { status: 'Requested' });
    }
  }

  async _approveFeature(feat) {
    try {
      const updated = await api.put(`/api/features/${feat.id}/approve`);
      this._updateTaskLocal(feat.id, updated ?? { status: 'Approved' });
    } catch { /* toast shown by api */ }
  }

  async _rejectFeature(feat) {
    this._updateTaskLocal(feat.id, { status: 'Requested', plan: null });
    await api.put(`/api/features/${feat.id}/reject`).catch(() => {});
  }

  async _executeFeature(feat) {
    this._taskProgressId = feat.id;
    this._taskProgressOut = '';
    this._updateTaskLocal(feat.id, { status: 'Building' });
    try {
      await api.post(`/api/features/${feat.id}/execute`);
    } catch (e) {
      this._taskProgressOut = `Error: ${e?.message ?? 'Execution failed'}`;
      this._taskProgressId = null;
      this._updateTaskLocal(feat.id, { status: 'Approved' });
      return;
    }
    this._startPoll(`feat-${feat.id}`, 2000, async () => {
      try {
        const data = await api.get(`/api/features/${feat.id}/progress`);
        if (data?.output) {this._taskProgressOut = data.output;}
        const st = data?.status ?? '';
        if (st === 'Testing' || st === 'Complete' || st === 'complete') {
          this._stopPoll(`feat-${feat.id}`);
          this._taskProgressId = null;
          this._updateTaskLocal(feat.id, { status: st === 'complete' ? 'Complete' : st });
        } else if (st === 'error' || st === 'failed') {
          this._stopPoll(`feat-${feat.id}`);
          this._taskProgressId = null;
          await this._loadTasks();
        }
      } catch { /* keep polling */ }
    });
  }

  async _markComplete(feat) {
    try {
      const updated = await api.put(`/api/features/${feat.id}/complete`);
      this._updateTaskLocal(feat.id, updated ?? { status: 'Complete' });
    } catch { /* toast */ }
  }

  async _reportIssues(feat) {
    try {
      const updated = await api.put(`/api/features/${feat.id}/issues`, { notes: 'Issues found during testing' });
      this._updateTaskLocal(feat.id, updated ?? { status: 'Building' });
    } catch { /* toast */ }
  }

  async _executeTodo(todo) {
    this._taskProgressId = todo.id;
    this._taskProgressOut = '';
    this._updateTaskLocal(todo.id, { status: 'executing' });
    try {
      await api.post(`/api/todos/${todo.id}/execute`);
    } catch (e) {
      this._taskProgressOut = `Error: ${e?.message ?? 'Execution failed'}`;
      this._taskProgressId = null;
      this._updateTaskLocal(todo.id, { status: 'pending' });
      return;
    }
    this._startPoll(`todo-${todo.id}`, 2000, async () => {
      try {
        const data = await api.get(`/api/todos/${todo.id}/progress`);
        if (data?.output) {this._taskProgressOut = data.output;}
        const st = data?.status ?? '';
        if (st === 'idle') {
          this._stopPoll(`todo-${todo.id}`);
          this._taskProgressId = null;
          await this._loadTasks();
        }
      } catch { /* keep polling */ }
    });
  }

  async _runOpsCheck() {
    this._opsRunning = true;
    this._opsOutput = '';
    try {
      await api.post('/api/ops/trigger');
    } catch (e) {
      this._opsOutput = `Error: ${e?.message ?? 'Failed to start ops check'}`;
      this._opsRunning = false;
      return;
    }
    this._startPoll('ops-run', 2000, async () => {
      try {
        const data = await api.get('/api/ops/status');
        if (data?.output) {this._opsOutput = data.output;}
        const st = data?.status ?? '';
        if (st === 'complete' || st === 'done') {
          this._stopPoll('ops-run');
          this._opsRunning = false;
        } else if (st === 'failed' || st === 'error') {
          this._stopPoll('ops-run');
          this._opsRunning = false;
          this._opsOutput += '\n[Ops check failed]';
        }
      } catch { /* keep polling */ }
    });
  }

  // ─── Planning Workflow (TODOs) ──────────────────────────────────────────

  async _planTask(todo) {
    this._taskPlanProgressId = todo.id;
    this._taskPlanProgressOut = '';
    this._updateTaskLocal(todo.id, { status: 'planning', approval_status: 'pending_plan' });
    try {
      await api.post(`/api/todos/${todo.id}/plan`);
    } catch (e) {
      this._taskPlanProgressOut = `Error: ${e?.message ?? 'Failed to start planning'}`;
      this._taskPlanProgressId = null;
      this._updateTaskLocal(todo.id, { status: 'pending' });
      return;
    }
    this._startPoll(`plan-${todo.id}`, 2000, async () => {
      try {
        const data = await api.get(`/api/todos/${todo.id}/plan-progress`);
        if (data?.output) {this._taskPlanProgressOut = data.output;}
        const st = data?.status ?? '';
        if (st === 'idle' || st === 'complete') {
          this._stopPoll(`plan-${todo.id}`);
          this._taskPlanProgressId = null;
          await this._loadTasks();
        } else if (st === 'error' || st === 'failed') {
          this._stopPoll(`plan-${todo.id}`);
          this._taskPlanProgressId = null;
          this._taskPlanProgressOut += '\n[Planning failed]';
          await this._loadTasks();
        }
      } catch { /* keep polling */ }
    });
  }

  async _approveTask(todo, action) {
    const body = { action };
    if (action === 'approve_schedule' && this._taskScheduleTime) {
      body.scheduled_time = new Date(this._taskScheduleTime).toISOString();
    }
    body.run_post_op = this._taskRunPostOp;
    try {
      const updated = await api.post(`/api/todos/${todo.id}/approve`, body);
      this._updateTaskLocal(todo.id, updated ?? {});
      this._taskScheduleId = null;
      this._taskScheduleTime = '';
      if (action === 'approve') {
        this._executeTodo(todo);
      }
    } catch { /* toast */ }
  }

  async _replanTask(todo) {
    try {
      await api.post(`/api/todos/${todo.id}/replan`);
      this._updateTaskLocal(todo.id, { status: 'pending', execution_plan: null, approval_status: null });
      this._planTask(todo);
    } catch { /* toast */ }
  }

  async _generateAuditTasks(type) {
    const report = type === 'qa' ? this._qaReport : this._secReport;
    const selected = type === 'qa' ? this._qaSelectedFindings : this._secSelectedFindings;
    if (!report) {return;}
    const findingIds = Object.keys(selected).filter(id => selected[id]);
    if (!findingIds.length) {
      if (typeof window.__oasisToast === 'function') {window.__oasisToast('Select findings first', 'error');}
      return;
    }
    try {
      const result = await api.post(`/api/audit/${type}/generate-tasks`, {
        reportId: report.id,
        findingIds,
      });
      if (typeof window.__oasisToast === 'function') {
        window.__oasisToast(`Created ${result?.created ?? findingIds.length} tasks`, 'ok');
      }
      await this._loadTasks();
    } catch (e) {
      if (typeof window.__oasisToast === 'function') {window.__oasisToast('Failed: ' + (e?.message || 'error'), 'error');}
    }
  }

  get _taskDetail() {
    return this._tasks.find(t => t.id === this._taskDetailId) ?? null;
  }

  get _filteredTasks() {
    return this._tasks.filter(t => {
      // Type filter
      if (this._taskFilterType !== 'all') {
        const type = t._type || (t._source === 'feature' ? 'feature' : 'task');
        if (type !== this._taskFilterType) {return false;}
      }
      // Status filter
      if (this._taskFilterStatus === 'active') {
        const status = (t.status ?? '').toLowerCase();
        if (status === 'completed' || status === 'complete' || status === 'failed') {return false;}
      } else if (this._taskFilterStatus !== 'all') {
        const status = (t.status ?? '').toLowerCase();
        if (status !== this._taskFilterStatus) {return false;}
      }
      // Priority filter
      if (this._taskFilterPriority !== 'all' && t.priority !== this._taskFilterPriority) {return false;}
      // Search
      if (this._taskSearch.trim()) {
        const q = this._taskSearch.toLowerCase();
        if (!(t.title ?? '').toLowerCase().includes(q) &&
            !(t.description ?? '').toLowerCase().includes(q)) {return false;}
      }
      return true;
    });
  }

  // ─── Top-level Render ────────────────────────────────────────────────────

  render() {
    const tabs = [
      { id: 'tasks',    label: 'Tasks'          },
      { id: 'ops',      label: 'Ops Check'      },
      { id: 'qa',       label: 'QA Audit'       },
      { id: 'security', label: 'Security Audit' },
    ];
    return html`
      <div class="page-tools">
        <div class="page-header">
          <h1 class="page-title">Tools</h1>
          <div class="tab-bar">
            ${tabs.map(t => html`
              <button class="tab-btn ${this._activeTab === t.id ? 'active' : ''}"
                @click=${() => this._setTab(t.id)}>
                ${t.label}
              </button>
            `)}
          </div>
        </div>

        <div class="tab-content">
          ${this._activeTab === 'tasks'    ? this._renderTasks()    : ''}
          ${this._activeTab === 'ops'      ? this._renderOpsCheck() : ''}
          ${this._activeTab === 'qa'       ? this._renderQaAudit()  : ''}
          ${this._activeTab === 'security' ? this._renderSecAudit() : ''}
        </div>

        ${this._taskDetailId ? this._renderTaskDetailModal() : ''}
        ${this._taskEditId   ? this._renderTaskEditModal()   : ''}
      </div>
    `;
  }

  // ─── QA Audit Tab ────────────────────────────────────────────────────────

  _renderQaAudit() {
    return html`
      <div class="audit-tab">
        <div class="trigger-card">
          <div class="trigger-content">
            <div class="trigger-icon">🛡️</div>
            <div class="trigger-info">
              <div class="trigger-title">Quality Audit</div>
              <div class="trigger-desc">
                Runs a comprehensive system quality audit using Claude Code with Bypass Permissions.
              </div>
            </div>
            <button class="btn btn-primary trigger-btn"
              ?disabled=${this._qaRunning}
              @click=${() => this._runQaAudit()}>
              ${this._qaRunning ? html`<span class="spin"></span> Running…` : '▶ Run QA Audit'}
            </button>
          </div>
          ${(this._qaRunning || this._qaOutput) ? html`
            <div class="output-panel">
              <pre class="output-pre">${this._qaOutput || 'Starting audit…'}</pre>
            </div>
          ` : ''}
        </div>

        ${(this._qaFixRunning || this._qaFixOutput) ? html`
          <div class="trigger-card">
            <div class="section-hdr">Fix Progress</div>
            <div class="output-panel">
              <pre class="output-pre">${this._qaFixOutput || 'Applying fixes…'}</pre>
            </div>
          </div>
        ` : ''}

        ${this._qaReport ? this._renderAuditReport({
          report:    this._qaReport,
          findings:  this._qaFiltered,
          cats:      this._qaCategories,
          filter:    this._qaFilter,
          filterCat: this._qaFilterCat,
          selected:  this._qaSelectedFindings,
          editingId: this._qaEditingId,
          editVals:  this._qaEditValues,
          isSec:     false,
          setFilter:    f  => { this._qaFilter = f; },
          setFilterCat: c  => { this._qaFilterCat = c; },
          setSelected:  (id, v) => { this._qaSelectedFindings = { ...this._qaSelectedFindings, [id]: v }; },
          toggleEdit:   id => { this._qaEditingId = this._qaEditingId === id ? null : id; },
          setEditVal:   (id, k, v) => { this._qaEditValues = { ...this._qaEditValues, [id]: { ...this._qaEditValues[id], [k]: v } }; },
          onFix:        () => this._qaApproveAndFix(),
          onAutoFix:    () => this._qaApproveAutoFixable(),
        }) : ''}

        ${this._renderReportHistory(this._qaReports, this._qaReportsLoading,
          r => { this._qaReport = r; this._qaSelectedFindings = {}; this._qaFilter = 'all'; this._qaFilterCat = 'all'; }
        )}
      </div>
    `;
  }

  // ─── Security Audit Tab ──────────────────────────────────────────────────

  _renderSecAudit() {
    return html`
      <div class="audit-tab">
        <div class="trigger-card">
          <div class="trigger-content">
            <div class="trigger-icon">🔒</div>
            <div class="trigger-info">
              <div class="trigger-title">Security Audit</div>
              <div class="trigger-desc">
                Runs a comprehensive security audit with OWASP analysis and vulnerability scanning.
              </div>
            </div>
            <button class="btn btn-primary trigger-btn"
              ?disabled=${this._secRunning}
              @click=${() => this._runSecAudit()}>
              ${this._secRunning ? html`<span class="spin"></span> Running…` : '▶ Run Security Audit'}
            </button>
          </div>
          ${(this._secRunning || this._secOutput) ? html`
            <div class="output-panel">
              <pre class="output-pre">${this._secOutput || 'Starting security audit…'}</pre>
            </div>
          ` : ''}
        </div>

        ${(this._secFixRunning || this._secFixOutput) ? html`
          <div class="trigger-card">
            <div class="section-hdr">Fix Progress</div>
            <div class="output-panel">
              <pre class="output-pre">${this._secFixOutput || 'Applying security fixes…'}</pre>
            </div>
          </div>
        ` : ''}

        ${this._secReport ? this._renderAuditReport({
          report:    this._secReport,
          findings:  this._secFiltered,
          cats:      [],
          filter:    this._secFilter,
          filterCat: 'all',
          selected:  this._secSelectedFindings,
          editingId: null,
          editVals:  {},
          isSec:     true,
          setFilter:    f  => { this._secFilter = f; },
          setFilterCat: () => {},
          setSelected:  (id, v) => { this._secSelectedFindings = { ...this._secSelectedFindings, [id]: v }; },
          toggleEdit:   () => {},
          setEditVal:   () => {},
          onFix:        () => this._secApproveAndFix(),
          onAutoFix:    () => {},
        }) : ''}

        ${this._renderReportHistory(this._secReports, this._secReportsLoading,
          r => { this._secReport = r; this._secSelectedFindings = {}; this._secFilter = 'all'; }
        )}
      </div>
    `;
  }

  // ─── Shared Audit Report Renderer ───────────────────────────────────────

  _renderAuditReport({ report, findings, cats, filter, filterCat, selected, editingId, editVals,
    isSec, setFilter, setFilterCat, setSelected, toggleEdit, setEditVal, onFix, onAutoFix }) {
    const all = report.findings ?? [];
    const critical   = all.filter(f => ['critical','high'].includes((f.severity ?? f.risk ?? '').toLowerCase())).length;
    const warnings   = all.filter(f => ['warning','medium'].includes((f.severity ?? f.risk ?? '').toLowerCase())).length;
    const info       = all.filter(f => (f.severity ?? '').toLowerCase() === 'info').length;
    const autoFixable = all.filter(f => f.autoFixable).length;
    const selectedIds = Object.keys(selected).filter(id => selected[id]);

    return html`
      <div class="report-card">
        <!-- Summary bar -->
        <div class="report-summary-bar">
          ${this._badge(critical,   'Critical',     'var(--red)',    'var(--red-dim)')}
          ${this._badge(warnings,   'Warnings',     'var(--yellow)', 'var(--yellow-dim)')}
          ${this._badge(info,       'Info',         'var(--accent)', 'var(--accent-dim)')}
          ${this._badge(autoFixable,'Auto-fixable', 'var(--green)',  'var(--green-dim)')}
          <div class="report-actions">
            <button class="btn btn-sm"
              ?disabled=${selectedIds.length === 0}
              @click=${() => onFix()}>
              Approve Selected &amp; Fix (${selectedIds.length})
            </button>
            ${autoFixable > 0 ? html`
              <button class="btn btn-sm btn-green" @click=${() => onAutoFix()}>
                Approve All Auto-fixable
              </button>
            ` : ''}
            <button class="btn btn-sm"
              ?disabled=${selectedIds.length === 0}
              @click=${() => this._generateAuditTasks(isSec ? 'security' : 'qa')}
              title="Create tasks from selected findings">
              Create Tasks (${selectedIds.length})
            </button>
          </div>
        </div>

        <!-- Filters -->
        <div class="filter-row">
          <span class="filter-label">Severity:</span>
          ${['all','critical','high','warning','info'].map(s => html`
            <button class="filter-btn ${filter === s ? 'active' : ''}" @click=${() => setFilter(s)}>
              ${s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          `)}
          ${cats.length > 0 ? html`
            <span class="filter-label" style="margin-left:var(--space-4)">Category:</span>
            <select class="input filter-select" .value=${filterCat} @change=${e => setFilterCat(e.target.value)}>
              <option value="all">All</option>
              ${cats.map(c => html`<option value="${c}">${c}</option>`)}
            </select>
          ` : ''}
        </div>

        <!-- Findings list -->
        <div class="findings-list">
          ${findings.length === 0
            ? html`<div class="empty-state">No findings match the filter.</div>`
            : findings.map(f => this._renderFinding(f, selected, editingId, editVals,
                isSec, setSelected, toggleEdit, setEditVal))}
        </div>
      </div>
    `;
  }

  _badge(count, label, color, bg) {
    return html`
      <div class="count-badge" style="background:${bg};border-color:${color}">
        <span class="count-num" style="color:${color}">${count}</span>
        <span class="count-label" style="color:${color}">${label}</span>
      </div>
    `;
  }

  _renderFinding(f, selected, editingId, editVals, isSec, setSelected, toggleEdit, setEditVal) {
    const sev     = f.severity ?? f.risk ?? 'info';
    const fColor  = severityColor(sev);
    const fBg     = severityBg(sev);
    const isEditing = editingId === f.id;
    const ev = editVals[f.id] ?? {};

    return html`
      <div class="finding-card" style="border-left:3px solid ${fColor}">
        <div class="finding-header">
          <label class="check-wrap">
            <input type="checkbox" .checked=${selected[f.id] ?? false}
              @change=${e => setSelected(f.id, e.target.checked)} />
          </label>
          <span class="badge" style="background:${fBg};color:${fColor}">${sev}</span>
          ${f.category ? html`<span class="badge badge-gray">${f.category}</span>` : ''}
          ${f.autoFixable ? html`<span class="badge badge-green">Auto-fixable</span>` : ''}
          ${isSec && f.owaspCategory ? html`<span class="badge badge-orange">${f.owaspCategory}</span>` : ''}
          <div class="finding-title">${isEditing ? (ev.title ?? f.title ?? f.name ?? '') : (f.title ?? f.name ?? '')}</div>
          <button class="btn btn-sm" @click=${() => toggleEdit(f.id)}>
            ${isEditing ? 'Done' : 'Edit'}
          </button>
        </div>

        ${isEditing ? html`
          <div class="finding-edit">
            <input class="input" type="text" placeholder="Title"
              .value=${ev.title ?? f.title ?? ''}
              @input=${e => setEditVal(f.id, 'title', e.target.value)} />
            <textarea class="input finding-ta" placeholder="Description"
              .value=${ev.description ?? f.description ?? ''}
              @input=${e => setEditVal(f.id, 'description', e.target.value)}></textarea>
            <textarea class="input finding-ta" placeholder="Suggested fix"
              .value=${ev.suggestedFix ?? f.suggestedFix ?? f.fix ?? ''}
              @input=${e => setEditVal(f.id, 'suggestedFix', e.target.value)}></textarea>
          </div>
        ` : html`
          <div class="finding-body">
            <p class="finding-desc">${f.description ?? ''}</p>
            ${f.component ? html`<div class="finding-meta">Component: <span class="mono">${f.component}</span></div>` : ''}
            ${isSec && f.cveRefs?.length ? html`
              <div class="finding-meta">
                CVEs:
                ${f.cveRefs.map(cve => html`
                  <a class="cve-link"
                    href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}"
                    target="_blank" rel="noopener noreferrer">${cve}</a>
                `)}
              </div>
            ` : ''}
            ${isSec && f.remediationSteps ? html`
              <div class="finding-remediation">
                <div class="meta-label">Remediation:</div>
                <div class="markdown-sm" .innerHTML=${renderMarkdown(f.remediationSteps)}></div>
              </div>
            ` : ''}
            ${(f.suggestedFix ?? f.fix) ? html`
              <div class="finding-fix">
                <div class="meta-label">Suggested Fix:</div>
                <pre class="fix-pre">${f.suggestedFix ?? f.fix}</pre>
              </div>
            ` : ''}
          </div>
        `}
      </div>
    `;
  }

  _renderReportHistory(reports, loading, onSelect) {
    return html`
      <div class="history-card">
        <div class="section-hdr">Report History</div>
        ${loading
          ? html`<div class="loading-msg">Loading…</div>`
          : reports.length === 0
            ? html`<div class="empty-state">No past reports.</div>`
            : html`
              <div class="history-list">
                ${reports.map(r => html`
                  <div class="history-row" @click=${() => onSelect(r)}>
                    <div class="dim">${timeAgo(r.createdAt ?? r.date)}</div>
                    <div class="history-counts">
                      <span style="color:var(--red)">${r.criticalCount ?? 0} crit</span>
                      <span style="color:var(--yellow)">${r.warningCount ?? 0} warn</span>
                      <span style="color:var(--accent)">${r.infoCount ?? 0} info</span>
                    </div>
                    <span class="badge ${r.status === 'complete' ? 'badge-green' : 'badge-yellow'}">
                      ${r.status ?? 'unknown'}
                    </span>
                  </div>
                `)}
              </div>
            `}
      </div>
    `;
  }

  // ─── Unified Tasks Tab ──────────────────────────────────────────────────

  _renderTasks() {
    const tasks = this._filteredTasks;
    const counts = {
      total: this._tasks.length,
      tasks: this._tasks.filter(t => (t._type || 'task') === 'task').length,
      features: this._tasks.filter(t => t._type === 'feature').length,
      bugs: this._tasks.filter(t => t._type === 'bug').length,
    };
    return html`
      <div class="tasks-tab">
        <!-- Create form -->
        <div class="collapsible-card">
          <button class="coll-header" @click=${() => { this._taskFormOpen = !this._taskFormOpen; }}>
            <span>Create New Task</span>
            <span class="toggle-ico">${this._taskFormOpen ? '▼' : '▶'}</span>
          </button>
          ${this._taskFormOpen ? html`
            <div class="coll-body">
              <div class="form-grid">
                <div class="form-field full">
                  <label class="form-label">Title *</label>
                  <input class="input" type="text" placeholder="Task title"
                    .value=${this._taskForm.title}
                    @input=${e => { this._taskForm = { ...this._taskForm, title: e.target.value }; }} />
                </div>
                <div class="form-field full">
                  <label class="form-label">Description</label>
                  <textarea class="input form-ta" placeholder="Description (Markdown supported)…"
                    .value=${this._taskForm.description}
                    @input=${e => { this._taskForm = { ...this._taskForm, description: e.target.value }; }}></textarea>
                </div>
                <div class="form-field">
                  <label class="form-label">Type</label>
                  <select class="input"
                    .value=${this._taskForm.type}
                    @change=${e => { this._taskForm = { ...this._taskForm, type: e.target.value }; }}>
                    <option value="task">Task</option>
                    <option value="feature">Feature</option>
                    <option value="bug">Bug</option>
                  </select>
                </div>
                <div class="form-field">
                  <label class="form-label">Priority</label>
                  <select class="input"
                    .value=${this._taskForm.priority}
                    @change=${e => { this._taskForm = { ...this._taskForm, priority: e.target.value }; }}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                ${this._taskForm.type !== 'feature' ? html`
                  <div class="form-field full">
                    <label class="form-label">Context</label>
                    <input class="input" type="text" placeholder="Context info (optional)"
                      .value=${this._taskForm.context}
                      @input=${e => { this._taskForm = { ...this._taskForm, context: e.target.value }; }} />
                  </div>
                ` : ''}
              </div>
              <button class="btn btn-primary"
                ?disabled=${this._taskSubmitting || !this._taskForm.title.trim()}
                @click=${() => this._createTask()}>
                ${this._taskSubmitting ? 'Creating…' : 'Create Task'}
              </button>
            </div>
          ` : ''}
        </div>

        <!-- Filters -->
        <div class="filter-toolbar">
          <input class="input search-input" type="search" placeholder="Search tasks…"
            .value=${this._taskSearch}
            @input=${e => { this._taskSearch = e.target.value; }} />

          <div class="filter-group">
            <span class="filter-label">Type:</span>
            ${[
              { val: 'all', label: `All (${counts.total})` },
              { val: 'task', label: `Tasks (${counts.tasks})` },
              { val: 'feature', label: `Features (${counts.features})` },
              { val: 'bug', label: `Bugs (${counts.bugs})` },
            ].map(t => html`
              <button class="filter-btn ${this._taskFilterType === t.val ? 'active' : ''}"
                @click=${() => { this._taskFilterType = t.val; }}>
                ${t.label}
              </button>
            `)}
          </div>

          <div class="filter-group">
            <span class="filter-label">Status:</span>
            ${[
              { val: 'active', label: 'Active' },
              { val: 'all', label: 'All' },
              { val: 'pending', label: 'Pending' },
              { val: 'planning', label: 'Planning' },
              { val: 'awaiting_approval', label: 'Review' },
              { val: 'scheduled', label: 'Scheduled' },
              { val: 'executing', label: 'Executing' },
              { val: 'completed', label: 'Completed' },
              { val: 'failed', label: 'Failed' },
            ].map(s => html`
              <button class="filter-btn ${this._taskFilterStatus === s.val ? 'active' : ''}"
                @click=${() => { this._taskFilterStatus = s.val; }}>
                ${s.label}
              </button>
            `)}
          </div>

          <div class="filter-group">
            <span class="filter-label">Priority:</span>
            ${['all','high','medium','low'].map(p => html`
              <button class="filter-btn ${this._taskFilterPriority === p ? 'active' : ''}"
                @click=${() => { this._taskFilterPriority = p; }}>
                ${p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            `)}
          </div>

          ${this._tasksLoading ? html`<span class="spin"></span>` : ''}
        </div>

        <!-- Task list -->
        <div class="task-list">
          ${tasks.length === 0
            ? html`<div class="empty-state">No tasks match the current filters.</div>`
            : tasks.map(t => this._renderTaskCard(t))}
        </div>

        ${this._taskPlanProgressId ? html`
          <div class="trigger-card">
            <div class="section-hdr">Planning Progress</div>
            <div class="output-panel">
              <pre class="output-pre">${this._taskPlanProgressOut || 'Generating plan…'}</pre>
            </div>
          </div>
        ` : ''}

        ${this._taskProgressId ? html`
          <div class="trigger-card">
            <div class="section-hdr">Execution Progress</div>
            <div class="output-panel">
              <pre class="output-pre">${this._taskProgressOut || 'Executing…'}</pre>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  _typeColor(type) {
    switch (type) {
      case 'feature': return { color: 'var(--purple)', bg: 'var(--purple-dim, rgba(168,85,247,0.15))', icon: '\u2726' };
      case 'bug':     return { color: 'var(--red)', bg: 'var(--red-dim)', icon: '\u2717' };
      default:        return { color: 'var(--accent)', bg: 'var(--accent-dim)', icon: '\u25B8' };
    }
  }

  _renderTaskCard(t) {
    const sColor = statusColor(t.status);
    const sBg    = statusBg(t.status);
    const pColor = priorityColor(t.priority);
    const pBg    = priorityBg(t.priority);
    const type   = t._type || (t._source === 'feature' ? 'feature' : 'task');
    const tc     = this._typeColor(type);
    const isConfirm = this._taskDeleteConfirmId === t.id;
    const isFeat = t._source === 'feature';
    const status = (t.status ?? 'pending').toLowerCase();

    return html`
      <div class="task-card" @click=${e => {
        if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') {
          this._taskDetailId = t.id;
        }
      }}>
        <div class="task-card-hdr">
          <div class="task-badges">
            <span class="badge" style="background:${tc.bg};color:${tc.color}">${tc.icon} ${type}</span>
            <span class="badge" style="background:${sBg};color:${sColor}">${t.status ?? 'pending'}</span>
            <span class="badge" style="background:${pBg};color:${pColor}">${t.priority ?? 'low'}</span>
            ${t.scheduled_time ? html`
              <span class="badge badge-gray" title="Scheduled">${new Date(t.scheduled_time).toLocaleString()}</span>
            ` : ''}
          </div>
          <div class="task-actions">
            ${isFeat ? this._renderFeatureActions(t, status) : this._renderTodoActions(t, status, isConfirm)}
          </div>
        </div>

        <div class="task-title">${t.title}</div>

        ${t.description ? html`
          <details class="task-details" @click=${e => e.stopPropagation()}>
            <summary class="task-summary">Description</summary>
            <div class="task-desc markdown-sm" .innerHTML=${renderMarkdown(t.description)}></div>
          </details>
        ` : ''}

        ${t.context ? html`
          <div class="task-context"><span class="meta-label">Context:</span> ${t.context}</div>
        ` : ''}

        <div class="task-meta">
          <span class="dim">Created ${timeAgo(t.createdAt ?? t.created_at)}</span>
          ${(t.completed_at ?? t.completedAt) ? html`
            <span class="dim">Completed ${timeAgo(t.completed_at ?? t.completedAt)}</span>
          ` : ''}
        </div>

        ${this._taskScheduleId === t.id ? html`
          <div class="schedule-picker" @click=${e => e.stopPropagation()}>
            <div class="schedule-row">
              <label class="form-label">Schedule execution:</label>
              <input class="input" type="datetime-local" style="max-width:240px"
                .value=${this._taskScheduleTime}
                @input=${e => { this._taskScheduleTime = e.target.value; }} />
            </div>
            <label class="schedule-check">
              <input type="checkbox" .checked=${this._taskRunPostOp}
                @change=${e => { this._taskRunPostOp = e.target.checked; }} />
              Run /oasis-ops after execution
            </label>
            <div class="schedule-actions">
              <button class="btn btn-sm btn-primary"
                ?disabled=${!this._taskScheduleTime}
                @click=${() => this._approveTask(t, 'approve_schedule')}>
                Confirm Schedule
              </button>
              <button class="btn btn-sm" @click=${() => { this._taskScheduleId = null; }}>Cancel</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderFeatureActions(f, status) {
    return html`
      <span class="feat-actions" @click=${e => e.stopPropagation()}>
        ${status === 'requested' || status === 'pending' ? html`
          <button class="btn btn-sm btn-primary" @click=${() => this._generatePlan(f)}>Plan</button>
        ` : ''}
        ${status === 'planning' ? html`
          <span class="spin"></span><span class="dim" style="font-size:0.75rem;margin-left:4px">Planning…</span>
        ` : ''}
        ${['planned','awaiting_approval'].includes(status) ? html`
          <button class="btn btn-sm btn-primary" @click=${() => this._approveFeature(f)}>Approve</button>
          <button class="btn btn-sm" @click=${() => this._rejectFeature(f)}>Reject</button>
        ` : ''}
        ${status === 'approved' ? html`
          <button class="btn btn-sm btn-primary" @click=${() => this._executeFeature(f)}>Execute</button>
        ` : ''}
        ${status === 'building' || status === 'executing' ? html`
          <span class="spin"></span><span class="dim" style="font-size:0.75rem;margin-left:4px">Building…</span>
        ` : ''}
        ${status === 'testing' ? html`
          <button class="btn btn-sm btn-green" @click=${() => this._markComplete(f)}>Complete</button>
          <button class="btn btn-sm btn-danger" @click=${() => this._reportIssues(f)}>Issues</button>
        ` : ''}
        <button class="btn btn-sm" @click=${() => { this._taskDetailId = f.id; }}>Details</button>
      </span>
    `;
  }

  _renderTodoActions(t, status, isConfirm) {
    return html`
      <span class="feat-actions" @click=${e => e.stopPropagation()}>
        ${(status === 'pending' && !t.execution_plan) ? html`
          <button class="btn btn-sm btn-primary" @click=${() => this._planTask(t)} title="Generate AI plan">Plan</button>
          <button class="btn btn-sm" @click=${() => this._executeTodo(t)} title="Run immediately (skip plan)">Run Now</button>
        ` : ''}
        ${status === 'planning' ? html`
          <span class="spin"></span><span class="dim" style="font-size:0.75rem;margin-left:4px">Planning…</span>
        ` : ''}
        ${status === 'awaiting_approval' ? html`
          <button class="btn btn-sm btn-primary" @click=${() => this._approveTask(t, 'approve')}>Approve & Run</button>
          <button class="btn btn-sm" @click=${() => { this._taskScheduleId = t.id; this._taskRunPostOp = t.run_post_op !== false; }}>Schedule</button>
          <button class="btn btn-sm" @click=${() => this._replanTask(t)}>Re-plan</button>
          <button class="btn btn-sm" @click=${() => this._approveTask(t, 'reject')}>Reject</button>
        ` : ''}
        ${(status === 'approved' || status === 'scheduled') ? html`
          <button class="btn btn-sm btn-primary" @click=${() => this._executeTodo(t)}>Execute</button>
        ` : ''}
        ${status === 'executing' ? html`
          <span class="spin"></span><span class="dim" style="font-size:0.75rem;margin-left:4px">Executing…</span>
        ` : ''}
        ${status === 'failed' ? html`
          <button class="btn btn-sm btn-primary" @click=${() => this._executeTodo(t)}>Retry</button>
          <button class="btn btn-sm" @click=${() => this._replanTask(t)}>Re-plan</button>
        ` : ''}
        ${(status === 'pending' && t.execution_plan) ? html`
          <button class="btn btn-sm btn-primary" @click=${() => this._approveTask(t, 'approve')}>Approve & Run</button>
          <button class="btn btn-sm" @click=${() => { this._taskScheduleId = t.id; this._taskRunPostOp = t.run_post_op !== false; }}>Schedule</button>
          <button class="btn btn-sm" @click=${() => this._replanTask(t)}>Re-plan</button>
        ` : ''}
        <button class="btn btn-sm" @click=${() => this._openEditTask(t)}>Edit</button>
        ${isConfirm ? html`
          <button class="btn btn-sm btn-danger" @click=${() => this._deleteTask(t.id)}>Confirm</button>
          <button class="btn btn-sm" @click=${() => { this._taskDeleteConfirmId = null; }}>Cancel</button>
        ` : html`
          <button class="btn btn-sm" @click=${() => { this._taskDeleteConfirmId = t.id; }}>Delete</button>
        `}
      </span>
    `;
  }

  _renderOpsCheck() {
    return html`
      <div class="audit-tab">
        <div class="trigger-card">
          <div class="trigger-content">
            <div class="trigger-icon">\u2699\uFE0F</div>
            <div class="trigger-info">
              <div class="trigger-title">Operations Check</div>
              <div class="trigger-desc">
                Runs a full OASIS operations cycle using Claude Code with full permissions.
                Checks system health, Docker containers, services, and configuration.
              </div>
            </div>
            <button class="btn btn-primary trigger-btn"
              ?disabled=${this._opsRunning}
              @click=${() => this._runOpsCheck()}>
              ${this._opsRunning ? html`<span class="spin"></span> Running\u2026` : '\u25B6 Run Ops Check'}
            </button>
          </div>
          ${(this._opsRunning || this._opsOutput) ? html`
            <div class="output-panel">
              <pre class="output-pre">${this._opsOutput || 'Starting ops check\u2026'}</pre>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  _renderTaskDetailModal() {
    const f = this._taskDetail;
    if (!f) {return '';}
    const isFeat = f._source === 'feature';
    const status = (f.status ?? 'pending').toLowerCase();
    const type   = f._type || (isFeat ? 'feature' : 'task');
    const tc     = this._typeColor(type);
    return html`
      <div class="modal-overlay" @click=${e => { if (e.target === e.currentTarget) {this._taskDetailId = null;} }}>
        <div class="modal-box">
          <div class="modal-hdr">
            <div class="modal-title">${f.title}</div>
            <button class="btn btn-sm btn-ghost" @click=${() => { this._taskDetailId = null; }}>✕</button>
          </div>
          <div class="modal-body">
            <div class="detail-meta">
              <span class="badge" style="background:${tc.bg};color:${tc.color}">${tc.icon} ${type}</span>
              <span class="badge" style="background:${statusBg(f.status)};color:${statusColor(f.status)}">${f.status}</span>
              <span class="badge" style="background:${priorityBg(f.priority)};color:${priorityColor(f.priority)}">${f.priority}</span>
              ${f.area ? html`<span class="badge badge-gray">${f.area}</span>` : ''}
            </div>
            <p class="modal-desc">${f.description ?? ''}</p>
            <div class="modal-timestamps">
              <span class="dim">Created: ${timeAgo(f.createdAt ?? f.created_at)}</span>
              ${f.updatedAt ? html`<span class="dim">Updated: ${timeAgo(f.updatedAt)}</span>` : ''}
              ${(f.completedAt ?? f.completed_at) ? html`<span class="dim">Completed: ${timeAgo(f.completedAt ?? f.completed_at)}</span>` : ''}
            </div>

            ${f.context ? html`
              <div class="modal-section">
                <div class="modal-section-title">Context</div>
                <div class="dim">${f.context}</div>
              </div>
            ` : ''}

            ${(f.plan || f.execution_plan) ? html`
              <div class="modal-section">
                <div class="modal-section-title">
                  ${f.execution_plan ? 'Execution Plan' : 'Implementation Plan'}
                  ${f.plan_generated_at ? html`<span class="dim" style="margin-left:var(--space-2);font-weight:400">Generated ${timeAgo(f.plan_generated_at)}</span>` : ''}
                </div>
                ${f.execution_plan ? html`
                  <div class="markdown-sm" .innerHTML=${renderMarkdown(f.execution_plan)}></div>
                ` : Array.isArray(f.plan?.steps) ? html`
                  <ol class="plan-steps">${f.plan.steps.map(s => html`<li>${s}</li>`)}</ol>
                ` : html`
                  <div class="markdown-sm" .innerHTML=${renderMarkdown(
                    typeof f.plan === 'string' ? f.plan : JSON.stringify(f.plan, null, 2)
                  )}></div>
                `}
                ${f.plan?.filesAffected?.length ? html`
                  <div class="meta-label" style="margin-top:var(--space-3)">Files Affected:</div>
                  <ul class="files-list">${f.plan.filesAffected.map(p => html`<li class="mono">${p}</li>`)}</ul>
                ` : ''}
              </div>
            ` : ''}

            ${f.approval_status ? html`
              <div class="modal-section">
                <div class="modal-section-title">Approval Status</div>
                <div class="detail-meta">
                  <span class="badge" style="background:${statusBg(f.approval_status)};color:${statusColor(f.approval_status)}">${f.approval_status}</span>
                  ${f.plan_approved_at ? html`<span class="dim">Approved ${timeAgo(f.plan_approved_at)}</span>` : ''}
                  ${f.scheduled_time ? html`<span class="dim">Scheduled: ${new Date(f.scheduled_time).toLocaleString()}</span>` : ''}
                  ${f.run_post_op !== undefined ? html`<span class="dim">Post-ops: ${f.run_post_op !== false ? 'Yes' : 'No'}</span>` : ''}
                </div>
              </div>
            ` : ''}

            ${f.executionOutput ? html`
              <div class="modal-section">
                <div class="modal-section-title">Execution Output</div>
                <pre class="output-pre">${f.executionOutput}</pre>
              </div>
            ` : ''}

            ${f.run_log ? html`
              <div class="modal-section">
                <div class="modal-section-title">Run Log</div>
                <pre class="output-pre">${f.run_log}</pre>
              </div>
            ` : ''}

            ${f.completion_summary ? html`
              <div class="modal-section">
                <div class="modal-section-title">Completion Summary</div>
                <div class="markdown-sm" .innerHTML=${renderMarkdown(f.completion_summary)}></div>
              </div>
            ` : ''}

            ${f.execution_report ? html`
              <div class="modal-section">
                <div class="modal-section-title">Execution Report</div>
                <pre class="output-pre">${f.execution_report}</pre>
              </div>
            ` : ''}

            ${f.failure_reason ? html`
              <div class="modal-section">
                <div class="modal-section-title">Failure Reason</div>
                <pre class="output-pre" style="color:var(--red)">${f.failure_reason}</pre>
              </div>
            ` : ''}

            <div class="modal-actions">
              ${isFeat && (status === 'requested' || status === 'pending') ? html`
                <button class="btn btn-primary" @click=${() => { this._generatePlan(f); this._taskDetailId = null; }}>Generate Plan</button>
              ` : ''}
              ${isFeat && ['planned','awaiting_approval'].includes(status) ? html`
                <button class="btn btn-primary" @click=${() => { this._approveFeature(f); this._taskDetailId = null; }}>Approve Plan</button>
                <button class="btn" @click=${() => { this._rejectFeature(f); this._taskDetailId = null; }}>Reject</button>
              ` : ''}
              ${isFeat && status === 'approved' ? html`
                <button class="btn btn-primary" @click=${() => { this._executeFeature(f); this._taskDetailId = null; }}>Execute</button>
              ` : ''}
              ${isFeat && status === 'testing' ? html`
                <button class="btn btn-green" @click=${() => { this._markComplete(f); this._taskDetailId = null; }}>Mark Complete</button>
              ` : ''}
              ${!isFeat && (status === 'pending' && !f.execution_plan) ? html`
                <button class="btn btn-primary" @click=${() => { this._planTask(f); this._taskDetailId = null; }}>Generate Plan</button>
                <button class="btn" @click=${() => { this._executeTodo(f); this._taskDetailId = null; }}>Run Now</button>
              ` : ''}
              ${!isFeat && status === 'awaiting_approval' ? html`
                <button class="btn btn-primary" @click=${() => { this._approveTask(f, 'approve'); this._taskDetailId = null; }}>Approve & Run</button>
                <button class="btn" @click=${() => { this._replanTask(f); this._taskDetailId = null; }}>Re-plan</button>
                <button class="btn" @click=${() => { this._approveTask(f, 'reject'); this._taskDetailId = null; }}>Reject</button>
              ` : ''}
              ${!isFeat && (status === 'approved' || status === 'scheduled') ? html`
                <button class="btn btn-primary" @click=${() => { this._executeTodo(f); this._taskDetailId = null; }}>Execute</button>
              ` : ''}
              ${!isFeat && status === 'failed' ? html`
                <button class="btn btn-primary" @click=${() => { this._executeTodo(f); this._taskDetailId = null; }}>Retry</button>
                <button class="btn" @click=${() => { this._replanTask(f); this._taskDetailId = null; }}>Re-plan</button>
              ` : ''}
              <button class="btn" @click=${() => { this._openEditTask(f); this._taskDetailId = null; }}>Edit</button>
              <button class="btn" @click=${() => { this._taskDetailId = null; }}>Close</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderTaskEditModal() {
    const f = this._taskEditForm;
    const task = this._tasks.find(t => t.id === this._taskEditId);
    const isFeat = task?._source === 'feature';
    const STATUSES = isFeat
      ? ['pending','planning','awaiting_approval','approved','executing','completed','failed']
      : ['pending','planning','awaiting_approval','approved','scheduled','executing','completed','failed'];
    return html`
      <div class="modal-overlay" @click=${e => { if (e.target === e.currentTarget) {this._taskEditId = null;} }}>
        <div class="modal-box">
          <div class="modal-hdr">
            <div class="modal-title">Edit ${isFeat ? 'Feature' : 'Task'}</div>
            <button class="btn btn-sm btn-ghost" @click=${() => { this._taskEditId = null; }}>✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="form-field full">
                <label class="form-label">Title</label>
                <input class="input" type="text" .value=${f.title ?? ''}
                  @input=${e => { this._taskEditForm = { ...f, title: e.target.value }; }} />
              </div>
              <div class="form-field full">
                <label class="form-label">Description</label>
                <textarea class="input form-ta" .value=${f.description ?? ''}
                  @input=${e => { this._taskEditForm = { ...f, description: e.target.value }; }}></textarea>
              </div>
              <div class="form-field">
                <label class="form-label">Status</label>
                <select class="input" .value=${f.status ?? 'pending'}
                  @change=${e => { this._taskEditForm = { ...f, status: e.target.value }; }}>
                  ${STATUSES.map(s => html`<option value="${s}">${s}</option>`)}
                </select>
              </div>
              <div class="form-field">
                <label class="form-label">Priority</label>
                <select class="input" .value=${f.priority ?? 'medium'}
                  @change=${e => { this._taskEditForm = { ...f, priority: e.target.value }; }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              ${!isFeat ? html`
                <div class="form-field full">
                  <label class="form-label">Context</label>
                  <input class="input" type="text" .value=${f.context ?? ''}
                    @input=${e => { this._taskEditForm = { ...f, context: e.target.value }; }} />
                </div>
              ` : ''}
            </div>
            <div class="modal-actions">
              <button class="btn btn-primary" @click=${() => this._saveTask()}>Save</button>
              <button class="btn" @click=${() => { this._taskEditId = null; }}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Styles ──────────────────────────────────────────────────────────────

  static styles = css`
    :host {
      display: block;
      font-family: var(--font-sans);
      color: var(--text);
    }

    .page-tools {
      padding: var(--space-6);
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }

    .page-header {
      display: flex;
      align-items: center;
      gap: var(--space-6);
      flex-wrap: wrap;
    }
    .page-title { margin: 0; font-size: var(--font-size-2xl); font-weight: 700; }

    /* Tabs */
    .tab-bar {
      display: flex;
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
      white-space: nowrap;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-content { display: flex; flex-direction: column; gap: var(--space-5); }

    /* Audit tabs */
    .audit-tab { display: flex; flex-direction: column; gap: var(--space-5); }

    /* Trigger card */
    .trigger-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .trigger-content {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-5);
      flex-wrap: wrap;
    }
    .trigger-icon { font-size: 2rem; flex-shrink: 0; }
    .trigger-info { flex: 1; min-width: 200px; }
    .trigger-title { font-size: var(--font-size-lg); font-weight: 700; margin-bottom: var(--space-1); }
    .trigger-desc { font-size: var(--font-size-sm); color: var(--text-dim); line-height: 1.5; }
    .trigger-btn { flex-shrink: 0; }

    .section-hdr {
      padding: var(--space-4) var(--space-5);
      font-size: var(--font-size-md);
      font-weight: 600;
      border-bottom: 1px solid var(--border);
    }

    .output-panel {
      border-top: 1px solid var(--border);
      background: var(--bg);
      max-height: 300px;
      overflow-y: auto;
    }
    .output-pre {
      margin: 0;
      padding: var(--space-4);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Report card */
    .report-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .report-summary-bar {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-5);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .count-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--space-2) var(--space-4);
      border: 1px solid;
      border-radius: var(--radius);
      min-width: 72px;
    }
    .count-num { font-size: var(--font-size-xl); font-weight: 700; font-family: var(--font-mono); }
    .count-label { font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
    .report-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-left: auto; }

    /* Filters */
    .filter-row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-5);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .filter-label {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .filter-btn {
      padding: 2px 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--text-dim);
      font-size: var(--font-size-xs);
      cursor: pointer;
      transition: all var(--transition);
    }
    .filter-btn:hover { border-color: var(--accent); color: var(--text); }
    .filter-btn.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
    .filter-select {
      font-size: var(--font-size-xs);
      padding: 2px 8px;
      height: 26px;
      width: auto;
    }

    /* Findings */
    .findings-list { display: flex; flex-direction: column; }
    .finding-card {
      padding: var(--space-4) var(--space-5);
      border-bottom: 1px solid var(--border);
    }
    .finding-card:last-child { border-bottom: none; }
    .finding-header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin-bottom: var(--space-2);
    }
    .check-wrap { display: flex; align-items: center; }
    .check-wrap input { cursor: pointer; accent-color: var(--accent); }
    .finding-title { font-weight: 600; font-size: var(--font-size-sm); flex: 1; min-width: 0; }
    .finding-body { padding-top: var(--space-1); }
    .finding-desc {
      font-size: var(--font-size-sm);
      color: var(--text-dim);
      margin: 0 0 var(--space-2) 0;
      line-height: 1.6;
    }
    .finding-meta { font-size: var(--font-size-xs); color: var(--text-muted); margin-bottom: var(--space-2); }
    .finding-fix { margin-top: var(--space-3); }
    .finding-remediation { margin-top: var(--space-3); }
    .meta-label {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: var(--space-1);
    }
    .fix-pre {
      margin: 0;
      padding: var(--space-3);
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .cve-link {
      color: var(--accent);
      text-decoration: none;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      margin-right: var(--space-2);
    }
    .cve-link:hover { text-decoration: underline; }
    .finding-edit { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-2); }
    .finding-ta { min-height: 80px; resize: vertical; }

    /* History */
    .history-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .history-list { display: flex; flex-direction: column; }
    .history-row {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-3) var(--space-5);
      border-bottom: 1px solid rgba(42,53,80,0.4);
      cursor: pointer;
      transition: background var(--transition);
    }
    .history-row:last-child { border-bottom: none; }
    .history-row:hover { background: var(--surface-2); }
    .history-counts { display: flex; gap: var(--space-3); font-size: var(--font-size-xs); font-family: var(--font-mono); }

    /* Unified Tasks */
    .tasks-tab { display: flex; flex-direction: column; gap: var(--space-5); }
    .filter-toolbar { display: flex; flex-direction: column; gap: var(--space-3); }
    .search-input { max-width: 360px; }
    .filter-group { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
    .task-list { display: flex; flex-direction: column; gap: var(--space-3); }
    .task-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-4) var(--space-5);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      cursor: default;
      transition: border-color var(--transition);
    }
    .task-card:hover { border-color: rgba(99,102,241,0.3); }
    .task-card-hdr { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
    .task-badges { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .task-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }
    .feat-actions { display: inline-flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
    .task-title { font-size: var(--font-size-md); font-weight: 700; }
    .task-details {}
    .task-summary {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      cursor: pointer;
      list-style: none;
      padding: var(--space-1) 0;
      user-select: none;
    }
    .task-summary::-webkit-details-marker { display: none; }
    .task-summary::before { content: '▶ '; font-size: 0.65em; }
    details[open] .task-summary::before { content: '▼ '; }
    .task-desc {
      padding: var(--space-3);
      background: var(--surface-2);
      border-radius: var(--radius);
      margin-top: var(--space-2);
    }
    .task-context { font-size: var(--font-size-xs); color: var(--text-dim); }
    .task-meta { display: flex; gap: var(--space-4); font-size: var(--font-size-xs); flex-wrap: wrap; }

    /* Collapsible card */
    .collapsible-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .coll-header {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-4) var(--space-5);
      border: none;
      background: transparent;
      color: var(--text);
      font-family: var(--font-sans);
      font-size: var(--font-size-md);
      font-weight: 600;
      cursor: pointer;
      transition: background var(--transition);
      text-align: left;
    }
    .coll-header:hover { background: var(--surface-2); }
    .toggle-ico { color: var(--text-muted); font-size: var(--font-size-xs); }
    .coll-body {
      padding: var(--space-5);
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }

    /* Forms */
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4);
    }
    @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
    .form-field { display: flex; flex-direction: column; gap: var(--space-1); }
    .form-field.full { grid-column: 1 / -1; }
    .form-label {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .form-ta { min-height: 100px; resize: vertical; font-family: var(--font-sans); }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: var(--overlay);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: var(--space-4);
    }
    .modal-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
      width: 100%;
      max-width: 640px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: var(--shadow-lg);
    }
    .modal-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-4) var(--space-5);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .modal-title { font-size: var(--font-size-lg); font-weight: 700; }
    .modal-body {
      padding: var(--space-5);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .detail-meta { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .modal-desc { font-size: var(--font-size-sm); color: var(--text-dim); line-height: 1.6; margin: 0; }
    .modal-timestamps { display: flex; gap: var(--space-4); flex-wrap: wrap; }
    .modal-section {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
    }
    .modal-section-title { font-size: var(--font-size-xs); font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; }
    .modal-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-2); }
    .plan-steps {
      margin: 0;
      padding-left: var(--space-5);
      font-size: var(--font-size-sm);
      line-height: 1.7;
      color: var(--text-dim);
    }
    .plan-steps li { margin-bottom: var(--space-1); }
    .files-list {
      margin: var(--space-2) 0 0 0;
      padding-left: var(--space-5);
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      color: var(--text-dim);
    }

    /* Shared primitives */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-green  { background: var(--green-dim);  color: var(--green); }
    .badge-red    { background: var(--red-dim);    color: var(--red); }
    .badge-yellow { background: var(--yellow-dim); color: var(--yellow); }
    .badge-orange { background: var(--orange-dim); color: var(--orange); }
    .badge-gray   { background: var(--surface-3);  color: var(--text-muted); }

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
    .btn:hover:not(:disabled) { background: var(--surface-3); border-color: var(--accent); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-sm { padding: var(--space-1) var(--space-3); font-size: var(--font-size-xs); }
    .btn-ghost { background: transparent; border-color: transparent; color: var(--text-dim); }
    .btn-ghost:hover:not(:disabled) { background: var(--surface-2); color: var(--text); border-color: var(--border); }
    .btn-primary { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-green { background: var(--green-dim); border-color: var(--green); color: var(--green); }
    .btn-green:hover:not(:disabled) { background: rgba(34,197,94,0.25); }
    .btn-danger { background: var(--red-dim); border-color: var(--red); color: var(--red); }
    .btn-danger:hover:not(:disabled) { background: rgba(239,68,68,0.25); }

    .input {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: var(--font-size-sm);
      padding: var(--space-2) var(--space-3);
      transition: border-color var(--transition);
      width: 100%;
      box-sizing: border-box;
    }
    .input:focus { outline: none; border-color: var(--accent); }

    /* Spinner */
    .spin {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* States */
    .empty-state { color: var(--text-muted); font-size: var(--font-size-sm); padding: var(--space-8); text-align: center; }
    .loading-msg { color: var(--text-dim); font-size: var(--font-size-sm); padding: var(--space-6); text-align: center; }

    /* Markdown */
    .markdown-sm { font-size: var(--font-size-sm); line-height: 1.7; color: var(--text-dim); }
    .markdown-sm h1, .markdown-sm h2, .markdown-sm h3 { color: var(--text); margin: var(--space-3) 0 var(--space-1) 0; }
    .markdown-sm h1 { font-size: var(--font-size-lg); }
    .markdown-sm h2 { font-size: var(--font-size-md); }
    .markdown-sm h3 { font-size: var(--font-size-sm); }
    .markdown-sm p { margin: var(--space-2) 0; }
    .markdown-sm code { font-family: var(--font-mono); background: var(--surface-3); padding: 1px 5px; border-radius: var(--radius-sm); font-size: 0.9em; }
    .markdown-sm pre.code-block { background: var(--surface-3); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3); overflow-x: auto; margin: var(--space-2) 0; }
    .markdown-sm pre.code-block code { background: none; padding: 0; }
    .markdown-sm blockquote { border-left: 3px solid var(--accent); padding-left: var(--space-3); color: var(--text-muted); margin: var(--space-2) 0; }
    .markdown-sm li { padding-left: var(--space-2); margin: 2px 0; }
    .markdown-sm hr { border: none; border-top: 1px solid var(--border); margin: var(--space-3) 0; }
    .markdown-sm a { color: var(--accent); text-decoration: none; }
    .markdown-sm a:hover { text-decoration: underline; }
    .markdown-sm strong { color: var(--text); }

    /* Schedule picker */
    .schedule-picker {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-top: var(--space-2);
    }
    .schedule-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .schedule-check {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--font-size-sm);
      color: var(--text-dim);
      cursor: pointer;
    }
    .schedule-check input { accent-color: var(--accent); cursor: pointer; }
    .schedule-actions { display: flex; gap: var(--space-2); }

    .mono { font-family: var(--font-mono); font-size: var(--font-size-xs); }
    .dim { color: var(--text-dim); font-size: var(--font-size-xs); }

    details > summary { list-style: none; }
    details > summary::-webkit-details-marker { display: none; }
  `;
}

customElements.define('page-tools', PageTools);
