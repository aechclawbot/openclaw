import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';
import { store } from '/app/store.js';

// ─── Helper Functions ────────────────────────────────────────────────────────

function formatCurrency(n) {
  if (n == null || isNaN(n)) {return '$—';}
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function formatTokens(n) {
  if (n == null || isNaN(n)) {return '—';}
  if (n >= 1_000_000) {return (n / 1_000_000).toFixed(1) + 'M';}
  if (n >= 1_000) {return (n / 1_000).toFixed(1) + 'k';}
  return String(n);
}

function formatDuration(ms) {
  if (!ms || isNaN(ms)) {return '—';}
  const s = Math.floor(ms / 1000);
  if (s < 60) {return `${s}s`;}
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) {return `${m}m ${rem}s`;}
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatUptime(secs) {
  if (!secs || isNaN(secs)) {return '—';}
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  if (d > 0) {return `${d}d ${h}h`;}
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

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

function shortModelName(id) {
  const resolved = (typeof id === 'object' && id) ? (id.primary ?? id.id ?? id.name ?? null) : id;
  if (!resolved || typeof resolved !== 'string') {return '—';}
  let name = resolved.includes('/') ? resolved.split('/').pop() : resolved;
  name = name.replace(/-\d{4}[-\d]*$/, '');
  return name;
}

function formatDate(iso) {
  if (!iso) {return '—';}
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

// ─── Component ───────────────────────────────────────────────────────────────

class PageAnalytics extends LitElement {
  static properties = {
    // Top-level tab: 'usage' | 'performance'
    _activeTab: { type: String, state: true },

    // Usage tab
    _period: { type: Number, state: true },
    _usageData: { type: Object, state: true },
    _usageLoading: { type: Boolean, state: true },
    _usageError: { type: String, state: true },
    _chartMetric: { type: String, state: true },     // 'cost' | 'tokens' | 'messages'
    _collapsedSections: { type: Object, state: true },

    // Performance tab
    _perfSummary: { type: Object, state: true },
    _perfAgents: { type: Array, state: true },
    _perfCron: { type: Array, state: true },
    _perfSystem: { type: Object, state: true },
    _perfContainers: { type: Array, state: true },
    _perfLoading: { type: Boolean, state: true },
    _agentSortKey: { type: String, state: true },
    _agentSortDir: { type: Number, state: true },
    _cronSortKey: { type: String, state: true },
    _cronSortDir: { type: Number, state: true },
  };

  constructor() {
    super();
    this._activeTab = 'usage';
    this._period = 7;
    this._usageData = null;
    this._usageLoading = false;
    this._usageError = '';
    this._chartMetric = 'cost';
    this._collapsedSections = {};

    this._perfSummary = null;
    this._perfAgents = [];
    this._perfCron = [];
    this._perfSystem = null;
    this._perfContainers = [];
    this._perfLoading = false;

    this._agentSortKey = 'sessions';
    this._agentSortDir = -1;
    this._cronSortKey = 'name';
    this._cronSortDir = 1;

    this._refreshTimers = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadUsage();
    // Auto-refresh usage every 60s
    this._refreshTimers.push(setInterval(() => {
      if (this._activeTab === 'usage') {this._loadUsage();}
    }, 60_000));
    // Auto-refresh performance every 30s
    this._refreshTimers.push(setInterval(() => {
      if (this._activeTab === 'performance') {this._loadPerformance();}
    }, 30_000));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._refreshTimers.forEach(t => clearInterval(t));
    this._refreshTimers = [];
  }

  // ─── Data Fetching ───────────────────────────────────────────────────────

  async _loadUsage() {
    this._usageLoading = true;
    this._usageError = '';
    try {
      const raw = await api.get(`/api/usage?period=${this._period}`);
      // Normalize API response: the backend returns { totals, aggregates, sessions }
      // but the UI expects flat properties like { totalCost, daily, byModel, ... }
      const data = raw ?? {};
      const totals = data.totals ?? {};
      const agg = data.aggregates ?? {};

      // Flatten totals to top level
      data.totalCost = totals.totalCost ?? 0;
      data.totalTokens = totals.totalTokens ?? 0;
      data.inputTokens = totals.input ?? 0;
      data.outputTokens = totals.output ?? 0;

      // API calls = total message count from aggregates
      const msgAgg = agg.messages ?? {};
      data.apiCalls = msgAgg.total ?? 0;

      // Active agents = count of agents with data
      const byAgent = Array.isArray(agg.byAgent) ? agg.byAgent : [];
      data.activeAgents = byAgent.length;

      // Daily breakdown
      data.daily = Array.isArray(agg.daily) ? agg.daily : [];

      // byModel: flatten nested totals
      data.byModel = (Array.isArray(agg.byModel) ? agg.byModel : []).map(m => ({
        model: m.model,
        provider: m.provider,
        inputTokens: m.totals?.input ?? 0,
        outputTokens: m.totals?.output ?? 0,
        cacheReadTokens: m.totals?.cacheRead ?? 0,
        cacheWriteTokens: m.totals?.cacheWrite ?? 0,
        cost: m.totals?.totalCost ?? 0,
        calls: m.count ?? 0,
      }));

      // byAgent: flatten nested totals
      data.byAgent = byAgent.map(a => ({
        agentId: a.agentId,
        name: a.agentId,
        tokens: a.totals?.totalTokens ?? 0,
        cost: a.totals?.totalCost ?? 0,
        calls: a.count ?? 0,
      }));

      // byProvider: flatten nested totals
      data.byProvider = (Array.isArray(agg.byProvider) ? agg.byProvider : []).map(p => ({
        provider: p.provider,
        tokens: p.totals?.totalTokens ?? 0,
        cost: p.totals?.totalCost ?? 0,
        calls: p.count ?? 0,
      }));

      // Top sessions by cost (sorted, top 20)
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      data.topSessions = sessions
        .filter(s => s.usage?.totalCost > 0)
        .toSorted((a, b) => (b.usage?.totalCost ?? 0) - (a.usage?.totalCost ?? 0))
        .slice(0, 20)
        .map(s => ({
          sessionId: s.sessionId,
          agentId: s.agentId,
          cost: s.usage?.totalCost ?? 0,
          totalTokens: s.usage?.totalTokens ?? 0,
          durationMs: s.usage?.durationMs ?? 0,
        }));

      // Tool usage: aggregates.tools is { totalCalls, uniqueTools, tools: [...] }
      const toolsAgg = agg.tools ?? {};
      data.toolUsage = Array.isArray(toolsAgg.tools) ? toolsAgg.tools : (Array.isArray(toolsAgg) ? toolsAgg : []);

      this._usageData = data;
    } catch (e) {
      this._usageError = e?.message ?? 'Failed to load usage data';
    } finally {
      this._usageLoading = false;
    }
  }

  async _loadPerformance() {
    this._perfLoading = true;
    try {
      const [summary, agents, cron, system, containers] = await Promise.allSettled([
        api.get('/api/metrics/summary'),
        api.get('/api/metrics/agents'),
        api.get('/api/metrics/cron'),
        api.get('/api/metrics/system'),
        api.get('/api/docker/containers'),
      ]);

      // Extract summary — backend returns nested { agents, cron, system }
      const rawSummary = summary.status === 'fulfilled' ? (summary.value ?? {}) : {};
      const rawSystem = system.status === 'fulfilled' ? (system.value ?? {}) : {};
      const sysGw = rawSummary.system?.gateway ?? rawSystem.gateway ?? {};
      // Gateway may report uptime=0; fall back to dashboard uptime as proxy
      const gwUptime = sysGw.uptime || rawSummary.system?.dashboard?.uptime || rawSystem.dashboard?.uptime || 0;
      this._perfSummary = {
        totalSessions: rawSummary.agents?.totalSessions ?? 0,
        activeSessions: rawSummary.agents?.activeSessions ?? 0,
        cronJobs: rawSummary.cron?.summary?.total ?? 0,
        gatewayUptime: gwUptime,
        gatewayStatus: sysGw.status ?? 'unknown',
      };

      // Agent metrics — backend returns { agents: [{ id, sessions: { total, active }, messages, lastActivity }] }
      const rawAgents = agents.status === 'fulfilled' ? (agents.value?.agents ?? []) : [];
      this._perfAgents = rawAgents.map(a => ({
        ...a,
        name: a.name ?? a.id,
        sessions: a.sessions?.total ?? a.sessions ?? 0,
        activeSessions: a.sessions?.active ?? 0,
        activityPct: a.sessions?.total > 0 ? Math.round((a.sessions?.active ?? 0) / a.sessions.total * 100) : 0,
        lastActive: a.lastActivity ?? a.lastActive ?? null,
        cronUptime: 0,
      }));

      // Cron — backend returns { jobs: [{ id, name, agentId, lastStatus, lastRunAt, consecutiveErrors, uptime }] }
      const rawCron = cron.status === 'fulfilled' ? (cron.value?.jobs ?? []) : [];
      this._perfCron = rawCron.map(j => ({
        ...j,
        totalRuns: j.totalRuns ?? (j.lastStatus !== 'never' ? 1 + (j.consecutiveErrors ?? 0) : 0),
        successes: j.successes ?? (j.lastStatus === 'ok' ? 1 : 0),
        failures: j.failures ?? (j.consecutiveErrors ?? 0),
        successRate: j.successRate ?? (j.uptime != null ? j.uptime * 100 : 0),
        lastRun: j.lastRunAt ?? j.lastRun ?? null,
      }));

      this._perfSystem = system.status === 'fulfilled' ? (system.value ?? {}) : {};
      this._perfContainers = containers.status === 'fulfilled' ? (Array.isArray(containers.value) ? containers.value : (containers.value?.containers ?? [])) : [];
    } finally {
      this._perfLoading = false;
    }
  }

  _setTab(tab) {
    this._activeTab = tab;
    if (tab === 'performance' && !this._perfSummary) {
      this._loadPerformance();
    }
  }

  _setPeriod(days) {
    this._period = days;
    this._loadUsage();
  }

  _toggleSection(key) {
    this._collapsedSections = {
      ...this._collapsedSections,
      [key]: !this._collapsedSections[key],
    };
  }

  // ─── Computed ───────────────────────────────────────────────────────────

  get _summary() {
    const d = this._usageData ?? {};
    const daily = Array.isArray(d.daily) ? d.daily : [];
    const totalCost = d.totalCost ?? daily.reduce((s, r) => s + (r.cost ?? 0), 0);
    const totalTokens = d.totalTokens ?? daily.reduce((s, r) => s + (r.tokens ?? 0), 0);
    const inputTokens = d.inputTokens ?? daily.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
    const outputTokens = d.outputTokens ?? daily.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
    const apiCalls = d.apiCalls ?? daily.reduce((s, r) => s + (r.calls ?? 0), 0);
    const activeAgents = d.activeAgents ?? 0;
    const avgCostDay = this._period > 0 ? totalCost / this._period : 0;
    return { totalCost, totalTokens, inputTokens, outputTokens, apiCalls, activeAgents, avgCostDay };
  }

  get _dailyRows() {
    const d = this._usageData ?? {};
    return Array.isArray(d.daily) ? d.daily : [];
  }

  get _chartMax() {
    const rows = this._dailyRows;
    if (!rows.length) {return 1;}
    const vals = rows.map(r => this._chartValue(r));
    return Math.max(...vals, 0.001);
  }

  _chartValue(row) {
    if (this._chartMetric === 'cost') {return row.cost ?? 0;}
    if (this._chartMetric === 'tokens') {return row.tokens ?? row.totalTokens ?? 0;}
    return row.messages ?? row.calls ?? 0;
  }

  _sortedAgents() {
    const key = this._agentSortKey;
    const dir = this._agentSortDir;
    return [...this._perfAgents].toSorted((a, b) => {
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (typeof av === 'string') {return dir * av.localeCompare(bv);}
      return dir * (av - bv);
    });
  }

  _sortedCron() {
    const key = this._cronSortKey;
    const dir = this._cronSortDir;
    return [...this._perfCron].toSorted((a, b) => {
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      if (typeof av === 'string') {return dir * av.localeCompare(bv);}
      return dir * (av - bv);
    });
  }

  _toggleAgentSort(key) {
    if (this._agentSortKey === key) {
      this._agentSortDir = -this._agentSortDir;
    } else {
      this._agentSortKey = key;
      this._agentSortDir = -1;
    }
  }

  _toggleCronSort(key) {
    if (this._cronSortKey === key) {
      this._cronSortDir = -this._cronSortDir;
    } else {
      this._cronSortKey = key;
      this._cronSortDir = -1;
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  render() {
    return html`
      <div class="page-analytics">
        <div class="page-header">
          <h1 class="page-title">Analytics</h1>
          <div class="tab-bar">
            ${['usage', 'performance'].map(t => html`
              <button class="tab-btn ${this._activeTab === t ? 'active' : ''}"
                @click=${() => this._setTab(t)}>
                ${t === 'usage' ? 'Usage' : 'Performance'}
              </button>
            `)}
          </div>
        </div>

        <div class="tab-content">
          ${this._activeTab === 'usage' ? this._renderUsage() : this._renderPerformance()}
        </div>
      </div>
    `;
  }

  // ─── Usage Tab ──────────────────────────────────────────────────────────

  _renderUsage() {
    return html`
      <div class="usage-tab">
        <!-- Period Selector -->
        <div class="period-row">
          <span class="period-label">Period:</span>
          ${[1, 7, 30, 90].map(d => html`
            <button class="period-btn ${this._period === d ? 'active' : ''}"
              @click=${() => this._setPeriod(d)}>
              ${d === 1 ? '1 day' : `${d} days`}
            </button>
          `)}
          ${this._usageLoading ? html`<span class="loading-spin"></span>` : ''}
        </div>

        ${this._usageError ? html`<div class="error-msg">${this._usageError}</div>` : ''}

        <!-- Summary Cards -->
        <div class="summary-cards">
          ${this._renderSummaryCard('Total Cost', formatCurrency(this._summary.totalCost), '')}
          ${this._renderSummaryCard('Total Tokens', formatTokens(this._summary.totalTokens),
            `in: ${formatTokens(this._summary.inputTokens)} / out: ${formatTokens(this._summary.outputTokens)}`)}
          ${this._renderSummaryCard('API Calls', this._summary.apiCalls?.toLocaleString() ?? '0', '')}
          ${this._renderSummaryCard('Active Agents', this._summary.activeAgents ?? '0', '')}
          ${this._renderSummaryCard('Avg Cost/Day', formatCurrency(this._summary.avgCostDay), '')}
        </div>

        <!-- Daily Chart -->
        ${this._renderDailyChart()}

        <!-- Data Tables -->
        ${this._renderSection('models', 'Usage by Model', () => this._renderModelTable())}
        ${this._renderSection('agents', 'Usage by Agent', () => this._renderAgentUsageTable())}
        ${this._renderSection('providers', 'Usage by Provider', () => this._renderProviderTable())}
        ${this._renderSection('tokens', 'Token Breakdown', () => this._renderTokenBreakdown())}
        ${this._renderSection('sessions', 'Top Sessions by Cost', () => this._renderSessionsTable())}
        ${this._renderSection('tools', 'Tool Usage', () => this._renderToolsTable())}
      </div>
    `;
  }

  _renderSummaryCard(label, value, sub) {
    return html`
      <div class="summary-card">
        <div class="summary-label">${label}</div>
        <div class="summary-value">${value}</div>
        ${sub ? html`<div class="summary-sub">${sub}</div>` : ''}
      </div>
    `;
  }

  _renderDailyChart() {
    const rows = this._dailyRows;
    const max = this._chartMax;
    const metrics = ['cost', 'tokens', 'messages'];

    return html`
      <div class="chart-card">
        <div class="chart-header">
          <span class="chart-title">Daily Breakdown</span>
          <div class="chart-metric-tabs">
            ${metrics.map(m => html`
              <button class="metric-tab ${this._chartMetric === m ? 'active' : ''}"
                @click=${() => { this._chartMetric = m; }}>
                ${m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            `)}
          </div>
        </div>

        ${rows.length === 0
          ? html`<div class="chart-empty">No data for this period.</div>`
          : html`
            <div class="chart-area">
              <div class="chart-yaxis">
                ${[1, 0.75, 0.5, 0.25, 0].map(pct => html`
                  <div class="yaxis-label">
                    ${this._formatChartLabel(max * pct)}
                  </div>
                `)}
              </div>
              <div class="chart-bars-wrap">
                <div class="chart-bars">
                  ${rows.map(row => {
                    const val = this._chartValue(row);
                    const pct = max > 0 ? Math.max((val / max) * 100, val > 0 ? 2 : 0) : 0;
                    const tip = `${formatDate(row.date ?? row.day)}: ${this._formatChartLabel(val)}`;
                    return html`
                      <div class="bar-col" title="${tip}">
                        <div class="bar-fill" style="height:${pct}%"></div>
                        <div class="bar-label">${this._shortDate(row.date ?? row.day)}</div>
                      </div>
                    `;
                  })}
                </div>
              </div>
            </div>
          `}
      </div>
    `;
  }

  _formatChartLabel(val) {
    if (this._chartMetric === 'cost') {return formatCurrency(val);}
    if (this._chartMetric === 'tokens') {return formatTokens(val);}
    return Math.round(val).toLocaleString();
  }

  _shortDate(iso) {
    if (!iso) {return '';}
    try {
      const d = new Date(iso);
      return (d.getMonth() + 1) + '/' + d.getDate();
    } catch { return iso; }
  }

  _renderSection(key, title, renderFn) {
    const collapsed = this._collapsedSections[key];
    return html`
      <div class="data-section">
        <button class="section-header" @click=${() => this._toggleSection(key)}>
          <span class="section-title">${title}</span>
          <span class="section-toggle">${collapsed ? '▶' : '▼'}</span>
        </button>
        ${!collapsed ? html`<div class="section-body">${renderFn()}</div>` : ''}
      </div>
    `;
  }

  _renderModelTable() {
    const models = this._usageData?.byModel ?? [];
    if (!models.length) {return html`<div class="empty-state">No model data.</div>`;}
    const totalCost = models.reduce((s, m) => s + (m.cost ?? 0), 0);
    return html`
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th class="num">Input Tokens</th>
              <th class="num">Output Tokens</th>
              <th class="num">Total Cost</th>
              <th class="num">API Calls</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            ${models.map(m => {
              const share = totalCost > 0 ? ((m.cost ?? 0) / totalCost) * 100 : 0;
              return html`
                <tr>
                  <td class="model-cell">${shortModelName(m.model ?? m.name)}</td>
                  <td class="num">${formatTokens(m.inputTokens ?? m.input_tokens)}</td>
                  <td class="num">${formatTokens(m.outputTokens ?? m.output_tokens)}</td>
                  <td class="num accent">${formatCurrency(m.cost)}</td>
                  <td class="num">${(m.calls ?? m.count ?? 0).toLocaleString()}</td>
                  <td>
                    <div class="share-cell">
                      <div class="share-bar-bg">
                        <div class="share-bar-fill" style="width:${share.toFixed(1)}%"></div>
                      </div>
                      <span class="share-pct">${share.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderAgentUsageTable() {
    const agents = this._usageData?.byAgent ?? [];
    if (!agents.length) {return html`<div class="empty-state">No agent data.</div>`;}
    const totalCost = agents.reduce((s, a) => s + (a.cost ?? 0), 0);
    return html`
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th class="num">Tokens</th>
              <th class="num">Cost</th>
              <th class="num">Calls</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            ${agents.map(a => {
              const share = totalCost > 0 ? ((a.cost ?? 0) / totalCost) * 100 : 0;
              return html`
                <tr>
                  <td>
                    <span class="agent-cell">
                      <span class="agent-emoji">${a.emoji ?? '🤖'}</span>
                      <span>${a.name ?? a.agent ?? a.agentId}</span>
                    </span>
                  </td>
                  <td class="num">${formatTokens(a.tokens ?? a.totalTokens)}</td>
                  <td class="num accent">${formatCurrency(a.cost)}</td>
                  <td class="num">${(a.calls ?? a.count ?? 0).toLocaleString()}</td>
                  <td>
                    <div class="share-cell">
                      <div class="share-bar-bg">
                        <div class="share-bar-fill" style="width:${share.toFixed(1)}%"></div>
                      </div>
                      <span class="share-pct">${share.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderProviderTable() {
    const providers = this._usageData?.byProvider ?? [];
    if (!providers.length) {return html`<div class="empty-state">No provider data.</div>`;}
    return html`
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th class="num">Tokens</th>
              <th class="num">Cost</th>
              <th class="num">Calls</th>
            </tr>
          </thead>
          <tbody>
            ${providers.map(p => html`
              <tr>
                <td class="provider-cell">${p.provider ?? p.name}</td>
                <td class="num">${formatTokens(p.tokens ?? p.totalTokens)}</td>
                <td class="num accent">${formatCurrency(p.cost)}</td>
                <td class="num">${(p.calls ?? p.count ?? 0).toLocaleString()}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderTokenBreakdown() {
    const models = this._usageData?.byModel ?? [];
    if (!models.length) {return html`<div class="empty-state">No token data.</div>`;}

    return html`
      <div class="token-breakdown">
        <div class="token-legend">
          <span class="legend-item"><span class="legend-dot accent-bg"></span>Input</span>
          <span class="legend-item"><span class="legend-dot green-bg"></span>Output</span>
          <span class="legend-item"><span class="legend-dot yellow-bg"></span>Cache Read</span>
          <span class="legend-item"><span class="legend-dot orange-bg"></span>Cache Write</span>
        </div>
        ${models.map(m => {
          const inp = m.inputTokens ?? m.input_tokens ?? 0;
          const out = m.outputTokens ?? m.output_tokens ?? 0;
          const cr = m.cacheReadTokens ?? m.cache_read_input_tokens ?? 0;
          const cw = m.cacheWriteTokens ?? m.cache_creation_input_tokens ?? 0;
          const total = inp + out + cr + cw || 1;
          const toP = n => ((n / total) * 100).toFixed(1);
          return html`
            <div class="token-row">
              <div class="token-model">${shortModelName(m.model ?? m.name)}</div>
              <div class="stacked-bar">
                ${inp > 0 ? html`<div class="stack-seg accent-bg" style="width:${toP(inp)}%" title="Input: ${formatTokens(inp)}"></div>` : ''}
                ${out > 0 ? html`<div class="stack-seg green-bg" style="width:${toP(out)}%" title="Output: ${formatTokens(out)}"></div>` : ''}
                ${cr > 0 ? html`<div class="stack-seg yellow-bg" style="width:${toP(cr)}%" title="Cache Read: ${formatTokens(cr)}"></div>` : ''}
                ${cw > 0 ? html`<div class="stack-seg orange-bg" style="width:${toP(cw)}%" title="Cache Write: ${formatTokens(cw)}"></div>` : ''}
              </div>
              <div class="token-total">${formatTokens(total)}</div>
            </div>
          `;
        })}
      </div>
    `;
  }

  _renderSessionsTable() {
    const sessions = (this._usageData?.topSessions ?? []).slice(0, 20);
    if (!sessions.length) {return html`<div class="empty-state">No session data.</div>`;}
    return html`
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Agent</th>
              <th class="num">Cost</th>
              <th class="num">Tokens</th>
              <th class="num">Duration</th>
            </tr>
          </thead>
          <tbody>
            ${sessions.map(s => html`
              <tr>
                <td class="session-id-cell mono">${(s.id ?? s.sessionId ?? '').slice(0, 16)}…</td>
                <td>
                  <span class="agent-cell">
                    <span class="agent-emoji">${s.emoji ?? '🤖'}</span>
                    <span>${s.agent ?? s.agentId ?? '—'}</span>
                  </span>
                </td>
                <td class="num accent">${formatCurrency(s.cost)}</td>
                <td class="num">${formatTokens(s.tokens ?? s.totalTokens)}</td>
                <td class="num">${formatDuration(s.duration ?? s.durationMs)}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderToolsTable() {
    const tools = (this._usageData?.toolUsage ?? []).slice(0, 15);
    if (!tools.length) {return html`<div class="empty-state">No tool usage data.</div>`;}
    return html`
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tool Name</th>
              <th class="num">Call Count</th>
              <th class="num">Avg Duration</th>
              <th class="num">Success Rate</th>
            </tr>
          </thead>
          <tbody>
            ${tools.map(t => {
              const rate = t.successRate ?? (t.calls > 0 ? ((t.successes ?? t.calls) / t.calls * 100) : 100);
              const rateColor = rate >= 90 ? 'var(--green)' : rate >= 70 ? 'var(--yellow)' : 'var(--red)';
              return html`
                <tr>
                  <td class="mono">${t.name ?? t.tool}</td>
                  <td class="num">${(t.count ?? t.calls ?? 0).toLocaleString()}</td>
                  <td class="num">${formatDuration(t.avgDuration ?? t.avgDurationMs)}</td>
                  <td class="num" style="color:${rateColor}">${rate.toFixed(0)}%</td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─── Performance Tab ─────────────────────────────────────────────────────

  _renderPerformance() {
    if (this._perfLoading && !this._perfSummary) {
      return html`<div class="loading-msg">Loading performance metrics…</div>`;
    }
    const s = this._perfSummary ?? {};
    const uptimeSecs = s.gatewayUptime ?? s.uptime ?? 0;
    const gatewayStatus = s.gatewayStatus ?? s.status ?? 'unknown';
    const isConnected = gatewayStatus === 'connected' || gatewayStatus === 'ok';

    return html`
      <div class="performance-tab">
        <!-- Summary Cards -->
        <div class="summary-cards">
          ${this._renderSummaryCard('Total Sessions', (s.totalSessions ?? 0).toLocaleString(), '')}
          ${this._renderSummaryCard('Cron Jobs', (s.cronJobs ?? s.cronTotal ?? this._perfCron.length ?? 0).toLocaleString(), '')}
          ${this._renderSummaryCard('Gateway Uptime', formatUptime(uptimeSecs), '')}
          <div class="summary-card">
            <div class="summary-label">Gateway Status</div>
            <div class="summary-value">
              <span class="status-badge ${isConnected ? 'badge-green' : 'badge-red'}">
                <span class="status-dot ${isConnected ? 'dot-green' : 'dot-red'}"></span>
                ${isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>

        <!-- Agent Performance Table -->
        ${this._renderSection('perf-agents', 'Agent Performance', () => this._renderAgentPerfTable())}

        <!-- Cron Reliability Table -->
        ${this._renderSection('perf-cron', 'Cron Reliability', () => this._renderCronReliabilityTable())}

        <!-- System Resources -->
        ${this._renderSection('perf-system', 'System Resources', () => this._renderSystemResources())}
      </div>
    `;
  }

  _renderAgentPerfTable() {
    const agents = this._sortedAgents();
    if (!agents.length) {return html`<div class="empty-state">No agent performance data.</div>`;}
    const sortIcon = (key) => this._agentSortKey === key ? (this._agentSortDir > 0 ? ' ↑' : ' ↓') : '';

    return html`
      <div class="table-wrap">
        <table class="data-table sortable">
          <thead>
            <tr>
              <th @click=${() => this._toggleAgentSort('name')}>Agent${sortIcon('name')}</th>
              <th class="num" @click=${() => this._toggleAgentSort('sessions')}>Total Sessions${sortIcon('sessions')}</th>
              <th class="num" @click=${() => this._toggleAgentSort('activeSessions')}>Active${sortIcon('activeSessions')}</th>
              <th @click=${() => this._toggleAgentSort('activityPct')}>Activity${sortIcon('activityPct')}</th>
              <th @click=${() => this._toggleAgentSort('lastActive')}>Last Active${sortIcon('lastActive')}</th>
              <th @click=${() => this._toggleAgentSort('cronUptime')}>Cron Uptime${sortIcon('cronUptime')}</th>
            </tr>
          </thead>
          <tbody>
            ${agents.map(a => {
              const actPct = a.activityPct ?? 0;
              const cronPct = a.cronUptime ?? a.cronUptimePct ?? 0;
              return html`
                <tr>
                  <td>
                    <span class="agent-cell">
                      <span class="agent-emoji">${a.emoji ?? '🤖'}</span>
                      <span>${a.name ?? a.id}</span>
                    </span>
                  </td>
                  <td class="num">${(a.sessions ?? a.totalSessions ?? 0).toLocaleString()}</td>
                  <td class="num">${(a.activeSessions ?? 0).toLocaleString()}</td>
                  <td>
                    <div class="pct-cell">
                      <div class="pct-bar-bg"><div class="pct-bar-fill accent-bar" style="width:${actPct}%"></div></div>
                      <span class="pct-label">${actPct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td class="dim">${timeAgo(a.lastActive ?? a.lastSession)}</td>
                  <td>
                    <div class="pct-cell">
                      <div class="pct-bar-bg"><div class="pct-bar-fill green-bar" style="width:${cronPct}%"></div></div>
                      <span class="pct-label">${cronPct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderCronReliabilityTable() {
    const jobs = this._sortedCron();
    if (!jobs.length) {return html`<div class="empty-state">No cron data.</div>`;}
    const sortIcon = (key) => this._cronSortKey === key ? (this._cronSortDir > 0 ? ' ↑' : ' ↓') : '';

    return html`
      <div class="table-wrap">
        <table class="data-table sortable">
          <thead>
            <tr>
              <th @click=${() => this._toggleCronSort('name')}>Job Name${sortIcon('name')}</th>
              <th @click=${() => this._toggleCronSort('agentId')}>Agent${sortIcon('agentId')}</th>
              <th class="num" @click=${() => this._toggleCronSort('totalRuns')}>Total Runs${sortIcon('totalRuns')}</th>
              <th class="num" @click=${() => this._toggleCronSort('successes')}>Success${sortIcon('successes')}</th>
              <th class="num" @click=${() => this._toggleCronSort('failures')}>Fail${sortIcon('failures')}</th>
              <th @click=${() => this._toggleCronSort('successRate')}>Rate${sortIcon('successRate')}</th>
              <th>Last Status</th>
              <th @click=${() => this._toggleCronSort('lastRun')}>Last Run${sortIcon('lastRun')}</th>
            </tr>
          </thead>
          <tbody>
            ${jobs.map(j => {
              const total = j.totalRuns ?? j.runCount ?? 0;
              const succ = j.successes ?? j.successCount ?? 0;
              const fail = j.failures ?? j.failCount ?? (total - succ);
              const rate = total > 0 ? (succ / total * 100) : 0;
              const rateColor = rate >= 90 ? 'var(--green)' : rate >= 70 ? 'var(--yellow)' : 'var(--red)';
              const lastStatus = j.lastStatus ?? j.lastRunStatus ?? 'unknown';
              const isSuccess = lastStatus === 'success' || lastStatus === 'ok';
              const isError = lastStatus === 'error' || lastStatus === 'failed' || lastStatus === 'fail';
              return html`
                <tr>
                  <td class="font-medium">${j.name ?? j.id}</td>
                  <td class="dim">${j.agentId ?? j.agent ?? '—'}</td>
                  <td class="num">${total.toLocaleString()}</td>
                  <td class="num" style="color:var(--green)">${succ.toLocaleString()}</td>
                  <td class="num" style="color:${fail > 0 ? 'var(--red)' : 'var(--text-muted)'}">${fail.toLocaleString()}</td>
                  <td>
                    <div class="pct-cell">
                      <div class="pct-bar-bg" style="width:80px">
                        <div class="pct-bar-fill" style="width:${rate.toFixed(1)}%;background:${rateColor}"></div>
                      </div>
                      <span class="pct-label" style="color:${rateColor}">${rate.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td>
                    <span class="badge ${isSuccess ? 'badge-green' : isError ? 'badge-red' : 'badge-gray'}">
                      ${lastStatus}
                    </span>
                  </td>
                  <td class="dim">${timeAgo(j.lastRun ?? j.lastRunAt)}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderSystemResources() {
    const containers = this._perfContainers;
    if (!containers.length) {return html`<div class="empty-state">No container data.</div>`;}
    return html`
      <div class="system-resources">
        ${containers.map(c => {
          const cpuPct = c.cpuPercent ?? c.cpu ?? 0;
          const memMb = c.memUsageMb ?? c.memoryMb ?? (c.memoryBytes ? c.memoryBytes / 1048576 : null);
          const memMax = c.memLimitMb ?? c.memoryLimitMb ?? 1024;
          const memPct = memMb != null && memMax > 0 ? (memMb / memMax) * 100 : 0;
          const memLabel = memMb != null ? (memMb >= 1024 ? (memMb / 1024).toFixed(1) + ' GB' : memMb.toFixed(0) + ' MB') : '—';
          const cpuColor = cpuPct > 80 ? 'var(--red)' : cpuPct > 50 ? 'var(--yellow)' : 'var(--green)';
          const memColor = memPct > 80 ? 'var(--red)' : memPct > 60 ? 'var(--yellow)' : 'var(--accent)';
          return html`
            <div class="container-row">
              <div class="container-name">${c.name ?? c.Names?.[0]?.replace(/^\//, '') ?? 'unknown'}</div>
              <div class="resource-bars">
                <div class="resource-row">
                  <span class="resource-label">CPU</span>
                  <div class="resource-bar-bg">
                    <div class="resource-bar-fill" style="width:${Math.min(cpuPct, 100).toFixed(1)}%;background:${cpuColor}"></div>
                  </div>
                  <span class="resource-pct" style="color:${cpuColor}">${cpuPct.toFixed(1)}%</span>
                </div>
                <div class="resource-row">
                  <span class="resource-label">MEM</span>
                  <div class="resource-bar-bg">
                    <div class="resource-bar-fill" style="width:${Math.min(memPct, 100).toFixed(1)}%;background:${memColor}"></div>
                  </div>
                  <span class="resource-pct" style="color:${memColor}">${memLabel}</span>
                </div>
              </div>
              <div class="container-meta">
                ${c.uptime ? html`<span class="dim">Up ${formatUptime(c.uptime)}</span>` : ''}
                ${c.restartCount != null ? html`<span class="dim">${c.restartCount} restarts</span>` : ''}
              </div>
            </div>
          `;
        })}
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

    .page-analytics {
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

    .page-title {
      margin: 0;
      font-size: var(--font-size-2xl);
      font-weight: 700;
    }

    /* Top-level tabs */
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
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }

    .tab-content { display: flex; flex-direction: column; gap: var(--space-5); }

    /* Period selector */
    .period-row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .period-label {
      font-size: var(--font-size-sm);
      color: var(--text-dim);
      margin-right: var(--space-1);
    }
    .period-btn {
      padding: var(--space-1) var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-full);
      background: var(--surface-2);
      color: var(--text-dim);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition);
    }
    .period-btn:hover { border-color: var(--accent); color: var(--text); }
    .period-btn.active {
      background: var(--accent-dim);
      border-color: var(--accent);
      color: var(--accent);
    }

    /* Loading spinner */
    .loading-spin {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin-left: var(--space-2);
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Summary cards */
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: var(--space-4);
    }
    .summary-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-4);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .summary-label {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .summary-value {
      font-size: var(--font-size-xl);
      font-weight: 700;
      font-family: var(--font-mono);
      color: var(--text);
    }
    .summary-sub {
      font-size: var(--font-size-xs);
      color: var(--text-dim);
      font-family: var(--font-mono);
    }

    /* Status badge */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      border-radius: var(--radius-full);
      font-size: var(--font-size-sm);
      font-weight: 600;
    }
    .badge-green { background: var(--green-dim); color: var(--green); }
    .badge-red { background: var(--red-dim); color: var(--red); }
    .badge-gray { background: var(--surface-3); color: var(--text-muted); }
    .badge-yellow { background: var(--yellow-dim); color: var(--yellow); }
    .badge-orange { background: var(--orange-dim); color: var(--orange); }

    .status-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .dot-green { background: var(--green); box-shadow: 0 0 5px var(--green); }
    .dot-red { background: var(--red); box-shadow: 0 0 5px var(--red); }

    /* Chart card */
    .chart-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-5);
    }
    .chart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-4);
      gap: var(--space-4);
      flex-wrap: wrap;
    }
    .chart-title {
      font-size: var(--font-size-md);
      font-weight: 600;
    }
    .chart-metric-tabs {
      display: flex;
      gap: var(--space-1);
    }
    .metric-tab {
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--text-dim);
      font-size: var(--font-size-xs);
      cursor: pointer;
      transition: all var(--transition);
    }
    .metric-tab:hover { color: var(--text); border-color: var(--accent); }
    .metric-tab.active {
      background: var(--accent-dim);
      border-color: var(--accent);
      color: var(--accent);
    }

    .chart-area {
      display: flex;
      gap: var(--space-3);
      height: 180px;
    }
    .chart-yaxis {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: flex-end;
      width: 56px;
      flex-shrink: 0;
      padding-bottom: 20px; /* leave room for x-axis labels */
    }
    .yaxis-label {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .chart-bars-wrap {
      flex: 1;
      min-width: 0;
      overflow-x: auto;
    }
    .chart-bars {
      display: flex;
      align-items: flex-end;
      height: 100%;
      gap: 3px;
      min-width: 100%;
    }
    .bar-col {
      flex: 1;
      min-width: 18px;
      max-width: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
      justify-content: flex-end;
      cursor: default;
    }
    .bar-fill {
      width: 100%;
      min-height: 2px;
      background: var(--accent);
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      transition: height 0.3s ease, background var(--transition);
    }
    .bar-col:hover .bar-fill { background: var(--accent-hover, rgba(0,212,255,0.6)); }
    .bar-label {
      font-size: 9px;
      color: var(--text-muted);
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      text-align: center;
    }
    .chart-empty {
      text-align: center;
      padding: var(--space-8);
      color: var(--text-muted);
      font-size: var(--font-size-sm);
    }

    /* Collapsible section */
    .data-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .section-header {
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
    .section-header:hover { background: var(--surface-2); }
    .section-title { flex: 1; }
    .section-toggle {
      font-size: var(--font-size-sm);
      color: var(--text-dim);
      transition: color var(--transition-fast);
    }
    .section-header:hover .section-toggle { color: var(--accent); }
    .section-body {
      padding: var(--space-4) var(--space-5);
      padding-top: 0;
      border-top: 1px solid var(--border);
    }

    /* Tables */
    .table-wrap {
      overflow-x: auto;
      margin: var(--space-4) 0;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--font-size-sm);
    }
    .data-table th {
      text-align: left;
      padding: var(--space-2) var(--space-3);
      font-size: var(--font-size-xs);
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    .data-table.sortable th { cursor: pointer; user-select: none; }
    .data-table.sortable th:hover { color: var(--text); }
    .data-table td {
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid rgba(42,53,80,0.5);
      vertical-align: middle;
    }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table tr:hover td { background: var(--surface-2); }
    .data-table .num { text-align: right; font-family: var(--font-mono); }
    .data-table .mono { font-family: var(--font-mono); font-size: var(--font-size-xs); }
    .data-table .dim { color: var(--text-dim); font-size: var(--font-size-xs); }
    .data-table .accent { color: var(--accent); }
    .data-table .font-medium { font-weight: 600; }

    /* Share bar */
    .share-cell {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .share-bar-bg {
      width: 80px;
      height: 6px;
      background: var(--surface-3);
      border-radius: var(--radius-full);
      overflow: hidden;
      flex-shrink: 0;
    }
    .share-bar-fill {
      height: 100%;
      background: var(--accent);
      border-radius: var(--radius-full);
      transition: width 0.3s ease;
    }
    .share-pct {
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      color: var(--text-dim);
      white-space: nowrap;
    }

    /* Percent bars in tables */
    .pct-cell {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .pct-bar-bg {
      width: 80px;
      height: 6px;
      background: var(--surface-3);
      border-radius: var(--radius-full);
      overflow: hidden;
      flex-shrink: 0;
    }
    .pct-bar-fill {
      height: 100%;
      border-radius: var(--radius-full);
      transition: width 0.3s ease;
    }
    .accent-bar { background: var(--accent); }
    .green-bar { background: var(--green); }
    .pct-label {
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      color: var(--text-dim);
      white-space: nowrap;
      min-width: 32px;
    }

    /* Agent cell */
    .agent-cell {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .agent-emoji { font-size: 1rem; }
    .provider-cell { font-weight: 600; }
    .model-cell { font-family: var(--font-mono); font-size: var(--font-size-xs); }

    /* Token breakdown */
    .token-breakdown {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4) 0;
    }
    .token-legend {
      display: flex;
      gap: var(--space-4);
      flex-wrap: wrap;
      margin-bottom: var(--space-2);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--font-size-xs);
      color: var(--text-dim);
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
    .accent-bg { background: var(--accent); }
    .green-bg { background: var(--green); }
    .yellow-bg { background: var(--yellow); }
    .orange-bg { background: var(--orange); }
    .purple-bg { background: var(--purple); }

    .token-row {
      display: flex;
      align-items: center;
      gap: var(--space-4);
    }
    .token-model {
      width: 160px;
      flex-shrink: 0;
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      color: var(--text-dim);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stacked-bar {
      flex: 1;
      height: 18px;
      display: flex;
      border-radius: var(--radius-sm);
      overflow: hidden;
      min-width: 100px;
      background: var(--surface-3);
    }
    .stack-seg {
      height: 100%;
      transition: width 0.3s ease;
    }
    .token-total {
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      color: var(--text-muted);
      white-space: nowrap;
      min-width: 48px;
      text-align: right;
    }

    /* Session id cell */
    .session-id-cell {
      font-size: var(--font-size-xs);
      color: var(--text-dim);
    }

    /* System resources */
    .system-resources {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-4) 0;
    }
    .container-row {
      display: flex;
      align-items: center;
      gap: var(--space-5);
      padding: var(--space-3) var(--space-4);
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      flex-wrap: wrap;
    }
    .container-name {
      font-size: var(--font-size-sm);
      font-weight: 600;
      font-family: var(--font-mono);
      min-width: 140px;
    }
    .resource-bars {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      flex: 1;
      min-width: 200px;
    }
    .resource-row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .resource-label {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      width: 32px;
      flex-shrink: 0;
      font-family: var(--font-mono);
    }
    .resource-bar-bg {
      flex: 1;
      height: 8px;
      background: var(--surface-3);
      border-radius: var(--radius-full);
      overflow: hidden;
    }
    .resource-bar-fill {
      height: 100%;
      border-radius: var(--radius-full);
      transition: width 0.3s ease;
    }
    .resource-pct {
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      min-width: 56px;
      text-align: right;
    }
    .container-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
      align-items: flex-end;
      font-size: var(--font-size-xs);
    }

    /* Usage/performance tabs */
    .usage-tab, .performance-tab {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }

    /* States */
    .empty-state {
      color: var(--text-muted);
      font-size: var(--font-size-sm);
      padding: var(--space-6);
      text-align: center;
    }
    .loading-msg {
      color: var(--text-dim);
      font-size: var(--font-size-sm);
      padding: var(--space-6);
      text-align: center;
    }
    .error-msg {
      font-size: var(--font-size-sm);
      color: var(--red);
      padding: var(--space-2) var(--space-3);
      background: var(--red-dim);
      border-radius: var(--radius);
      border: 1px solid rgba(239,68,68,0.3);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: 600;
    }
  `;
}

customElements.define('page-analytics', PageAnalytics);
