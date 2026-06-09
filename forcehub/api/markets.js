// api/markets.js — Agregador de cotações internacionais (server-side, com cache).
//   GET /api/markets           -> usa cache (TTL curto, compartilhado)
//   GET /api/markets?refresh=1 -> força nova busca
//
// Fontes (cascata, tudo grátis): Yahoo Finance (índices/futuros/moedas/
// commodities) + CoinGecko (cripto). Cache no Upstash (~45s) para um único
// conjunto de chamadas externas atender todos os usuários (evita rate-limit).
//
// A resposta é tolerante a falha parcial: cada ativo é buscado isoladamente, e
// um ativo que falhe simplesmente não aparece (não derruba o painel).
import { getRedis } from "./_redis";

const KEY = "forcehub:markets";
const TTL_S = 45;            // frescor do cache (segundos)
const STALE_KEEP_S = 60 * 10; // mantém no Redis por 10min p/ fallback se a fonte cair

// Grupos de ativos: [símbolo Yahoo, rótulo].
const GROUPS = {
  indices: [
    ["^BVSP", "Ibovespa"], ["^GSPC", "S&P 500"], ["^IXIC", "Nasdaq"], ["^DJI", "Dow Jones"],
    ["^GDAXI", "DAX"], ["^FTSE", "FTSE 100"], ["^STOXX50E", "Euro Stoxx 50"], ["^N225", "Nikkei 225"],
  ],
  futuros: [
    ["ES=F", "S&P 500 Fut"], ["NQ=F", "Nasdaq Fut"], ["YM=F", "Dow Fut"], ["GC=F", "Ouro Fut"],
  ],
  moedas: [
    ["DX-Y.NYB", "DXY"], ["BRL=X", "USD/BRL"], ["EURUSD=X", "EUR/USD"], ["GBPUSD=X", "GBP/USD"], ["USDJPY=X", "USD/JPY"],
  ],
  commodities: [
    ["CL=F", "WTI"], ["BZ=F", "Brent"], ["GC=F", "Ouro"], ["SI=F", "Prata"], ["NG=F", "Gás Natural"],
  ],
};
// Cripto via CoinGecko: [id CoinGecko, rótulo].
const CRYPTO = [["bitcoin", "BTC"], ["ethereum", "ETH"], ["solana", "SOL"], ["binancecoin", "BNB"]];

// ─── Yahoo Finance (endpoint v8 chart — sem chave) ───────────────────────────
async function fetchYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (FORCEHUB)", "accept": "application/json" } });
  if (!r.ok) throw new Error("yahoo " + r.status);
  const j = await r.json();
  const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!m || m.regularMarketPrice == null) throw new Error("sem dados");
  const price = m.regularMarketPrice;
  const prev = m.chartPreviousClose != null ? m.chartPreviousClose : (m.previousClose != null ? m.previousClose : price);
  return {
    price,
    change: +(price - prev).toFixed(4),
    changePct: prev ? +(((price / prev) - 1) * 100).toFixed(2) : 0,
    time: m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now(),
  };
}

async function fetchGroup(list) {
  const rows = await Promise.allSettled(list.map(async ([symbol, label]) => ({ symbol, label, ...(await fetchYahoo(symbol)) })));
  return rows.filter(r => r.status === "fulfilled").map(r => r.value);
}

// ─── CoinGecko (cripto — sem chave) ──────────────────────────────────────────
async function fetchCrypto() {
  const ids = CRYPTO.map(c => c[0]).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("coingecko " + r.status);
  const j = await r.json();
  return CRYPTO.map(([id, label]) => {
    const d = j[id] || {};
    return d.usd != null ? { symbol: id, label, price: d.usd, change: null, changePct: d.usd_24h_change != null ? +d.usd_24h_change.toFixed(2) : null, time: Date.now() } : null;
  }).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const redis = getRedis();
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";

  try {
    if (!refresh && redis) {
      const c = await redis.get(KEY);
      if (c && c.generatedAt && (Date.now() - c.generatedAt) < TTL_S * 1000) {
        return res.status(200).json({ ok: true, cached: true, ...c });
      }
    }

    const groups = {};
    const entries = await Promise.allSettled(Object.entries(GROUPS).map(async ([g, list]) => [g, await fetchGroup(list)]));
    for (const e of entries) if (e.status === "fulfilled") groups[e.value[0]] = e.value[1];
    try { groups.cripto = await fetchCrypto(); } catch (_) { groups.cripto = []; }

    const total = Object.values(groups).reduce((s, arr) => s + arr.length, 0);
    if (!total) throw new Error("Nenhuma cotação disponível agora.");

    const payload = { generatedAt: Date.now(), groups };
    if (redis) { try { await redis.set(KEY, payload, { ex: STALE_KEEP_S }); } catch (_) {} }
    return res.status(200).json({ ok: true, cached: false, ...payload });
  } catch (e) {
    if (redis) {
      try { const c = await redis.get(KEY); if (c) return res.status(200).json({ ok: true, cached: true, stale: true, ...c }); } catch (_) {}
    }
    return res.status(200).json({ ok: false, error: e.message, groups: {} });
  }
}
