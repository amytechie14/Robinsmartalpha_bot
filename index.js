require('dotenv').config();
const TelegramBotLib = require('node-telegram-bot-api');
const TelegramBot = TelegramBotLib.default || TelegramBotLib;
const axios = require('axios');

// ---------- Setup ----------

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN. Set it in your .env file or hosting environment variables.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const NETWORK = 'robinhood'; // GeckoTerminal's network id for Robinhood Chain (chain ID 4663)
const GT_BASE = 'https://api.geckoterminal.com/api/v2';
const BLOCKSCOUT_BASE = 'https://robinhoodchain.blockscout.com/api/v2';

const gt = axios.create({ baseURL: GT_BASE, timeout: 15000 });
const blockscout = axios.create({ baseURL: BLOCKSCOUT_BASE, timeout: 15000 });

// Never let one bad request crash the whole bot.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err?.message || err);
});
bot.on('polling_error', (err) => {
  console.error('Polling error:', err?.message || err);
});

// ---------- Helpers ----------

function isAddress(str) {
  return /^0x[a-fA-F0-9]{40}$/.test(str || '');
}

function fmtUsd(n) {
  if (n === null || n === undefined || isNaN(n)) return 'DATA UNAVAILABLE';
  const num = Number(n);
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000) return sign + '$' + (abs / 1_000).toFixed(1) + 'K';
  return sign + '$' + abs.toFixed(abs < 1 ? 6 : 2);
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return 'DATA UNAVAILABLE';
  const num = Number(n);
  return (num >= 0 ? '+' : '') + num.toFixed(2) + '%';
}

function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return 'DATA UNAVAILABLE';
  return Number(n).toLocaleString('en-US');
}

// Same liquidity bands described in the RHO ALPHA spec (section 9) — a label
// on real, fetched liquidity, never an invented score.
function liquidityHealth(usd) {
  if (usd === null || usd === undefined || isNaN(usd)) return 'Unknown';
  if (usd < 10000) return 'Dangerous (very thin)';
  if (usd < 30000) return 'Weak';
  if (usd < 75000) return 'Moderate';
  if (usd < 150000) return 'Healthy';
  return 'Very healthy';
}

async function safeSend(chatId, text) {
  try {
    await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
  } catch (err) {
    console.error('Send message failed:', err?.message || err);
  }
}

// ---------- Data fetchers (real data only — never invented) ----------

async function fetchTokenData(address) {
  const result = { error: null };
  try {
    const res = await gt.get(`/networks/${NETWORK}/tokens/${address}`);
    const attrs = (res.data && res.data.data && res.data.data.attributes) || {};
    result.name = attrs.name || null;
    result.symbol = attrs.symbol || null;
    result.priceUsd = attrs.price_usd != null ? Number(attrs.price_usd) : null;
    result.fdvUsd = attrs.fdv_usd != null ? Number(attrs.fdv_usd) : null;
    result.marketCapUsd = attrs.market_cap_usd != null ? Number(attrs.market_cap_usd) : null;
    result.liquidityUsd = attrs.total_reserve_in_usd != null ? Number(attrs.total_reserve_in_usd) : null;
    result.volume24h = attrs.volume_usd && attrs.volume_usd.h24 != null ? Number(attrs.volume_usd.h24) : null;
    result.priceChange24h =
      attrs.price_change_percentage && attrs.price_change_percentage.h24 != null
        ? Number(attrs.price_change_percentage.h24)
        : null;
  } catch (err) {
    result.error = err.response && err.response.status === 404 ? 'NOT_FOUND' : 'FETCH_ERROR';
  }
  return result;
}

async function fetchContractData(address) {
  const result = { verified: null, holders: null, error: null };
  try {
    const res = await blockscout.get(`/tokens/${address}`);
    const d = res.data || {};
    result.holders = d.holders != null ? d.holders : null;
    result.tokenType = d.type || null;
  } catch (err) {
    result.error = 'TOKEN_LOOKUP_FAILED';
  }
  try {
    const res2 = await blockscout.get(`/smart-contracts/${address}`);
    result.verified = !!res2.data;
  } catch (err) {
    // Blockscout returns 404 for unverified/non-contract addresses — that's
    // information, not a crash.
    result.verified = false;
  }
  return result;
}

async function fetchPoolsList(endpoint) {
  const res = await gt.get(endpoint);
  return (res.data && res.data.data) || [];
}

// ---------- Commands ----------

bot.onText(/^\/start\b/, (msg) => {
  safeSend(
    msg.chat.id,
    " Welcome to RobinsmartAlpha\n\n" +
      "I look up live, real on-chain data for tokens on Robinhood Chain (chain ID 4663) — price, liquidity, volume, and basic contract info — sourced from GeckoTerminal and Blockscout.\n\n" +
      "Commands:\n" +
      "/analyze <token address> — full data for one token\n" +
      "/trending — top trending pools right now\n" +
      "/new — newest pools\n" +
      "/help — show this again\n\n" +
      "⚠️ This bot reports current market data only. It does not predict prices, detect whales or insiders, or guarantee profit. Always do your own research."
  );
});

bot.onText(/^\/help\b/, (msg) => {
  safeSend(
    msg.chat.id,
    "Commands:\n" +
      "/analyze <address> — price, liquidity, volume, contract status\n" +
      "/trending — trending pools on Robinhood Chain\n" +
      "/new — newest pools on Robinhood Chain\n\n" +
      "Example:\n/analyze 0x1234567890abcdef1234567890abcdef12345678"
  );
});

bot.onText(/^\/analyze(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const address = (match[1] || '').trim();

  if (!isAddress(address)) {
    return safeSend(
      chatId,
      "Please send a valid token contract address, e.g.\n/analyze 0x1234567890abcdef1234567890abcdef12345678"
    );
  }

  await safeSend(chatId, '🔎 Looking that up…');

  const [tokenData, contractData] = await Promise.all([
    fetchTokenData(address),
    fetchContractData(address),
  ]);

  if (tokenData.error === 'NOT_FOUND') {
    return safeSend(
      chatId,
      "No trading pools found for this address on Robinhood Chain via GeckoTerminal. " +
        "It may be too new to be indexed yet, have no liquidity, or not be a token contract at all.\n\n" +
        `Check it directly: https://robinhoodchain.blockscout.com/address/${address}`
    );
  }
  if (tokenData.error === 'FETCH_ERROR') {
    return safeSend(chatId, 'DATA UNAVAILABLE — GeckoTerminal did not respond. Please try again in a moment.');
  }

  const lines = [];
  lines.push(`📊 ${tokenData.name || 'Unknown token'} ${tokenData.symbol ? '(' + tokenData.symbol + ')' : ''}`.trim());
  lines.push(address);
  lines.push('');
  lines.push(`💰 Price: ${fmtUsd(tokenData.priceUsd)}`);
  lines.push(`📈 24h change: ${fmtPct(tokenData.priceChange24h)}`);
  lines.push(`💎 Market cap: ${fmtUsd(tokenData.marketCapUsd)}`);
  lines.push(`📊 FDV: ${fmtUsd(tokenData.fdvUsd)}`);
  lines.push(`💧 Liquidity: ${fmtUsd(tokenData.liquidityUsd)} — ${liquidityHealth(tokenData.liquidityUsd)}`);
  lines.push(`📉 24h volume: ${fmtUsd(tokenData.volume24h)}`);
  lines.push('');
  lines.push(
    `🔐 Contract verified: ${contractData.verified === null ? 'DATA UNAVAILABLE' : contractData.verified ? 'YES' : 'NOT VERIFIED'}`
  );
  lines.push(`👥 Holders: ${fmtNum(contractData.holders)}`);
  lines.push('');
  lines.push(`🔗 Explorer: https://robinhoodchain.blockscout.com/token/${address}`);
  lines.push('');
  lines.push('This is live market data, not a prediction. It does not guarantee profit or safety — always verify independently.');

  safeSend(chatId, lines.join('\n'));
});

async function sendPoolsList(chatId, endpoint, title) {
  await safeSend(chatId, `🔎 Fetching ${title.toLowerCase()}…`);
  try {
    const pools = await fetchPoolsList(endpoint);
    if (!pools.length) {
      return safeSend(chatId, 'No pools returned right now. Please try again shortly.');
    }
    const top = pools.slice(0, 8);
    const lines = [`🔥 ${title} (Robinhood Chain)`, ''];
    top.forEach((p, i) => {
      const a = p.attributes || {};
      const name = a.name || 'Unknown pair';
      const price = a.base_token_price_usd != null ? fmtUsd(Number(a.base_token_price_usd)) : 'DATA UNAVAILABLE';
      const liq = a.reserve_in_usd != null ? fmtUsd(Number(a.reserve_in_usd)) : 'DATA UNAVAILABLE';
      const vol = a.volume_usd && a.volume_usd.h24 != null ? fmtUsd(Number(a.volume_usd.h24)) : 'DATA UNAVAILABLE';
      const chg =
        a.price_change_percentage && a.price_change_percentage.h24 != null
          ? fmtPct(Number(a.price_change_percentage.h24))
          : 'DATA UNAVAILABLE';
      lines.push(`${i + 1}. ${name}`);
      lines.push(`   Price: ${price} | 24h: ${chg}`);
      lines.push(`   Liquidity: ${liq} | Vol 24h: ${vol}`);
      lines.push('');
    });
    safeSend(chatId, lines.join('\n'));
  } catch (err) {
    safeSend(chatId, 'DATA UNAVAILABLE — could not reach GeckoTerminal right now. Please try again shortly.');
  }
}

bot.onText(/^\/trending\b/, (msg) => {
  sendPoolsList(msg.chat.id, `/networks/${NETWORK}/trending_pools`, 'Trending Pools');
});

bot.onText(/^\/new\b/, (msg) => {
  sendPoolsList(msg.chat.id, `/networks/${NETWORK}/new_pools`, 'Newest Pools');
});

console.log('RobinsmartAlpha bot is running (polling mode)...');
