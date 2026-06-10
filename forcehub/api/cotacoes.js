// api/cotacoes.js — Cotações ao vivo (delay ~15min) de ações da B3, via brapi.
//   GET /api/cotacoes?tickers=PETR4,VALE3,ITUB4
//
// Usado pela Carteira para marcar a mercado as recomendações e posições abertas.
// Cache por ticker no Upstash (10 min, compartilhado): a fonte (brapi PRO) tem
// delay ~15 min, então uma cadência de 10 min mantém o dado fresco sem
// desperdiçar cota. Requisições em lote (vários tickers por chamada no PRO).
import { getRedis } from "./_redis";

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const TTL_S = 600;             // frescor (10 min — fonte tem delay ~15 min)
const KEEP_S = 60 * 60 * 6;    // mantém no Redis p/ fallback se a brapi cair
const MAX_TICKERS = 40;
const CHUNK = 10;              // plano PRO: vários ativos por requisição

const sanitize = (t) => String(t).toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 12);
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v))) ? null : +Number(v).toFixed(2);

// Busca um lote de tickers numa única requisição (PRO) e indexa por símbolo.
async function fetchQuotes(tickers) {
  const url = `https://brapi.dev/api/quote/${tickers.map(encodeURIComponent).join(",")}?token=${BRAPI_TOKEN}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("brapi " + r.status);
  const j = await r.json();
  const out = {};
  for (const q of (j && Array.isArray(j.results) ? j.results : [])) {
    if (!q || q.regularMarketPrice == null) continue;
    out[sanitize(q.symbol)] = {
      price: num(q.regularMarketPrice),
      change: num(q.regularMarketChange),
      changePct: num(q.regularMarketChangePercent),
      time: q.regularMarketTime ? (Date.parse(q.regularMarketTime) || Date.now()) : Date.now(),
    };
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const redis = getRedis();
  const tickers = [...new Set(String(req.query.tickers || "").split(",").map(sanitize).filter(Boolean))].slice(0, MAX_TICKERS);
  if (!tickers.length) return res.status(200).json({ ok: true, quotes: {} });
  if (!BRAPI_TOKEN) return res.status(200).json({ ok: false, error: "BRAPI_TOKEN ausente", quotes: {} });

  const quotes = {};
  const missing = [];
  if (redis) {
    await Promise.all(tickers.map(async (t) => {
      try { const c = await redis.get("forcehub:cot:" + t); if (c && c._cachedAt && (Date.now() - c._cachedAt) < TTL_S * 1000) { quotes[t] = c; return; } } catch (_) {}
      missing.push(t);
    }));
  } else {
    missing.push(...tickers);
  }

  // Lotes (PRO permite vários tickers por requisição) + fallback individual.
  const chunks = [];
  for (let i = 0; i < missing.length; i += CHUNK) chunks.push(missing.slice(i, i + CHUNK));
  await Promise.allSettled(chunks.map(async (chunk) => {
    let got = {};
    try { got = await fetchQuotes(chunk); } catch (_) {}
    await Promise.allSettled(chunk.map(async (t) => {
      const q = got[t];
      if (q) {
        q._cachedAt = Date.now();
        quotes[t] = q;
        if (redis) { try { await redis.set("forcehub:cot:" + t, q, { ex: KEEP_S }); } catch (_) {} }
      } else if (redis) {
        // fallback: último valor conhecido (marcado como defasado)
        try { const c = await redis.get("forcehub:cot:" + t); if (c) quotes[t] = { ...c, stale: true }; } catch (_) {}
      }
    }));
  }));

  // Não vaza o carimbo interno de cache.
  for (const t of Object.keys(quotes)) { if (quotes[t]) delete quotes[t]._cachedAt; }
  return res.status(200).json({ ok: true, quotes, generatedAt: Date.now() });
}
