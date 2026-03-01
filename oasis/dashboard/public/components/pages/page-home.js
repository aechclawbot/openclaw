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

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) {return '$\u2014';}
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function getCurrentWeek() {
  const now = new Date();
  // ISO week: the week containing the year's first Thursday
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const daysSinceW1 = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - startOfWeek1) / 86400000);
  const weekNum = Math.floor(daysSinceW1 / 7) + 1;
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getTodayName() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

function eventTypeColor(type) {
  if (!type) {return 'var(--text-dim)';}
  const t = type.toLowerCase();
  if (t.includes('error') || t.includes('fail')) {return 'var(--red)';}
  if (t.includes('warn')) {return 'var(--yellow)';}
  if (t.includes('session') || t.includes('connect')) {return 'var(--green)';}
  if (t.includes('cron') || t.includes('job')) {return 'var(--purple)';}
  if (t.includes('message') || t.includes('chat')) {return 'var(--accent)';}
  return 'var(--text-dim)';
}

function escapeHtml(text) {
  if (!text) {return '';}
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class PageHome extends LitElement {
  static properties = {
    // Health
    gatewayStatus: { type: String },
    channelsCount: { type: Number },
    activeSessions: { type: Number },
    uptime: { type: String },

    // Summary data (kept for right-column cards)
    portfolioUsd: { type: Number },
    portfolioLoading: { type: Boolean },
    portfolioError: { type: Boolean },

    cronActive: { type: Number },
    cronTotal: { type: Number },
    cronLoading: { type: Boolean },

    agentCount: { type: Number },
    agentActiveCount: { type: Number },
    agentLoading: { type: Boolean },

    todayRecipe: { type: Object },
    recipeLoading: { type: Boolean },

    openTodos: { type: Number },
    todosLoading: { type: Boolean },

    // Agent grid (kept for data, rendered via Quick Nav)
    agents: { type: Array },
    agentsGridLoading: { type: Boolean },

    // Needs attention
    failingCrons: { type: Array },
    overdueTodos: { type: Array },
    recentErrors: { type: Array },
    attentionLoading: { type: Boolean },

    // Activity feed
    activities: { type: Array },

    // Chat (NEW)
    chatMessages: { type: Array },
    chatLoading: { type: Boolean },
    chatInput: { type: String },

    // Docker containers (NEW — for System Health)
    containers: { type: Array },
    containersLoading: { type: Boolean },

    // Treasury detail (NEW — for Business Overview)
    treasuryData: { type: Object },
  };

  constructor() {
    super();
    this.gatewayStatus = 'loading';
    this.channelsCount = 0;
    this.activeSessions = 0;
    this.uptime = '\u2014';
    this.portfolioUsd = null;
    this.portfolioLoading = true;
    this.portfolioError = false;
    this.cronActive = 0;
    this.cronTotal = 0;
    this.cronLoading = true;
    this.agentCount = 0;
    this.agentActiveCount = 0;
    this.agentLoading = true;
    this.todayRecipe = null;
    this.recipeLoading = true;
    this.openTodos = 0;
    this.todosLoading = true;
    this.agents = [];
    this.agentsGridLoading = true;
    this.failingCrons = [];
    this.overdueTodos = [];
    this.recentErrors = [];
    this.attentionLoading = true;
    this.activities = [];
    this._healthInterval = null;
    this._unsubActivity = null;

    // Chat
    this.chatMessages = [];
    this.chatLoading = false;
    this.chatInput = '';
    this._chatSessionKey = null;

    // Docker containers
    this.containers = [];
    this.containersLoading = true;

    // Treasury detail
    this.treasuryData = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._fetchAll();
    this._healthInterval = setInterval(() => this._fetchHealth(), 30000);
    this._unsubActivity = eventBus.on('*', (event) => {
      this._onActivity(event);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._healthInterval) {clearInterval(this._healthInterval);}
    if (this._unsubActivity) {this._unsubActivity();}
    this._chatSessionKey = null;
  }

  async _fetchAll() {
    await Promise.allSettled([
      this._fetchHealth(),
      this._fetchPortfolio(),
      this._fetchCron(),
      this._fetchAgents(),
      this._fetchRecipe(),
      this._fetchTodos(),
      this._fetchActivities(),
      this._fetchContainers(),
    ]);
  }

  async _fetchHealth() {
    try {
      const data = await api.get('/api/health');
      const gwOk = data.status === 'ok' || data.gateway?.ok === true || data.gateway?.connected === true;
      this.gatewayStatus = gwOk ? 'connected' : 'disconnected';
      const gw = data.gateway || {};
      this.channelsCount = gw.channelOrder?.length ?? data.channels?.length ?? data.channelsCount ?? 0;
      this.activeSessions = data.sessions ?? gw.sessions?.count ?? data.activeSessions ?? 0;
      if (typeof data.uptime === 'number' && data.uptime > 0) {
        const h = Math.floor(data.uptime / 3600);
        const m = Math.floor((data.uptime % 3600) / 60);
        this.uptime = h > 0 ? `${h}h ${m}m` : `${m}m`;
      } else {
        this.uptime = data.uptime ?? '\u2014';
      }
    } catch {
      this.gatewayStatus = 'disconnected';
    }
  }

  async _fetchPortfolio() {
    this.portfolioLoading = true;
    this.portfolioError = false;
    try {
      const data = await api.get('/api/treasury');
      this.portfolioUsd = data.totalUsd ?? data.total ?? null;
      this.treasuryData = data;
    } catch {
      this.portfolioError = true;
    } finally {
      this.portfolioLoading = false;
    }
  }

  async _fetchCron() {
    this.cronLoading = true;
    try {
      const data = await api.get('/api/cron');
      const jobs = Array.isArray(data) ? data : (data.jobs ?? []);
      this.cronTotal = jobs.length;
      this.cronActive = jobs.filter(j => j.enabled !== false && j.status !== 'disabled').length;
      this.failingCrons = jobs.filter(j => j.status === 'error' || j.lastStatus === 'error' || j.lastResult === 'error');
    } catch {
      this.cronTotal = 0;
      this.cronActive = 0;
      this.failingCrons = [];
    } finally {
      this.cronLoading = false;
      this.attentionLoading = false;
    }
  }

  async _fetchAgents() {
    this.agentLoading = true;
    this.agentsGridLoading = true;
    try {
      const data = await api.get('/api/agents');
      const agents = Array.isArray(data) ? data : (data.agents ?? []);
      this.agents = agents;
      this.agentCount = agents.length;
      this.agentActiveCount = agents.filter(a => a.activeSession || a.status === 'active').length;
    } catch {
      this.agents = [];
      this.agentCount = 0;
      this.agentActiveCount = 0;
    } finally {
      this.agentLoading = false;
      this.agentsGridLoading = false;
    }
  }

  async _fetchRecipe() {
    this.recipeLoading = true;
    try {
      const week = getCurrentWeek();
      const day = getTodayName();
      const data = await api.get(`/api/recipes/${week}/${day}`);
      this.todayRecipe = data;
    } catch {
      this.todayRecipe = null;
    } finally {
      this.recipeLoading = false;
    }
  }

  async _fetchTodos() {
    this.todosLoading = true;
    try {
      const data = await api.get('/api/todos');
      const todos = Array.isArray(data) ? data : (data.todos ?? []);
      this.openTodos = todos.filter(t => t.status !== 'completed' && t.status !== 'done').length;
      this.overdueTodos = todos.filter(t => {
        if (t.status === 'completed' || t.status === 'done') {return false;}
        if (t.status === 'failed') {return true;}
        if (!t.dueDate && !t.due_date) {return false;}
        return new Date(t.dueDate || t.due_date) < new Date();
      });
    } catch {
      this.openTodos = 0;
      this.overdueTodos = [];
    } finally {
      this.todosLoading = false;
    }
  }

  async _fetchActivities() {
    try {
      const data = await api.get('/api/activity?limit=20');
      const events = Array.isArray(data) ? data : (data.activity ?? data.events ?? []);
      this.activities = events.map(ev => ({
        id: ev.id ?? Date.now(),
        timestamp: ev.timestamp ?? (ev.ts ? new Date(ev.ts).toISOString() : new Date().toISOString()),
        type: ev.type ?? 'event',
        agent: ev.agent ?? ev.agentId ?? null,
        description: ev.description ?? ev.message ?? '',
        href: ev.href ?? null,
      }));
    } catch {
      this.activities = [];
    }
  }

  async _fetchContainers() {
    this.containersLoading = true;
    try {
      const data = await api.get('/api/docker/containers');
      this.containers = data?.containers ?? (Array.isArray(data) ? data : []);
    } catch {
      this.containers = [];
    } finally {
      this.containersLoading = false;
    }
  }

  _onActivity(event) {
    if (!event) {return;}
    const activity = {
      id: event.id ?? Date.now(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      type: event.type ?? 'event',
      agent: event.agent ?? event.agentId ?? null,
      description: event.description ?? event.message ?? JSON.stringify(event).slice(0, 80),
      href: event.href ?? null,
    };
    this.activities = [activity, ...this.activities].slice(0, 50);
    if (event.type === 'error') {
      this.recentErrors = [activity, ...this.recentErrors].slice(0, 5);
    }
  }

  _navigate(path) {
    router.navigate(path);
  }

  // --- Chat ---

  _onChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._sendChat();
    }
  }

  _onChatInput(e) {
    this.chatInput = e.target.value;
  }

  async _sendChat() {
    const message = this.chatInput.trim();
    if (!message || this.chatLoading) {return;}

    // Push user message
    this.chatMessages = [
      ...this.chatMessages,
      { role: 'user', text: message, ts: new Date() },
    ];
    this.chatInput = '';
    this.chatLoading = true;

    // Create agent placeholder
    const agentMsg = { role: 'agent', text: '', ts: new Date(), streaming: true };
    this.chatMessages = [...this.chatMessages, agentMsg];

    this.updateComplete.then(() => this._scrollChatToBottom());

    try {
      await api.stream('/api/chat/stream', {
        agentId: 'oasis',
        message,
        ...(this._chatSessionKey ? { sessionKey: this._chatSessionKey } : {}),
      }, (event) => {
        if (event.type === 'token') {
          const text = event.data?.text ?? (typeof event.data === 'string' ? event.data : '');
          // Update the last agent message
          const msgs = [...this.chatMessages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'agent') {
            msgs[msgs.length - 1] = { ...last, text: last.text + text };
            this.chatMessages = msgs;
          }
          this.updateComplete.then(() => this._scrollChatToBottom());
        } else if (event.type === 'done') {
          if (event.data?.sessionKey) {
            this._chatSessionKey = event.data.sessionKey;
          }
          // Mark streaming complete
          const msgs = [...this.chatMessages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'agent') {
            msgs[msgs.length - 1] = { ...last, streaming: false };
            this.chatMessages = msgs;
          }
          this.chatLoading = false;
        } else if (event.type === 'error') {
          const errText = event.data?.text ?? 'Something went wrong';
          const msgs = [...this.chatMessages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'agent') {
            msgs[msgs.length - 1] = { ...last, text: errText, streaming: false, error: true };
            this.chatMessages = msgs;
          }
          this.chatLoading = false;
        } else if (event.type === 'thinking') {
          // Keep loading state, optionally show thinking text
        }
      });
    } catch (err) {
      // Stream failed entirely
      const msgs = [...this.chatMessages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'agent') {
        msgs[msgs.length - 1] = { ...last, text: `Error: ${err.message}`, streaming: false, error: true };
        this.chatMessages = msgs;
      }
      this.chatLoading = false;
    }
  }

  _scrollChatToBottom() {
    const el = this.shadowRoot?.querySelector('.chat-messages');
    if (el) {el.scrollTop = el.scrollHeight;}
  }

  async _retryCron(jobId) {
    try {
      await api.post(`/api/cron/${jobId}/run`);
      // Refresh cron data
      await this._fetchCron();
    } catch {
      // api.post already shows toast on error
    }
  }

  async _runTodo(todoId) {
    try {
      await api.post(`/api/todos/${todoId}/run`);
      await this._fetchTodos();
    } catch {
      // toast handled by api client
    }
  }

  // --- Render helpers ---

  _renderHealthBanner() {
    const isConnected = this.gatewayStatus === 'connected';
    const isLoading = this.gatewayStatus === 'loading';
    return html`
      <div class="health-banner ${isConnected ? 'connected' : isLoading ? 'loading' : 'disconnected'}">
        <div class="health-left">
          <span class="status-dot ${isConnected ? 'green' : isLoading ? 'yellow' : 'red'}"></span>
          <span class="health-label">Gateway</span>
          <span class="health-value">${isLoading ? 'Checking...' : isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div class="health-stats">
          <span class="health-stat">
            <span class="stat-label">Channels</span>
            <span class="stat-val">${this.channelsCount}</span>
          </span>
          <span class="health-stat">
            <span class="stat-label">Sessions</span>
            <span class="stat-val">${this.activeSessions}</span>
          </span>
          <span class="health-stat">
            <span class="stat-label">Uptime</span>
            <span class="stat-val">${this.uptime}</span>
          </span>
        </div>
      </div>
    `;
  }

  _renderSkeleton() {
    return html`<span class="skeleton"></span>`;
  }

  // --- NEW: Chat Card ---

  _renderChatCard() {
    const isConnected = this.gatewayStatus === 'connected';
    return html`
      <div class="chat-card">
        <div class="chat-header">
          <span class="status-dot ${isConnected ? 'green' : 'red'}"></span>
          <span class="chat-title">OASIS</span>
          ${this.chatLoading ? html`<span class="chat-thinking">thinking</span>` : ''}
        </div>
        <div class="chat-messages">
          ${this.chatMessages.length === 0
            ? html`
              <div class="chat-empty">
                ${isConnected
                  ? 'Gateway connected. What are we tackling today?'
                  : 'Gateway disconnected. Reconnecting...'}
              </div>
            `
            : this.chatMessages.map(msg => html`
              <div class="chat-msg ${msg.role} ${msg.error ? 'error' : ''} ${msg.streaming ? 'streaming' : ''}">
                <div class="chat-msg-text">${msg.text || (msg.streaming ? '' : '\u2014')}</div>
                ${msg.streaming && !msg.text ? html`<span class="typing-dots"><span></span><span></span><span></span></span>` : ''}
              </div>
            `)}
        </div>
        <div class="chat-input-area">
          <input
            class="chat-input"
            type="text"
            placeholder="${isConnected ? 'Message OASIS...' : 'Waiting for gateway...'}"
            .value=${this.chatInput}
            @input=${this._onChatInput}
            @keydown=${this._onChatKeydown}
            ?disabled=${!isConnected || this.chatLoading}
          />
          <button
            class="btn btn-send"
            @click=${this._sendChat}
            ?disabled=${!isConnected || this.chatLoading || !this.chatInput.trim()}
          >\u2191</button>
        </div>
      </div>
    `;
  }

  // --- NEW: Action Center ---

  _renderActionCenter() {
    const items = [];

    // Failing crons (red)
    for (const j of this.failingCrons) {
      items.push({
        type: 'error',
        label: `Cron failing: ${j.name ?? j.id}`,
        detail: j.lastError ?? j.error ?? '',
        actions: [
          { label: 'Retry', handler: () => this._retryCron(j.id) },
          { label: 'View Logs', handler: () => this._navigate('#/operations') },
        ],
      });
    }

    // Overdue / failed todos (yellow)
    for (const t of this.overdueTodos) {
      items.push({
        type: 'warning',
        label: t.status === 'failed' ? `Failed: ${t.title ?? t.id}` : `Overdue: ${t.title ?? t.id}`,
        detail: t.dueDate || t.due_date ? `Due ${t.dueDate ?? t.due_date}` : (t.description ?? ''),
        actions: [
          { label: 'Run', handler: () => this._runTodo(t.id) },
        ],
      });
    }

    // Recent errors (red)
    for (const e of this.recentErrors.slice(0, 3)) {
      items.push({
        type: 'error',
        label: e.description,
        detail: timeAgo(e.timestamp),
        actions: e.href ? [{ label: 'View', handler: () => this._navigate(e.href) }] : [],
      });
    }

    // Recent noteworthy activity (cyan/review)
    const noteworthy = this.activities
      .filter(ev => {
        const t = (ev.type ?? '').toLowerCase();
        return t.includes('complete') || t.includes('brief') || t.includes('deploy');
      })
      .slice(0, 3);
    for (const ev of noteworthy) {
      items.push({
        type: 'review',
        label: ev.description,
        detail: `${ev.agent ? ev.agent + ' \u00b7 ' : ''}${timeAgo(ev.timestamp)}`,
        actions: ev.href ? [{ label: 'Review', handler: () => this._navigate(ev.href) }] : [],
      });
    }

    // Sort: errors first, then warnings, then reviews
    const order = { error: 0, warning: 1, review: 2 };
    items.sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3));
    const visible = items.slice(0, 8);

    return html`
      <div class="action-center">
        <div class="ac-header">
          <h3 class="ac-title">Action Center</h3>
          ${visible.length > 0 ? html`<span class="ac-badge">${visible.length}</span>` : ''}
        </div>
        ${this.attentionLoading ? html`
          <div class="ac-list">
            ${[1,2].map(() => html`<div class="action-item skeleton-card"></div>`)}
          </div>
        ` : visible.length === 0 ? html`
          <div class="ac-empty">
            <span class="ac-check">\u2713</span>
            All clear \u2014 no items need attention
          </div>
        ` : html`
          <div class="ac-list">
            ${visible.map(item => html`
              <div class="action-item ${item.type}">
                <div class="action-item-body">
                  <div class="action-item-label">${item.label}</div>
                  ${item.detail ? html`<div class="action-item-detail">${item.detail}</div>` : ''}
                </div>
                ${item.actions.length > 0 ? html`
                  <div class="action-item-actions">
                    ${item.actions.map(a => html`
                      <button class="btn btn-sm" @click=${a.handler}>${a.label}</button>
                    `)}
                  </div>
                ` : ''}
              </div>
            `)}
          </div>
        `}
      </div>
    `;
  }

  // --- NEW: System Health ---

  _renderSystemHealth() {
    return html`
      <div class="cc-card">
        <h4 class="cc-card-title">System Health</h4>
        ${this.containersLoading ? html`
          <div class="health-chips">${this._renderSkeleton()} ${this._renderSkeleton()}</div>
        ` : html`
          <div class="health-chips">
            <span class="health-chip ${this.gatewayStatus === 'connected' ? 'ok' : 'err'}">
              <span class="status-dot ${this.gatewayStatus === 'connected' ? 'green' : 'red'}"></span>
              Gateway
            </span>
            <span class="health-chip ok">
              <span class="chip-icon">\u23f1</span>
              ${this.uptime}
            </span>
            ${this.containers.map(c => {
              const running = (c.status ?? '').toLowerCase().includes('running') ||
                              (c.state ?? '').toLowerCase() === 'running' ||
                              (c.health ?? '').toLowerCase() === 'healthy';
              return html`
                <span class="health-chip ${running ? 'ok' : 'err'}">
                  <span class="status-dot ${running ? 'green' : 'red'}"></span>
                  ${c.name ?? c.Names?.[0]?.replace(/^\//, '') ?? 'container'}
                </span>
              `;
            })}
          </div>
        `}
      </div>
    `;
  }

  // --- NEW: Household Snapshot ---

  _renderHouseholdSnapshot() {
    return html`
      <div class="cc-card clickable" @click=${() => this._navigate('#/household')}>
        <h4 class="cc-card-title">Today's Plan</h4>
        ${this.recipeLoading ? html`
          <div class="snapshot-body">${this._renderSkeleton()}</div>
        ` : this.todayRecipe ? html`
          <div class="snapshot-body">
            <span class="snapshot-icon">\uD83C\uDF7D\uFE0F</span>
            <div class="snapshot-info">
              <div class="snapshot-name">${this.todayRecipe.name ?? this.todayRecipe.title ?? 'Planned'}</div>
              ${this.todayRecipe.cookTime || this.todayRecipe.totalTime
                ? html`<div class="snapshot-meta">${this.todayRecipe.cookTime ?? this.todayRecipe.totalTime}</div>`
                : ''}
            </div>
            <span class="snapshot-arrow">\u203a</span>
          </div>
        ` : html`
          <div class="snapshot-empty">
            <span class="snapshot-empty-text">No meal planned for today</span>
          </div>
        `}
      </div>
    `;
  }

  // --- NEW: Business Overview ---

  _renderBusinessOverview() {
    const walletCount = Object.keys(this.treasuryData?.wallets ?? {}).length;
    return html`
      <div class="cc-card clickable" @click=${() => this._navigate('#/business')}>
        <h4 class="cc-card-title">Treasury</h4>
        ${this.portfolioLoading ? html`
          <div class="biz-body">${this._renderSkeleton()}</div>
        ` : this.portfolioError ? html`
          <div class="biz-body"><span class="unavailable">unavailable</span></div>
        ` : html`
          <div class="biz-body">
            <div class="biz-total">${formatCurrency(this.portfolioUsd)}</div>
            <div class="biz-meta">
              ${this.treasuryData?.ethPrice
                ? html`<span>ETH ${formatCurrency(this.treasuryData.ethPrice)}</span>`
                : ''}
              ${walletCount > 0 ? html`<span>${walletCount} wallet${walletCount > 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>
          <span class="snapshot-arrow">\u203a</span>
        `}
      </div>
    `;
  }

  // --- NEW: Quick Nav ---

  _renderQuickNav() {
    const links = [
      { label: 'Agents', path: '#/agents' },
      { label: 'Operations', path: '#/operations' },
      { label: 'Knowledge', path: '#/knowledge' },
      { label: 'Household', path: '#/household' },
      { label: 'Analytics', path: '#/analytics' },
    ];
    return html`
      <div class="quick-nav">
        ${links.map(l => html`
          <button class="qn-pill" @click=${() => this._navigate(l.path)}>${l.label}</button>
        `)}
      </div>
    `;
  }

  // --- Main Render ---

  render() {
    return html`
      <div class="page-home">
        ${this._renderHealthBanner()}
        <div class="command-center">
          <div class="cc-left">
            ${this._renderChatCard()}
            ${this._renderActionCenter()}
          </div>
          <div class="cc-right">
            ${this._renderSystemHealth()}
            ${this._renderHouseholdSnapshot()}
            ${this._renderBusinessOverview()}
            ${this._renderQuickNav()}
          </div>
        </div>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      font-family: var(--font-sans);
      color: var(--text);
    }

    /* Health Banner */
    .health-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--space-4);
      padding: var(--space-3) var(--space-6);
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      font-size: var(--font-size-sm);
    }
    .health-banner.connected { border-left: 3px solid var(--green); }
    .health-banner.disconnected { border-left: 3px solid var(--red); }
    .health-banner.loading { border-left: 3px solid var(--yellow); }

    .health-left {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .health-label {
      color: var(--text-dim);
      text-transform: uppercase;
      font-size: var(--font-size-xs);
      letter-spacing: 0.06em;
    }
    .health-value { font-weight: 600; }

    .health-stats {
      display: flex;
      gap: var(--space-6);
    }
    .health-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    .stat-label {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-val { font-weight: 600; font-size: var(--font-size-sm); }

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
    .status-dot.red {
      background: var(--red);
      box-shadow: 0 0 6px var(--red);
    }
    .status-dot.yellow {
      background: var(--yellow);
      box-shadow: 0 0 6px var(--yellow);
    }
    .status-dot.gray {
      background: var(--text-muted);
    }

    /* ===== Two-Column Command Center ===== */
    .command-center {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: var(--space-6);
      padding: var(--space-6);
      min-height: 0;
    }
    .cc-left {
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
      min-width: 0;
    }
    .cc-right {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }

    @media (max-width: 1024px) {
      .command-center { grid-template-columns: 1fr; }
      .cc-left { order: -1; }
    }

    /* ===== Chat Card ===== */
    .chat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      display: flex;
      flex-direction: column;
      min-height: 300px;
      max-height: 500px;
    }
    .chat-header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      border-bottom: 1px solid var(--border);
    }
    .chat-title {
      font-weight: 700;
      font-size: var(--font-size-sm);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .chat-thinking {
      margin-left: auto;
      font-size: var(--font-size-xs);
      color: var(--accent);
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .chat-empty {
      color: var(--text-muted);
      font-size: var(--font-size-sm);
      text-align: center;
      padding: var(--space-8) var(--space-4);
      align-self: center;
    }
    .chat-msg {
      max-width: 75%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 0.9rem;
      line-height: 1.55;
      word-break: break-word;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: var(--accent-dim, rgba(0,212,255,0.15));
      border: 1px solid rgba(0,212,255,0.25);
      color: var(--text, #e0e6f0);
      border-bottom-right-radius: 4px;
    }
    .chat-msg.agent {
      align-self: flex-start;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      border-bottom-left-radius: 4px;
    }
    .chat-msg.error {
      color: var(--red);
    }

    /* Typing dots */
    .typing-dots {
      display: inline-flex;
      gap: 4px;
      padding: 4px 0;
    }
    .typing-dots span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
      animation: bounce 1.4s ease-in-out infinite;
    }
    .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }

    .chat-input-area {
      display: flex;
      gap: var(--space-2);
      padding: var(--space-3);
      border-top: 1px solid var(--border);
    }
    .chat-input {
      flex: 1;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: var(--space-2) var(--space-3);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: var(--font-size-sm);
      outline: none;
      transition: border-color var(--transition);
    }
    .chat-input:focus {
      border-color: var(--accent);
    }
    .chat-input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .chat-input::placeholder {
      color: var(--text-muted);
    }
    .btn-send {
      width: 36px;
      height: 36px;
      padding: 0;
      border-radius: var(--radius);
      background: var(--accent);
      color: white;
      border: none;
      font-size: var(--font-size-md);
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity var(--transition);
      flex-shrink: 0;
    }
    .btn-send:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    .btn-send:hover:not(:disabled) {
      opacity: 0.85;
    }

    /* ===== Action Center ===== */
    .action-center {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .ac-header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .ac-title {
      margin: 0;
      font-size: var(--font-size-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
    }
    .ac-badge {
      background: var(--red);
      color: white;
      font-size: var(--font-size-xs);
      font-weight: 700;
      padding: 1px 7px;
      border-radius: var(--radius-full);
      line-height: 1.4;
    }
    .ac-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .ac-empty {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-4);
      color: var(--text-muted);
      font-size: var(--font-size-sm);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    .ac-check {
      color: var(--green);
      font-size: var(--font-size-lg);
      font-weight: 700;
    }

    .action-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: background var(--transition);
    }
    .action-item:hover { background: var(--surface-2); }
    .action-item.error { border-left: 3px solid var(--red); }
    .action-item.warning { border-left: 3px solid var(--yellow); }
    .action-item.review { border-left: 3px solid var(--accent); }

    .action-item-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .action-item-label {
      font-size: var(--font-size-sm);
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .action-item-detail {
      font-size: var(--font-size-xs);
      color: var(--text-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .action-item-actions {
      margin-left: auto;
      display: flex;
      gap: var(--space-2);
      flex-shrink: 0;
    }

    /* ===== Right Column Cards ===== */
    .cc-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-4);
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      transition: border-color var(--transition);
    }
    .cc-card.clickable {
      cursor: pointer;
    }
    .cc-card.clickable:hover {
      border-color: var(--accent);
    }
    .cc-card-title {
      margin: 0;
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
    }

    /* Health chips */
    .health-chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .health-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: var(--space-1) var(--space-3);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: 500;
      background: var(--surface-2);
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .health-chip.ok {
      border-color: color-mix(in srgb, var(--green) 30%, transparent);
    }
    .health-chip.err {
      border-color: color-mix(in srgb, var(--red) 30%, transparent);
    }
    .chip-icon {
      font-size: 0.7rem;
    }

    /* Household snapshot */
    .snapshot-body {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .snapshot-icon { font-size: 1.4rem; flex-shrink: 0; }
    .snapshot-info { flex: 1; min-width: 0; }
    .snapshot-name {
      font-weight: 600;
      font-size: var(--font-size-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .snapshot-meta {
      font-size: var(--font-size-xs);
      color: var(--text-dim);
    }
    .snapshot-arrow {
      color: var(--text-muted);
      font-size: var(--font-size-xl);
      flex-shrink: 0;
    }
    .snapshot-empty {
      padding: var(--space-2) 0;
    }
    .snapshot-empty-text {
      font-size: var(--font-size-sm);
      color: var(--text-muted);
    }

    /* Business overview */
    .biz-body {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .biz-total {
      font-size: var(--font-size-xl);
      font-weight: 700;
      color: var(--text);
    }
    .biz-meta {
      display: flex;
      gap: var(--space-4);
      font-size: var(--font-size-xs);
      color: var(--text-dim);
    }
    .unavailable {
      color: var(--text-muted);
      font-size: var(--font-size-sm);
    }

    /* Quick nav */
    .quick-nav {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .qn-pill {
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-full);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-dim);
      font-family: var(--font-sans);
      font-size: var(--font-size-xs);
      font-weight: 500;
      cursor: pointer;
      transition: background var(--transition), border-color var(--transition), color var(--transition);
      white-space: nowrap;
    }
    .qn-pill:hover {
      background: var(--surface-2);
      border-color: var(--accent);
      color: var(--text);
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: background var(--transition), border-color var(--transition);
      text-decoration: none;
      white-space: nowrap;
    }
    .btn:hover {
      background: var(--surface-3);
      border-color: var(--accent);
    }
    .btn-sm { padding: var(--space-1) var(--space-2); font-size: var(--font-size-xs); }

    /* Skeleton loading */
    .skeleton {
      display: inline-block;
      width: 80px;
      height: 1.2em;
      border-radius: var(--radius-sm);
      background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    .skeleton-card {
      height: 52px;
      border-radius: var(--radius);
      background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .empty-state {
      color: var(--text-muted);
      font-size: var(--font-size-sm);
      padding: var(--space-6);
      text-align: center;
    }
  `;
}

customElements.define('page-home', PageHome);
