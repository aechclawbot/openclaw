import { LitElement, html, css } from '/vendor/lit-core.min.js';
import { api } from '/app/api.js';
import { store } from '/app/store.js';

// --- Helper Functions ---

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) {return '$—';}
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function truncAddr(addr) {
  if (!addr) {return '—';}
  if (addr.length <= 12) {return addr;}
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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

function copyToClipboard(text, toastMsg = 'Copied!') {
  navigator.clipboard.writeText(text).then(() => {
    if (typeof window.__oasisToast === 'function') {
      window.__oasisToast(toastMsg, 'ok');
    }
  }).catch(() => {
    if (typeof window.__oasisToast === 'function') {
      window.__oasisToast('Copy failed', 'error');
    }
  });
}

// Pipeline step ordering
const DITO_STEPS = ['identified', 'qualified', 'demo_built', 'pitched', 'won', 'lost'];
const DITO_STEP_LABELS = {
  identified: 'Identified',
  qualified: 'Qualified',
  demo_built: 'Demo Built',
  pitched: 'Pitched',
  won: 'Won',
  lost: 'Lost',
};
const DITO_STEP_COLORS = {
  identified: 'var(--text-dim)',
  qualified: 'var(--yellow)',
  demo_built: 'var(--accent)',
  pitched: 'var(--purple)',
  won: 'var(--green)',
  lost: 'var(--red)',
};

const NOLAN_STEPS = ['identified', 'claimed', 'in-progress', 'submitted', 'completed'];
const NOLAN_STEP_LABELS = {
  identified: 'Identified',
  claimed: 'Claimed',
  'in-progress': 'In Progress',
  submitted: 'Submitted',
  completed: 'Completed',
};
const NOLAN_STEP_COLORS = {
  identified: 'var(--text-dim)',
  claimed: 'var(--yellow)',
  'in-progress': 'var(--accent)',
  submitted: 'var(--purple)',
  completed: 'var(--green)',
};

const AECH_STATUS_COLORS = {
  identified: 'var(--text-dim)',
  approved: 'var(--yellow)',
  executing: 'var(--accent)',
  completed: 'var(--green)',
  cancelled: 'var(--red)',
};

const AECH_SOURCE_COLORS = {
  ebay: '#2563eb',
  amazon: '#f97316',
  crypto: '#a855f7',
  service: '#22c55e',
  other: 'var(--text-dim)',
};

class PageBusiness extends LitElement {
  static properties = {
    _activeTab: { type: String },

    // Overview
    ditoLeads: { type: Array },
    nolanProjects: { type: Array },
    aechDeals: { type: Array },
    treasuryData: { type: Object },
    overviewLoading: { type: Boolean },

    // Dito
    ditoPipelineView: { type: String },  // 'kanban' | 'list'
    ditoFilter: { type: String },
    ditoLoading: { type: Boolean },
    demoSites: { type: Array },
    ditoModalOpen: { type: Boolean },
    ditoModalData: { type: Object },
    ditoDragLeadId: { type: String },
    ditoDragOverCol: { type: String },

    // Nolan
    nolanLoading: { type: Boolean },
    nolanModalOpen: { type: Boolean },
    nolanModalData: { type: Object },

    // Aech
    aechLoading: { type: Boolean },
    aechTreasury: { type: Object },
    aechModalOpen: { type: Boolean },
    aechModalData: { type: Object },

    // Scan history
    ditoScanHistory: { type: Array },
    ditoScanLoading: { type: Boolean },
    ditoScanOpen: { type: Boolean },
    nolanScanHistory: { type: Array },
    nolanScanLoading: { type: Boolean },
    nolanScanOpen: { type: Boolean },
    aechScanHistory: { type: Array },
    aechScanLoading: { type: Boolean },
    aechScanOpen: { type: Boolean },

    // Treasury
    treasuryLoading: { type: Boolean },
    treasuryError: { type: Boolean },
    txModal: { type: Object },  // { wallet, chain, transactions } | null
    txLoading: { type: Boolean },

    // Confirm dialog
    confirmDialog: { type: Object },  // { message, onConfirm } | null

    // Scan run modal
    scanRunModal: { type: Object },  // { jobId, jobLabel, agentLabel, state, startedAt, result, error } | null
  };

  constructor() {
    super();
    this._activeTab = 'overview';
    this.ditoLeads = [];
    this.nolanProjects = [];
    this.aechDeals = [];
    this.treasuryData = null;
    this.overviewLoading = true;
    this.ditoPipelineView = 'kanban';
    this.ditoFilter = 'all';
    this.ditoLoading = false;
    this.demoSites = [];
    this.ditoModalOpen = false;
    this.ditoModalData = {};
    this.ditoDragLeadId = null;
    this.ditoDragOverCol = null;
    this.nolanLoading = false;
    this.nolanModalOpen = false;
    this.nolanModalData = {};
    this.aechLoading = false;
    this.aechTreasury = null;
    this.aechModalOpen = false;
    this.aechModalData = {};
    this.ditoScanHistory = [];
    this.ditoScanLoading = false;
    this.ditoScanOpen = false;
    this.nolanScanHistory = [];
    this.nolanScanLoading = false;
    this.nolanScanOpen = false;
    this.aechScanHistory = [];
    this.aechScanLoading = false;
    this.aechScanOpen = false;
    this.treasuryLoading = true;
    this.treasuryError = false;
    this.txModal = null;
    this.txLoading = false;
    this.confirmDialog = null;
    this.scanRunModal = null;

    this._refreshDitoTimer = null;
    this._scanElapsedTimer = null;
    this._refreshAechTimer = null;
    this._refreshTreasuryTimer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadOverview();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._clearTimers();
  }

  _clearTimers() {
    if (this._refreshDitoTimer) {clearInterval(this._refreshDitoTimer);}
    if (this._refreshAechTimer) {clearInterval(this._refreshAechTimer);}
    if (this._refreshTreasuryTimer) {clearInterval(this._refreshTreasuryTimer);}
    if (this._scanElapsedTimer) {clearInterval(this._scanElapsedTimer);}
  }

  async _loadOverview() {
    this.overviewLoading = true;
    await Promise.allSettled([
      this._fetchDito(),
      this._fetchNolan(),
      this._fetchAech(),
      this._fetchTreasury(),
    ]);
    this.overviewLoading = false;
  }

  async _fetchDito() {
    try {
      const data = await api.get('dito/leads');
      this.ditoLeads = Array.isArray(data) ? data : (data.leads ?? []);
    } catch {
      this.ditoLeads = [];
    }
  }

  async _fetchDemoSites() {
    try {
      const data = await api.get('dito/demos');
      this.demoSites = Array.isArray(data) ? data : (data.demos ?? []);
    } catch {
      this.demoSites = [];
    }
  }

  async _fetchNolan() {
    try {
      const data = await api.get('nolan/projects');
      this.nolanProjects = Array.isArray(data) ? data : (data.projects ?? []);
    } catch {
      this.nolanProjects = [];
    }
  }

  async _fetchAech() {
    try {
      const data = await api.get('aech/deals');
      this.aechDeals = Array.isArray(data) ? data : (data.deals ?? []);
    } catch {
      this.aechDeals = [];
    }
  }

  async _fetchDitoScans() {
    this.ditoScanLoading = true;
    try {
      const [prospecting, pipeline] = await Promise.allSettled([
        api.get('cron/dito-daily-prospecting/runs?limit=5'),
        api.get('cron/dito-weekly-pipeline/runs?limit=5'),
      ]);
      const p = prospecting.status === 'fulfilled' ? (Array.isArray(prospecting.value) ? prospecting.value : (prospecting.value.entries ?? [])) : [];
      const w = pipeline.status === 'fulfilled' ? (Array.isArray(pipeline.value) ? pipeline.value : (pipeline.value.entries ?? [])) : [];
      // Merge, tag source, sort by timestamp desc
      const tagged = [
        ...p.map(r => ({ ...r, _source: 'Daily Prospecting' })),
        ...w.map(r => ({ ...r, _source: 'Weekly Pipeline' })),
      ].toSorted((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
      this.ditoScanHistory = tagged.slice(0, 10);
    } catch {
      this.ditoScanHistory = [];
    } finally {
      this.ditoScanLoading = false;
    }
  }

  async _fetchNolanScans() {
    this.nolanScanLoading = true;
    try {
      const data = await api.get('cron/clawlancer-scan/runs?limit=10');
      this.nolanScanHistory = Array.isArray(data) ? data : (data.entries ?? data.runs ?? []);
    } catch {
      this.nolanScanHistory = [];
    } finally {
      this.nolanScanLoading = false;
    }
  }

  async _fetchAechScans() {
    this.aechScanLoading = true;
    try {
      const data = await api.get('cron/aech-arb-scan/runs?limit=10');
      this.aechScanHistory = Array.isArray(data) ? data : (data.entries ?? data.runs ?? []);
    } catch {
      this.aechScanHistory = [];
    } finally {
      this.aechScanLoading = false;
    }
  }

  async _fetchTreasury() {
    this.treasuryLoading = true;
    this.treasuryError = false;
    try {
      // Use legacy endpoint — it returns per-chain ETH+USDC balances directly.
      // Transform into the array-of-wallets format expected by _renderWalletCard.
      const data = await api.get('treasury');
      const walletEntries = data.wallets ? Object.entries(data.wallets) : [];
      const wallets = walletEntries.map(([id, w]) => {
        // Build chains array from the per-chain breakdown
        const chainsObj = w.chains ?? {};
        const primaryChain = w.chain ?? '';
        const chains = Object.entries(chainsObj)
          // Always show the wallet's primary chain, even if balance is 0
          .filter(([chainId, c]) => chainId === primaryChain || c.totalUsd > 0.01 || c.eth > 0 || c.usdc > 0)
          .map(([chainId, c]) => ({
            name: c.label ?? chainId.toUpperCase(),
            chain: chainId,
            nativeBalance: c.eth ?? 0,
            nativeSymbol: 'ETH',
            nativeUsd: c.ethUsd ?? 0,
            usdcBalance: c.usdc ?? 0,
            totalUsd: c.totalUsd ?? 0,
            isPrimary: chainId === primaryChain,
          }))
          // Sort primary chain first
          .toSorted((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
        return {
          id,
          name: w.name ?? id,
          address: w.address ?? '',
          chain: w.chain ?? '',
          chainLabel: w.chainLabel ?? '',
          totalUsd: w.totalUsd ?? 0,
          chains,
        };
      });

      this.treasuryData = {
        totalUsd: data.totalUsd ?? 0,
        ethPrice: data.ethPrice ?? 0,
        wallets,
      };

      // Extract Aech wallet balance separately for Aech tab
      const aechWallet = wallets.find(w => w.name?.toLowerCase() === 'aech');
      this.aechTreasury = aechWallet ?? null;
    } catch {
      this.treasuryError = true;
      this.treasuryData = null;
    } finally {
      this.treasuryLoading = false;
    }
  }

  _switchTab(tab) {
    this._activeTab = tab;
    this._clearTimers();

    if (tab === 'dito') {
      this._fetchDito();
      this._fetchDemoSites();
      this._fetchDitoScans();
      this._refreshDitoTimer = setInterval(() => this._fetchDito(), 30000);
    } else if (tab === 'nolan') {
      this._fetchNolan();
      this._fetchNolanScans();
    } else if (tab === 'aech') {
      this._fetchAech();
      this._fetchTreasury();
      this._fetchAechScans();
      this._refreshAechTimer = setInterval(() => this._fetchAech(), 30000);
      this._refreshTreasuryTimer = setInterval(() => this._fetchTreasury(), 60000);
    } else if (tab === 'treasury') {
      this._fetchTreasury();
      this._refreshTreasuryTimer = setInterval(() => this._fetchTreasury(), 60000);
    }
  }

  // ──────────────────────────────────────────
  // DITO OPERATIONS
  // ──────────────────────────────────────────

  async _addLead(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    // Build contact string from individual fields
    const parts = [fd.get('contactName'), fd.get('phone'), fd.get('email')].filter(Boolean);
    const body = {
      name: fd.get('name'),
      type: fd.get('type'),
      location: fd.get('location'),
      contact: parts.join(' / ') || '',
      website: fd.get('website'),
      notes: fd.get('notes'),
      status: 'identified',
    };
    const result = await api.post('dito/leads', body);
    if (result) {
      this.ditoModalOpen = false;
      this.ditoModalData = {};
      await this._fetchDito();
      window.__oasisToast?.('Lead added', 'ok');
    }
  }

  async _updateLead(index, changes) {
    const result = await api.patch(`dito/leads/${index}`, changes);
    if (result) {
      await this._fetchDito();
    }
    return result;
  }

  async _deleteLead(index) {
    this._showConfirm('Delete this lead?', async () => {
      await api.delete(`dito/leads/${index}`);
      await this._fetchDito();
      window.__oasisToast?.('Lead deleted', 'ok');
    });
  }

  _advanceLeadStatus(lead) {
    const steps = DITO_STEPS.filter(s => s !== 'lost');
    const idx = steps.indexOf(lead.status);
    if (idx >= 0 && idx < steps.length - 1) {
      this._updateLead(lead.index, { status: steps[idx + 1] });
    }
  }

  _revertLeadStatus(lead) {
    const steps = DITO_STEPS.filter(s => s !== 'lost');
    const idx = steps.indexOf(lead.status);
    if (idx > 0) {
      this._updateLead(lead.index, { status: steps[idx - 1] });
    }
  }

  _markLeadLost(lead) {
    this._showConfirm('Mark this lead as Lost?', () => {
      this._updateLead(lead.index, { status: 'lost' });
    });
  }

  _reopenLead(lead) {
    this._updateLead(lead.index, { status: 'identified' });
  }

  _approveAndAdvanceLead(lead, actionLabel) {
    const steps = DITO_STEPS.filter(s => s !== 'lost');
    const idx = steps.indexOf(lead.status);
    if (idx < 0 || idx >= steps.length - 1) {return;}
    const nextStatus = steps[idx + 1];
    this._showConfirm(`${actionLabel} "${lead.name}"? Move to ${DITO_STEP_LABELS[nextStatus]}.`, async () => {
      await this._updateLead(lead.index, { status: nextStatus });
      window.__oasisToast?.(`${lead.name} → ${DITO_STEP_LABELS[nextStatus]}`, 'ok');
    });
  }

  // Drag-and-drop
  _onDragStart(e, leadId) {
    this.ditoDragLeadId = leadId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leadId);
    e.currentTarget.style.opacity = '0.4';
  }

  _onDragEnd(e) {
    e.currentTarget.style.opacity = '';
    this.ditoDragLeadId = null;
    this.ditoDragOverCol = null;
  }

  _onDragOver(e, col) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    this.ditoDragOverCol = col;
  }

  _onDragLeave() {
    this.ditoDragOverCol = null;
  }

  async _onDrop(e, col) {
    e.preventDefault();
    const leadIndex = this.ditoDragLeadId ?? e.dataTransfer.getData('text/plain');
    this.ditoDragOverCol = null;
    this.ditoDragLeadId = null;
    if (leadIndex != null && leadIndex !== '' && col) {
      await this._updateLead(leadIndex, { status: col });
    }
  }

  // ──────────────────────────────────────────
  // NOLAN OPERATIONS
  // ──────────────────────────────────────────

  async _saveNolanProject(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const body = {
      title: fd.get('title'),
      source: fd.get('source'),
      status: fd.get('status') || 'identified',
      description: fd.get('description'),
      fee: fd.get('fee') ? parseFloat(fd.get('fee')) : null,
      url: fd.get('url'),
      notes: fd.get('notes'),
    };
    let result;
    if (this.nolanModalData?.id) {
      result = await api.patch(`nolan/projects/${this.nolanModalData.id}`, body);
    } else {
      result = await api.post('nolan/projects', body);
    }
    if (result) {
      this.nolanModalOpen = false;
      this.nolanModalData = {};
      await this._fetchNolan();
      window.__oasisToast?.(`Project ${this.nolanModalData?.id ? 'updated' : 'added'}`, 'ok');
    }
  }

  async _advanceNolanStatus(project) {
    const idx = NOLAN_STEPS.indexOf(project.status);
    if (idx >= 0 && idx < NOLAN_STEPS.length - 1) {
      await api.patch(`nolan/projects/${project.id}`, { status: NOLAN_STEPS[idx + 1] });
      await this._fetchNolan();
    }
  }

  async _deleteNolanProject(id) {
    this._showConfirm('Delete this project?', async () => {
      await api.delete(`nolan/projects/${id}`);
      await this._fetchNolan();
      window.__oasisToast?.('Project deleted', 'ok');
    });
  }

  async _triggerScanWithModal(jobId, jobLabel, agentLabel, refreshFn) {
    // Open modal immediately in running state
    if (this._scanElapsedTimer) {clearInterval(this._scanElapsedTimer);}
    this.scanRunModal = { jobId, jobLabel, agentLabel, state: 'running', startedAt: Date.now(), result: null, error: null };
    // Tick elapsed time every second for the live counter
    this._scanElapsedTimer = setInterval(() => { this.requestUpdate(); }, 1000);

    // api.post returns null on error (already shows toast), otherwise JSON response
    const data = await api.post(`cron/${jobId}/run`);
    if (this._scanElapsedTimer) { clearInterval(this._scanElapsedTimer); this._scanElapsedTimer = null; }

    if (data) {
      // Server returns { ok, result } — result has the cron run details
      // Also try to fetch the latest run entry which has richer metadata
      const rpcResult = data.result ?? {};
      let runEntry = null;
      try {
        const history = await api.get(`cron/${jobId}/runs?limit=1`);
        runEntry = (history?.entries ?? [])[0] ?? null;
      } catch { /* ignore — rpc result is enough */ }
      // Merge: prefer run history entry (has summary, model, usage, duration) over raw rpc result
      const result = runEntry ? { ...rpcResult, ...runEntry } : rpcResult;
      this.scanRunModal = { ...this.scanRunModal, state: 'done', result };
    } else {
      this.scanRunModal = { ...this.scanRunModal, state: 'error', error: 'Request failed or timed out. Check scan history for details.' };
    }
    // Refresh tab data in background
    if (refreshFn) {refreshFn();}
  }

  _triggerClawlancerScan() {
    this._triggerScanWithModal('clawlancer-scan', 'Nolan Scan', 'nolan', () => {
      this._fetchNolan();
      this._fetchNolanScans();
    });
  }

  _triggerDitoProspecting() {
    this._triggerScanWithModal('dito-daily-prospecting', 'Dito Prospecting', 'dito', () => {
      this._fetchDito();
      this._fetchDitoScans();
    });
  }

  _triggerAechScan() {
    this._triggerScanWithModal('aech-arb-scan', 'Aech Scan', 'aech', () => {
      this._fetchAech();
      this._fetchAechScans();
    });
  }

  _closeScanModal() {
    if (this._scanElapsedTimer) { clearInterval(this._scanElapsedTimer); this._scanElapsedTimer = null; }
    this.scanRunModal = null;
  }

  // ──────────────────────────────────────────
  // AECH OPERATIONS
  // ──────────────────────────────────────────

  async _saveAechDeal(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const body = {
      assetName: fd.get('assetName'),
      source: fd.get('source'),
      buyPrice: fd.get('buyPrice') ? parseFloat(fd.get('buyPrice')) : null,
      sellPrice: fd.get('sellPrice') ? parseFloat(fd.get('sellPrice')) : null,
      estimatedFees: fd.get('estimatedFees') ? parseFloat(fd.get('estimatedFees')) : 0,
      riskLevel: parseInt(fd.get('riskLevel'), 10) || 1,
      listingUrl: fd.get('listingUrl'),
      notes: fd.get('notes'),
    };
    let result;
    if (this.aechModalData?.id) {
      result = await api.patch(`aech/deals/${this.aechModalData.id}`, body);
    } else {
      body.status = 'identified';
      result = await api.post('aech/deals', body);
    }
    if (result) {
      this.aechModalOpen = false;
      this.aechModalData = {};
      await this._fetchAech();
      window.__oasisToast?.('Deal saved', 'ok');
    }
  }

  async _approveAechDeal(deal) {
    await api.patch(`aech/deals/${deal.id}`, { status: 'approved' });
    await this._fetchAech();
  }

  async _cancelAechDeal(deal) {
    this._showConfirm('Mark as No-Go / Cancel this deal?', async () => {
      await api.patch(`aech/deals/${deal.id}`, { status: 'cancelled' });
      await this._fetchAech();
    });
  }

  async _executeAechDeal(deal) {
    await api.patch(`aech/deals/${deal.id}`, { status: 'executing' });
    await this._fetchAech();
  }

  async _completeAechDeal(deal) {
    await api.patch(`aech/deals/${deal.id}`, { status: 'completed' });
    await this._fetchAech();
  }

  async _deleteAechDeal(id) {
    this._showConfirm('Delete this deal?', async () => {
      await api.delete(`aech/deals/${id}`);
      await this._fetchAech();
      window.__oasisToast?.('Deal deleted', 'ok');
    });
  }

  // ──────────────────────────────────────────
  // TREASURY OPERATIONS
  // ──────────────────────────────────────────

  async _loadTransactions(walletName, chain) {
    // Normalize chain key: legacy uses 'eth' but v2 service expects 'ethereum'
    const chainKeyMap = { eth: 'ethereum', poly: 'polygon' };
    const chainKey = chainKeyMap[chain] ?? chain;
    this.txModal = { walletName, chain: chainKey, transactions: [] };
    this.txLoading = true;
    try {
      const data = await api.get(`treasury/transactions/${walletName}/${chainKey}`);
      this.txModal = {
        walletName,
        chain: chainKey,
        transactions: Array.isArray(data) ? data : (data.transactions ?? []),
      };
    } catch {
      this.txModal = { walletName, chain: chainKey, transactions: [] };
    } finally {
      this.txLoading = false;
    }
  }

  _explorerLink(txHash, chain) {
    const c = (chain ?? '').toLowerCase();
    if (c === 'base') {return `https://basescan.org/tx/${txHash}`;}
    if (c === 'polygon' || c === 'poly') {return `https://polygonscan.com/tx/${txHash}`;}
    return `https://etherscan.io/tx/${txHash}`;
  }

  _addressExplorerLink(address, chain) {
    const c = (chain ?? '').toLowerCase();
    if (c === 'base') {return `https://basescan.org/address/${address}`;}
    if (c === 'polygon' || c === 'poly') {return `https://polygonscan.com/address/${address}`;}
    return `https://etherscan.io/address/${address}`;
  }

  // ──────────────────────────────────────────
  // SHARED HELPERS
  // ──────────────────────────────────────────

  _showConfirm(message, onConfirm) {
    this.confirmDialog = { message, onConfirm };
  }

  _confirmYes() {
    if (this.confirmDialog?.onConfirm) {this.confirmDialog.onConfirm();}
    this.confirmDialog = null;
  }

  _confirmNo() {
    this.confirmDialog = null;
  }

  // ──────────────────────────────────────────
  // STYLES
  // ──────────────────────────────────────────

  static styles = css`
    :host {
      display: block;
      font-family: "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace;
      color: var(--text, #e0e6f0);
      background: var(--bg, #0a0e17);
      min-height: 100%;
      padding: 24px;
      box-sizing: border-box;
    }

    h2 {
      margin: 0 0 20px;
      font-size: 1.3rem;
      color: var(--text);
      font-weight: 600;
    }

    /* Tabs */
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border, #2a3550);
      padding-bottom: 0;
    }
    .tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-dim, #7a8ba8);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.85rem;
      padding: 8px 16px;
      margin-bottom: -1px;
      transition: color 0.15s, border-color 0.15s;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active {
      color: var(--accent, #00d4ff);
      border-bottom-color: var(--accent, #00d4ff);
      font-weight: 600;
    }

    /* Cards */
    .card {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      padding: 16px;
    }
    .card-sm {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 6px;
      padding: 12px 16px;
    }

    /* Summary cards row */
    .summary-row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .summary-card {
      background: var(--surface, #131926);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      padding: 16px;
    }
    .summary-card .label {
      font-size: 0.72rem;
      color: var(--text-muted, #4a5568);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 6px;
    }
    .summary-card .value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
    }
    .summary-card .sub {
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-top: 2px;
    }

    /* Stat pill grid */
    .stat-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 20px;
    }
    .stat-pill {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 80px;
    }
    .stat-pill .sp-val {
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--text);
    }
    .stat-pill .sp-label {
      font-size: 0.68rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-top: 2px;
    }

    /* Badges */
    .badge {
      display: inline-block;
      font-size: 0.68rem;
      font-weight: 600;
      border-radius: 4px;
      padding: 2px 7px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* Buttons */
    button { cursor: pointer; font-family: inherit; }
    .btn {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border);
      border-radius: 5px;
      color: var(--text);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.78rem;
      padding: 6px 12px;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--surface-3, #222d42); }
    .btn-accent {
      background: var(--accent-dim, rgba(0,212,255,0.15));
      border-color: var(--accent, #00d4ff);
      color: var(--accent, #00d4ff);
    }
    .btn-accent:hover { background: rgba(0,212,255,0.25); }
    .btn-danger {
      background: rgba(239,68,68,0.12);
      border-color: var(--red, #ef4444);
      color: var(--red, #ef4444);
    }
    .btn-danger:hover { background: rgba(239,68,68,0.22); }
    .btn-sm {
      padding: 3px 8px;
      font-size: 0.72rem;
    }
    .btn-icon {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-dim);
      font-size: 0.85rem;
      padding: 3px 6px;
      border-radius: 4px;
      transition: background 0.12s, color 0.12s;
    }
    .btn-icon:hover { background: var(--surface-3); color: var(--text); }

    /* Kanban */
    .kanban-board {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 8px;
      min-height: 400px;
    }
    .kanban-col {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 8px;
      min-width: 220px;
      max-width: 260px;
      flex: 1;
      display: flex;
      flex-direction: column;
      transition: border-color 0.15s;
    }
    .kanban-col.drag-over {
      border-color: var(--accent, #00d4ff);
      background: rgba(0,212,255,0.04);
    }
    .kanban-col.col-won { border-top: 2px solid var(--green, #22c55e); }
    .kanban-col.col-lost { border-top: 2px solid var(--red, #ef4444); }
    .kanban-col-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .kanban-col-title {
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--text);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .kanban-col-count {
      font-size: 0.72rem;
      color: var(--text-muted);
      background: var(--surface-3);
      border-radius: 10px;
      padding: 1px 7px;
    }
    .kanban-cards {
      padding: 8px;
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 60px;
    }
    .lead-card {
      background: var(--surface, #131926);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      cursor: grab;
      transition: box-shadow 0.15s;
    }
    .lead-card:hover { box-shadow: 0 0 0 1px var(--border); }
    .lead-card[draggable="true"]:active { cursor: grabbing; }
    .lead-card .lc-name { font-size: 0.85rem; font-weight: 700; color: var(--text); margin-bottom: 4px; }
    .lead-card .lc-loc { font-size: 0.72rem; color: var(--text-dim); margin-bottom: 4px; }
    .lead-card .lc-contact { font-size: 0.7rem; color: var(--text-muted); }
    .lead-card .lc-date { font-size: 0.68rem; color: var(--text-muted); margin-top: 4px; }
    .lead-card .lc-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      margin-top: 8px;
      border-top: 1px solid var(--border);
      padding-top: 6px;
    }

    /* List view */
    .list-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .list-table th {
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 8px 12px;
      text-align: left;
    }
    .list-table td {
      border-bottom: 1px solid var(--border);
      padding: 8px 12px;
      vertical-align: middle;
    }
    .list-table tr:last-child td { border-bottom: none; }
    .list-table tr:hover td { background: var(--surface-2); }

    /* Demo sites */
    .demos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 10px;
      margin-top: 8px;
    }
    .demo-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 0.78rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .demo-card a { color: var(--accent); text-decoration: none; }
    .demo-card a:hover { text-decoration: underline; }

    /* Project cards */
    .project-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .project-card {
      background: var(--surface, #131926);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
    }
    .project-card .pc-title {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .project-card .pc-desc {
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-bottom: 8px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .project-card .pc-meta {
      font-size: 0.7rem;
      color: var(--text-muted);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .project-card .pc-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      border-top: 1px solid var(--border);
      padding-top: 8px;
    }

    /* Deal cards */
    .deal-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 12px;
    }
    .deal-card {
      background: var(--surface, #131926);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
    }
    .deal-card .dc-title {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .deal-card .price-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
      margin-bottom: 8px;
    }
    .deal-card .price-table th {
      color: var(--text-muted);
      font-size: 0.67rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 4px;
      text-align: right;
      font-weight: 400;
    }
    .deal-card .price-table td {
      text-align: right;
      padding: 2px 4px;
      color: var(--text);
    }
    .deal-card .price-table th:first-child,
    .deal-card .price-table td:first-child { text-align: left; }
    .spread-pos { color: var(--green, #22c55e); font-weight: 600; }
    .spread-neg { color: var(--red, #ef4444); font-weight: 600; }
    .deal-card .dc-meta {
      font-size: 0.7rem;
      color: var(--text-muted);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
      align-items: center;
    }
    .deal-card .dc-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      border-top: 1px solid var(--border);
      padding-top: 8px;
    }
    .verdict-badge {
      font-size: 0.7rem;
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 600;
    }

    /* Treasury */
    .wallet-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .wallet-card {
      background: var(--surface, #131926);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .wallet-card .wc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .wallet-card .wc-name {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text);
    }
    .wallet-card .wc-total {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent);
    }
    .wallet-card .wc-addr {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.72rem;
      color: var(--text-dim);
      font-family: monospace;
      margin-bottom: 12px;
    }
    .chain-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.78rem;
    }
    .chain-row:last-child { border-bottom: none; }
    .chain-row .cr-balances {
      text-align: right;
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    .chain-row .cr-balances .usdc { color: var(--green); }

    /* Mini tx table */
    .tx-mini {
      margin-top: 12px;
      font-size: 0.72rem;
      width: 100%;
      border-collapse: collapse;
    }
    .tx-mini th {
      color: var(--text-muted);
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 3px 4px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    .tx-mini td {
      padding: 4px;
      border-bottom: 1px solid rgba(42,53,80,0.5);
      color: var(--text-dim);
    }
    .tx-mini tr:last-child td { border-bottom: none; }
    .tx-in { color: var(--green); }
    .tx-out { color: var(--red); }

    /* Pipeline health bar */
    .pipeline-bar {
      display: flex;
      height: 10px;
      border-radius: 5px;
      overflow: hidden;
      margin: 6px 0;
      gap: 1px;
    }
    .pipeline-bar .seg {
      height: 100%;
      min-width: 2px;
      border-radius: 1px;
      transition: flex 0.3s;
    }

    /* Modal overlay */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200;
    }
    .modal-box {
      background: var(--surface, #131926);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 24px;
      width: 90%;
      max-width: 480px;
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal-box h3 {
      margin: 0 0 18px;
      font-size: 1rem;
      color: var(--text);
    }
    .modal-box .form-group {
      margin-bottom: 14px;
    }
    .modal-box label {
      display: block;
      font-size: 0.72rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 5px;
    }
    .modal-box input,
    .modal-box select,
    .modal-box textarea {
      width: 100%;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 5px;
      color: var(--text);
      font-family: inherit;
      font-size: 0.82rem;
      padding: 7px 10px;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.15s;
    }
    .modal-box input:focus,
    .modal-box select:focus,
    .modal-box textarea:focus { border-color: var(--accent); }
    .modal-box select option { background: var(--surface); }
    .modal-box textarea { min-height: 70px; resize: vertical; }
    .modal-box .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .modal-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }

    /* Confirm dialog */
    .confirm-box {
      background: var(--surface, #131926);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 24px 28px;
      max-width: 360px;
      width: 90%;
    }
    .confirm-box p {
      color: var(--text);
      font-size: 0.9rem;
      margin: 0 0 18px;
    }
    .confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }

    /* Mini bar chart (overview pipeline) */
    .mini-chart { margin-top: 6px; }
    .mini-chart-label {
      font-size: 0.68rem;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      margin-bottom: 3px;
    }

    /* Recent activity list */
    .activity-list { display: flex; flex-direction: column; gap: 6px; }
    .activity-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.78rem;
      padding: 8px 12px;
      background: var(--surface-2);
      border-radius: 6px;
    }
    .activity-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .activity-time { color: var(--text-muted); font-size: 0.7rem; margin-left: auto; }

    /* Scan history */
    .scan-history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 4px 0;
      user-select: none;
    }
    .scan-history-header:hover .section-title { color: var(--accent); }
    .scan-history-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
    }
    .scan-entry {
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 6px;
      padding: 10px 12px;
    }
    .scan-entry-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 4px;
    }
    .scan-entry-body {
      font-size: 0.75rem;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.4;
    }

    /* Scan Run Modal */
    .scan-run-modal { max-width: 560px; }
    .srm-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 18px;
    }
    .srm-header h3 { font-size: 1rem; color: var(--text); }
    .srm-agent-badge {
      display: inline-block;
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--accent);
      background: rgba(99,179,237,0.1);
      padding: 2px 8px;
      border-radius: 4px;
    }
    .srm-status-badge {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 4px 12px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .srm-running {
      color: var(--yellow, #eab308);
      background: rgba(234,179,8,0.12);
      animation: srm-pulse 1.5s ease-in-out infinite;
    }
    .srm-done {
      color: var(--green, #22c55e);
      background: rgba(34,197,94,0.12);
    }
    .srm-error {
      color: var(--red, #ef4444);
      background: rgba(239,68,68,0.12);
    }
    @keyframes srm-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .srm-running-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 24px 0;
    }
    .srm-spinner-row {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 0.88rem;
      color: var(--text);
    }
    .srm-spinner {
      width: 22px;
      height: 22px;
      border: 3px solid var(--border, #2a3550);
      border-top-color: var(--accent, #63b3ed);
      border-radius: 50%;
      animation: srm-spin 0.8s linear infinite;
    }
    @keyframes srm-spin {
      to { transform: rotate(360deg); }
    }
    .srm-elapsed {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.82rem;
    }
    .srm-elapsed-label {
      color: var(--text-muted);
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .srm-elapsed-val {
      color: var(--text);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .srm-hint {
      font-size: 0.72rem;
      color: var(--text-muted);
      text-align: center;
      max-width: 320px;
      line-height: 1.4;
    }
    .srm-result-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .srm-meta-row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .srm-meta-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .srm-meta-item .srm-meta-label {
      font-size: 0.68rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .srm-meta-item span:last-child {
      font-size: 0.82rem;
      color: var(--text);
      font-weight: 600;
    }
    .srm-summary-label {
      font-size: 0.72rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-top: 4px;
    }
    .srm-summary {
      font-size: 0.78rem;
      color: var(--text-dim, #94a3b8);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
      background: var(--surface-2, #1a2235);
      border: 1px solid var(--border, #2a3550);
      border-radius: 6px;
      padding: 14px;
      max-height: 300px;
      overflow-y: auto;
    }
    .srm-session {
      font-size: 0.68rem;
      color: var(--text-muted);
    }
    .srm-session code {
      background: var(--surface-2, #1a2235);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.68rem;
    }
    .srm-error-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      padding: 20px 0;
    }
    .srm-error-msg {
      font-size: 0.82rem;
      color: var(--red, #ef4444);
      background: rgba(239,68,68,0.08);
      border: 1px solid rgba(239,68,68,0.2);
      border-radius: 6px;
      padding: 12px 16px;
      width: 100%;
      box-sizing: border-box;
      word-break: break-word;
    }

    /* Misc */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--text);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .empty-state {
      color: var(--text-muted);
      font-size: 0.8rem;
      padding: 24px;
      text-align: center;
    }
    .loading-state {
      color: var(--text-muted);
      font-size: 0.8rem;
      padding: 20px;
      text-align: center;
    }
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }
    .three-col {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
      align-items: stretch;
    }
    .three-col > .card {
      display: flex;
      flex-direction: column;
      min-height: 100px;
    }
    @media (max-width: 800px) {
      .two-col, .three-col { grid-template-columns: 1fr; }
      .kanban-board { flex-direction: column; }
      .kanban-col { min-width: unset; max-width: unset; }
    }
    .view-toggle {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
    }
    .view-toggle .vt-btn {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 5px;
      color: var(--text-dim);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.75rem;
      padding: 5px 12px;
      transition: background 0.12s, color 0.12s;
    }
    .view-toggle .vt-btn.active {
      background: var(--accent-dim);
      border-color: var(--accent);
      color: var(--accent);
    }
    .risk-badge-low  { background: rgba(34,197,94,0.15); color: var(--green); border: 1px solid var(--green); }
    .risk-badge-med  { background: rgba(234,179,8,0.15); color: var(--yellow); border: 1px solid var(--yellow); }
    .risk-badge-high { background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid var(--red); }
    .range-value { color: var(--accent); font-size: 0.8rem; margin-left: 8px; }
    input[type="range"] { width: 100%; cursor: pointer; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
  `;

  // ──────────────────────────────────────────
  // RENDER HELPERS
  // ──────────────────────────────────────────

  _statusBadge(status, colorMap, labelMap) {
    const color = colorMap?.[status] ?? 'var(--text-dim)';
    const label = labelMap?.[status] ?? status;
    return html`
      <span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">
        ${label}
      </span>`;
  }

  _ditoStatusBadge(s) { return this._statusBadge(s, DITO_STEP_COLORS, DITO_STEP_LABELS); }
  _nolanStatusBadge(s) { return this._statusBadge(s, NOLAN_STEP_COLORS, NOLAN_STEP_LABELS); }
  _aechStatusBadge(s) { return this._statusBadge(s, AECH_STATUS_COLORS, { identified: 'Identified', approved: 'Approved', executing: 'Executing', completed: 'Completed', cancelled: 'Cancelled' }); }

  _sourceBadge(source, colorMap) {
    const color = colorMap?.[source?.toLowerCase()] ?? 'var(--text-dim)';
    return html`<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${source}</span>`;
  }

  _riskBadge(level) {
    const n = parseInt(level) || 1;
    if (n <= 2) {return html`<span class="badge risk-badge-low">Low</span>`;}
    if (n === 3) {return html`<span class="badge risk-badge-med">Med</span>`;}
    return html`<span class="badge risk-badge-high">High</span>`;
  }

  _verdictBadge(verdict) {
    if (!verdict || verdict === 'pending') {return html`<span class="verdict-badge" style="background:rgba(74,85,104,0.2);color:var(--text-muted)">⏳ Pending</span>`;}
    const v = verdict.toUpperCase();
    if (v === 'CLEAR') {return html`<span class="verdict-badge" style="background:rgba(34,197,94,0.15);color:var(--green)">🟢 CLEAR</span>`;}
    if (v === 'FLAG') {return html`<span class="verdict-badge" style="background:rgba(234,179,8,0.15);color:var(--yellow)">🟡 FLAG</span>`;}
    if (v === 'BLOCK') {return html`<span class="verdict-badge" style="background:rgba(239,68,68,0.15);color:var(--red)">🔴 BLOCK</span>`;}
    return html`<span class="verdict-badge" style="background:rgba(74,85,104,0.2);color:var(--text-muted)">${verdict}</span>`;
  }

  _pipelineBar(items, statusKey, colorMap) {
    const counts = {};
    for (const item of items) {
      const s = item[statusKey] ?? 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    const total = items.length || 1;
    const segments = Object.entries(counts).map(([s, c]) => ({
      status: s,
      count: c,
      pct: (c / total) * 100,
      color: colorMap?.[s] ?? 'var(--text-dim)',
    }));
    return html`
      <div class="pipeline-bar">
        ${segments.map(seg => html`
          <div class="seg" title="${seg.status}: ${seg.count}"
            style="flex:${seg.pct};background:${seg.color}"></div>
        `)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
        ${segments.map(seg => html`
          <span style="font-size:0.68rem;color:${seg.color}">
            ${seg.count} ${DITO_STEP_LABELS[seg.status] ?? NOLAN_STEP_LABELS[seg.status] ?? seg.status}
          </span>
        `)}
      </div>`;
  }

  // ──────────────────────────────────────────
  // OVERVIEW TAB
  // ──────────────────────────────────────────

  _calcRevenue(deals) {
    return deals
      .filter(d => d.status === 'completed')
      .reduce((sum, d) => {
        const spread = ((d.sellPrice ?? 0) - (d.buyPrice ?? 0) - (d.estimatedFees ?? d.fees ?? 0));
        return sum + (spread > 0 ? spread : 0);
      }, 0);
  }

  _recentActivity() {
    const items = [];
    for (const l of this.ditoLeads) {
      items.push({ label: `Dito: ${l.name} → ${DITO_STEP_LABELS[l.status] ?? l.status}`, ts: l.updatedAt ?? l.dateAdded ?? l.createdAt, color: DITO_STEP_COLORS[l.status] ?? 'var(--text-dim)' });
    }
    for (const p of this.nolanProjects) {
      items.push({ label: `Nolan: ${p.title} → ${NOLAN_STEP_LABELS[p.status] ?? p.status}`, ts: p.updatedAt ?? p.dateAdded ?? p.createdAt, color: NOLAN_STEP_COLORS[p.status] ?? 'var(--text-dim)' });
    }
    for (const d of this.aechDeals) {
      items.push({ label: `Aech: ${d.asset ?? d.assetName} → ${d.status}`, ts: d.updatedAt ?? d.dateAdded ?? d.createdAt, color: AECH_STATUS_COLORS[d.status] ?? 'var(--text-dim)' });
    }
    return items
      .filter(i => i.ts)
      .toSorted((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 5);
  }

  _renderOverview() {
    const ditoRev = this._calcRevenue([]);  // Dito doesn't have revenue yet
    const nolanRev = this.nolanProjects
      .filter(p => p.status === 'completed' && p.fee)
      .reduce((s, p) => s + (p.fee ?? 0), 0);
    const aechRev = this._calcRevenue(this.aechDeals);
    const totalRev = ditoRev + nolanRev + aechRev;
    const treasuryBal = this.treasuryData?.totalUsd ?? this.treasuryData?.total ?? null;
    const activity = this._recentActivity();

    return html`
      <!-- Revenue cards -->
      <div class="summary-row">
        <div class="summary-card">
          <div class="label">Total Revenue</div>
          <div class="value">${formatCurrency(totalRev)}</div>
          <div class="sub">All agents combined</div>
        </div>
        <div class="summary-card">
          <div class="label">Dito Revenue</div>
          <div class="value">${formatCurrency(ditoRev)}</div>
          <div class="sub">${this.ditoLeads.length} leads in pipeline</div>
        </div>
        <div class="summary-card">
          <div class="label">Nolan Revenue</div>
          <div class="value">${formatCurrency(nolanRev)}</div>
          <div class="sub">${this.nolanProjects.length} projects</div>
        </div>
        <div class="summary-card">
          <div class="label">Aech Revenue</div>
          <div class="value">${formatCurrency(aechRev)}</div>
          <div class="sub">${this.aechDeals.length} deals tracked</div>
        </div>
        <div class="summary-card">
          <div class="label">Treasury Balance</div>
          <div class="value">${this.treasuryLoading ? '…' : formatCurrency(treasuryBal)}</div>
          <div class="sub">Multi-chain portfolio</div>
        </div>
      </div>

      <!-- Pipeline health -->
      <div class="three-col">
        <div class="card">
          <div class="section-title" style="margin-bottom:10px">Dito Pipeline</div>
          ${this.ditoLeads.length === 0
            ? html`<div class="empty-state">No leads</div>`
            : this._pipelineBar(this.ditoLeads, 'status', DITO_STEP_COLORS)
          }
        </div>
        <div class="card">
          <div class="section-title" style="margin-bottom:10px">Nolan Projects</div>
          ${this.nolanProjects.length === 0
            ? html`<div class="empty-state">No projects</div>`
            : this._pipelineBar(this.nolanProjects, 'status', NOLAN_STEP_COLORS)
          }
        </div>
        <div class="card">
          <div class="section-title" style="margin-bottom:10px">Aech Deals</div>
          ${this.aechDeals.length === 0
            ? html`<div class="empty-state">No deals</div>`
            : this._pipelineBar(this.aechDeals, 'status', AECH_STATUS_COLORS)
          }
        </div>
      </div>

      <!-- Recent activity -->
      <div class="card">
        <div class="section-title" style="margin-bottom:12px">Recent Activity</div>
        ${activity.length === 0
          ? html`<div class="empty-state">No recent activity</div>`
          : html`<div class="activity-list">
              ${activity.map(a => html`
                <div class="activity-item">
                  <div class="activity-dot" style="background:${a.color}"></div>
                  <span>${a.label}</span>
                  <span class="activity-time">${timeAgo(a.ts)}</span>
                </div>
              `)}
            </div>`
        }
      </div>
    `;
  }

  // ──────────────────────────────────────────
  // DITO TAB
  // ──────────────────────────────────────────

  _renderDitoStats() {
    const byStatus = {};
    for (const s of DITO_STEPS) {byStatus[s] = 0;}
    for (const l of this.ditoLeads) {byStatus[l.status] = (byStatus[l.status] || 0) + 1;}
    const statLabels = { identified: 'Total', qualified: 'Qualified', demo_built: 'Demos Built', pitched: 'Pitched', won: 'Won', lost: 'Lost' };
    return html`
      <div class="stat-grid">
        <div class="stat-pill">
          <span class="sp-val">${this.ditoLeads.length}</span>
          <span class="sp-label">Total</span>
        </div>
        ${DITO_STEPS.filter(s => s !== 'identified').map(s => html`
          <div class="stat-pill">
            <span class="sp-val" style="color:${DITO_STEP_COLORS[s]}">${byStatus[s]}</span>
            <span class="sp-label">${DITO_STEP_LABELS[s]}</span>
          </div>
        `)}
      </div>`;
  }

  _renderLeadCard(lead) {
    const isLost = lead.status === 'lost';
    const isWon = lead.status === 'won';
    const steps = DITO_STEPS.filter(s => s !== 'lost');
    const idx = steps.indexOf(lead.status);
    const canAdvance = !isLost && !isWon && idx < steps.length - 1;
    const canRevert = !isLost && idx > 0;
    const nextStepLabel = canAdvance ? DITO_STEP_LABELS[steps[idx + 1]] : null;
    const approveLabel = canAdvance ? {
      identified: 'Qualify',
      qualified: 'Build Demo',
      demo_built: 'Pitch',
      pitched: 'Mark Won',
    }[lead.status] ?? 'Advance' : null;

    return html`
      <div class="lead-card"
        draggable="true"
        @dragstart=${(e) => this._onDragStart(e, lead.index)}
        @dragend=${(e) => this._onDragEnd(e)}>
        <div class="lc-name">${lead.name}</div>
        ${lead.type ? html`${this._sourceBadge(lead.type, {})}` : ''}
        ${lead.location ? html`<div class="lc-loc">📍 ${lead.location}</div>` : ''}
        ${lead.contact
          ? html`<div class="lc-contact">👤 ${lead.contact}</div>`
          : ''}
        ${lead.notes ? html`<div class="lc-contact" style="margin-top:4px;color:var(--text-muted);font-style:italic">${lead.notes.slice(0, 60)}${lead.notes.length > 60 ? '…' : ''}</div>` : ''}
        <div class="lc-date">${timeAgo(lead.dateAdded)}</div>
        ${canAdvance ? html`
          <button class="btn btn-sm btn-accent" style="width:100%;margin-bottom:4px"
            @click=${() => this._approveAndAdvanceLead(lead, approveLabel)}>
            ${approveLabel} →
          </button>` : ''}
        <div class="lc-actions">
          <button class="btn-icon" title="Google Search"
            @click=${() => window.open(`https://www.google.com/search?q=${encodeURIComponent((lead.name || '') + ' ' + (lead.location || ''))}`, '_blank')}>🔍</button>
          ${lead.website ? html`<button class="btn-icon" title="Visit Site"
            @click=${() => window.open(lead.website, '_blank')}>🌐</button>` : ''}
          ${canRevert ? html`<button class="btn-icon" title="Revert Status"
            @click=${() => this._revertLeadStatus(lead)}>⬅️</button>` : ''}
          ${!isLost ? html`<button class="btn-icon" title="Mark as Lost"
            @click=${() => this._markLeadLost(lead)}>❌</button>` : ''}
          ${isLost ? html`<button class="btn-icon" title="Reopen"
            @click=${() => this._reopenLead(lead)}>🔄</button>` : ''}
          <button class="btn-icon" title="Delete"
            @click=${() => this._deleteLead(lead.index)}>🗑️</button>
        </div>
      </div>`;
  }

  _renderKanban() {
    const cols = DITO_STEPS;
    return html`
      <div class="kanban-board">
        ${cols.map(col => {
          const leads = this.ditoLeads.filter(l => l.status === col);
          const isDraggingOver = this.ditoDragOverCol === col;
          return html`
            <div class="kanban-col col-${col} ${isDraggingOver ? 'drag-over' : ''}"
              @dragover=${(e) => this._onDragOver(e, col)}
              @dragleave=${() => this._onDragLeave()}
              @drop=${(e) => this._onDrop(e, col)}>
              <div class="kanban-col-header">
                <span class="kanban-col-title" style="color:${DITO_STEP_COLORS[col]}">${DITO_STEP_LABELS[col]}</span>
                <span class="kanban-col-count">${leads.length}</span>
              </div>
              <div class="kanban-cards">
                ${leads.map(l => this._renderLeadCard(l))}
                ${leads.length === 0 ? html`<div style="color:var(--text-muted);font-size:0.72rem;text-align:center;padding:12px 0">Empty</div>` : ''}
              </div>
            </div>`;
        })}
      </div>`;
  }

  _renderListView() {
    const filtered = this.ditoFilter === 'all'
      ? this.ditoLeads
      : this.ditoLeads.filter(l => l.status === this.ditoFilter);
    return html`
      <div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm ${this.ditoFilter === 'all' ? 'btn-accent' : ''}"
          @click=${() => { this.ditoFilter = 'all'; }}>All</button>
        ${DITO_STEPS.map(s => html`
          <button class="btn btn-sm ${this.ditoFilter === s ? 'btn-accent' : ''}"
            @click=${() => { this.ditoFilter = s; }}>
            ${DITO_STEP_LABELS[s]}
          </button>`)}
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <table class="list-table">
          <thead>
            <tr>
              <th>Name</th><th>Type</th><th>Location</th><th>Status</th>
              <th>Contact</th><th>Date</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? html`<tr><td colspan="7" class="empty-state">No leads</td></tr>` : ''}
            ${filtered.map(lead => html`
              <tr>
                <td style="font-weight:600">${lead.name}</td>
                <td>${lead.type ? this._sourceBadge(lead.type, {}) : '—'}</td>
                <td>${lead.location ?? '—'}</td>
                <td>${this._ditoStatusBadge(lead.status)}</td>
                <td style="font-size:0.72rem">
                  ${lead.contact ?? '—'}
                </td>
                <td style="color:var(--text-muted)">${timeAgo(lead.dateAdded)}</td>
                <td>
                  <div style="display:flex;gap:3px">
                    <button class="btn-icon" title="Google"
                      @click=${() => window.open(`https://www.google.com/search?q=${encodeURIComponent((lead.name || '') + ' ' + (lead.location || ''))}`, '_blank')}>🔍</button>
                    ${lead.website ? html`<button class="btn-icon" title="Site"
                      @click=${() => window.open(lead.website, '_blank')}>🌐</button>` : ''}
                    <button class="btn-icon" @click=${() => this._deleteLead(lead.index)}>🗑️</button>
                  </div>
                </td>
              </tr>`)}
          </tbody>
        </table>
      </div>`;
  }

  _renderDito() {
    return html`
      ${this._renderDitoStats()}

      <div class="section-header">
        <div class="view-toggle">
          <button class="vt-btn ${this.ditoPipelineView === 'kanban' ? 'active' : ''}"
            @click=${() => { this.ditoPipelineView = 'kanban'; }}>Kanban</button>
          <button class="vt-btn ${this.ditoPipelineView === 'list' ? 'active' : ''}"
            @click=${() => { this.ditoPipelineView = 'list'; }}>List</button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" @click=${() => this._triggerDitoProspecting()}>🔄 Prospect Now</button>
          <button class="btn btn-accent btn-sm"
            @click=${() => { this.ditoModalData = {}; this.ditoModalOpen = true; }}>
            + Add Lead
          </button>
        </div>
      </div>

      ${this.ditoPipelineView === 'kanban' ? this._renderKanban() : this._renderListView()}

      <!-- Demo Sites -->
      <div style="margin-top:24px">
        <div class="section-title" style="margin-bottom:10px">Demo Sites</div>
        ${this.demoSites.length === 0
          ? html`<div class="empty-state">No demo sites found</div>`
          : html`<div class="demos-grid">
              ${this.demoSites.map(d => html`
                <div class="demo-card">
                  <span style="color:var(--text)">${d.name ?? d.slug ?? d.id}</span>
                  <a href="${d.url ?? d.previewUrl ?? '#'}" target="_blank">Preview</a>
                </div>`)}
            </div>`}
      </div>

      <!-- Scan History -->
      ${this._renderScanHistory(this.ditoScanHistory, this.ditoScanLoading, this.ditoScanOpen, 'ditoScanOpen')}

      <!-- Add Lead Modal -->
      ${this.ditoModalOpen ? html`
        <div class="modal-overlay" @click=${(e) => { if (e.target === e.currentTarget) {this.ditoModalOpen = false;} }}>
          <div class="modal-box">
            <h3>Add Lead</h3>
            <form @submit=${(e) => this._addLead(e)}>
              <div class="form-group">
                <label>Business Name *</label>
                <input name="name" required placeholder="Name" .value=${this.ditoModalData.name ?? ''}>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Type</label>
                  <select name="type">
                    <option value="">— Select —</option>
                    <option value="restaurant">Restaurant</option>
                    <option value="auto shop">Auto Shop</option>
                    <option value="salon">Salon</option>
                    <option value="plumber">Plumber</option>
                    <option value="general contractor">General Contractor</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Location</label>
                  <input name="location" placeholder="City, State">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Contact Name</label>
                  <input name="contactName" placeholder="Full name">
                </div>
                <div class="form-group">
                  <label>Phone</label>
                  <input name="phone" type="tel" placeholder="+1 555 000 0000">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Email</label>
                  <input name="email" type="email" placeholder="contact@biz.com">
                </div>
                <div class="form-group">
                  <label>Website</label>
                  <input name="website" type="url" placeholder="https://...">
                </div>
              </div>
              <div class="form-group">
                <label>Notes</label>
                <textarea name="notes" placeholder="Any notes…"></textarea>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn" @click=${() => { this.ditoModalOpen = false; }}>Cancel</button>
                <button type="submit" class="btn btn-accent">Add Lead</button>
              </div>
            </form>
          </div>
        </div>` : ''}
    `;
  }

  // ──────────────────────────────────────────
  // SCAN HISTORY HELPER
  // ──────────────────────────────────────────

  _renderScanHistory(runs, loading, isOpen, toggleProp) {
    return html`
      <div class="card" style="margin-top:24px">
        <div class="scan-history-header" @click=${() => { this[toggleProp] = !this[toggleProp]; }}>
          <span class="section-title" style="font-size:0.8rem">Recent Scan Summaries</span>
          <span style="font-size:0.75rem;color:var(--text-dim)">${isOpen ? '▾' : '▸'} ${runs.length} runs</span>
        </div>
        ${isOpen ? html`
          ${loading ? html`<div class="loading-state">Loading scans…</div>` : ''}
          ${!loading && runs.length === 0 ? html`<div class="empty-state">No scan history found</div>` : ''}
          ${!loading && runs.length > 0 ? html`
            <div class="scan-history-list">
              ${runs.map(run => {
                const ts = run.startedAt ?? run.ts ?? run.timestamp;
                const status = run.status ?? 'unknown';
                const summary = run.summary ?? run.result ?? '';
                const statusColor = status === 'ok' || status === 'success' ? 'var(--green)'
                  : status === 'error' || status === 'failed' ? 'var(--red)' : 'var(--text-dim)';
                return html`
                  <div class="scan-entry">
                    <div class="scan-entry-header">
                      <span style="color:${statusColor};font-weight:600;text-transform:uppercase;font-size:0.68rem">${status}</span>
                      ${run._source ? html`<span style="color:var(--accent);font-size:0.68rem;font-weight:600">${run._source}</span>` : ''}
                      <span style="color:var(--text-muted);font-size:0.7rem">${ts ? new Date(ts).toLocaleString() : '—'}</span>
                      ${run.durationMs ? html`<span style="color:var(--text-muted);font-size:0.68rem">${(run.durationMs / 1000).toFixed(1)}s</span>` : ''}
                    </div>
                    ${summary ? html`<div class="scan-entry-body">${typeof summary === 'string' ? summary : JSON.stringify(summary)}</div>` : ''}
                  </div>`;
              })}
            </div>` : ''}
        ` : ''}
      </div>`;
  }

  // ──────────────────────────────────────────
  // NOLAN TAB
  // ──────────────────────────────────────────

  _renderNolan() {
    const total = this.nolanProjects.length;
    const active = this.nolanProjects.filter(p => ['claimed', 'in-progress'].includes(p.status)).length;
    const completed = this.nolanProjects.filter(p => p.status === 'completed').length;
    const revenue = this.nolanProjects
      .filter(p => p.status === 'completed' && p.fee)
      .reduce((s, p) => s + (p.fee ?? 0), 0);

    return html`
      <!-- Stats -->
      <div class="stat-grid">
        <div class="stat-pill"><span class="sp-val">${total}</span><span class="sp-label">Total</span></div>
        <div class="stat-pill"><span class="sp-val" style="color:var(--accent)">${active}</span><span class="sp-label">Active</span></div>
        <div class="stat-pill"><span class="sp-val" style="color:var(--green)">${completed}</span><span class="sp-label">Completed</span></div>
        <div class="stat-pill"><span class="sp-val" style="color:var(--yellow)">${formatCurrency(revenue)}</span><span class="sp-label">Revenue</span></div>
      </div>

      <!-- Header -->
      <div class="section-header">
        <span class="section-title">Projects</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" @click=${() => this._triggerClawlancerScan()}>🔄 Scan Now</button>
          <button class="btn btn-accent btn-sm"
            @click=${() => { this.nolanModalData = {}; this.nolanModalOpen = true; }}>
            + Add Project
          </button>
        </div>
      </div>

      <!-- Project cards -->
      ${this.nolanProjects.length === 0
        ? html`<div class="empty-state">No projects yet. Run a scan or add one manually.</div>`
        : html`<div class="project-grid">
            ${this.nolanProjects.map(p => this._renderNolanCard(p))}
          </div>`}

      <!-- Scan History -->
      ${this._renderScanHistory(this.nolanScanHistory, this.nolanScanLoading, this.nolanScanOpen, 'nolanScanOpen')}

      <!-- Modal -->
      ${this.nolanModalOpen ? this._renderNolanModal() : ''}
    `;
  }

  _renderNolanCard(project) {
    const sourceColors = { clawtasks: '#a855f7', clawhunt: '#f97316', manual: 'var(--text-dim)' };
    const idx = NOLAN_STEPS.indexOf(project.status);
    const canAdvance = idx >= 0 && idx < NOLAN_STEPS.length - 1;
    const nextLabel = canAdvance ? { identified: 'Claim', claimed: 'Start', 'in-progress': 'Submit', submitted: 'Complete' }[project.status] : null;

    return html`
      <div class="project-card">
        <div class="pc-title">
          ${project.title}
        </div>
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
          ${this._sourceBadge(project.source ?? 'manual', sourceColors)}
          ${this._nolanStatusBadge(project.status)}
        </div>
        ${project.description ? html`<div class="pc-desc">${project.description}</div>` : ''}
        <div class="pc-meta">
          ${project.fee != null ? html`<span style="color:var(--green)">Fee: ${formatCurrency(project.fee)}</span>` : ''}
          ${project.url ? html`<a href="${project.url}" target="_blank" style="color:var(--accent)">🔗 Link</a>` : ''}
          <span>${timeAgo(project.createdAt)}</span>
        </div>
        ${project.notes ? html`<div style="font-size:0.72rem;color:var(--text-muted);font-style:italic;margin-bottom:8px">${project.notes.slice(0, 80)}${project.notes.length > 80 ? '…' : ''}</div>` : ''}
        <div class="pc-actions">
          ${canAdvance ? html`
            <button class="btn btn-sm btn-accent"
              @click=${() => this._advanceNolanStatus(project)}>
              ${nextLabel ?? 'Advance'}
            </button>` : ''}
          <button class="btn btn-sm"
            @click=${() => { this.nolanModalData = { ...project }; this.nolanModalOpen = true; }}>
            Edit
          </button>
          <button class="btn btn-sm btn-danger"
            @click=${() => this._deleteNolanProject(project.id)}>
            Delete
          </button>
        </div>
      </div>`;
  }

  _renderNolanModal() {
    const p = this.nolanModalData ?? {};
    const isEdit = !!p.id;
    return html`
      <div class="modal-overlay" @click=${(e) => { if (e.target === e.currentTarget) {this.nolanModalOpen = false;} }}>
        <div class="modal-box">
          <h3>${isEdit ? 'Edit Project' : 'Add Project'}</h3>
          <form @submit=${(e) => this._saveNolanProject(e)}>
            <div class="form-group">
              <label>Title *</label>
              <input name="title" required placeholder="Project title" .value=${p.title ?? ''}>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Source</label>
                <select name="source">
                  <option value="manual" ?selected=${(p.source ?? 'manual') === 'manual'}>Manual</option>
                  <option value="clawtasks" ?selected=${p.source === 'clawtasks'}>ClawTasks</option>
                  <option value="clawhunt" ?selected=${p.source === 'clawhunt'}>ClawHunt</option>
                </select>
              </div>
              <div class="form-group">
                <label>Status</label>
                <select name="status">
                  ${NOLAN_STEPS.map(s => html`
                    <option value="${s}" ?selected=${p.status === s}>${NOLAN_STEP_LABELS[s]}</option>`)}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea name="description" placeholder="What's the project?">${p.description ?? ''}</textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Fee ($)</label>
                <input name="fee" type="number" step="0.01" placeholder="0.00" .value=${p.fee ?? ''}>
              </div>
              <div class="form-group">
                <label>URL</label>
                <input name="url" type="url" placeholder="https://..." .value=${p.url ?? ''}>
              </div>
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea name="notes" placeholder="Any notes…">${p.notes ?? ''}</textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" @click=${() => { this.nolanModalOpen = false; }}>Cancel</button>
              <button type="submit" class="btn btn-accent">${isEdit ? 'Save' : 'Add Project'}</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  // ──────────────────────────────────────────
  // AECH TAB
  // ──────────────────────────────────────────

  _renderAech() {
    const activeDeals = this.aechDeals.filter(d => !['completed', 'cancelled'].includes(d.status)).length;
    const totalProfit = this._calcRevenue(this.aechDeals);
    const completed = this.aechDeals.filter(d => d.status === 'completed').length;
    const cancelled = this.aechDeals.filter(d => d.status === 'cancelled').length;
    const winRate = (completed + cancelled) > 0 ? Math.round((completed / (completed + cancelled)) * 100) : 0;
    const aechBal = this.aechTreasury?.totalUsd ?? this.aechTreasury?.total ?? null;

    return html`
      <!-- Stats -->
      <div class="stat-grid">
        <div class="stat-pill">
          <span class="sp-val" style="color:var(--accent)">${activeDeals}</span>
          <span class="sp-label">Active</span>
        </div>
        <div class="stat-pill">
          <span class="sp-val" style="color:var(--green)">${formatCurrency(totalProfit)}</span>
          <span class="sp-label">Total Profit</span>
        </div>
        <div class="stat-pill">
          <span class="sp-val" style="color:${winRate >= 70 ? 'var(--green)' : winRate >= 40 ? 'var(--yellow)' : 'var(--red)'}">${winRate}%</span>
          <span class="sp-label">Win Rate</span>
        </div>
        <div class="stat-pill">
          <span class="sp-val" style="color:var(--purple)">${this.treasuryLoading ? '…' : formatCurrency(aechBal)}</span>
          <span class="sp-label">Aech Treasury</span>
        </div>
      </div>

      <!-- Header -->
      <div class="section-header">
        <span class="section-title">Deals</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" @click=${() => this._triggerAechScan()}>🔄 Scan Now</button>
          <button class="btn btn-accent btn-sm"
            @click=${() => { this.aechModalData = {}; this.aechModalOpen = true; }}>
            + Add Deal
          </button>
        </div>
      </div>

      <!-- Deal cards -->
      ${this.aechDeals.length === 0
        ? html`<div class="empty-state">No deals yet. Add one to get started.</div>`
        : html`<div class="deal-grid">
            ${this.aechDeals.map(d => this._renderAechCard(d))}
          </div>`}

      <!-- Scan History -->
      ${this._renderScanHistory(this.aechScanHistory, this.aechScanLoading, this.aechScanOpen, 'aechScanOpen')}

      <!-- Modal -->
      ${this.aechModalOpen ? this._renderAechModal() : ''}
    `;
  }

  _renderAechCard(deal) {
    const assetName = deal.assetName ?? deal.asset ?? 'Untitled Deal';
    const fees = deal.estimatedFees ?? deal.fees ?? 0;
    const spread = ((deal.sellPrice ?? 0) - (deal.buyPrice ?? 0) - fees);
    const spreadClass = spread >= 0 ? 'spread-pos' : 'spread-neg';

    return html`
      <div class="deal-card">
        <div class="dc-title">
          ${assetName}
          ${this._sourceBadge(deal.source, AECH_SOURCE_COLORS)}
          ${this._aechStatusBadge(deal.status)}
        </div>

        <!-- Price table -->
        <table class="price-table">
          <thead>
            <tr>
              <th></th><th>Buy</th><th>Sell</th><th>Fees</th><th>Spread</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="color:var(--text-muted);font-weight:600">Price</td>
              <td>${formatCurrency(deal.buyPrice)}</td>
              <td>${formatCurrency(deal.sellPrice)}</td>
              <td>${formatCurrency(fees)}</td>
              <td class="${spreadClass}">${formatCurrency(spread)}</td>
            </tr>
          </tbody>
        </table>

        <div class="dc-meta">
          ${this._riskBadge(deal.riskLevel)}
          ${this._verdictBadge(deal.art3misVerdict ?? deal.verdict)}
          ${deal.listingUrl ? html`<a href="${deal.listingUrl}" target="_blank">🔗 Listing</a>` : ''}
        </div>

        ${deal.notes ? html`<div style="font-size:0.72rem;color:var(--text-muted);font-style:italic;margin-bottom:8px">${deal.notes.slice(0, 80)}${deal.notes.length > 80 ? '…' : ''}</div>` : ''}

        <div class="dc-actions">
          ${deal.status === 'identified' ? html`
            <button class="btn btn-sm btn-accent" @click=${() => this._approveAechDeal(deal)}>Go ✅</button>
            <button class="btn btn-sm btn-danger" @click=${() => this._cancelAechDeal(deal)}>No-Go ❌</button>
          ` : ''}
          ${deal.status === 'approved' ? html`
            <button class="btn btn-sm btn-accent" @click=${() => this._executeAechDeal(deal)}>Execute</button>
          ` : ''}
          ${deal.status === 'executing' ? html`
            <button class="btn btn-sm" style="border-color:var(--green);color:var(--green)"
              @click=${() => this._completeAechDeal(deal)}>Complete ✓</button>
          ` : ''}
          <button class="btn btn-sm"
            @click=${() => { this.aechModalData = { ...deal }; this.aechModalOpen = true; }}>
            Edit
          </button>
          <button class="btn btn-sm btn-danger"
            @click=${() => this._deleteAechDeal(deal.id)}>
            Delete
          </button>
        </div>
      </div>`;
  }

  _renderAechModal() {
    const d = this.aechModalData ?? {};
    const isEdit = !!d.id;
    const risk = d.riskLevel ?? 1;
    return html`
      <div class="modal-overlay" @click=${(e) => { if (e.target === e.currentTarget) {this.aechModalOpen = false;} }}>
        <div class="modal-box">
          <h3>${isEdit ? 'Edit Deal' : 'Add Deal'}</h3>
          <form @submit=${(e) => this._saveAechDeal(e)}>
            <div class="form-group">
              <label>Asset Name *</label>
              <input name="assetName" required placeholder="e.g. iPhone 15 Pro" .value=${d.assetName ?? d.asset ?? ''}>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Source</label>
                <select name="source">
                  <option value="ebay" ?selected=${d.source === 'ebay'}>eBay</option>
                  <option value="amazon" ?selected=${d.source === 'amazon'}>Amazon</option>
                  <option value="crypto" ?selected=${d.source === 'crypto'}>Crypto</option>
                  <option value="service" ?selected=${d.source === 'service'}>Service</option>
                  <option value="other" ?selected=${!d.source || d.source === 'other'}>Other</option>
                </select>
              </div>
              <div class="form-group">
                <label>Risk Level: <span id="risk-display" class="range-value">${risk}</span></label>
                <input type="range" name="riskLevel" min="1" max="5" step="1" .value=${String(risk)}
                  @input=${(e) => {
                    const disp = this.shadowRoot.querySelector('#risk-display');
                    if (disp) {disp.textContent = e.target.value;}
                  }}>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Buy Price ($)</label>
                <input name="buyPrice" type="number" step="0.01" placeholder="0.00" .value=${d.buyPrice ?? ''}>
              </div>
              <div class="form-group">
                <label>Sell Price ($)</label>
                <input name="sellPrice" type="number" step="0.01" placeholder="0.00" .value=${d.sellPrice ?? ''}>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Est. Fees ($)</label>
                <input name="estimatedFees" type="number" step="0.01" placeholder="0.00" .value=${d.estimatedFees ?? d.fees ?? ''}>
              </div>
              <div class="form-group">
                <label>Listing URL</label>
                <input name="listingUrl" type="url" placeholder="https://..." .value=${d.listingUrl ?? ''}>
              </div>
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea name="notes" placeholder="Notes about this deal…">${d.notes ?? ''}</textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" @click=${() => { this.aechModalOpen = false; }}>Cancel</button>
              <button type="submit" class="btn btn-accent">${isEdit ? 'Save' : 'Add Deal'}</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  // ──────────────────────────────────────────
  // TREASURY TAB
  // ──────────────────────────────────────────

  _chainBadge(chain) {
    const c = (chain ?? '').toLowerCase();
    const color = c === 'base' ? '#2563eb' : (c === 'polygon' || c === 'poly') ? '#a855f7' : '#6366f1';
    return html`<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${chain}</span>`;
  }

  _renderTreasury() {
    if (this.treasuryLoading) {return html`<div class="loading-state">Loading treasury…</div>`;}
    if (this.treasuryError || !this.treasuryData) {return html`<div class="empty-state">Could not load treasury data.</div>`;}

    const td = this.treasuryData;
    const total = td.totalUsd ?? td.total ?? 0;
    const ethPrice = td.ethPrice ?? 0;
    const wallets = td.wallets ?? [];
    const walletEmoji = { aech: '🤖', nolan: '🎯', oasis: '🏦' };

    return html`
      <!-- Portfolio total -->
      <div style="margin-bottom:24px;text-align:center">
        <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Portfolio Total</div>
        <div style="font-size:2.4rem;font-weight:800;color:var(--accent)">${formatCurrency(total)}</div>
        ${ethPrice > 0 ? html`<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">ETH ${formatCurrency(ethPrice)} &middot; ${wallets.length} wallets</div>` : ''}
      </div>

      <!-- Wallet cards -->
      <div class="wallet-grid">
        ${wallets.map(wallet => this._renderWalletCard(wallet, walletEmoji))}
      </div>

      <!-- Tx modal -->
      ${this.txModal ? this._renderTxModal() : ''}
    `;
  }

  _renderWalletCard(wallet, walletEmoji) {
    const name = wallet.name ?? wallet.id ?? 'Unknown';
    const walletId = wallet.id ?? name.toLowerCase();
    const emoji = walletEmoji[name.toLowerCase()] ?? '💼';
    const chains = wallet.chains ?? [];
    const address = wallet.address ?? '';
    const primaryChain = wallet.chainLabel || wallet.chain || '';

    return html`
      <div class="wallet-card">
        <div class="wc-header">
          <div class="wc-name">${emoji} ${name} <span class="badge" style="font-size:0.6rem;margin-left:6px;background:var(--bg-alt);color:var(--text-muted)">${primaryChain.toUpperCase()}</span></div>
          <div class="wc-total">${formatCurrency(wallet.totalUsd ?? wallet.total)}</div>
        </div>

        ${address ? html`
          <div class="wc-addr">
            <a href="${this._addressExplorerLink(address, primaryChain)}" target="_blank" rel="noopener noreferrer"
               style="color:var(--accent);text-decoration:none" title="View on explorer">${truncAddr(address)}</a>
            <button class="btn-icon" title="Copy address" style="font-size:0.75rem"
              @click=${() => copyToClipboard(address, 'Address copied!')}>📋</button>
          </div>` : ''}

        <!-- Chain breakdown -->
        ${chains.length > 0 ? html`
          <div style="margin-top:8px;font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Balances by Chain</div>
        ` : ''}
        ${chains.map(chain => html`
          <div class="chain-row">
            <div>${this._chainBadge(chain.name ?? chain.chain)}</div>
            <div class="cr-balances">
              ${chain.nativeBalance != null
                ? html`<div>${Number(chain.nativeBalance).toFixed(4)} ${chain.nativeSymbol ?? 'ETH'} ≈ ${formatCurrency(chain.nativeUsd)}</div>`
                : ''}
              ${chain.usdcBalance != null && chain.usdcBalance > 0
                ? html`<div class="usdc">${formatCurrency(chain.usdcBalance)} USDC</div>`
                : ''}
            </div>
          </div>`)}

        <!-- View transactions button per chain -->
        ${chains.map(chain => html`
          <div style="margin-top:10px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:0.68rem;color:var(--text-muted)">${chain.name ?? chain.chain} Transactions</span>
              <button class="btn btn-sm" style="font-size:0.65rem"
                @click=${() => this._loadTransactions(walletId, chain.chain ?? (chain.name ?? '').toLowerCase())}>
                View All
              </button>
            </div>
            ${chain.recentTx && chain.recentTx.length > 0
              ? html`
                <table class="tx-mini">
                  <thead><tr><th>Tx</th><th>Dir</th><th>Amount</th><th>When</th></tr></thead>
                  <tbody>
                    ${chain.recentTx.slice(0, 6).map(tx => html`
                      <tr>
                        <td>
                          <a href="${this._explorerLink(tx.hash, chain.chain ?? chain.name)}" target="_blank"
                            style="color:var(--accent)">
                            ${tx.hash ? tx.hash.slice(0, 8) + '…' : '—'}
                          </a>
                        </td>
                        <td class="${tx.direction === 'in' ? 'tx-in' : 'tx-out'}">
                          ${tx.direction === 'in' ? '↓ In' : '↑ Out'}
                        </td>
                        <td>${tx.amountUsd != null ? formatCurrency(tx.amountUsd) : (tx.amount ?? '—')}</td>
                        <td style="color:var(--text-muted)">${timeAgo(tx.timestamp ?? tx.ts)}</td>
                      </tr>`)}
                  </tbody>
                </table>`
              : html`<div style="font-size:0.7rem;color:var(--text-muted);padding:4px 0">No recent transactions</div>`}
          </div>`)}
      </div>`;
  }

  _renderTxModal() {
    const { walletName, chain, transactions } = this.txModal;
    return html`
      <div class="modal-overlay" @click=${(e) => { if (e.target === e.currentTarget) {this.txModal = null;} }}>
        <div class="modal-box" style="max-width:600px">
          <h3>${walletName} — ${chain} Transactions</h3>
          ${this.txLoading
            ? html`<div class="loading-state">Loading…</div>`
            : transactions.length === 0
              ? html`<div class="empty-state">No transactions found</div>`
              : html`
                <table class="list-table" style="font-size:0.75rem">
                  <thead>
                    <tr><th>Tx Hash</th><th>Dir</th><th>Amount</th><th>Chain</th><th>When</th></tr>
                  </thead>
                  <tbody>
                    ${transactions.map(tx => html`
                      <tr>
                        <td>
                          <a href="${this._explorerLink(tx.hash, chain)}" target="_blank">
                            ${tx.hash ? tx.hash.slice(0, 10) + '…' : '—'}
                          </a>
                        </td>
                        <td class="${tx.direction === 'in' ? 'tx-in' : 'tx-out'}">
                          ${tx.direction === 'in' ? '↓ In' : '↑ Out'}
                        </td>
                        <td>${tx.amountUsd != null ? formatCurrency(tx.amountUsd) : (tx.amount ?? '—')}</td>
                        <td>${this._chainBadge(chain)}</td>
                        <td style="color:var(--text-muted)">${timeAgo(tx.timestamp ?? tx.ts)}</td>
                      </tr>`)}
                  </tbody>
                </table>`}
          <div class="modal-actions">
            <button class="btn" @click=${() => { this.txModal = null; }}>Close</button>
          </div>
        </div>
      </div>`;
  }

  // ──────────────────────────────────────────
  // SCAN RUN MODAL
  // ──────────────────────────────────────────

  _renderScanRunModal() {
    const m = this.scanRunModal;
    if (!m) {return '';}
    const elapsed = Math.floor((Date.now() - m.startedAt) / 1000);
    const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;
    const isRunning = m.state === 'running';
    const isDone = m.state === 'done';
    const isError = m.state === 'error';

    // Extract result fields
    const r = m.result ?? {};
    const summary = r.summary ?? r.response ?? '';
    const status = r.status ?? (isDone ? 'ok' : '');
    const durationMs = r.durationMs ?? (isDone ? Date.now() - m.startedAt : null);
    const durationStr = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : '';
    const model = r.model ?? '';
    const usage = r.usage ?? {};
    const sessionId = r.sessionId ?? '';

    return html`
      <div class="modal-overlay" @click=${(e) => { if (e.target === e.currentTarget && !isRunning) {this._closeScanModal();} }}>
        <div class="modal-box scan-run-modal">
          <!-- Header -->
          <div class="srm-header">
            <div>
              <h3 style="margin:0 0 4px">${m.jobLabel}</h3>
              <span class="srm-agent-badge">${m.agentLabel}</span>
            </div>
            ${isRunning
              ? html`<div class="srm-status-badge srm-running">Running</div>`
              : isDone
                ? html`<div class="srm-status-badge srm-done">${status === 'ok' || status === 'success' ? 'Success' : status}</div>`
                : html`<div class="srm-status-badge srm-error">Failed</div>`}
          </div>

          <!-- Running state -->
          ${isRunning ? html`
            <div class="srm-running-body">
              <div class="srm-spinner-row">
                <div class="srm-spinner"></div>
                <span>Agent is working...</span>
              </div>
              <div class="srm-elapsed">
                <span class="srm-elapsed-label">Elapsed</span>
                <span class="srm-elapsed-val">${elapsedStr}</span>
              </div>
              <div class="srm-hint">The agent is executing the ${m.jobLabel.toLowerCase()} process. This typically takes 10-30 seconds.</div>
            </div>` : ''}

          <!-- Done state -->
          ${isDone ? html`
            <div class="srm-result-body">
              <div class="srm-meta-row">
                ${durationStr ? html`<div class="srm-meta-item"><span class="srm-meta-label">Duration</span><span>${durationStr}</span></div>` : ''}
                ${model ? html`<div class="srm-meta-item"><span class="srm-meta-label">Model</span><span>${model}</span></div>` : ''}
                ${usage.total_tokens ? html`<div class="srm-meta-item"><span class="srm-meta-label">Tokens</span><span>${usage.total_tokens.toLocaleString()}</span></div>` : ''}
              </div>
              ${summary ? html`
                <div class="srm-summary-label">Agent Summary</div>
                <div class="srm-summary">${summary}</div>` : html`
                <div class="srm-summary" style="color:var(--text-muted)">No summary returned.</div>`}
              ${sessionId ? html`<div class="srm-session">Session: <code>${sessionId.slice(0, 8)}...</code></div>` : ''}
            </div>` : ''}

          <!-- Error state -->
          ${isError ? html`
            <div class="srm-error-body">
              <div class="srm-error-msg">${m.error}</div>
              <div class="srm-elapsed">
                <span class="srm-elapsed-label">Elapsed</span>
                <span class="srm-elapsed-val">${elapsedStr}</span>
              </div>
            </div>` : ''}

          <!-- Footer -->
          <div class="modal-actions">
            ${isRunning
              ? html`<span style="color:var(--text-muted);font-size:0.75rem">Waiting for agent response...</span>`
              : html`<button class="btn" @click=${() => this._closeScanModal()}>Close</button>`}
          </div>
        </div>
      </div>`;
  }

  // ──────────────────────────────────────────
  // CONFIRM DIALOG
  // ──────────────────────────────────────────

  _renderConfirm() {
    if (!this.confirmDialog) {return '';}
    return html`
      <div class="modal-overlay">
        <div class="confirm-box">
          <p>${this.confirmDialog.message}</p>
          <div class="confirm-actions">
            <button class="btn" @click=${() => this._confirmNo()}>Cancel</button>
            <button class="btn btn-danger" @click=${() => this._confirmYes()}>Confirm</button>
          </div>
        </div>
      </div>`;
  }

  // ──────────────────────────────────────────
  // MAIN RENDER
  // ──────────────────────────────────────────

  render() {
    return html`
      <h2>Business Operations</h2>

      <div class="tabs">
        ${[
          { id: 'overview', label: 'Overview' },
          { id: 'dito', label: 'Dito Pipeline' },
          { id: 'nolan', label: 'Nolan Projects' },
          { id: 'aech', label: 'Aech Deals' },
          { id: 'treasury', label: 'Treasury' },
        ].map(t => html`
          <button class="tab-btn ${this._activeTab === t.id ? 'active' : ''}"
            @click=${() => this._switchTab(t.id)}>
            ${t.label}
          </button>`)}
      </div>

      <div class="tab-content">
        ${this._activeTab === 'overview' ? this._renderOverview() : ''}
        ${this._activeTab === 'dito' ? this._renderDito() : ''}
        ${this._activeTab === 'nolan' ? this._renderNolan() : ''}
        ${this._activeTab === 'aech' ? this._renderAech() : ''}
        ${this._activeTab === 'treasury' ? this._renderTreasury() : ''}
      </div>

      ${this._renderScanRunModal()}
      ${this._renderConfirm()}
    `;
  }
}

customElements.define('page-business', PageBusiness);
