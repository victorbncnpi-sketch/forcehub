// api/_brapi.js — Acesso compartilhado à brapi (cotações e barras diárias),
// com cache no Upstash. Prefixo "_": não vira rota na Vercel.
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const CHUNK = 10;            // plano PRO: vários ativos por requisição
const QUOTE_FRESH_S = 600;   // frescor da cotação (10 min; fonte tem delay ~15 min)
const QUOTE_KEEP_S = 60 * 60 * 6;
const BARS_FRESH_S = 3600;   // barras diárias mudam 1x/dia
const BARS_KEEP_S = 60 * 60 * 12;

export const sanitizeTicker = (t) => String(t).toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 12);
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v))) ? null : +Number(v).toFixed(2);

async function fetchQuoteChunk(tickers) {
  const url = `https://brapi.dev/api/quote/${tickers.map(encodeURIComponent).join(",")}?token=${BRAPI_TOKEN}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("brapi " + r.status);
  const j = await r.json();
  const out = {};
  for (const q of (j && Array.isArray(j.results) ? j.results : [])) {
    if (!q || q.regularMarketPrice == null) continue;
    out[sanitizeTicker(q.symbol)] = {
      price: num(q.regularMarketPrice),
      change: num(q.regularMarketChange),
      changePct: num(q.regularMarketChangePercent),
      dayHigh: num(q.regularMarketDayHigh),
      dayLow: num(q.regularMarketDayLow),
      time: q.regularMarketTime ? (Date.parse(q.regularMarketTime) || Date.now()) : Date.now(),
    };
  }
  return out;
}

// Cotações em lote com cache por ticker. Marca { stale: true } quando devolve
// o último valor conhecido (fonte indisponível no momento).
export async function getQuotes(tickers, redis) {
  const list = [...new Set(tickers.map(sanitizeTicker).filter(Boolean))];
  const quotes = {};
  const missing = [];
  if (redis) {
    await Promise.all(list.map(async (t) => {
      try {
        const c = await redis.get("forcehub:cot:" + t);
        if (c && c._cachedAt && (Date.now() - c._cachedAt) < QUOTE_FRESH_S * 1000) { quotes[t] = c; return; }
      } catch (_) {}
      missing.push(t);
    }));
  } else missing.push(...list);

  const chunks = [];
  for (let i = 0; i < missing.length; i += CHUNK) chunks.push(missing.slice(i, i + CHUNK));
  await Promise.allSettled(chunks.map(async (chunk) => {
    let got = {};
    try { got = await fetchQuoteChunk(chunk); } catch (_) {}
    await Promise.allSettled(chunk.map(async (t) => {
      const q = got[t];
      if (q) {
        q._cachedAt = Date.now();
        quotes[t] = q;
        if (redis) { try { await redis.set("forcehub:cot:" + t, q, { ex: QUOTE_KEEP_S }); } catch (_) {} }
      } else if (redis) {
        try { const c = await redis.get("forcehub:cot:" + t); if (c) quotes[t] = { ...c, stale: true }; } catch (_) {}
      }
    }));
  }));
  return quotes;
}

// Barras diárias (último mês) de um ticker: [{ date: "YYYY-MM-DD" (BRT), high, low }].
export async function getDailyBars(ticker, redis) {
  const t = sanitizeTicker(ticker);
  const key = "forcehub:gat:hist:" + t;
  if (redis) {
    try { const c = await redis.get(key); if (c && c._cachedAt && (Date.now() - c._cachedAt) < BARS_FRESH_S * 1000) return c.bars || []; } catch (_) {}
  }
  try {
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(t)}?range=1mo&interval=1d&token=${BRAPI_TOKEN}`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("brapi " + r.status);
    const j = await r.json();
    const hist = j && j.results && j.results[0] && j.results[0].historicalDataPrice;
    const bars = (Array.isArray(hist) ? hist : [])
      .map(b => ({
        date: b.date ? new Date(b.date * 1000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : null,
        high: num(b.high), low: num(b.low),
      }))
      .filter(b => b.date && b.high != null && b.low != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (redis) { try { await redis.set(key, { bars, _cachedAt: Date.now() }, { ex: BARS_KEEP_S }); } catch (_) {} }
    return bars;
  } catch (e) {
    if (redis) { try { const c = await redis.get(key); if (c) return c.bars || []; } catch (_) {} }
    return [];
  }
}
