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
import { FUT, getJson, pickFront, findBarsArray, toISODate } from "./_market-data";

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const KEY = "forcehub:markets";
const TTL_S = 45;            // frescor do cache (segundos)
const STALE_KEEP_S = 60 * 10; // mantém no Redis por 10min p/ fallback se a fonte cair

// Futuros agrícolas da B3 (brapi, token PRO) — cotados em R$, atualização EOD
// (fecham 1x/dia). asset = raiz B3: CCM=milho, ICF=café arábica, BGI=boi gordo,
// SOJ=soja. Cache próprio (30min) pois o dado só muda no fechamento; assim o
// Panorama (45s) não bate na brapi a cada ciclo.
const AGRO = [["CCM", "Milho"], ["ICF", "Café"], ["BGI", "Boi Gordo"], ["SOJ", "Soja"]];
const AGRO_KEY = "forcehub:markets:agro";
const AGRO_FRESH_S = 30 * 60;
const AGRO_KEEP_S = 60 * 60 * 24; // mantém 24h p/ fallback offline

// DI de 1 dia (futuro de juros da B3, asset raiz "DI1"). Amostra 3 pontos da
// curva — curto/médio/longo — para o direcional de juros; o "preço" aqui é a
// TAXA (% a.a.). Mesmo cache EOD dos agrícolas.
const DI_KEY = "forcehub:markets:di";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

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
    ["CL=F", "WTI"], ["BZ=F", "Brent"], ["TIO=F", "Minério 62%"], ["GC=F", "Ouro"], ["SI=F", "Prata"], ["NG=F", "Gás Natural"],
  ],
};
// Cripto via CoinGecko: [id CoinGecko, rótulo].
const CRYPTO = [["bitcoin", "BTC"], ["ethereum", "ETH"], ["solana", "SOL"], ["binancecoin", "BNB"]];

// Reduz uma série a no máx. `n` pontos uniformemente espaçados (p/ sparkline).
function downsample(arr, n) {
  const clean = (arr || []).filter(v => v != null && !Number.isNaN(v));
  if (clean.length <= n) return clean.map(v => +v.toFixed(4));
  const step = clean.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(+clean[Math.floor(i * step)].toFixed(4));
  return out;
}

// ─── Yahoo Finance (endpoint v8 chart — sem chave) ───────────────────────────
async function yahooChart(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (FORCEHUB)", "accept": "application/json" } });
  if (!r.ok) throw new Error("yahoo " + r.status);
  const j = await r.json();
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("sem result");
  const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
  return { meta: result.meta || null, closes: (q && q.close) || [] };
}

async function fetchYahoo(symbol) {
  // 1) Intradiário (5 min). Funciona para a maioria dos ativos líquidos.
  let meta = null, spark = [];
  try { const d = await yahooChart(symbol, "5m", "1d"); meta = d.meta; spark = downsample(d.closes, 32); } catch (_) {}
  // 2) Fallback diário p/ contratos finos (ex.: minério): sem preço ou sem série.
  if (!meta || meta.regularMarketPrice == null || spark.length < 2) {
    try {
      const d2 = await yahooChart(symbol, "1d", "1mo");
      if (!meta || meta.regularMarketPrice == null) meta = d2.meta;
      if (spark.length < 2) spark = downsample(d2.closes, 32);
    } catch (_) {}
  }
  if (!meta || meta.regularMarketPrice == null) throw new Error("sem dados");
  const price = meta.regularMarketPrice;
  // previousClose (fechamento da sessão anterior) é o correto p/ a variação do dia,
  // inclusive quando a série usada é a diária (chartPreviousClose seria o início da janela).
  const prev = meta.previousClose != null ? meta.previousClose : (meta.chartPreviousClose != null ? meta.chartPreviousClose : price);
  return {
    price,
    change: +(price - prev).toFixed(4),
    changePct: prev ? +(((price / prev) - 1) * 100).toFixed(2) : 0,
    time: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
    spark,
  };
}

async function fetchGroup(list) {
  const rows = await Promise.allSettled(list.map(async ([symbol, label]) => ({ symbol, label, ...(await fetchYahoo(symbol)) })));
  return rows.filter(r => r.status === "fulfilled").map(r => r.value);
}

// ─── CoinGecko (cripto — sem chave) ──────────────────────────────────────────
async function fetchCrypto() {
  const ids = CRYPTO.map(c => c[0]).join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&sparkline=true&price_change_percentage=24h`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("coingecko " + r.status);
  const arr = await r.json();
  if (!Array.isArray(arr)) throw new Error("coingecko formato");
  const byId = {};
  for (const c of arr) byId[c.id] = c;
  return CRYPTO.map(([id, label]) => {
    const d = byId[id];
    if (!d || d.current_price == null) return null;
    const sp = d.sparkline_in_7d && Array.isArray(d.sparkline_in_7d.price) ? d.sparkline_in_7d.price : [];
    return { symbol: id, label, price: d.current_price, change: null, changePct: d.price_change_percentage_24h != null ? +d.price_change_percentage_24h.toFixed(2) : null, time: Date.now(), spark: downsample(sp, 32) };
  }).filter(Boolean);
}

// ─── Brapi: futuros agrícolas da B3 (EOD, em R$) ─────────────────────────────
// Reusa o fluxo term-structure -> historical do contrato vigente (mesmo do
// WIN/WDO). Só precisamos da série de fechamentos: preço, variação vs. pregão
// anterior e sparkline. Não exige máx/mín (EOD agrícola às vezes só traz o
// ajuste), então mapeia close ?? settlement sem descartar barras.
const numOr = (v) => (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v);

async function fetchAgroAsset(asset, label) {
  const tok = `&token=${BRAPI_TOKEN}`;
  const ts = await getJson(`${FUT}/term-structure?asset=${asset}${tok}`);
  const contracts = Array.isArray(ts && ts.contracts) ? ts.contracts : [];
  const todayBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const front = pickFront(contracts, todayBRT);
  if (!front) throw new Error(`agro ${asset} sem contrato vigente`);
  const raw = findBarsArray(await getJson(`${FUT}/historical?symbol=${encodeURIComponent(front.symbol)}${tok}`)) || [];
  const series = raw
    .map(b => ({ date: toISODate(b.date), close: numOr(b.close) ?? numOr(b.settlement) }))
    .filter(b => b.date && b.close != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!series.length) throw new Error(`agro ${front.symbol} sem série`);
  const closes = series.map(b => b.close);
  const price = closes[closes.length - 1];
  const prev = closes.length >= 2 ? closes[closes.length - 2] : price;
  return {
    symbol: asset, label, contract: front.symbol,
    price: +price.toFixed(2),
    change: +(price - prev).toFixed(2),
    changePct: prev ? +(((price / prev) - 1) * 100).toFixed(2) : 0,
    time: Date.parse(series[series.length - 1].date + "T18:00:00-03:00") || Date.now(),
    spark: downsample(closes, 32),
  };
}

async function fetchAgro(redis) {
  if (!BRAPI_TOKEN) return []; // sem token PRO não há futuros — some do painel
  if (redis) {
    try { const c = await redis.get(AGRO_KEY); if (c && c.at && (Date.now() - c.at) < AGRO_FRESH_S * 1000) return c.items || []; } catch (_) {}
  }
  const rows = await Promise.allSettled(AGRO.map(([a, l]) => fetchAgroAsset(a, l)));
  const items = rows.filter(r => r.status === "fulfilled").map(r => r.value);
  if (items.length) {
    if (redis) { try { await redis.set(AGRO_KEY, { items, at: Date.now() }, { ex: AGRO_KEEP_S }); } catch (_) {} }
    return items;
  }
  // Nada agora: devolve o último bom (stale) antes de desistir.
  if (redis) { try { const c = await redis.get(AGRO_KEY); if (c && c.items) return c.items; } catch (_) {} }
  return [];
}

// ─── Brapi: curva de juros DI de 1 dia (B3, EOD, taxa % a.a.) ─────────────────
function diLabel(exp) {
  const p = String(exp || "").split("-");
  if (p.length < 2) return "DI";
  return "DI " + (MESES[(parseInt(p[1], 10) || 1) - 1] || "") + "/" + p[0].slice(2);
}
// Amostra a curva: vencimento mais próximo (curto) + os mais perto de +1 e +2
// anos (médio/longo). Deduplica caso a curva seja curta.
function pickDICurve(contracts, todayBRT) {
  const up = (contracts || [])
    .filter(c => c && c.symbol && c.expirationDate && c.expirationDate >= todayBRT)
    .sort((a, b) => a.expirationDate.localeCompare(b.expirationDate));
  if (!up.length) return [];
  const base = Date.parse(todayBRT + "T00:00:00Z");
  const closest = (days) => {
    const target = base + days * 86400000;
    let best = up[0], bd = Infinity;
    for (const c of up) { const d = Math.abs(Date.parse(c.expirationDate + "T00:00:00Z") - target); if (d < bd) { bd = d; best = c; } }
    return best;
  };
  const seen = new Set(), out = [];
  for (const c of [up[0], closest(365), closest(730)]) { if (c && !seen.has(c.symbol)) { seen.add(c.symbol); out.push(c); } }
  return out;
}

async function fetchDIContract(c) {
  const tok = `&token=${BRAPI_TOKEN}`;
  const raw = findBarsArray(await getJson(`${FUT}/historical?symbol=${encodeURIComponent(c.symbol)}${tok}`)) || [];
  const series = raw
    .map(b => ({ date: toISODate(b.date), rate: numOr(b.close) ?? numOr(b.settlement) }))
    .filter(b => b.date && b.rate != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!series.length) throw new Error(`DI ${c.symbol} sem série`);
  const rates = series.map(b => b.rate);
  const price = rates[rates.length - 1];
  const prev = rates.length >= 2 ? rates[rates.length - 2] : price;
  return {
    symbol: c.symbol, label: diLabel(c.expirationDate),
    price: +price.toFixed(3),
    change: +(price - prev).toFixed(3),
    changePct: prev ? +(((price / prev) - 1) * 100).toFixed(2) : 0,
    time: Date.parse(series[series.length - 1].date + "T18:00:00-03:00") || Date.now(),
    spark: downsample(rates, 32),
  };
}

async function fetchDI(redis) {
  if (!BRAPI_TOKEN) return [];
  if (redis) {
    try { const c = await redis.get(DI_KEY); if (c && c.at && (Date.now() - c.at) < AGRO_FRESH_S * 1000) return c.items || []; } catch (_) {}
  }
  try {
    const tok = `&token=${BRAPI_TOKEN}`;
    const ts = await getJson(`${FUT}/term-structure?asset=DI1${tok}`);
    const contracts = Array.isArray(ts && ts.contracts) ? ts.contracts : [];
    const todayBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const rows = await Promise.allSettled(pickDICurve(contracts, todayBRT).map(fetchDIContract));
    const items = rows.filter(r => r.status === "fulfilled").map(r => r.value);
    if (items.length) {
      if (redis) { try { await redis.set(DI_KEY, { items, at: Date.now() }, { ex: AGRO_KEEP_S }); } catch (_) {} }
      return items;
    }
  } catch (_) {}
  if (redis) { try { const c = await redis.get(DI_KEY); if (c && c.items) return c.items; } catch (_) {} }
  return [];
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
    // Agrícolas (B3) entram na coluna "Futuros" — são contratos futuros também.
    try { const agro = await fetchAgro(redis); if (agro.length) groups.futuros = [...(groups.futuros || []), ...agro]; } catch (_) {}
    // Curva de juros DI de 1 dia — painel próprio (taxa % a.a.).
    try { groups.juros = await fetchDI(redis); } catch (_) { groups.juros = []; }

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
