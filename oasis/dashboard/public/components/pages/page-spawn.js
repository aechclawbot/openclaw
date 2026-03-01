import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';
import { store } from '/app/store.js';
import { router } from '/app/router.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) {return '';}
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function renderMarkdown(text) {
  if (!text) {return '';}
  let h = escapeHtml(text);
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  h = h.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  h = h.replace(/^---+$/gm, '<hr>');
  h = h.replace(/\n\n/g, '</p><p>');
  h = '<p>' + h + '</p>';
  h = h.replace(/<p>(<h[1-6]>)/g, '$1');
  h = h.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  h = h.replace(/<p>(<hr>)<\/p>/g, '$1');
  h = h.replace(/<p>(<li>)/g, '$1');
  h = h.replace(/(<\/li>)<\/p>/g, '$1');
  return h;
}

// ---------------------------------------------------------------------------
// File generators
// ---------------------------------------------------------------------------

function generateIdentityMd(state) {
  const { agentId, displayName, emoji, roleDescription, theme, style } = state;
  const styleDesc = {
    casual: 'Casual and friendly, uses contractions and informal language.',
    professional: 'Professional and clear, formal and structured responses.',
    technical: 'Technical and precise, detailed with domain terminology.',
    aggressive: 'Bold and direct, action-oriented with strong language.',
  }[style] || 'Default conversational style.';
  return `# ${emoji || '🤖'} ${displayName || agentId || 'Agent'}

**Agent ID:** \`${agentId || 'agent-id'}\`
**Role:** ${roleDescription || 'An OASIS agent.'}
${theme ? `**Theme:** ${theme}` : ''}

## Communication Style
${styleDesc}
`;
}

function generateSoulMd(state) {
  const { displayName, emoji, tone, roleDescription } = state;
  const toneStr = (tone || []).join(', ') || 'capable';
  return `# Soul — ${emoji || '🤖'} ${displayName || 'Agent'}

You are ${toneStr}. ${roleDescription || 'You are a capable OASIS agent ready to help.'}

## Core Traits
${(tone || []).map(t => `- **${t.charAt(0).toUpperCase() + t.slice(1)}**`).join('\n') || '- Helpful\n- Reliable'}

## Identity
You are part of the OASIS multi-agent system. Act with integrity, focus, and purpose.
`;
}

function generateDirectivesMd(state) {
  const { constraints } = state;
  const lines = (constraints || '').split('\n').map(s => s.trim()).filter(Boolean);
  return `# Directives

## Hard Rules
${lines.length ? lines.map(l => `- ${l}`).join('\n') : '- Follow all OASIS operational guidelines'}

## General Conduct
- Respond only within your defined role
- Always be transparent about your capabilities and limitations
- Escalate to humans when uncertain about high-stakes decisions
`;
}

function generateToolsMd(state) {
  const { tools } = state;
  if (!tools || !tools.length) {return `# Tools\n\nNo tools configured.\n`;}
  return `# Tools

Available tools for this agent:

${tools.map(t => `- \`${t}\``).join('\n')}
`;
}

function generateUserMd(state) {
  const { bindings } = state;
  return `# User Context

## Channel Bindings
${(bindings || []).length
    ? bindings.map(b => `- **${b.channel}** | peer: ${b.peer || 'any'} | type: ${b.type || 'direct'}`).join('\n')
    : '- No bindings configured'}

## Notes
Update this file to add user-specific context, preferences, or persistent information.
`;
}

function generateMemoryMd(_state) {
  return `# Memory

This file persists important information across sessions.

## Agent Notes
- (Add persistent notes here)
`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = [
  { num: 1, label: 'Identity' },
  { num: 2, label: 'Personality' },
  { num: 3, label: 'Capabilities' },
  { num: 4, label: 'Operations' },
  { num: 5, label: 'Routing' },
  { num: 6, label: 'Review' },
];

const EMOJI_OPTIONS = [
  '🤖','🌐','⚡','🛡️','🧙','🕵️','🎯','🔨','💬','📚',
  '🎮','🧪','🔬','📡','🎨','🏗️','🦾','🧠','👁️','🌟',
  '💎','🔮','⚔️','🏹','🛸',
];

const TONE_OPTIONS = [
  'Witty','Serious','Friendly','Analytical','Creative',
  'Cautious','Enthusiastic','Methodical','Playful','Intense',
];

const TOOLS_GROUPS = [
  {
    group: 'Communication',
    tools: [
      { id: 'message', label: 'message', desc: 'Send messages to other agents' },
      { id: 'voice_call', label: 'voice_call', desc: 'Make/receive voice calls' },
    ],
  },
  {
    group: 'Web',
    tools: [
      { id: 'web_search', label: 'web_search', desc: 'Search the internet (group:web)' },
      { id: 'web_fetch', label: 'web_fetch', desc: 'Fetch web pages (group:web)' },
      { id: 'browser', label: 'browser', desc: 'Browser automation' },
    ],
  },
  {
    group: 'Files',
    tools: [
      { id: 'read', label: 'read', desc: 'Read files (group:fs)' },
      { id: 'write', label: 'write', desc: 'Write files (group:fs)' },
      { id: 'glob', label: 'glob', desc: 'Find files by pattern (group:fs)' },
      { id: 'grep', label: 'grep', desc: 'Search file contents (group:fs)' },
    ],
  },
  {
    group: 'System',
    tools: [
      { id: 'exec', label: 'exec', desc: 'Execute shell commands' },
      { id: 'session_status', label: 'session_status', desc: 'Check session status' },
    ],
  },
  {
    group: 'Plugins',
    tools: [
      { id: 'group:plugins', label: 'group:plugins', desc: 'All plugin tools' },
    ],
  },
];

const REVIEW_FILES = [
  { key: 'IDENTITY.md', gen: generateIdentityMd },
  { key: 'SOUL.md', gen: generateSoulMd },
  { key: 'DIRECTIVES.md', gen: generateDirectivesMd },
  { key: 'TOOLS.md', gen: generateToolsMd },
  { key: 'USER.md', gen: generateUserMd },
  { key: 'MEMORY.md', gen: generateMemoryMd },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

class PageSpawn extends LitElement {
  static properties = {
    currentStep: { type: Number },
    // Step 1 — Identity
    agentId: { type: String },
    idValidating: { type: Boolean },
    idValid: { type: Boolean },
    idError: { type: String },
    displayName: { type: String },
    emoji: { type: String },
    customEmoji: { type: String },
    roleDescription: { type: String },
    theme: { type: String },
    // Step 2 — Personality
    commStyle: { type: String },
    tone: { type: Array },
    constraints: { type: String },
    personalityPreviewFile: { type: String },
    // Step 3 — Capabilities
    tools: { type: Array },
    subagents: { type: Array },
    primaryModel: { type: String },
    fallbacks: { type: Array },
    agentList: { type: Array },
    modelList: { type: Array },
    modelsLoading: { type: Boolean },
    agentsLoading: { type: Boolean },
    // Step 4 — Operations
    cronJobs: { type: Array },
    customFiles: { type: Array },
    cronExpanded: { type: Boolean },
    filesExpanded: { type: Boolean },
    // Step 5 — Routing
    bindings: { type: Array },
    // Step 6 — Review
    reviewOpenFiles: { type: Object },
    createProgress: { type: Array },
    createState: { type: String },
    createError: { type: String },
    createdAgentId: { type: String },
  };

  constructor() {
    super();
    this.currentStep = 1;
    // Step 1
    this.agentId = '';
    this.idValidating = false;
    this.idValid = null;
    this.idError = '';
    this.displayName = '';
    this.emoji = '';
    this.customEmoji = '';
    this.roleDescription = '';
    this.theme = '';
    // Step 2
    this.commStyle = 'casual';
    this.tone = [];
    this.constraints = '';
    this.personalityPreviewFile = 'IDENTITY.md';
    // Step 3
    this.tools = [];
    this.subagents = [];
    this.primaryModel = '';
    this.fallbacks = [];
    this.agentList = [];
    this.modelList = [];
    this.modelsLoading = false;
    this.agentsLoading = false;
    // Step 4
    this.cronJobs = [];
    this.customFiles = [];
    this.cronExpanded = false;
    this.filesExpanded = false;
    // Step 5
    this.bindings = [];
    // Step 6
    this.reviewOpenFiles = {};
    this.createProgress = [];
    this.createState = 'idle';
    this.createError = '';
    this.createdAgentId = '';
    this._idValidateTimer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._fetchModels();
    this._fetchAgents();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._idValidateTimer) {clearTimeout(this._idValidateTimer);}
  }

  // ---------------------------------------------------------------------------
  // Data fetch
  // ---------------------------------------------------------------------------

  async _fetchModels() {
    this.modelsLoading = true;
    try {
      const data = await api.get('/api/models');
      this.modelList = Array.isArray(data) ? data : (data.models ?? []);
      if (this.modelList.length && !this.primaryModel) {
        this.primaryModel = this.modelList[0].id ?? this.modelList[0];
      }
    } catch {
      this.modelList = [];
    } finally {
      this.modelsLoading = false;
    }
  }

  async _fetchAgents() {
    this.agentsLoading = true;
    try {
      const data = await api.get('/api/agents');
      this.agentList = Array.isArray(data) ? data : (data.agents ?? []);
    } catch {
      this.agentList = [];
    } finally {
      this.agentsLoading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  _canNext() {
    switch (this.currentStep) {
      case 1:
        return this.idValid === true && this.displayName.trim() !== '' && (this.emoji !== '' || this.customEmoji.trim() !== '');
      case 2:
        return this.tone.length > 0;
      case 3:
      case 4:
      case 5:
        return true;
      default:
        return false;
    }
  }

  _next() {
    if (this._canNext() && this.currentStep < 6) {this.currentStep += 1;}
  }

  _back() {
    if (this.currentStep > 1) {this.currentStep -= 1;}
  }

  // ---------------------------------------------------------------------------
  // Step 1
  // ---------------------------------------------------------------------------

  _onIdInput(e) {
    const raw = e.target.value;
    const slug = slugify(raw) || raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
    this.agentId = slug;
    e.target.value = slug;
    this.idValid = null;
    this.idError = '';
    if (this._idValidateTimer) {clearTimeout(this._idValidateTimer);}
    if (!slug.trim()) {return;}
    this._idValidateTimer = setTimeout(() => this._validateId(), 500);
  }

  async _validateId() {
    const id = this.agentId.trim();
    if (!id) {return;}
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      this.idValid = false;
      this.idError = 'Use lowercase letters, numbers, and hyphens only';
      return;
    }
    this.idValidating = true;
    try {
      const res = await api.get(`/api/spawn/validate/${id}`);
      const available = res?.available ?? res?.valid ?? true;
      this.idValid = available;
      this.idError = available ? '' : (res?.message || 'Agent ID already in use');
    } catch {
      // Assume available if endpoint is missing
      this.idValid = true;
      this.idError = '';
    } finally {
      this.idValidating = false;
    }
  }

  _selectEmoji(em) {
    this.emoji = em;
    this.customEmoji = '';
  }

  // ---------------------------------------------------------------------------
  // Step 2
  // ---------------------------------------------------------------------------

  _toggleTone(t) {
    const lower = t.toLowerCase();
    if (this.tone.includes(lower)) {
      this.tone = this.tone.filter(x => x !== lower);
    } else {
      this.tone = [...this.tone, lower];
    }
  }

  _getPreviewContent() {
    const state = this._collectState();
    const file = REVIEW_FILES.find(f => f.key === this.personalityPreviewFile);
    return file ? file.gen(state) : '';
  }

  // ---------------------------------------------------------------------------
  // Step 3
  // ---------------------------------------------------------------------------

  _toggleTool(id) {
    if (this.tools.includes(id)) {
      this.tools = this.tools.filter(t => t !== id);
    } else {
      this.tools = [...this.tools, id];
    }
  }

  _toggleGroup(groupTools) {
    const ids = groupTools.map(t => t.id);
    const allSelected = ids.every(id => this.tools.includes(id));
    if (allSelected) {
      this.tools = this.tools.filter(id => !ids.includes(id));
    } else {
      const toAdd = ids.filter(id => !this.tools.includes(id));
      this.tools = [...this.tools, ...toAdd];
    }
  }

  _selectAllTools() {
    const all = TOOLS_GROUPS.flatMap(g => g.tools.map(t => t.id));
    this.tools = [...new Set(all)];
  }

  _clearAllTools() {
    this.tools = [];
  }

  _toggleSubagent(id) {
    if (this.subagents.includes(id)) {
      this.subagents = this.subagents.filter(s => s !== id);
    } else {
      this.subagents = [...this.subagents, id];
    }
  }

  _addFallback(model) {
    if (model && !this.fallbacks.includes(model)) {
      this.fallbacks = [...this.fallbacks, model];
    }
  }

  _removeFallback(model) {
    this.fallbacks = this.fallbacks.filter(m => m !== model);
  }

  _moveFallbackUp(idx) {
    if (idx <= 0) {return;}
    const arr = [...this.fallbacks];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    this.fallbacks = arr;
  }

  _moveFallbackDown(idx) {
    if (idx >= this.fallbacks.length - 1) {return;}
    const arr = [...this.fallbacks];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    this.fallbacks = arr;
  }

  // ---------------------------------------------------------------------------
  // Step 4
  // ---------------------------------------------------------------------------

  _addCronJob() {
    this.cronJobs = [
      ...this.cronJobs,
      { name: '', schedule: '', message: '', delivery: { mode: 'announce', channel: 'telegram', to: '' } },
    ];
  }

  _removeCronJob(idx) {
    this.cronJobs = this.cronJobs.filter((_, i) => i !== idx);
  }

  _updateCronJob(idx, field, value) {
    this.cronJobs = this.cronJobs.map((j, i) => {
      if (i !== idx) {return j;}
      if (field.startsWith('delivery.')) {
        const key = field.split('.')[1];
        return { ...j, delivery: { ...j.delivery, [key]: value } };
      }
      return { ...j, [field]: value };
    });
  }

  _addCustomFile() {
    this.customFiles = [...this.customFiles, { name: '', content: '' }];
  }

  _removeCustomFile(idx) {
    this.customFiles = this.customFiles.filter((_, i) => i !== idx);
  }

  _updateCustomFile(idx, field, value) {
    this.customFiles = this.customFiles.map((f, i) => i === idx ? { ...f, [field]: value } : f);
  }

  // ---------------------------------------------------------------------------
  // Step 5
  // ---------------------------------------------------------------------------

  _addBinding() {
    this.bindings = [...this.bindings, { channel: 'telegram', peer: 'any', type: 'direct' }];
  }

  _removeBinding(idx) {
    this.bindings = this.bindings.filter((_, i) => i !== idx);
  }

  _updateBinding(idx, field, value) {
    this.bindings = this.bindings.map((b, i) => i === idx ? { ...b, [field]: value } : b);
  }

  // ---------------------------------------------------------------------------
  // Step 6
  // ---------------------------------------------------------------------------

  _toggleReviewFile(key) {
    this.reviewOpenFiles = { ...this.reviewOpenFiles, [key]: !this.reviewOpenFiles[key] };
  }

  _collectState() {
    return {
      agentId: this.agentId,
      displayName: this.displayName,
      emoji: this.emoji || this.customEmoji,
      roleDescription: this.roleDescription,
      theme: this.theme,
      style: this.commStyle,
      tone: this.tone,
      constraints: this.constraints,
      tools: this.tools,
      subagents: this.subagents,
      model: this.primaryModel,
      fallbacks: this.fallbacks,
      cronJobs: this.cronJobs,
      bindings: this.bindings,
      customFiles: this.customFiles,
    };
  }

  _buildPayload() {
    const s = this._collectState();
    return {
      id: s.agentId,
      name: s.displayName,
      emoji: s.emoji,
      role: s.roleDescription,
      theme: s.theme,
      style: s.style,
      tone: s.tone,
      constraints: s.constraints.split('\n').map(x => x.trim()).filter(Boolean),
      tools: s.tools,
      subagents: s.subagents,
      model: s.model,
      fallbacks: s.fallbacks,
      cronJobs: s.cronJobs.filter(j => j.name && j.schedule),
      bindings: s.bindings,
      customFiles: s.customFiles.filter(f => f.name && f.content),
    };
  }

  async _createAgent() {
    this.createState = 'creating';
    this.createProgress = ['Preparing agent configuration...'];
    this.createError = '';
    const payload = this._buildPayload();
    const steps = [
      'Creating workspace...',
      'Writing config files...',
      'Updating gateway config...',
      'Finalizing...',
    ];
    let stepIdx = 0;
    const iv = setInterval(() => {
      if (stepIdx < steps.length) {
        this.createProgress = [...this.createProgress, steps[stepIdx++]];
      }
    }, 600);
    try {
      const result = await api.post('/api/spawn', payload);
      clearInterval(iv);
      this.createProgress = [...this.createProgress, 'Done!'];
      this.createState = 'success';
      this.createdAgentId = result?.id ?? payload.id;
    } catch (e) {
      clearInterval(iv);
      this.createState = 'error';
      this.createError = e?.message || 'Failed to create agent';
    }
  }

  _getConfigJson() {
    return JSON.stringify(this._buildPayload(), null, 2);
  }

  _shortModel(m) {
    if (!m) {return '—';}
    const id = m.id ?? m;
    return id.includes('/') ? id.split('/').pop().replace(/-\d{4}[-\d]*$/, '') : id;
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
    h3 { margin: 0 0 6px 0; }
    h4 { margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted, #4a5568); }

    .page-header { margin-bottom: 24px; }
    .page-header p { margin: 0; color: var(--text-dim, #7a8ba8); font-size: 13px; }

    /* Progress bar */
    .progress-bar {
      display: flex;
      align-items: center;
      margin-bottom: 32px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .step-item { display: flex; flex-direction: column; align-items: center; gap: 6px; flex-shrink: 0; }
    .step-connector {
      flex: 1;
      height: 2px;
      min-width: 24px;
      background: var(--border, #2a3550);
      margin-bottom: 20px;
      transition: background 0.3s;
    }
    .step-connector.done { background: var(--green, #22c55e); }
    .step-circle {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--surface-3, #222d42);
      border: 2px solid var(--border, #2a3550);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; color: var(--text-muted, #4a5568);
      transition: all 0.2s;
    }
    .step-circle.active { background: var(--accent-dim, rgba(0,212,255,0.15)); border-color: var(--accent, #00d4ff); color: var(--accent, #00d4ff); }
    .step-circle.done { background: rgba(34,197,94,0.15); border-color: var(--green, #22c55e); color: var(--green, #22c55e); }
    .step-label { font-size: 10px; color: var(--text-muted, #4a5568); text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
    .step-label.active { color: var(--accent, #00d4ff); }
    .step-label.done { color: var(--green, #22c55e); }

    /* Step layout */
    .step-content { display: grid; grid-template-columns: 1fr; gap: 24px; }
    .step-content.with-preview { grid-template-columns: 1fr 1fr; }
    @media (max-width: 900px) { .step-content.with-preview { grid-template-columns: 1fr; } }

    /* Form */
    .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-dim, #7a8ba8); }
    input[type="text"], select, textarea {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 6px; color: var(--text, #e0e6f0);
      font-family: inherit; font-size: 13px; padding: 8px 12px;
      outline: none; transition: border-color 0.15s; width: 100%; box-sizing: border-box;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--accent, #00d4ff); }
    input.valid { border-color: var(--green, #22c55e); }
    input.invalid { border-color: var(--red, #ef4444); }
    textarea { resize: vertical; min-height: 80px; }
    .field-hint { font-size: 11px; color: var(--text-muted, #4a5568); }
    .field-error { font-size: 11px; color: var(--red, #ef4444); }
    .field-ok { font-size: 11px; color: var(--green, #22c55e); }

    /* ID row */
    .id-row { display: flex; align-items: center; gap: 8px; }
    .id-row input { flex: 1; }
    .id-status { font-size: 18px; line-height: 1; flex-shrink: 0; min-width: 24px; text-align: center; }

    /* Emoji picker */
    .emoji-grid {
      display: flex; flex-wrap: wrap; gap: 8px; padding: 12px;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550); border-radius: 8px;
    }
    .emoji-option {
      width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
      font-size: 20px; border-radius: 6px; cursor: pointer;
      border: 2px solid transparent; background: var(--surface-3, #222d42); transition: all 0.15s;
    }
    .emoji-option:hover { border-color: rgba(0,212,255,0.3); }
    .emoji-option.selected { border-color: var(--accent, #00d4ff); background: var(--accent-dim, rgba(0,212,255,0.15)); }
    .emoji-custom-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .emoji-custom-row input { flex: 1; max-width: 200px; }

    /* Radio buttons */
    .radio-group { display: flex; flex-direction: column; gap: 8px; }
    .radio-option {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px 14px; border-radius: 8px;
      border: 2px solid var(--border, #2a3550); cursor: pointer; transition: all 0.15s;
    }
    .radio-option:hover { border-color: rgba(0,212,255,0.3); }
    .radio-option.selected { border-color: var(--accent, #00d4ff); background: rgba(0,212,255,0.08); }
    .radio-option input[type="radio"] { width: auto; margin-top: 2px; flex-shrink: 0; }
    .radio-label { display: flex; flex-direction: column; gap: 2px; }
    .radio-title { font-size: 13px; font-weight: 600; color: var(--text, #e0e6f0); }
    .radio-desc { font-size: 11px; color: var(--text-dim, #7a8ba8); }

    /* Tone tags */
    .tag-group { display: flex; flex-wrap: wrap; gap: 8px; }
    .tag-btn {
      padding: 5px 12px; border-radius: 20px;
      border: 1.5px solid var(--border, #2a3550);
      background: var(--surface-2, #1a2235); color: var(--text-dim, #7a8ba8);
      font-size: 12px; cursor: pointer; transition: all 0.15s; font-family: inherit;
    }
    .tag-btn:hover { border-color: rgba(0,212,255,0.5); color: var(--text, #e0e6f0); }
    .tag-btn.selected { border-color: var(--accent, #00d4ff); background: var(--accent-dim, rgba(0,212,255,0.15)); color: var(--accent, #00d4ff); }

    /* Preview panel */
    .preview-panel {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 10px; display: flex; flex-direction: column; overflow: hidden;
    }
    .preview-header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; background: var(--surface-2, #1a2235);
      border-bottom: 1px solid var(--border, #2a3550);
    }
    .preview-header span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-dim, #7a8ba8); }
    .preview-file-tabs {
      display: flex; gap: 4px; padding: 8px 12px;
      background: var(--surface-2, #1a2235);
      border-bottom: 1px solid var(--border, #2a3550); overflow-x: auto;
    }
    .preview-file-tab {
      padding: 3px 10px; border-radius: 4px; border: 1px solid transparent;
      font-size: 11px; color: var(--text-muted, #4a5568); cursor: pointer; white-space: nowrap;
      background: none; font-family: inherit; transition: all 0.15s;
    }
    .preview-file-tab:hover { color: var(--text-dim, #7a8ba8); }
    .preview-file-tab.active { border-color: var(--accent, #00d4ff); color: var(--accent, #00d4ff); }
    .preview-body { padding: 16px; overflow-y: auto; flex: 1; min-height: 320px; }
    .preview-body h1, .preview-body h2, .preview-body h3 { color: var(--text, #e0e6f0); margin: 0 0 8px 0; }
    .preview-body p { margin: 0 0 8px 0; font-size: 13px; }
    .preview-body li { margin-left: 16px; font-size: 13px; }
    .preview-body code { background: var(--surface-3, #222d42); padding: 1px 5px; border-radius: 3px; font-size: 12px; }

    /* Tools */
    .tools-section { display: flex; flex-direction: column; gap: 12px; }
    .tools-controls { display: flex; gap: 8px; margin-bottom: 12px; }
    .tool-group { background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550); border-radius: 8px; overflow: hidden; }
    .tool-group-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 14px; background: var(--surface-3, #222d42);
      cursor: pointer; user-select: none;
    }
    .tool-group-header span { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-dim, #7a8ba8); }
    .tool-group-toggle {
      font-size: 11px; color: var(--accent, #00d4ff); cursor: pointer;
      background: none; border: none; font-family: inherit; padding: 2px 8px; border-radius: 4px;
    }
    .tool-group-toggle:hover { background: var(--accent-dim, rgba(0,212,255,0.1)); }
    .tool-list { display: flex; flex-direction: column; }
    .tool-item {
      display: flex; align-items: center; gap: 10px; padding: 8px 14px;
      border-top: 1px solid var(--border, #2a3550); cursor: pointer; transition: background 0.1s;
    }
    .tool-item:hover { background: var(--surface-3, #222d42); }
    .tool-item input[type="checkbox"] { width: auto; flex-shrink: 0; accent-color: var(--accent, #00d4ff); }
    .tool-item-label { display: flex; flex-direction: column; gap: 1px; }
    .tool-item-name { font-size: 12px; font-weight: 600; color: var(--text, #e0e6f0); }
    .tool-item-desc { font-size: 11px; color: var(--text-muted, #4a5568); }

    /* Fallbacks */
    .fallback-list { display: flex; flex-direction: column; gap: 6px; }
    .fallback-item {
      display: flex; align-items: center; gap: 8px; padding: 6px 10px;
      background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550); border-radius: 6px;
    }
    .fallback-item span { flex: 1; font-size: 12px; color: var(--text, #e0e6f0); }

    /* Subagents */
    .subagent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
    .subagent-item {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px;
      border: 1.5px solid var(--border, #2a3550); border-radius: 8px;
      cursor: pointer; transition: all 0.15s; background: var(--surface-2, #1a2235);
    }
    .subagent-item:hover { border-color: rgba(0,212,255,0.4); }
    .subagent-item.selected { border-color: var(--accent, #00d4ff); background: rgba(0,212,255,0.08); }
    .subagent-item input[type="checkbox"] { width: auto; accent-color: var(--accent, #00d4ff); }
    .sa-name { font-size: 12px; color: var(--text, #e0e6f0); }

    /* Cron / custom file cards */
    .cron-job-card, .custom-file-card {
      background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550);
      border-radius: 8px; padding: 16px; margin-bottom: 12px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .cron-job-header, .custom-file-header {
      display: flex; align-items: center; justify-content: space-between;
    }
    .cron-job-header span, .custom-file-header span {
      font-size: 12px; font-weight: 700; color: var(--text-dim, #7a8ba8);
      text-transform: uppercase; letter-spacing: 0.6px;
    }
    .cron-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

    /* Bindings */
    .binding-card {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550);
      border-radius: 8px; margin-bottom: 8px; flex-wrap: wrap;
    }
    .binding-card select, .binding-card input { flex: 1; min-width: 80px; }

    /* Section expander */
    .section-expander { border: 1px solid var(--border, #2a3550); border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
    .section-expander-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; background: var(--surface-2, #1a2235);
      cursor: pointer; user-select: none;
    }
    .section-expander-title { font-size: 13px; font-weight: 700; color: var(--text, #e0e6f0); }
    .section-expander-body { padding: 16px; }

    /* Review */
    .review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    @media (max-width: 700px) { .review-grid { grid-template-columns: 1fr; } }
    .review-card { background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550); border-radius: 10px; padding: 16px; }
    .agent-summary-card {
      display: flex; align-items: center; gap: 16px; padding: 16px;
      background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550);
      border-radius: 10px; margin-bottom: 16px;
    }
    .agent-summary-emoji { font-size: 40px; line-height: 1; }
    .agent-summary-info h3 { margin: 0 0 2px 0; font-size: 18px; }
    .agent-id { font-size: 12px; color: var(--accent, #00d4ff); }
    .agent-role { font-size: 12px; color: var(--text-dim, #7a8ba8); margin-top: 4px; }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px;
      background: var(--surface-3, #222d42); color: var(--text-dim, #7a8ba8);
      border: 1px solid var(--border, #2a3550);
    }
    .badge-list { display: flex; flex-wrap: wrap; gap: 5px; }
    .review-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .review-table th { text-align: left; padding: 4px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted, #4a5568); border-bottom: 1px solid var(--border, #2a3550); }
    .review-table td { padding: 6px 8px; border-bottom: 1px solid rgba(42,53,80,0.5); color: var(--text, #e0e6f0); }

    /* File preview */
    .file-preview-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
    .file-preview-item { border: 1px solid var(--border, #2a3550); border-radius: 8px; overflow: hidden; }
    .file-preview-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 14px; background: var(--surface-2, #1a2235);
      cursor: pointer; user-select: none;
    }
    .file-preview-header span { font-size: 12px; font-weight: 600; color: var(--text-dim, #7a8ba8); }
    .file-preview-body { padding: 14px; background: var(--surface, #131926); font-size: 12px; line-height: 1.6; overflow-x: auto; }
    .file-preview-body h1, .file-preview-body h2, .file-preview-body h3 { color: var(--text, #e0e6f0); margin: 0 0 6px 0; }
    .file-preview-body p { margin: 0 0 6px 0; }
    .config-preview {
      background: var(--surface, #131926); border: 1px solid var(--border, #2a3550);
      border-radius: 8px; padding: 16px; overflow-x: auto; margin-bottom: 24px;
    }
    .config-preview pre { margin: 0; font-family: inherit; font-size: 12px; color: var(--text-dim, #7a8ba8); white-space: pre-wrap; word-break: break-all; }

    /* Create progress */
    .create-progress {
      background: var(--surface-2, #1a2235); border: 1px solid var(--border, #2a3550);
      border-radius: 8px; padding: 20px; display: flex; flex-direction: column;
      gap: 10px; margin-bottom: 16px;
    }
    .progress-step { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-dim, #7a8ba8); animation: fadeSlideIn 0.3s ease; }
    .progress-step:last-child { color: var(--text, #e0e6f0); }
    @keyframes fadeSlideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
    .progress-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #00d4ff); flex-shrink: 0; }

    .success-block {
      background: rgba(34,197,94,0.1); border: 1px solid var(--green, #22c55e);
      border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 16px;
    }
    .success-block .success-icon { font-size: 40px; margin-bottom: 8px; }
    .success-block h3 { margin: 0 0 6px 0; color: var(--green, #22c55e); }
    .success-block p { margin: 0; font-size: 13px; color: var(--text-dim, #7a8ba8); }
    .error-block {
      background: rgba(239,68,68,0.1); border: 1px solid var(--red, #ef4444);
      border-radius: 8px; padding: 16px; margin-bottom: 16px;
      font-size: 13px; color: var(--red, #ef4444);
    }

    /* Buttons */
    .step-actions {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border, #2a3550); gap: 12px;
    }
    .step-actions-right { display: flex; gap: 10px; align-items: center; }
    .btn {
      padding: 9px 20px; border-radius: 7px; border: none;
      font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-ghost { background: transparent; border: 1px solid var(--border, #2a3550); color: var(--text-dim, #7a8ba8); }
    .btn-ghost:hover:not(:disabled) { border-color: rgba(0,212,255,0.5); color: var(--text, #e0e6f0); }
    .btn-accent { background: var(--accent, #00d4ff); color: #0a0e17; }
    .btn-accent:hover:not(:disabled) { background: #26dbff; }
    .btn-green { background: var(--green, #22c55e); color: #0a0e17; }
    .btn-green:hover:not(:disabled) { background: #34d96e; }
    .btn-danger { background: transparent; border: 1px solid var(--red, #ef4444); color: var(--red, #ef4444); padding: 4px 10px; font-size: 11px; }
    .btn-sm { padding: 4px 10px; font-size: 11px; }
    .btn-icon { padding: 4px 8px; background: transparent; border: 1px solid var(--border, #2a3550); color: var(--text-dim, #7a8ba8); font-size: 12px; }
    .btn-icon:hover:not(:disabled) { border-color: rgba(0,212,255,0.5); color: var(--accent, #00d4ff); }
    .add-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 7px;
      border: 1.5px dashed var(--border, #2a3550); background: transparent;
      color: var(--text-dim, #7a8ba8); font-family: inherit; font-size: 12px;
      cursor: pointer; transition: all 0.15s;
    }
    .add-btn:hover { border-color: var(--accent, #00d4ff); color: var(--accent, #00d4ff); }

    .chevron { transition: transform 0.2s; display: inline-block; }
    .chevron.open { transform: rotate(90deg); }
    .note {
      padding: 10px 14px; background: rgba(0,212,255,0.08);
      border: 1px solid rgba(0,212,255,0.2); border-radius: 6px;
      font-size: 12px; color: var(--text-dim, #7a8ba8); margin-bottom: 16px;
    }
    .divider { border: none; border-top: 1px solid var(--border, #2a3550); margin: 20px 0; }
    a { color: var(--accent, #00d4ff); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .loading-text { color: var(--text-muted, #4a5568); font-size: 13px; }
    code { background: var(--surface-3, #222d42); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
  `;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  render() {
    return html`
      <div class="page-header">
        <h2>Spawn New Agent</h2>
        <p>Multi-step wizard to create and configure an OASIS agent</p>
      </div>
      ${this._renderProgressBar()}
      ${this.currentStep === 1 ? this._renderStep1() : ''}
      ${this.currentStep === 2 ? this._renderStep2() : ''}
      ${this.currentStep === 3 ? this._renderStep3() : ''}
      ${this.currentStep === 4 ? this._renderStep4() : ''}
      ${this.currentStep === 5 ? this._renderStep5() : ''}
      ${this.currentStep === 6 ? this._renderStep6() : ''}
    `;
  }

  _renderProgressBar() {
    return html`
      <div class="progress-bar">
        ${STEPS.map((step, idx) => html`
          ${idx > 0 ? html`
            <div class="step-connector ${this.currentStep > step.num ? 'done' : ''}"></div>
          ` : ''}
          <div class="step-item">
            <div class="step-circle ${this.currentStep === step.num ? 'active' : this.currentStep > step.num ? 'done' : ''}">
              ${this.currentStep > step.num ? '✓' : step.num}
            </div>
            <div class="step-label ${this.currentStep === step.num ? 'active' : this.currentStep > step.num ? 'done' : ''}">
              ${step.label}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  _renderStep1() {
    const activeEmoji = this.emoji || this.customEmoji;
    return html`
      <div class="step-content">
        <div>
          <div class="form-group">
            <label>Agent ID *</label>
            <div class="id-row">
              <input
                type="text"
                .value="${this.agentId}"
                class="${this.idValid === true ? 'valid' : this.idValid === false ? 'invalid' : ''}"
                placeholder="my-agent-id"
                @input="${this._onIdInput}"
                @blur="${() => this.agentId.trim() && this._validateId()}"
              />
              <span class="id-status">
                ${this.idValidating ? '⟳' : this.idValid === true ? '✅' : this.idValid === false ? '❌' : ''}
              </span>
            </div>
            ${this.idError
              ? html`<span class="field-error">${this.idError}</span>`
              : this.idValid === true
              ? html`<span class="field-ok">Agent ID is available</span>`
              : html`<span class="field-hint">Lowercase letters, numbers, hyphens only (e.g. my-agent)</span>`}
          </div>

          <div class="form-group">
            <label>Display Name *</label>
            <input
              type="text"
              .value="${this.displayName}"
              placeholder="My Agent"
              @input="${(e) => { this.displayName = e.target.value; }}"
            />
          </div>

          <div class="form-group">
            <label>Emoji *</label>
            <div class="emoji-grid">
              ${EMOJI_OPTIONS.map(em => html`
                <div
                  class="emoji-option ${this.emoji === em ? 'selected' : ''}"
                  @click="${() => this._selectEmoji(em)}"
                  title="${em}"
                >${em}</div>
              `)}
            </div>
            <div class="emoji-custom-row">
              <span style="font-size:12px;color:var(--text-muted)">Custom:</span>
              <input
                type="text"
                .value="${this.customEmoji}"
                placeholder="Or type any emoji..."
                @input="${(e) => { this.customEmoji = e.target.value; this.emoji = ''; }}"
              />
              ${activeEmoji ? html`<span style="font-size:24px;margin-left:4px">${activeEmoji}</span>` : ''}
            </div>
          </div>

          <div class="form-group">
            <label>Role Description *</label>
            <textarea
              .value="${this.roleDescription}"
              placeholder="What does this agent do? (2-3 sentences describing purpose and capabilities)"
              rows="3"
              @input="${(e) => { this.roleDescription = e.target.value; }}"
            ></textarea>
          </div>

          <div class="form-group">
            <label>Theme / Character <span style="color:var(--text-muted);font-size:10px;text-transform:none">optional</span></label>
            <input
              type="text"
              .value="${this.theme}"
              placeholder="e.g. Ready Player One — Parzival, tactical field commander..."
              @input="${(e) => { this.theme = e.target.value; }}"
            />
          </div>
        </div>
      </div>
      ${this._renderStepActions()}
    `;
  }

  _renderStep2() {
    const styleOptions = [
      { value: 'casual', label: 'Casual', desc: 'Friendly, informal, uses contractions' },
      { value: 'professional', label: 'Professional', desc: 'Clear, formal, structured' },
      { value: 'technical', label: 'Technical', desc: 'Precise, detailed, technical terminology' },
      { value: 'aggressive', label: 'Aggressive', desc: 'Bold, direct, action-oriented' },
    ];
    return html`
      <div class="step-content with-preview">
        <div>
          <div class="form-group">
            <label>Communication Style</label>
            <div class="radio-group">
              ${styleOptions.map(opt => html`
                <div
                  class="radio-option ${this.commStyle === opt.value ? 'selected' : ''}"
                  @click="${() => { this.commStyle = opt.value; }}"
                >
                  <input type="radio" name="commStyle" .value="${opt.value}" ?checked="${this.commStyle === opt.value}" />
                  <div class="radio-label">
                    <span class="radio-title">${opt.label}</span>
                    <span class="radio-desc">${opt.desc}</span>
                  </div>
                </div>
              `)}
            </div>
          </div>

          <div class="form-group">
            <label>Tone Adjectives * <span style="color:var(--text-muted);font-size:10px;text-transform:none">(select at least one)</span></label>
            <div class="tag-group">
              ${TONE_OPTIONS.map(t => html`
                <button
                  class="tag-btn ${this.tone.includes(t.toLowerCase()) ? 'selected' : ''}"
                  @click="${() => this._toggleTone(t)}"
                >${t}</button>
              `)}
            </div>
            ${this.tone.length === 0 ? html`<span class="field-error">Select at least one tone</span>` : ''}
          </div>

          <div class="form-group">
            <label>Constraints <span style="color:var(--text-muted);font-size:10px;text-transform:none">optional</span></label>
            <textarea
              .value="${this.constraints}"
              placeholder="What should this agent NEVER do? (one per line)&#10;e.g. Never share private keys&#10;Never send money without approval"
              rows="5"
              @input="${(e) => { this.constraints = e.target.value; }}"
            ></textarea>
          </div>
        </div>

        <div class="preview-panel">
          <div class="preview-header">
            <span>Live Preview</span>
          </div>
          <div class="preview-file-tabs">
            ${REVIEW_FILES.map(f => html`
              <button
                class="preview-file-tab ${this.personalityPreviewFile === f.key ? 'active' : ''}"
                @click="${() => { this.personalityPreviewFile = f.key; }}"
              >${f.key}</button>
            `)}
          </div>
          <div class="preview-body">
            <div .innerHTML="${renderMarkdown(this._getPreviewContent())}"></div>
          </div>
        </div>
      </div>
      ${this._renderStepActions()}
    `;
  }

  _renderStep3() {
    const modelOptions = this.modelList.map(m => ({ id: m.id ?? m, name: this._shortModel(m) }));
    const availableFallbacks = modelOptions.filter(m => m.id !== this.primaryModel && !this.fallbacks.includes(m.id));

    return html`
      <div class="step-content">
        <div>
          <!-- Tools -->
          <label style="display:block;margin-bottom:8px">Tools</label>
          <div class="tools-controls">
            <button class="btn btn-ghost btn-sm" @click="${this._selectAllTools}">Select All</button>
            <button class="btn btn-ghost btn-sm" @click="${this._clearAllTools}">Clear All</button>
          </div>
          <div class="tools-section">
            ${TOOLS_GROUPS.map(g => {
              const allSelected = g.tools.every(t => this.tools.includes(t.id));
              return html`
                <div class="tool-group">
                  <div class="tool-group-header" @click="${() => this._toggleGroup(g.tools)}">
                    <span>${g.group}</span>
                    <button class="tool-group-toggle" @click="${(e) => { e.stopPropagation(); this._toggleGroup(g.tools); }}">
                      ${allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div class="tool-list">
                    ${g.tools.map(t => html`
                      <div class="tool-item" @click="${() => this._toggleTool(t.id)}">
                        <input
                          type="checkbox"
                          .checked="${this.tools.includes(t.id)}"
                          @click="${(e) => e.stopPropagation()}"
                          @change="${() => this._toggleTool(t.id)}"
                        />
                        <div class="tool-item-label">
                          <span class="tool-item-name">${t.label}</span>
                          <span class="tool-item-desc">${t.desc}</span>
                        </div>
                      </div>
                    `)}
                  </div>
                </div>
              `;
            })}
          </div>

          <hr class="divider" />

          <!-- Subagent Access -->
          <div class="form-group">
            <label>Subagent Access <span style="color:var(--text-muted);font-size:10px;text-transform:none">optional</span></label>
            ${this.agentsLoading
              ? html`<span class="loading-text">Loading agents...</span>`
              : html`
                <div class="subagent-grid">
                  ${this.agentList.map(a => {
                    const id = a.id ?? a;
                    const name = a.name ?? id;
                    const em = a.emoji ?? '🤖';
                    return html`
                      <div
                        class="subagent-item ${this.subagents.includes(id) ? 'selected' : ''}"
                        @click="${() => this._toggleSubagent(id)}"
                      >
                        <input
                          type="checkbox"
                          .checked="${this.subagents.includes(id)}"
                          @click="${(e) => e.stopPropagation()}"
                          @change="${() => this._toggleSubagent(id)}"
                        />
                        <span style="font-size:16px">${em}</span>
                        <span class="sa-name">${name}</span>
                      </div>
                    `;
                  })}
                  ${this.agentList.length === 0 ? html`<span class="field-hint">No agents loaded</span>` : ''}
                </div>
              `}
          </div>

          <hr class="divider" />

          <!-- Model Selection -->
          <div class="form-group">
            <label>Primary Model</label>
            ${this.modelsLoading
              ? html`<span class="loading-text">Loading models...</span>`
              : html`
                <select .value="${this.primaryModel}" @change="${(e) => { this.primaryModel = e.target.value; }}">
                  ${modelOptions.map(m => html`<option value="${m.id}" ?selected="${this.primaryModel === m.id}">${m.name}</option>`)}
                  ${modelOptions.length === 0 ? html`<option value="">No models available</option>` : ''}
                </select>
              `}
          </div>

          <div class="form-group">
            <label>Fallback Chain <span style="color:var(--text-muted);font-size:10px;text-transform:none">optional</span></label>
            <div class="fallback-list">
              ${this.fallbacks.map((m, idx) => html`
                <div class="fallback-item">
                  <span>${idx + 1}. ${m.includes('/') ? m.split('/').pop() : m}</span>
                  <button class="btn btn-icon btn-sm" @click="${() => this._moveFallbackUp(idx)}" ?disabled="${idx === 0}">▲</button>
                  <button class="btn btn-icon btn-sm" @click="${() => this._moveFallbackDown(idx)}" ?disabled="${idx === this.fallbacks.length - 1}">▼</button>
                  <button class="btn btn-danger" @click="${() => this._removeFallback(m)}">✕</button>
                </div>
              `)}
            </div>
            ${availableFallbacks.length > 0 ? html`
              <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
                <select id="fallback-add-select" style="flex:1">
                  <option value="">— Add Fallback —</option>
                  ${availableFallbacks.map(m => html`<option value="${m.id}">${m.name}</option>`)}
                </select>
                <button class="btn btn-ghost btn-sm" @click="${() => {
                  const sel = this.shadowRoot.querySelector('#fallback-add-select');
                  if (sel?.value) { this._addFallback(sel.value); sel.value = ''; }
                }}">Add</button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
      ${this._renderStepActions()}
    `;
  }

  _renderStep4() {
    return html`
      <div class="step-content">
        <div>
          <div class="section-expander">
            <div class="section-expander-header" @click="${() => { this.cronExpanded = !this.cronExpanded; }}">
              <span class="section-expander-title">Scheduled Tasks (Cron Jobs)</span>
              <span class="chevron ${this.cronExpanded ? 'open' : ''}">▶</span>
            </div>
            ${this.cronExpanded ? html`
              <div class="section-expander-body">
                ${this.cronJobs.map((job, idx) => html`
                  <div class="cron-job-card">
                    <div class="cron-job-header">
                      <span>Task ${idx + 1}</span>
                      <button class="btn btn-danger" @click="${() => this._removeCronJob(idx)}">Remove</button>
                    </div>
                    <div class="cron-grid">
                      <div class="form-group" style="margin-bottom:0">
                        <label>Name</label>
                        <input type="text" .value="${job.name}" placeholder="daily-briefing" @input="${(e) => this._updateCronJob(idx, 'name', e.target.value)}" />
                      </div>
                      <div class="form-group" style="margin-bottom:0">
                        <label>Schedule (cron expression)</label>
                        <input type="text" .value="${job.schedule}" placeholder="0 9 * * *" @input="${(e) => this._updateCronJob(idx, 'schedule', e.target.value)}" />
                        <span class="field-hint">e.g. 0 9 * * * = 9am daily</span>
                      </div>
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                      <label>Message to Agent</label>
                      <textarea .value="${job.message}" placeholder="What should the agent do on this schedule?" rows="2" @input="${(e) => this._updateCronJob(idx, 'message', e.target.value)}"></textarea>
                    </div>
                    <div class="cron-grid">
                      <div class="form-group" style="margin-bottom:0">
                        <label>Delivery Mode</label>
                        <select .value="${job.delivery.mode}" @change="${(e) => this._updateCronJob(idx, 'delivery.mode', e.target.value)}">
                          <option value="announce">announce</option>
                          <option value="standard">standard</option>
                        </select>
                      </div>
                      <div class="form-group" style="margin-bottom:0">
                        <label>Channel</label>
                        <select .value="${job.delivery.channel}" @change="${(e) => this._updateCronJob(idx, 'delivery.channel', e.target.value)}">
                          <option value="telegram">telegram</option>
                          <option value="whatsapp">whatsapp</option>
                        </select>
                      </div>
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                      <label>Delivery Target (chatId or phone)</label>
                      <input type="text" .value="${job.delivery.to}" placeholder="e.g. 7955595068" @input="${(e) => this._updateCronJob(idx, 'delivery.to', e.target.value)}" />
                    </div>
                  </div>
                `)}
                <button class="add-btn" @click="${this._addCronJob}">+ Add Scheduled Task</button>
              </div>
            ` : ''}
          </div>

          <div class="section-expander">
            <div class="section-expander-header" @click="${() => { this.filesExpanded = !this.filesExpanded; }}">
              <span class="section-expander-title">Custom Workspace Files</span>
              <span class="chevron ${this.filesExpanded ? 'open' : ''}">▶</span>
            </div>
            ${this.filesExpanded ? html`
              <div class="section-expander-body">
                ${this.customFiles.map((file, idx) => html`
                  <div class="custom-file-card">
                    <div class="custom-file-header">
                      <span>File ${idx + 1}</span>
                      <button class="btn btn-danger" @click="${() => this._removeCustomFile(idx)}">Remove</button>
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                      <label>Filename</label>
                      <input type="text" .value="${file.name}" placeholder="CUSTOM.md" @input="${(e) => this._updateCustomFile(idx, 'name', e.target.value)}" />
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                      <label>Content</label>
                      <textarea .value="${file.content}" placeholder="File content..." rows="6" style="font-family:monospace" @input="${(e) => this._updateCustomFile(idx, 'content', e.target.value)}"></textarea>
                    </div>
                  </div>
                `)}
                <button class="add-btn" @click="${this._addCustomFile}">+ Add Custom File</button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
      ${this._renderStepActions()}
    `;
  }

  _renderStep5() {
    return html`
      <div class="step-content">
        <div>
          <div class="note">
            Bindings determine which messages from which channels route to this agent.
            The agent's bindings will be appended to the end of the routing priority list — you can reorder them in Settings.
          </div>
          <div class="form-group">
            <label>Channel Bindings</label>
            ${this.bindings.map((b, idx) => html`
              <div class="binding-card">
                <select .value="${b.channel}" @change="${(e) => this._updateBinding(idx, 'channel', e.target.value)}" style="max-width:120px">
                  <option value="telegram">telegram</option>
                  <option value="whatsapp">whatsapp</option>
                </select>
                <input
                  type="text"
                  .value="${b.peer}"
                  placeholder="peer (any / chatId / phone)"
                  @input="${(e) => this._updateBinding(idx, 'peer', e.target.value)}"
                />
                <select .value="${b.type}" @change="${(e) => this._updateBinding(idx, 'type', e.target.value)}" style="max-width:100px">
                  <option value="direct">direct</option>
                  <option value="group">group</option>
                  <option value="any">any</option>
                </select>
                <button class="btn btn-danger" @click="${() => this._removeBinding(idx)}">✕</button>
              </div>
            `)}
            <button class="add-btn" style="margin-top:8px" @click="${this._addBinding}">+ Add Binding</button>
          </div>
        </div>
      </div>
      ${this._renderStepActions()}
    `;
  }

  _renderStep6() {
    const state = this._collectState();
    const em = state.emoji;

    return html`
      <div>
        ${this.createState === 'success' ? html`
          <div class="success-block">
            <div class="success-icon">✅</div>
            <h3>Agent Created Successfully!</h3>
            <p>
              ${em} <strong>${state.displayName}</strong> (<code>${state.agentId}</code>) is ready.
              <br /><br />
              <a href="#/agents/${this.createdAgentId}">View Agent →</a>
            </p>
          </div>
        ` : ''}

        ${this.createState === 'error' ? html`
          <div class="error-block">Error: ${this.createError}</div>
        ` : ''}

        ${this.createState === 'creating' ? html`
          <div class="create-progress">
            ${this.createProgress.map(step => html`
              <div class="progress-step">
                <div class="progress-dot"></div>
                ${step}
              </div>
            `)}
          </div>
        ` : ''}

        <!-- Agent Summary Card -->
        <div class="agent-summary-card">
          <div class="agent-summary-emoji">${em || '🤖'}</div>
          <div class="agent-summary-info">
            <h3>${state.displayName || '—'}</h3>
            <div class="agent-id">${state.agentId || '—'}</div>
            <div class="agent-role">${state.roleDescription || '—'}</div>
          </div>
        </div>

        <div class="review-grid">
          <div class="review-card">
            <h4>Model</h4>
            <div style="font-size:13px;color:var(--text)">
              ${state.model ? (typeof state.model === 'string' && state.model.includes('/') ? state.model.split('/').pop() : (typeof state.model === 'object' ? (state.model.primary ?? '—') : state.model)) : '—'}
            </div>
            ${state.fallbacks.length ? html`
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px">
                Fallbacks: ${state.fallbacks.map(f => f.includes('/') ? f.split('/').pop() : f).join(' → ')}
              </div>
            ` : ''}
          </div>

          <div class="review-card">
            <h4>Style &amp; Tone</h4>
            <div style="font-size:13px;color:var(--text);margin-bottom:6px">${state.style}</div>
            <div class="badge-list">
              ${(state.tone || []).map(t => html`<span class="badge">${t}</span>`)}
            </div>
          </div>

          <div class="review-card">
            <h4>Tools (${state.tools.length})</h4>
            <div class="badge-list">
              ${state.tools.length
                ? state.tools.map(t => html`<span class="badge">${t}</span>`)
                : html`<span style="color:var(--text-muted);font-size:12px">None selected</span>`}
            </div>
          </div>

          <div class="review-card">
            <h4>Subagents (${state.subagents.length})</h4>
            <div class="badge-list">
              ${state.subagents.length
                ? state.subagents.map(s => html`<span class="badge">${s}</span>`)
                : html`<span style="color:var(--text-muted);font-size:12px">None selected</span>`}
            </div>
          </div>
        </div>

        ${state.cronJobs.length ? html`
          <div class="review-card" style="margin-bottom:16px">
            <h4>Cron Jobs (${state.cronJobs.length})</h4>
            <table class="review-table">
              <thead><tr><th>Name</th><th>Schedule</th><th>Delivery</th></tr></thead>
              <tbody>
                ${state.cronJobs.map(j => html`
                  <tr>
                    <td>${j.name || '—'}</td>
                    <td><code>${j.schedule || '—'}</code></td>
                    <td>${j.delivery.channel} → ${j.delivery.to || 'unset'}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        ` : ''}

        ${state.bindings.length ? html`
          <div class="review-card" style="margin-bottom:16px">
            <h4>Routing Bindings (${state.bindings.length})</h4>
            <table class="review-table">
              <thead><tr><th>Channel</th><th>Peer</th><th>Type</th></tr></thead>
              <tbody>
                ${state.bindings.map(b => html`
                  <tr><td>${b.channel}</td><td>${b.peer || 'any'}</td><td>${b.type || 'direct'}</td></tr>
                `)}
              </tbody>
            </table>
          </div>
        ` : ''}

        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:8px">
          Generated Files (click to expand)
        </div>
        <div class="file-preview-list">
          ${REVIEW_FILES.map(f => html`
            <div class="file-preview-item">
              <div class="file-preview-header" @click="${() => this._toggleReviewFile(f.key)}">
                <span>${f.key}</span>
                <span class="chevron ${this.reviewOpenFiles[f.key] ? 'open' : ''}">▶</span>
              </div>
              ${this.reviewOpenFiles[f.key] ? html`
                <div class="file-preview-body">
                  <div .innerHTML="${renderMarkdown(f.gen(state))}"></div>
                </div>
              ` : ''}
            </div>
          `)}
        </div>

        <div class="config-preview">
          <h4>Configuration Payload (JSON)</h4>
          <pre>${this._getConfigJson()}</pre>
        </div>

        <div class="step-actions">
          <button class="btn btn-ghost" @click="${this._back}"
            ?disabled="${this.createState === 'creating' || this.createState === 'success'}">
            ← Back
          </button>
          ${this.createState === 'success'
            ? html`<a href="#/agents/${this.createdAgentId}" class="btn btn-green" style="text-decoration:none">View Agent →</a>`
            : html`
              <button
                class="btn btn-green"
                style="padding:12px 28px;font-size:15px"
                @click="${this._createAgent}"
                ?disabled="${this.createState === 'creating'}"
              >
                ${this.createState === 'creating' ? '⟳ Creating...' : 'Create Agent'}
              </button>
            `}
        </div>
      </div>
    `;
  }

  _renderStepActions() {
    return html`
      <div class="step-actions">
        <button class="btn btn-ghost" @click="${this._back}" ?disabled="${this.currentStep === 1}">
          ← Back
        </button>
        <div class="step-actions-right">
          <span style="font-size:11px;color:var(--text-muted)">Step ${this.currentStep} of ${STEPS.length}</span>
          <button class="btn btn-accent" @click="${this._next}" ?disabled="${!this._canNext()}">
            Next →
          </button>
        </div>
      </div>
    `;
  }
}

customElements.define('page-spawn', PageSpawn);
