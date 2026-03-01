/**
 * OASIS Dashboard v3 - Treasury Routes
 * Wraps both the legacy single-chain endpoint and the v2 multi-chain service.
 */

import { Router } from "express";
import { getPortfolioSummary, getWalletBalances, getTransactionHistory, clearCache } from "../services/treasury-service.js";

const router = Router();

// --- Legacy single-chain treasury data (v1 compat) ---
// These inline helpers mirror server.js v1 logic so the legacy /api/treasury route
// continues to work without touching the v2 treasury-service.

const CHAINS = {
  base: {
    rpc: "https://mainnet.base.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    blockscout: "https://base.blockscout.com/api/v2",
    explorer: "https://basescan.org",
    label: "BASE",
  },
  eth: {
    rpc: "https://eth.llamarpc.com",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    blockscout: "https://eth.blockscout.com/api/v2",
    explorer: "https://etherscan.io",
    label: "ETH",
  },
  polygon: {
    rpc: "https://polygon-bor-rpc.publicnode.com",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    blockscout: "https://polygon.blockscout.com/api/v2",
    explorer: "https://polygonscan.com",
    label: "POLY",
  },
};

const WALLETS = {
  aech: { address: "0xd337fe9Df3fdFaf053786874074D8D9960993867", name: "Aech", emoji: "\u26a1", chain: "base" },
  nolan: { address: "0x2E566F6BA5f1fA38Aed50f2d1ea4E39F0689a6e4", name: "Nolan", emoji: "\ud83c\udf96\ufe0f", chain: "base" },
  oasis: { address: "0xA261717D3A85851dA902949e6fC7E9DAE484a968", name: "OASIS", emoji: "\ud83c\udff0", chain: "eth" },
};

const legacyCache = {
  treasury: { data: null, ts: 0, ttl: 60_000 },
  ethPrice: { data: null, ts: 0, ttl: 120_000 },
  txHistory: new Map(),
};
const TX_CACHE_TTL = 300_000;

const FETCH_TIMEOUT_MS = 8_000;

async function getEthPrice() {
  if (legacyCache.ethPrice.data && Date.now() - legacyCache.ethPrice.ts < legacyCache.ethPrice.ttl) {
    return legacyCache.ethPrice.data;
  }
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = await res.json();
    legacyCache.ethPrice.data = data.ethereum.usd;
    legacyCache.ethPrice.ts = Date.now();
    return legacyCache.ethPrice.data;
  } catch {
    return legacyCache.ethPrice.data || 0;
  }
}

async function getEthBalance(address, chain = "base") {
  const rpc = CHAINS[chain]?.rpc || CHAINS.base.rpc;
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [address, "latest"], id: 1 }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json();
  return parseInt(data.result, 16) / 1e18;
}

async function getUsdcBalance(address, chain = "base") {
  const chainCfg = CHAINS[chain] || CHAINS.base;
  const selector = "0x70a08231";
  const paddedAddr = address.toLowerCase().replace("0x", "").padStart(64, "0");
  const res = await fetch(chainCfg.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: chainCfg.usdc, data: selector + paddedAddr }, "latest"],
      id: 1,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json();
  return parseInt(data.result, 16) / 1e6;
}

async function getLegacyTreasuryData() {
  if (legacyCache.treasury.data && Date.now() - legacyCache.treasury.ts < legacyCache.treasury.ttl) {
    return legacyCache.treasury.data;
  }
  const ethPrice = await getEthPrice();
  const chainIds = Object.keys(CHAINS);
  const results = {};

  for (const [id, wallet] of Object.entries(WALLETS)) {
    const chainBalances = {};
    await Promise.all(
      chainIds.map(async (chainId) => {
        const [ethBal, usdcBal] = await Promise.all([
          getEthBalance(wallet.address, chainId).catch(() => 0),
          getUsdcBalance(wallet.address, chainId).catch(() => 0),
        ]);
        chainBalances[chainId] = {
          chain: chainId,
          label: CHAINS[chainId].label,
          eth: parseFloat(ethBal.toFixed(6)),
          usdc: parseFloat(usdcBal.toFixed(2)),
          ethUsd: parseFloat((ethBal * ethPrice).toFixed(2)),
          totalUsd: parseFloat((ethBal * ethPrice + usdcBal).toFixed(2)),
        };
      })
    );

    const primary = chainBalances[wallet.chain] || Object.values(chainBalances)[0];
    const totalUsd = Object.values(chainBalances).reduce((s, c) => s + c.totalUsd, 0);
    results[id] = {
      ...wallet,
      chainLabel: CHAINS[wallet.chain]?.label || wallet.chain.toUpperCase(),
      eth: primary.eth,
      usdc: primary.usdc,
      ethUsd: primary.ethUsd,
      totalUsd: parseFloat(totalUsd.toFixed(2)),
      chains: chainBalances,
    };
  }

  const data = {
    wallets: results,
    ethPrice: parseFloat(ethPrice.toFixed(2)),
    totalUsd: parseFloat(Object.values(results).reduce((s, w) => s + w.totalUsd, 0).toFixed(2)),
  };
  legacyCache.treasury.data = data;
  legacyCache.treasury.ts = Date.now();
  return data;
}

async function getLegacyTransactions(address, chain = "base") {
  const cacheKey = `${address.toLowerCase()}:${chain}`;
  const cached = legacyCache.txHistory.get(cacheKey);
  if (cached && Date.now() - cached.ts < TX_CACHE_TTL) {return cached.data;}

  const key = address.toLowerCase();
  const blockscoutApi = CHAINS[chain]?.blockscout || CHAINS.base.blockscout;
  const explorer = CHAINS[chain]?.explorer || CHAINS.base.explorer;

  const [txRes, tokenRes] = await Promise.all([
    fetch(`${blockscoutApi}/addresses/${address}/transactions`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    fetch(`${blockscoutApi}/addresses/${address}/token-transfers`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
  ]);
  const [txData, tokenData] = await Promise.all([txRes.json(), tokenRes.json()]);

  const normal = (txData.items || []).map((tx) => {
    const from = tx.from?.hash || "";
    const to = tx.to?.hash || "";
    return {
      hash: tx.hash,
      from,
      to,
      value: parseFloat((parseInt(tx.value || "0") / 1e18).toFixed(8)),
      symbol: "ETH",
      timestamp: new Date(tx.timestamp).getTime(),
      direction: from.toLowerCase() === key ? "out" : "in",
      explorer,
    };
  });

  const tokens = (tokenData.items || []).map((tx) => {
    const total = tx.total || {};
    const decimals = parseInt(total.decimals || tx.token?.decimals || "18");
    const from = tx.from?.hash || "";
    const to = tx.to?.hash || "";
    return {
      hash: tx.transaction_hash || tx.hash || "",
      from,
      to,
      value: parseFloat((parseInt(total.value || "0") / Math.pow(10, decimals)).toFixed(8)),
      symbol: tx.token?.symbol || "TOKEN",
      timestamp: new Date(tx.timestamp).getTime(),
      direction: from.toLowerCase() === key ? "out" : "in",
      explorer,
    };
  });

  const merged = [...normal, ...tokens].toSorted((a, b) => b.timestamp - a.timestamp).slice(0, 30);
  legacyCache.txHistory.set(cacheKey, { data: merged, ts: Date.now() });
  return merged;
}

// Evict stale tx cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of legacyCache.txHistory) {
    if (now - val.ts > TX_CACHE_TTL * 2) {legacyCache.txHistory.delete(key);}
  }
}, 600_000);

// GET /summary — portfolio summary (combines legacy + v2 data)
router.get("/summary", async (_req, res) => {
  try {
    const [legacyData, v2Data] = await Promise.allSettled([
      getLegacyTreasuryData(),
      getPortfolioSummary(),
    ]);

    const legacy = legacyData.status === "fulfilled" ? legacyData.value : null;
    const v2 = v2Data.status === "fulfilled" ? v2Data.value : null;

    const wallets = [];
    if (legacy?.wallets) {
      for (const [id, w] of Object.entries(legacy.wallets)) {
        wallets.push({
          id,
          name: w.name,
          address: w.address,
          chain: w.chain,
          totalUsd: w.totalUsd,
        });
      }
    }

    res.json({
      totalUsd: v2?.totalUsd ?? legacy?.totalUsd ?? 0,
      ethPrice: legacy?.ethPrice ?? 0,
      walletCount: wallets.length,
      wallets,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / — legacy single-chain treasury
router.get("/", async (_req, res) => {
  try {
    const data = await getLegacyTreasuryData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v2 — multi-chain portfolio via TreasuryService
router.get("/v2", async (_req, res) => {
  try {
    const data = await getPortfolioSummary();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /wallet/:name — single wallet
router.get("/wallet/:name", async (req, res) => {
  try {
    const data = await getWalletBalances(req.params.name);
    res.json(data);
  } catch (err) {
    res.status(err.message.includes("Unknown wallet") ? 404 : 500).json({ error: err.message });
  }
});

// GET /transactions/:wallet/:chain — tx history
router.get("/transactions/:wallet/:chain", async (req, res) => {
  try {
    const { wallet, chain } = req.params;
    const txs = await getTransactionHistory(wallet, chain, parseInt(req.query.limit) || 50);
    res.json({ transactions: txs });
  } catch (err) {
    res.status(err.message.includes("Unknown") ? 404 : 500).json({ error: err.message });
  }
});

// GET /:address/transactions — legacy per-address tx history (used by v1 UI)
router.get("/:address/transactions", async (req, res) => {
  try {
    const chain = req.query.chain || "base";
    const multi = req.query.multi === "1";
    if (multi) {
      const allChains = Object.keys(CHAINS);
      const results = await Promise.all(
        allChains.map((c) =>
          getLegacyTransactions(req.params.address, c)
            .then((txs) => txs.map((tx) => ({ ...tx, chainId: c, chainLabel: CHAINS[c].label })))
            .catch(() => [])
        )
      );
      const merged = results.flat().toSorted((a, b) => b.timestamp - a.timestamp).slice(0, 30);
      return res.json({ transactions: merged });
    }
    const txs = await getLegacyTransactions(req.params.address, chain);
    res.json({ transactions: txs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /cache/clear — clear treasury cache
router.post("/cache/clear", (_req, res) => {
  try {
    clearCache();
    legacyCache.treasury.data = null;
    legacyCache.treasury.ts = 0;
    legacyCache.ethPrice.data = null;
    legacyCache.ethPrice.ts = 0;
    legacyCache.txHistory.clear();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
