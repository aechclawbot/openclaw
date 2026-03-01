/**
 * OASIS Dashboard v3 — Chat Page
 * Full interactive chat with OASIS agents: streaming SSE, tool call blocks,
 * thinking blocks, session history, agent sidebar, markdown rendering.
 */

import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';
import { store } from '/app/store.js';
import { router } from '/app/router.js';
import { eventBus } from '/app/events.js';

// ─── Agent Registry ──────────────────────────────────────────────────────────

// Fallback agent list used until /api/agents responds.
const FALLBACK_AGENTS = [
  { id: 'oasis',        name: 'OASIS',        emoji: '🌐', pinned: true },
  { id: 'anorak',       name: 'Anorak',        emoji: '🧙‍♂️' },
  { id: 'curator',      name: 'Curator',       emoji: '📚' },
  { id: 'art3mis',      name: 'Art3mis',       emoji: '🛡️' },
  { id: 'ogden',        name: 'Ogden',         emoji: '🧙' },
  { id: 'ir0k',         name: 'I-r0k',         emoji: '🕵️' },
  { id: 'nolan',        name: 'Nolan',         emoji: '🎯' },
  { id: 'aech',         name: 'Aech',          emoji: '⚡' },
  { id: 'dito',         name: 'Dito',          emoji: '🔨' },
  { id: 'oasis-social', name: 'OASIS Social',  emoji: '💬' },
];

// ─── Markdown Renderer ───────────────────────────────────────────────────────

/**
 * Lightweight markdown-to-HTML converter.
 * HTML-escapes first, then applies markdown transforms in safe order.
 * Blocks dangerous URL schemes in links.
 */
function renderMarkdown(text) {
  if (!text) {return '';}

  // 1. HTML-escape raw input to prevent XSS
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // 2. Fenced code blocks (``` lang\n...\n```)
  s = s.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const cls = lang.trim() ? ` class="language-${lang.trim()}"` : '';
    return `<pre class="md-pre"><code${cls}>${code.trimEnd()}</code></pre>`;
  });

  // 3. Inline code (`...`)
  s = s.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');

  // 4. Headers (#### → h4, down to #)
  s = s.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  s = s.replace(/^### (.+)$/gm,  '<h3 class="md-h3">$1</h3>');
  s = s.replace(/^## (.+)$/gm,   '<h2 class="md-h2">$1</h2>');
  s = s.replace(/^# (.+)$/gm,    '<h1 class="md-h1">$1</h1>');

  // 5. Horizontal rules (--- or ***)
  s = s.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr class="md-hr">');

  // 6. Blockquotes (> ...)
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');

  // 7. Unordered lists (lines starting with - or *)
  s = s.replace(/^[ \t]*[-*] (.+)$/gm, '<li class="md-li">$1</li>');
  s = s.replace(/(<li[^>]*>.*<\/li>\n?)+/g, m => `<ul class="md-ul">${m}</ul>`);

  // 8. Ordered lists (lines starting with N.)
  s = s.replace(/^[ \t]*\d+\. (.+)$/gm, '<li class="md-li">$1</li>');
  // Note: ordered list wrapping — tag second pass to avoid double-wrapping
  s = s.replace(/(<ul[^>]*>[\s\S]*?<\/ul>)|(<li[^>]*>.*?<\/li>\n?)+/g, m => {
    if (m.startsWith('<ul')) {return m;}
    return `<ol class="md-ol">${m}</ol>`;
  });

  // 9. Bold (**text** or __text__)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

  // 10. Italic (*text* or _text_) — only single markers to avoid collision
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');

  // 11. Links [text](url) — block dangerous schemes
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const dangerous = /^(javascript|data|vbscript):/i.test(url.trim());
    if (dangerous) {return `[${text}]`;}
    return `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // 12. Paragraphs — wrap consecutive non-block lines
  const lines = s.split('\n');
  const out = [];
  let paraLines = [];

  const flushPara = () => {
    if (paraLines.length) {
      const joined = paraLines.join('<br>').trim();
      if (joined) {out.push(`<p class="md-p">${joined}</p>`);}
      paraLines = [];
    }
  };

  const BLOCK_TAGS = /^<(h[1-4]|ul|ol|li|pre|blockquote|hr)/;

  for (const line of lines) {
    if (BLOCK_TAGS.test(line.trim())) {
      flushPara();
      out.push(line);
    } else if (line.trim() === '') {
      flushPara();
    } else {
      paraLines.push(line);
    }
  }
  flushPara();

  return out.join('\n');
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function formatTime(ts) {
  if (!ts) {return '';}
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) {return '';}
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 86_400_000) {return formatTime(ts);}
  if (diff < 604_800_000) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function truncate(str, len = 40) {
  if (!str) {return '';}
  return str.length > len ? str.slice(0, len).trimEnd() + '…' : str;
}

function generateMsgId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export class PageChat extends LitElement {
  static properties = {
    // Sidebar / agent state
    _agents: { state: true },
    _selectedAgentId: { state: true },
    _sessions: { state: true },
    _sidebarOpen: { state: true },

    // Chat state
    _messages: { state: true },
    _sessionId: { state: true },
    _inputText: { state: true },
    _sending: { state: true },
    _showScrollBtn: { state: true },
    _charCount: { state: true },
    _typingText: { state: true },

    // Session history loading
    _sessionsLoading: { state: true },
    _messagesLoading: { state: true },
  };

  constructor() {
    super();
    this._agents = FALLBACK_AGENTS.map(a => ({ ...a, status: 'unknown', lastMessage: '' }));
    this._selectedAgentId = 'oasis';
    this._sessions = [];
    this._sidebarOpen = false;
    this._messages = [];
    this._sessionId = null;
    this._inputText = '';
    this._sending = false;
    this._showScrollBtn = false;
    this._charCount = 0;
    this._typingText = '';
    this._sessionsLoading = false;
    this._messagesLoading = false;

    // Streaming state — not reactive (managed imperatively for perf)
    this._streamingMsgId = null;
    this._streamBuffer = '';
    this._streamTimer = null;
    this._thinkingTimer = null;
    this._userScrolled = false;

    this._handleEventBus = this._handleEventBus.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    eventBus.on('chat_message', this._handleEventBus);

    // Handle route params on connect
    const params = router.match('/chat/:agentId');
    if (params?.agentId) {
      this._selectedAgentId = params.agentId;
    }

    // Register route listeners for future navigation within chat
    // Store unsubscribe functions for cleanup in disconnectedCallback
    this._routeUnsubs = [
      router.onRoute('/chat', () => {
        this._selectedAgentId = 'oasis';
        this._loadAgentSessions(this._selectedAgentId);
      }),
      router.onRoute('/chat/:agentId', (p) => {
        if (p.agentId && p.agentId !== this._selectedAgentId) {
          this._selectedAgentId = p.agentId;
          this._loadAgentSessions(p.agentId);
        }
      }),
    ];

    this._loadAgentStatuses();
    this._loadAgentSessions(this._selectedAgentId);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    eventBus.off('chat_message', this._handleEventBus);
    // Clean up route listeners to prevent leaks
    if (this._routeUnsubs) {
      this._routeUnsubs.forEach(unsub => unsub());
      this._routeUnsubs = null;
    }
    if (this._streamTimer) {clearTimeout(this._streamTimer);}
  }

  // ─── Data Loading ──────────────────────────────────────────────────────────

  async _loadAgentStatuses() {
    try {
      const data = await api.get('/api/agents');
      const agentList = Array.isArray(data) ? data : (data?.agents ?? []);
      if (!agentList.length) {return;}

      // Build the full agent list dynamically from the API response.
      // Merge with fallback data (emoji, pinned) for known agents,
      // and include any new agents the API returns.
      const fallbackMap = Object.fromEntries(FALLBACK_AGENTS.map(a => [a.id, a]));
      this._agents = agentList.map(a => {
        const fb = fallbackMap[a.id];
        return {
          id: a.id,
          // Prefer fallback name for known agents (curated for dashboard display)
          name: fb?.name || a.displayName || a.name || a.id,
          emoji: a.emoji || fb?.emoji || '🤖',
          pinned: fb?.pinned || false,
          status: a.status ?? 'unknown',
          model: a.model ?? '',
          lastMessage: a.lastMessage ?? '',
        };
      });
    } catch {
      // Graceful degradation — agents show from fallback list as unknown
    }
  }

  async _loadAgentSessions(agentId) {
    this._sessionsLoading = true;
    try {
      const data = await api.get(`/api/chat/sessions?agentId=${encodeURIComponent(agentId)}`);
      this._sessions = Array.isArray(data) ? data : (data?.sessions ?? []);
    } catch {
      this._sessions = [];
    } finally {
      this._sessionsLoading = false;
    }
  }

  async _loadSession(sessionId) {
    this._messagesLoading = true;
    this._messages = [];
    this._sessionId = sessionId;
    try {
      const data = await api.get(`/api/chat/sessions/${encodeURIComponent(sessionId)}`);
      if (data?.messages) {
        this._messages = data.messages.map(m => ({
          id: generateMsgId(),
          role: m.role,
          content: m.content,
          ts: m.timestamp || m.ts || Date.now(),
          toolCalls: m.toolCalls || [],
          thinking: m.thinking || '',
        }));
      }
    } catch {
      this._messages = [];
    } finally {
      this._messagesLoading = false;
      this.updateComplete.then(() => this._scrollToBottom(true));
    }
  }

  // ─── Event Handlers ────────────────────────────────────────────────────────

  _handleEventBus(event) {
    // Incoming message from another channel (broadcast)
    if (event.agentId === this._selectedAgentId) {
      this._messages = [
        ...this._messages,
        {
          id: generateMsgId(),
          role: 'agent',
          content: event.text || '',
          ts: event.timestamp || Date.now(),
          toolCalls: [],
          thinking: '',
        },
      ];
      this.updateComplete.then(() => this._maybeScrollToBottom());
    }
    // Refresh session list
    this._loadAgentSessions(this._selectedAgentId);
  }

  _onSelectAgent(agentId) {
    if (agentId === this._selectedAgentId && !this._sessionId) {return;}
    this._selectedAgentId = agentId;
    this._messages = [];
    this._sessionId = null;
    this._sidebarOpen = false;
    router.navigate(`/chat/${agentId}`);
    this._loadAgentSessions(agentId);
  }

  _onSelectSession(session) {
    this._selectedAgentId = session.agentId || this._selectedAgentId;
    this._loadSession(session.id);
    this._sidebarOpen = false;
  }

  _onNewChat() {
    this._messages = [];
    this._sessionId = null;
  }

  _onInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._sendMessage();
    }
  }

  _onInputInput(e) {
    this._inputText = e.target.value;
    this._charCount = e.target.value.length;
    this._autoResizeTextarea(e.target);
  }

  _autoResizeTextarea(el) {
    el.style.height = 'auto';
    const maxH = 200;
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
  }

  _onMessagesScroll(e) {
    const el = e.target;
    const threshold = 80;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    this._userScrolled = !atBottom;
    this._showScrollBtn = !atBottom;
  }

  _scrollToBottom(force = false) {
    if (!force && this._userScrolled) {return;}
    const area = this.shadowRoot?.querySelector('.messages-area');
    if (area) {
      area.scrollTop = area.scrollHeight;
    }
    this._showScrollBtn = false;
  }

  _maybeScrollToBottom() {
    if (!this._userScrolled) {
      this._scrollToBottom(true);
    }
  }

  _onScrollToBottomBtn() {
    this._userScrolled = false;
    this._scrollToBottom(true);
  }

  _onCopySessionId() {
    if (this._sessionId) {
      navigator.clipboard.writeText(this._sessionId).catch(() => {});
    }
  }

  _onToggleSidebar() {
    this._sidebarOpen = !this._sidebarOpen;
  }

  _onAgentSelectorChange(e) {
    this._onSelectAgent(e.target.value);
  }

  _onToggleBlock(e) {
    const btn = e.currentTarget;
    const block = btn.closest('.collapsible-block');
    if (!block) {return;}
    const body = block.querySelector('.block-body');
    if (!body) {return;}
    const collapsed = body.hasAttribute('hidden');
    if (collapsed) {
      body.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
    } else {
      body.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  // ─── Sending / Streaming ───────────────────────────────────────────────────

  async _sendMessage() {
    const text = this._inputText.trim();
    if (!text || this._sending) {return;}

    // Add user message immediately
    const userMsg = {
      id: generateMsgId(),
      role: 'user',
      content: text,
      ts: Date.now(),
      toolCalls: [],
      thinking: '',
    };
    this._messages = [...this._messages, userMsg];
    this._inputText = '';
    this._charCount = 0;

    // Reset textarea height
    const textarea = this.shadowRoot?.querySelector('.chat-textarea');
    if (textarea) {
      textarea.value = '';
      textarea.style.height = '44px';
    }

    this.updateComplete.then(() => this._scrollToBottom(true));

    // Add typing indicator
    const typingId = `typing-${Date.now()}`;
    this._typingText = 'Thinking...';
    this._messages = [
      ...this._messages,
      { id: typingId, role: 'agent', content: '', ts: Date.now(), typing: true, toolCalls: [], thinking: '' },
    ];
    this.updateComplete.then(() => this._scrollToBottom(true));

    this._sending = true;

    // Client-side timer: update typing text if no SSE events arrive within 30s
    if (this._thinkingTimer) {clearTimeout(this._thinkingTimer);}
    this._thinkingTimer = setTimeout(() => {
      this._typingText = 'Still working on it...';
    }, 30_000);
    this._streamingMsgId = null;
    this._streamBuffer = '';

    try {
      await this._streamResponse(text, typingId);
    } catch (err) {
      // Remove typing indicator, show error
      this._messages = this._messages.filter(m => m.id !== typingId);
      this._messages = [
        ...this._messages,
        {
          id: generateMsgId(),
          role: 'error',
          content: `Error: ${err.message || 'Stream failed'}`,
          ts: Date.now(),
          toolCalls: [],
          thinking: '',
        },
      ];
    } finally {
      this._sending = false;
      if (this._streamTimer) {
        clearTimeout(this._streamTimer);
        this._streamTimer = null;
      }
      if (this._thinkingTimer) {
        clearTimeout(this._thinkingTimer);
        this._thinkingTimer = null;
      }
      this._typingText = '';
      this.updateComplete.then(() => this._maybeScrollToBottom());
    }
  }

  async _streamResponse(text, typingId) {
    const body = JSON.stringify({
      agentId: this._selectedAgentId,
      message: text,
      ...(this._sessionId ? { sessionKey: this._sessionId } : {}),
    });

    const resp = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error(errText || `HTTP ${resp.status}`);
    }

    // Keep typing indicator visible until we get actual content.
    // Prepare the agent message shell but don't swap it in yet.
    const agentMsgId = generateMsgId();
    this._streamingMsgId = agentMsgId;
    let typingRemoved = false;

    const ensureAgentMsg = () => {
      if (typingRemoved) {return;}
      typingRemoved = true;
      this._messages = this._messages.filter(m => m.id !== typingId);
      this._messages = [
        ...this._messages,
        {
          id: agentMsgId,
          role: 'agent',
          content: '',
          ts: Date.now(),
          toolCalls: [],
          thinking: '',
          thinkingContent: '',
          streaming: true,
        },
      ];
    };

    // Stash typingId and ensureAgentMsg so _handleSSEEvent can use them
    this._pendingTypingSwap = ensureAgentMsg;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {break;}

      sseBuffer += decoder.decode(value, { stream: true });

      // Process all complete SSE events in buffer
      const events = sseBuffer.split('\n\n');
      sseBuffer = events.pop() ?? ''; // keep incomplete last chunk

      for (const rawEvent of events) {
        if (!rawEvent.trim()) {continue;}
        this._handleSSEEvent(rawEvent, agentMsgId);
      }
    }

    // If we never got a content event, swap now so flush/done logic works
    ensureAgentMsg();
    this._pendingTypingSwap = null;

    // Flush any remaining stream buffer
    if (this._streamBuffer) {
      this._flushStreamBuffer(agentMsgId);
    }

    // Mark streaming done
    this._messages = this._messages.map(m =>
      m.id === agentMsgId ? { ...m, streaming: false } : m
    );
  }

  _handleSSEEvent(rawEvent, agentMsgId) {
    // Any SSE event means the server is alive — reset the client-side thinking timer
    if (this._thinkingTimer) {
      clearTimeout(this._thinkingTimer);
      this._thinkingTimer = null;
    }

    let eventType = 'message';
    let dataLines = [];

    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event: ') || line.startsWith('event:')) {
        eventType = line.slice(line.indexOf(':') + 1).trim();
      } else if (line.startsWith('data: ') || line.startsWith('data:')) {
        dataLines.push(line.slice(line.indexOf(':') + 1).trimStart());
      }
    }

    const rawData = dataLines.join('\n');
    let data;
    try {
      data = JSON.parse(rawData);
    } catch {
      // Plain text fallback
      data = { text: rawData };
    }

    // Fallback: if no explicit SSE event type was set (legacy format where type
    // is embedded in the JSON data), use data.type instead.
    if (eventType === 'message' && data.type) {
      eventType = data.type;
    }

    switch (eventType) {
      case 'token': {
        // Content arrived — swap out typing indicator for the agent message bubble
        if (this._pendingTypingSwap) {this._pendingTypingSwap();}
        // Accumulate tokens; batch flush every 50ms for performance
        this._streamBuffer += (data.text || '');
        if (!this._streamTimer) {
          this._streamTimer = setTimeout(() => {
            this._flushStreamBuffer(agentMsgId);
            this._streamTimer = null;
          }, 50);
        }
        break;
      }

      case 'thinking': {
        const thinkText = data.text || '';
        // If the agent message bubble hasn't been created yet, this is a
        // server-side status update (e.g. "Thinking...", "Still processing...")
        // that should update the typing indicator text.
        if (this._pendingTypingSwap && !this._messages.some(m => m.id === agentMsgId)) {
          this._typingText = thinkText;
        } else {
          // Agent message exists — append to the thinking content block
          if (this._pendingTypingSwap) {this._pendingTypingSwap();}
          this._messages = this._messages.map(m =>
            m.id === agentMsgId
              ? { ...m, thinkingContent: (m.thinkingContent || '') + thinkText }
              : m
          );
        }
        this.updateComplete.then(() => this._maybeScrollToBottom());
        break;
      }

      case 'tool_call': {
        if (this._pendingTypingSwap) {this._pendingTypingSwap();}
        const toolCall = {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: data.name || 'unknown',
          args: data.args || {},
          result: data.result ?? null,
        };
        this._messages = this._messages.map(m =>
          m.id === agentMsgId
            ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
            : m
        );
        this.updateComplete.then(() => this._maybeScrollToBottom());
        break;
      }

      case 'done': {
        if (this._pendingTypingSwap) {this._pendingTypingSwap();}
        // Always store session key for conversation continuity
        const sessionKey = data.sessionKey || data.sessionId;
        if (sessionKey) {
          this._sessionId = sessionKey;
          // Update session list
          this._loadAgentSessions(this._selectedAgentId);
        }
        // Flush any remaining buffer
        if (this._streamBuffer) {
          this._flushStreamBuffer(agentMsgId);
        }
        this._messages = this._messages.map(m =>
          m.id === agentMsgId ? { ...m, streaming: false } : m
        );
        break;
      }

      case 'error': {
        if (this._pendingTypingSwap) {this._pendingTypingSwap();}
        const errMsg = data.text || data.message || 'Unknown error';
        this._messages = this._messages.map(m =>
          m.id === agentMsgId
            ? { ...m, streaming: false, error: errMsg }
            : m
        );
        break;
      }

      default:
        break;
    }
  }

  _flushStreamBuffer(agentMsgId) {
    if (!this._streamBuffer) {return;}
    const chunk = this._streamBuffer;
    this._streamBuffer = '';

    this._messages = this._messages.map(m =>
      m.id === agentMsgId
        ? { ...m, content: m.content + chunk }
        : m
    );
    this.updateComplete.then(() => this._maybeScrollToBottom());
  }

  // ─── Render Helpers ────────────────────────────────────────────────────────

  _getAgent(id) {
    return this._agents.find(a => a.id === id) || this._agents[0] || FALLBACK_AGENTS[0];
  }

  _renderAgentItem(agent) {
    const active = agent.id === this._selectedAgentId;
    return html`
      <button
        class="agent-item ${active ? 'active' : ''}"
        @click=${() => this._onSelectAgent(agent.id)}
        aria-label="${agent.name}"
        aria-pressed="${active}"
      >
        <span class="agent-emoji">${agent.emoji}</span>
        <div class="agent-info">
          <div class="agent-name">${agent.name}</div>
          <div class="agent-preview">${truncate(agent.lastMessage || 'No recent messages', 40)}</div>
        </div>
        <span class="status-dot ${agent.status === 'online' ? 'online' : ''}"></span>
      </button>
    `;
  }

  _renderSessionItem(session) {
    const active = session.id === this._sessionId;
    const preview = truncate(session.firstMessage || session.preview || 'Empty session', 40);
    return html`
      <button
        class="session-item ${active ? 'active' : ''}"
        @click=${() => this._onSelectSession(session)}
        aria-label="Session from ${formatDate(session.createdAt || session.ts)}"
      >
        <div class="session-preview">${preview}</div>
        <div class="session-meta">
          <span class="session-date">${formatDate(session.createdAt || session.ts)}</span>
          ${session.messageCount ? html`<span class="session-count">${session.messageCount} msgs</span>` : ''}
        </div>
      </button>
    `;
  }

  _renderMessage(msg) {
    if (msg.typing) {
      return html`
        <div class="msg-row msg-row--agent" role="status" aria-label="Agent is typing">
          <div class="msg-bubble msg-bubble--agent typing-bubble">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            ${this._typingText ? html`<span class="typing-label">${this._typingText}</span>` : ''}
          </div>
        </div>
      `;
    }

    if (msg.role === 'error') {
      return html`
        <div class="msg-row msg-row--error" role="alert">
          <div class="msg-error">${msg.content}</div>
        </div>
      `;
    }

    const isUser = msg.role === 'user';

    return html`
      <div class="msg-row ${isUser ? 'msg-row--user' : 'msg-row--agent'}">
        <div class="msg-bubble ${isUser ? 'msg-bubble--user' : 'msg-bubble--agent'}">

          ${!isUser && msg.thinkingContent ? this._renderThinkingBlock(msg.thinkingContent) : ''}
          ${!isUser && msg.toolCalls?.length ? msg.toolCalls.map(tc => this._renderToolCall(tc)) : ''}

          <div
            class="msg-content ${msg.streaming ? 'streaming' : ''}"
            .innerHTML=${isUser ? this._escapeHtml(msg.content) : renderMarkdown(msg.content)}
          ></div>

          ${msg.error ? html`<div class="msg-error-inline">⚠ ${msg.error}</div>` : ''}

          <div class="msg-ts">${formatTime(msg.ts)}</div>
        </div>
      </div>
    `;
  }

  _renderThinkingBlock(thinkingContent) {
    if (!thinkingContent) {return '';}
    return html`
      <div class="collapsible-block thinking-block">
        <button class="block-header" @click=${this._onToggleBlock} aria-expanded="false">
          <span class="block-icon">💭</span>
          <span class="block-title">Thinking...</span>
          <span class="block-toggle-icon">▸</span>
        </button>
        <div class="block-body" hidden>
          <div class="thinking-content">${thinkingContent}</div>
        </div>
      </div>
    `;
  }

  _renderToolCall(tc) {
    const argsStr = typeof tc.args === 'object'
      ? JSON.stringify(tc.args, null, 2)
      : String(tc.args || '');
    const resultStr = tc.result !== null && tc.result !== undefined
      ? (typeof tc.result === 'object' ? JSON.stringify(tc.result, null, 2) : String(tc.result))
      : null;

    return html`
      <div class="collapsible-block tool-block">
        <button class="block-header" @click=${this._onToggleBlock} aria-expanded="false">
          <span class="block-icon">🔧</span>
          <span class="block-title">${tc.name}</span>
          <span class="block-toggle-icon">▸</span>
        </button>
        <div class="block-body" hidden>
          <div class="tool-section">
            <div class="tool-section-label">Arguments</div>
            <pre class="tool-pre">${argsStr}</pre>
          </div>
          ${resultStr !== null ? html`
            <div class="tool-section">
              <div class="tool-section-label">Result</div>
              <pre class="tool-pre">${truncate(resultStr, 400)}</pre>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ─── Main Render ───────────────────────────────────────────────────────────

  render() {
    const agent = this._getAgent(this._selectedAgentId);
    const hasMessages = this._messages.length > 0;

    return html`
      <!-- Mobile sidebar overlay -->
      <div
        class="sidebar-overlay ${this._sidebarOpen ? 'visible' : ''}"
        @click=${() => { this._sidebarOpen = false; }}
        aria-hidden="true"
      ></div>

      <div class="chat-layout">

        <!-- ─── LEFT PANEL: Agent + Session Sidebar ─── -->
        <aside class="chat-sidebar ${this._sidebarOpen ? 'open' : ''}" aria-label="Agents and sessions">

          <div class="sidebar-agents-section">
            <div class="sidebar-section-label">Agents</div>
            <div class="agent-list" role="list">
              ${this._agents.filter(a => a.pinned).map(a => this._renderAgentItem(a))}
              ${this._agents.filter(a => !a.pinned).map(a => this._renderAgentItem(a))}
            </div>
          </div>

          <div class="sidebar-sessions-section">
            <div class="sidebar-sessions-header">
              <div class="sidebar-section-label">Sessions</div>
              <button class="btn-new-chat-sm" @click=${this._onNewChat} title="New chat">
                ✏
              </button>
            </div>

            <div class="session-list" role="list">
              ${this._sessionsLoading
                ? html`<div class="sessions-loading"><span class="spinner"></span></div>`
                : this._sessions.length === 0
                  ? html`<div class="sessions-empty">No sessions yet</div>`
                  : this._sessions.map(s => this._renderSessionItem(s))
              }
            </div>
          </div>
        </aside>

        <!-- ─── MAIN: Chat Area ─── -->
        <main class="chat-main" id="main-content">

          <!-- Header bar -->
          <header class="chat-header">
            <button
              class="hamburger ${this._sidebarOpen ? 'open' : ''}"
              @click=${this._onToggleSidebar}
              aria-label="${this._sidebarOpen ? 'Close sidebar' : 'Open sidebar'}"
              aria-expanded="${this._sidebarOpen}"
            >
              <span></span><span></span><span></span>
            </button>

            <div class="chat-header-agent">
              <span class="header-emoji">${agent.emoji}</span>
              <span class="header-name">${agent.name}</span>
              ${agent.model ? html`<span class="model-badge">${typeof agent.model === 'string' ? agent.model : (agent.model.id || agent.model.name || '—')}</span>` : ''}
            </div>

            <div class="chat-header-right">
              ${this._sessionId ? html`
                <button
                  class="session-id-badge"
                  @click=${this._onCopySessionId}
                  title="Click to copy session ID"
                  aria-label="Session ID: ${this._sessionId}"
                >
                  ${truncate(this._sessionId, 12)}
                </button>
              ` : ''}
              <button class="btn-new-chat" @click=${this._onNewChat} aria-label="New chat">
                + New Chat
              </button>
            </div>
          </header>

          <!-- Messages area -->
          <div
            class="messages-area"
            role="log"
            aria-label="Chat messages"
            aria-live="polite"
            @scroll=${this._onMessagesScroll}
          >
            ${this._messagesLoading
              ? html`
                <div class="messages-loading">
                  <span class="spinner spinner-lg"></span>
                  <span>Loading conversation…</span>
                </div>
              `
              : !hasMessages
                ? html`
                  <div class="empty-state">
                    <span class="empty-emoji">${agent.emoji}</span>
                    <p class="empty-text">Start a conversation with ${agent.name}</p>
                    <p class="empty-sub">Messages are sent securely to the OASIS gateway</p>
                  </div>
                `
                : this._messages.map(m => this._renderMessage(m))
            }
          </div>

          <!-- Scroll-to-bottom button -->
          ${this._showScrollBtn ? html`
            <button
              class="scroll-to-bottom-btn"
              @click=${this._onScrollToBottomBtn}
              aria-label="Scroll to latest messages"
            >
              ↓ Latest
            </button>
          ` : ''}

          <!-- Input area -->
          <div class="chat-input-area" role="form" aria-label="Send message">
            <!-- Agent selector (visible on mobile + as convenience) -->
            <div class="input-agent-row">
              <label class="input-agent-label" for="agent-selector">To:</label>
              <select
                id="agent-selector"
                class="agent-selector"
                .value=${this._selectedAgentId}
                @change=${this._onAgentSelectorChange}
                aria-label="Select agent"
              >
                ${this._agents.map(a => html`
                  <option value="${a.id}" ?selected=${a.id === this._selectedAgentId}>
                    ${a.emoji} ${a.name}
                  </option>
                `)}
              </select>
            </div>

            <div class="input-row">
              <textarea
                class="chat-textarea"
                placeholder="Message ${agent.name}… (Enter to send, Shift+Enter for newline)"
                .value=${this._inputText}
                @keydown=${this._onInputKeydown}
                @input=${this._onInputInput}
                rows="1"
                ?disabled=${this._sending}
                aria-label="Message input"
                aria-multiline="true"
              ></textarea>

              <button
                class="send-btn"
                @click=${this._sendMessage}
                ?disabled=${!this._inputText.trim() || this._sending}
                aria-label="Send message"
              >
                ${this._sending
                  ? html`<span class="send-spinner"></span>`
                  : html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>`
                }
              </button>
            </div>

            ${this._charCount > 500 ? html`
              <div class="char-count ${this._charCount > 4000 ? 'warn' : ''}"
                aria-live="polite">
                ${this._charCount.toLocaleString()} chars
              </div>
            ` : ''}
          </div>
        </main>
      </div>
    `;
  }

  // ─── Styles ────────────────────────────────────────────────────────────────

  static styles = css`
    :host {
      display: flex;
      flex: 1;
      overflow: hidden;
      height: 100%;
      min-height: 0;
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
    }

    /* ── Layout ─────────────────────────────────────────────── */

    .chat-layout {
      display: flex;
      flex: 1;
      overflow: hidden;
      height: 100%;
      min-height: 0;
      background: var(--bg, #0a0e17);
    }

    /* ── Mobile overlay ──────────────────────────────────────── */

    .sidebar-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: var(--overlay, rgba(0,0,0,0.7));
      z-index: 99;
    }

    .sidebar-overlay.visible {
      display: block;
    }

    /* ── Sidebar ─────────────────────────────────────────────── */

    .chat-sidebar {
      width: 280px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      background: var(--surface, #131926);
      border-right: 1px solid var(--border, #2a3550);
      overflow: hidden;
      height: 100%;
      z-index: 100;
    }

    .sidebar-agents-section {
      padding: 12px 0 8px;
      border-bottom: 1px solid var(--border, #2a3550);
    }

    .sidebar-section-label {
      font-size: 0.7rem;
      font-family: var(--font-mono, monospace);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted, #4a5568);
      padding: 0 12px 6px;
    }

    .agent-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 0 6px;
      max-height: 320px;
      overflow-y: auto;
    }

    .agent-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 8px;
      background: none;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text, #e0e6f0);
      text-align: left;
      transition: background 150ms ease;
      position: relative;
    }

    .agent-item:hover {
      background: var(--surface-2, #1a2235);
    }

    .agent-item.active {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      border-left: 3px solid var(--accent, #00d4ff);
      padding-left: 5px;
    }

    .agent-emoji {
      font-size: 1.25rem;
      flex-shrink: 0;
      line-height: 1;
    }

    .agent-info {
      flex: 1;
      min-width: 0;
    }

    .agent-name {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text, #e0e6f0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .agent-preview {
      font-size: 0.72rem;
      color: var(--text-muted, #4a5568);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted, #4a5568);
      flex-shrink: 0;
      margin-left: 4px;
    }

    .status-dot.online {
      background: var(--green, #22c55e);
      box-shadow: 0 0 6px var(--green, #22c55e);
    }

    /* ── Session Panel ───────────────────────────────────────── */

    .sidebar-sessions-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding-top: 8px;
    }

    .sidebar-sessions-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px 6px;
    }

    .btn-new-chat-sm {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-dim, #7a8ba8);
      font-size: 1rem;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: background 150ms, color 150ms;
      padding: 0;
    }

    .btn-new-chat-sm:hover {
      background: var(--surface-2, #1a2235);
      color: var(--text, #e0e6f0);
    }

    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 0 6px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .session-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
      padding: 8px 8px;
      background: none;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text, #e0e6f0);
      text-align: left;
      transition: background 150ms;
    }

    .session-item:hover {
      background: var(--surface-2, #1a2235);
    }

    .session-item.active {
      background: var(--accent-dim, rgba(0,212,255,0.15));
    }

    .session-preview {
      font-size: 0.8rem;
      color: var(--text, #e0e6f0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .session-meta {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .session-date {
      font-size: 0.7rem;
      color: var(--text-muted, #4a5568);
      font-family: var(--font-mono, monospace);
    }

    .session-count {
      font-size: 0.65rem;
      color: var(--text-muted, #4a5568);
      background: var(--surface-3, #222d42);
      border-radius: 4px;
      padding: 1px 5px;
    }

    .sessions-loading,
    .sessions-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 20px 12px;
      color: var(--text-muted, #4a5568);
      font-size: 0.8rem;
    }

    /* ── Main chat area ──────────────────────────────────────── */

    .chat-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
      position: relative;
    }

    /* ── Header ──────────────────────────────────────────────── */

    .chat-header {
      height: 56px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      background: var(--surface, #131926);
      border-bottom: 1px solid var(--border, #2a3550);
      z-index: 10;
    }

    .hamburger {
      display: none;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 5px;
      width: 36px;
      height: 36px;
      padding: 6px;
      background: none;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text-dim, #7a8ba8);
      flex-shrink: 0;
      transition: background 150ms, color 150ms;
    }

    .hamburger:hover {
      background: var(--surface-2, #1a2235);
      color: var(--text, #e0e6f0);
    }

    .hamburger span {
      display: block;
      width: 20px;
      height: 2px;
      background: currentColor;
      border-radius: 1px;
      transition: transform 200ms, opacity 200ms;
    }

    .hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
    .hamburger.open span:nth-child(2) { opacity: 0; }
    .hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

    .chat-header-agent {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }

    .header-emoji {
      font-size: 1.3rem;
      line-height: 1;
      flex-shrink: 0;
    }

    .header-name {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text, #e0e6f0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .model-badge {
      font-size: 0.7rem;
      font-family: var(--font-mono, monospace);
      background: var(--surface-3, #222d42);
      color: var(--accent, #00d4ff);
      border: 1px solid var(--border, #2a3550);
      border-radius: 4px;
      padding: 2px 6px;
      flex-shrink: 0;
    }

    .chat-header-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .session-id-badge {
      font-size: 0.65rem;
      font-family: var(--font-mono, monospace);
      background: var(--surface-3, #222d42);
      color: var(--text-muted, #4a5568);
      border: 1px solid var(--border, #2a3550);
      border-radius: 4px;
      padding: 3px 7px;
      cursor: pointer;
      transition: background 150ms, color 150ms, border-color 150ms;
      white-space: nowrap;
    }

    .session-id-badge:hover {
      border-color: var(--accent, #00d4ff);
      color: var(--accent, #00d4ff);
    }

    .btn-new-chat {
      font-size: 0.78rem;
      font-weight: 600;
      background: var(--surface-3, #222d42);
      color: var(--text-dim, #7a8ba8);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      padding: 6px 12px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 150ms, border-color 150ms, color 150ms;
    }

    .btn-new-chat:hover {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      border-color: var(--accent, #00d4ff);
      color: var(--accent, #00d4ff);
    }

    /* ── Messages area ───────────────────────────────────────── */

    .messages-area {
      flex: 1;
      overflow-y: auto;
      padding: 16px 16px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 0;
      scroll-behavior: smooth;
    }

    /* Scrollbar */
    .messages-area::-webkit-scrollbar { width: 5px; }
    .messages-area::-webkit-scrollbar-track { background: transparent; }
    .messages-area::-webkit-scrollbar-thumb { background: var(--surface-3, #222d42); border-radius: 999px; }
    .messages-area::-webkit-scrollbar-thumb:hover { background: var(--border, #2a3550); }

    /* ── Message rows ────────────────────────────────────────── */

    .msg-row {
      display: flex;
      margin-bottom: 4px;
      animation: msgFadeIn 200ms ease;
    }

    @keyframes msgFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .msg-row--user  { justify-content: flex-end; }
    .msg-row--agent { justify-content: flex-start; }
    .msg-row--error { justify-content: center; }

    /* ── Message bubbles ─────────────────────────────────────── */

    .msg-bubble {
      max-width: 75%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 0.9rem;
      line-height: 1.55;
      word-break: break-word;
      position: relative;
    }

    .msg-bubble--user {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      border: 1px solid rgba(0,212,255,0.25);
      color: var(--text, #e0e6f0);
      border-bottom-right-radius: 4px;
    }

    .msg-bubble--agent {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      color: var(--text, #e0e6f0);
      border-bottom-left-radius: 4px;
    }

    /* ── Typing indicator ────────────────────────────────────── */

    .typing-bubble {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 12px 16px;
      min-width: 60px;
    }

    .typing-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-muted, #4a5568);
      animation: typingBounce 1.2s ease-in-out infinite;
    }

    .typing-dot:nth-child(1) { animation-delay: 0ms; }
    .typing-dot:nth-child(2) { animation-delay: 200ms; }
    .typing-dot:nth-child(3) { animation-delay: 400ms; }

    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
      30%            { transform: translateY(-6px); opacity: 1; }
    }

    .typing-label {
      margin-left: 6px;
      font-size: 0.8rem;
      color: var(--text-muted, #4a5568);
      opacity: 0.9;
      white-space: nowrap;
    }

    /* ── Message content / markdown ─────────────────────────── */

    .msg-content {
      white-space: pre-wrap;
    }

    .msg-content.streaming::after {
      content: '▌';
      color: var(--accent, #00d4ff);
      animation: blink 0.8s step-end infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0; }
    }

    /* Markdown-rendered elements inside bubbles */
    .msg-content :is(.md-p, p) {
      margin: 0 0 0.6em;
    }
    .msg-content :is(.md-p, p):last-child { margin-bottom: 0; }

    .msg-content :is(.md-h1, h1) { font-size: 1.2em; font-weight: 700; margin: 0.6em 0 0.3em; }
    .msg-content :is(.md-h2, h2) { font-size: 1.1em; font-weight: 700; margin: 0.6em 0 0.3em; }
    .msg-content :is(.md-h3, h3) { font-size: 1.0em; font-weight: 600; margin: 0.5em 0 0.25em; }
    .msg-content :is(.md-h4, h4) { font-size: 0.95em; font-weight: 600; margin: 0.4em 0 0.2em; }

    .msg-content :is(.md-pre, pre) {
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      border-radius: 6px;
      padding: 10px 12px;
      overflow-x: auto;
      font-family: var(--font-mono, monospace);
      font-size: 0.82em;
      margin: 0.5em 0;
      white-space: pre;
    }

    .msg-content :is(.md-code, code) {
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      border-radius: 4px;
      padding: 0.1em 0.35em;
      font-family: var(--font-mono, monospace);
      font-size: 0.875em;
      color: var(--accent, #00d4ff);
    }

    .msg-content pre code {
      background: none;
      border: none;
      padding: 0;
      color: inherit;
    }

    .msg-content :is(.md-blockquote, blockquote) {
      border-left: 3px solid var(--accent, #00d4ff);
      margin: 0.5em 0;
      padding: 0.3em 0.75em;
      color: var(--text-dim, #7a8ba8);
      font-style: italic;
    }

    .msg-content :is(.md-ul, ul),
    .msg-content :is(.md-ol, ol) {
      margin: 0.4em 0;
      padding-left: 1.4em;
    }

    .msg-content :is(.md-li, li) { margin: 0.2em 0; }

    .msg-content :is(.md-link, a) {
      color: var(--accent, #00d4ff);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .msg-content :is(.md-hr, hr) {
      border: none;
      border-top: 1px solid var(--border, #2a3550);
      margin: 0.8em 0;
    }

    /* ── Timestamp ───────────────────────────────────────────── */

    .msg-ts {
      font-size: 0.65rem;
      color: var(--text-muted, #4a5568);
      text-align: right;
      margin-top: 4px;
    }

    /* ── Collapsible blocks (tool / thinking) ────────────────── */

    .collapsible-block {
      margin: 6px 0;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border, #2a3550);
    }

    .tool-block {
      border-left: 3px solid var(--accent, #00d4ff);
    }

    .thinking-block {
      border-left: 3px solid var(--purple, #a855f7);
    }

    .block-header {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 6px 10px;
      background: var(--surface-3, #222d42);
      border: none;
      cursor: pointer;
      color: var(--text-dim, #7a8ba8);
      font-size: 0.78rem;
      font-family: var(--font-mono, monospace);
      text-align: left;
      transition: background 150ms, color 150ms;
    }

    .block-header:hover {
      background: var(--surface-2, #1a2235);
      color: var(--text, #e0e6f0);
    }

    .block-icon { font-size: 0.85rem; flex-shrink: 0; }
    .block-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .block-toggle-icon {
      flex-shrink: 0;
      font-size: 0.7rem;
      transition: transform 200ms;
      display: inline-block;
    }

    .block-header[aria-expanded="true"] .block-toggle-icon {
      transform: rotate(90deg);
    }

    .block-body {
      background: var(--surface-3, #222d42);
      padding: 8px 12px;
      border-top: 1px solid var(--border, #2a3550);
    }

    .block-body[hidden] { display: none; }

    .thinking-content {
      font-size: 0.8rem;
      font-style: italic;
      color: var(--text-dim, #7a8ba8);
      white-space: pre-wrap;
    }

    .tool-section { margin-bottom: 8px; }
    .tool-section:last-child { margin-bottom: 0; }

    .tool-section-label {
      font-size: 0.65rem;
      font-family: var(--font-mono, monospace);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted, #4a5568);
      margin-bottom: 4px;
    }

    .tool-pre {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: var(--font-mono, monospace);
      font-size: 0.75rem;
      color: var(--text, #e0e6f0);
      overflow-x: auto;
      white-space: pre;
      max-height: 200px;
      overflow-y: auto;
      margin: 0;
    }

    /* ── Error messages ──────────────────────────────────────── */

    .msg-error {
      background: var(--red-dim, rgba(239,68,68,0.15));
      border: 1px solid var(--red, #ef4444);
      color: var(--red, #ef4444);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 0.82rem;
      max-width: 80%;
    }

    .msg-error-inline {
      font-size: 0.75rem;
      color: var(--red, #ef4444);
      margin-top: 4px;
    }

    /* ── Empty state ─────────────────────────────────────────── */

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-muted, #4a5568);
      text-align: center;
      padding: 32px;
      user-select: none;
    }

    .empty-emoji {
      font-size: 3.5rem;
      line-height: 1;
      filter: grayscale(20%);
    }

    .empty-text {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-dim, #7a8ba8);
      margin: 0;
    }

    .empty-sub {
      font-size: 0.8rem;
      color: var(--text-muted, #4a5568);
      margin: 0;
    }

    /* ── Loading ─────────────────────────────────────────────── */

    .messages-loading {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-dim, #7a8ba8);
      font-size: 0.85rem;
      font-family: var(--font-mono, monospace);
    }

    /* ── Scroll-to-bottom button ─────────────────────────────── */

    .scroll-to-bottom-btn {
      position: absolute;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      color: var(--text-dim, #7a8ba8);
      border-radius: 999px;
      padding: 6px 14px;
      font-size: 0.78rem;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      z-index: 20;
      white-space: nowrap;
      transition: background 150ms, border-color 150ms, color 150ms;
      animation: slideDown 200ms ease;
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .scroll-to-bottom-btn:hover {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      border-color: var(--accent, #00d4ff);
      color: var(--accent, #00d4ff);
    }

    /* ── Input area ──────────────────────────────────────────── */

    .chat-input-area {
      flex-shrink: 0;
      background: var(--surface-2, #1a2235);
      border-top: 1px solid var(--border, #2a3550);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .input-agent-row {
      display: none;
      align-items: center;
      gap: 8px;
    }

    .input-agent-label {
      font-size: 0.72rem;
      font-family: var(--font-mono, monospace);
      color: var(--text-muted, #4a5568);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      flex-shrink: 0;
    }

    .agent-selector {
      font-size: 0.8rem;
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      color: var(--text, #e0e6f0);
      padding: 4px 8px;
      cursor: pointer;
      flex: 1;
      font-family: var(--font-sans, sans-serif);
      transition: border-color 150ms;
    }

    .agent-selector:focus {
      outline: none;
      border-color: var(--accent, #00d4ff);
    }

    .input-row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
    }

    .chat-textarea {
      flex: 1;
      min-height: 44px;
      max-height: 200px;
      padding: 10px 14px;
      background: var(--surface-3, #222d42);
      border: 1px solid var(--border, #2a3550);
      border-radius: 20px;
      color: var(--text, #e0e6f0);
      font-size: 0.9rem;
      font-family: var(--font-sans, sans-serif);
      resize: none;
      overflow-y: auto;
      line-height: 1.5;
      transition: border-color 150ms, background 150ms;
      outline: none;
    }

    .chat-textarea:focus {
      border-color: var(--accent, #00d4ff);
      background: var(--surface-3, #222d42);
    }

    .chat-textarea::placeholder {
      color: var(--text-muted, #4a5568);
    }

    .chat-textarea:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .chat-textarea::-webkit-scrollbar { width: 4px; }
    .chat-textarea::-webkit-scrollbar-thumb { background: var(--surface-3, #222d42); border-radius: 999px; }

    /* ── Send button ─────────────────────────────────────────── */

    .send-btn {
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      border-radius: 50%;
      background: var(--accent, #00d4ff);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--bg, #0a0e17);
      transition: background 150ms, box-shadow 150ms, transform 100ms;
      align-self: flex-end;
    }

    .send-btn:hover:not(:disabled) {
      background: color-mix(in srgb, var(--accent, #00d4ff) 85%, white 15%);
      box-shadow: 0 0 14px rgba(0,212,255,0.35);
    }

    .send-btn:active:not(:disabled) {
      transform: scale(0.95);
    }

    .send-btn:disabled {
      background: var(--surface-3, #222d42);
      color: var(--text-muted, #4a5568);
      cursor: not-allowed;
    }

    /* Tiny spinner inside send button while streaming */
    .send-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(0,0,0,0.2);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* ── Char count ──────────────────────────────────────────── */

    .char-count {
      font-size: 0.68rem;
      font-family: var(--font-mono, monospace);
      color: var(--text-muted, #4a5568);
      text-align: right;
    }

    .char-count.warn {
      color: var(--orange, #f97316);
    }

    /* ── Spinner (loading) ───────────────────────────────────── */

    .spinner {
      display: inline-block;
      width: 1em;
      height: 1em;
      border: 2px solid var(--border, #2a3550);
      border-top-color: var(--accent, #00d4ff);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      vertical-align: middle;
    }

    .spinner-lg {
      width: 2.5rem;
      height: 2.5rem;
      border-width: 3px;
    }

    /* ── Mobile responsive ───────────────────────────────────── */

    @media (max-width: 768px) {
      .chat-sidebar {
        position: fixed;
        top: 0;
        left: 0;
        height: 100%;
        transform: translateX(-100%);
        transition: transform 200ms ease;
        z-index: 200;
        box-shadow: 4px 0 24px rgba(0,0,0,0.6);
      }

      .chat-sidebar.open {
        transform: translateX(0);
      }

      .hamburger {
        display: flex;
      }

      .input-agent-row {
        display: flex;
      }

      .btn-new-chat {
        display: none;
      }

      .msg-bubble {
        max-width: 88%;
      }

      .messages-area {
        padding: 12px 10px 6px;
      }
    }

    @media (max-width: 480px) {
      .chat-header {
        padding: 0 10px;
      }

      .header-name {
        font-size: 0.9rem;
      }

      .session-id-badge {
        display: none;
      }
    }
  `;
}

customElements.define('page-chat', PageChat);
