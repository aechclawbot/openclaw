/**
 * OASIS Dashboard 2.0 - Multi-Chain Treasury Service
 * Aggregates wallet balances across Base, Ethereum, and Polygon
 */

// Using native fetch (Node.js 18+)

// Chain configurations
const CHAINS = {
  base: {
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    explorerApi: 'https://base.blockscout.com/api',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    chainId: 8453,
  },
  ethereum: {
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    explorerApi: 'https://api.etherscan.io/api',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    chainId: 1,
  },
  polygon: {
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    explorerApi: 'https://api.polygonscan.com/api',
    nativeCurrency: { symbol: 'MATIC', decimals: 18 },
    chainId: 137,
  },
};

// Wallet addresses (keep in sync with server.js WALLETS)
const WALLETS = {
  aech: '0xd337fe9Df3fdFaf053786874074D8D9960993867',
  nolan: '0x2E566F6BA5f1fA38Aed50f2d1ea4E39F0689a6e4',
  oasis: '0xA261717D3A85851dA902949e6fC7E9DAE484a968',
};

// Cache for prices and balances (60s TTL)
const cache = {
  prices: { data: null, timestamp: 0 },
  balances: new Map(),
};

const CACHE_TTL = 60000; // 60 seconds

/**
 * Fetch ETH/MATIC price from CoinGecko
 */
async function fetchPrices() {
  const now = Date.now();
  if (cache.prices.data && now - cache.prices.timestamp < CACHE_TTL) {
    return cache.prices.data;
  }

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,matic-network,usd-coin,dai&vs_currencies=usd'
    );
    const data = await response.json();

    const prices = {
      ETH: data.ethereum?.usd || 0,
      MATIC: data['matic-network']?.usd || 0,
      USDC: data['usd-coin']?.usd || 1,
      DAI: data.dai?.usd || 1,
    };

    cache.prices = { data: prices, timestamp: now };
    return prices;
  } catch (error) {
    console.error('Failed to fetch prices:', error);
    return cache.prices.data || { ETH: 3500, MATIC: 1, USDC: 1, DAI: 1 };
  }
}

/**
 * Fetch native balance (ETH/MATIC) via RPC
 */
async function fetchNativeBalance(chain, address) {
  try {
    const response = await fetch(chain.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
    });

    const data = await response.json();
    if (data.result) {
      const balance = BigInt(data.result);
      return Number(balance) / Math.pow(10, chain.nativeCurrency.decimals);
    }
  } catch (error) {
    console.error(`Failed to fetch native balance for ${chain.name}:`, error);
  }

  return 0;
}

/**
 * Fetch token balances from block explorer
 */
async function fetchTokenBalances(chainKey, address) {
  const chain = CHAINS[chainKey];
  const apiKey = process.env[`${chainKey.toUpperCase()}_API_KEY`] || '';

  // For Blockscout (Base), use different endpoint
  if (chainKey === 'base') {
    try {
      const url = `${chain.explorerApi}?module=account&action=tokenlist&address=${address}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === '1' && Array.isArray(data.result)) {
        return data.result.map((token) => ({
          symbol: token.symbol,
          name: token.name,
          balance: Number(token.balance) / Math.pow(10, Number(token.decimals)),
          contract: token.contractAddress,
          decimals: Number(token.decimals),
        }));
      }
    } catch (error) {
      console.error(`Failed to fetch tokens for ${chain.name}:`, error);
    }
  } else {
    // Etherscan/Polygonscan
    try {
      const url = `${chain.explorerApi}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === '1' && Array.isArray(data.result)) {
        // Group by token contract
        const tokenMap = new Map();
        for (const tx of data.result) {
          if (!tokenMap.has(tx.contractAddress)) {
            tokenMap.set(tx.contractAddress, {
              symbol: tx.tokenSymbol,
              name: tx.tokenName,
              contract: tx.contractAddress,
              decimals: Number(tx.tokenDecimal),
            });
          }
        }

        // Fetch balance for each token (simplified, would need multicall in production)
        return Array.from(tokenMap.values()).map((token) => ({
          ...token,
          balance: 0, // Would need actual balance fetch
        }));
      }
    } catch (error) {
      console.error(`Failed to fetch tokens for ${chain.name}:`, error);
    }
  }

  return [];
}

/**
 * Get all balances for a single wallet across all chains
 */
export async function getWalletBalances(walletName) {
  const address = WALLETS[walletName];
  if (!address) {
    throw new Error(`Unknown wallet: ${walletName}`);
  }

  const cacheKey = `${walletName}-${address}`;
  const cached = cache.balances.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const prices = await fetchPrices();
  const chains = {};

  // Fetch balances from all chains in parallel
  await Promise.all(
    Object.entries(CHAINS).map(async ([chainKey, chain]) => {
      const nativeBalance = await fetchNativeBalance(chain, address);
      const tokens = await fetchTokenBalances(chainKey, address);

      const nativeSymbol = chain.nativeCurrency.symbol;
      const nativeUsdValue = nativeBalance * (prices[nativeSymbol] || 0);

      chains[chainKey] = {
        name: chain.name,
        native: {
          symbol: nativeSymbol,
          balance: nativeBalance,
          usdValue: nativeUsdValue,
        },
        tokens: tokens.map((token) => ({
          ...token,
          usdValue: token.balance * (prices[token.symbol] || 0),
        })),
        totalUsd:
          nativeUsdValue +
          tokens.reduce((sum, t) => sum + t.balance * (prices[t.symbol] || 0), 0),
      };
    })
  );

  const totalUsd = Object.values(chains).reduce((sum, chain) => sum + chain.totalUsd, 0);

  const result = {
    wallet: walletName,
    address,
    chains,
    totalUsd,
    timestamp: new Date().toISOString(),
  };

  cache.balances.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

/**
 * Get aggregated portfolio across all wallets and chains
 */
export async function getPortfolioSummary() {
  const prices = await fetchPrices();
  const wallets = {};

  // Fetch all wallets in parallel
  await Promise.all(
    Object.keys(WALLETS).map(async (walletName) => {
      wallets[walletName] = await getWalletBalances(walletName);
    })
  );

  const totalPortfolioUsd = Object.values(wallets).reduce(
    (sum, wallet) => sum + wallet.totalUsd,
    0
  );

  // Aggregate by chain
  const chainTotals = {};
  for (const wallet of Object.values(wallets)) {
    for (const [chainKey, chainData] of Object.entries(wallet.chains)) {
      if (!chainTotals[chainKey]) {
        chainTotals[chainKey] = { ...chainData, totalUsd: 0 };
      }
      chainTotals[chainKey].totalUsd += chainData.totalUsd;
    }
  }

  return {
    totalPortfolioUsd,
    prices,
    wallets,
    chains: chainTotals,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get transaction history for a wallet on a specific chain
 */
export async function getTransactionHistory(walletName, chainKey, limit = 50) {
  const address = WALLETS[walletName];
  if (!address) {
    throw new Error(`Unknown wallet: ${walletName}`);
  }

  const chain = CHAINS[chainKey];
  if (!chain) {
    throw new Error(`Unknown chain: ${chainKey}`);
  }

  const apiKey = process.env[`${chainKey.toUpperCase()}_API_KEY`] || '';

  try {
    const url =
      chainKey === 'base'
        ? `${chain.explorerApi}?module=account&action=txlist&address=${address}&sort=desc`
        : `${chain.explorerApi}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === '1' && Array.isArray(data.result)) {
      const prices = await fetchPrices();
      const nativePrice = prices[chain.nativeCurrency.symbol] || 0;

      return data.result.slice(0, limit).map((tx) => ({
        hash: tx.hash,
        timestamp: parseInt(tx.timeStamp) * 1000,
        from: tx.from,
        to: tx.to,
        value: Number(tx.value) / Math.pow(10, chain.nativeCurrency.decimals),
        token: chain.nativeCurrency.symbol,
        usdValue:
          (Number(tx.value) / Math.pow(10, chain.nativeCurrency.decimals)) * nativePrice,
        direction: tx.from.toLowerCase() === address.toLowerCase() ? 'out' : 'in',
        status: tx.isError === '0' ? 'success' : 'failed',
      }));
    }
  } catch (error) {
    console.error(`Failed to fetch transactions for ${chainKey}:`, error);
  }

  return [];
}

/**
 * Clear cache (for testing/debugging)
 */
export function clearCache() {
  cache.prices = { data: null, timestamp: 0 };
  cache.balances.clear();
}
