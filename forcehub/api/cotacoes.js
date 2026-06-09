// api/cotacoes.js — Cotações ao vivo (delay ~15min) de ações da B3, via brapi.
//   GET /api/cotacoes?tickers=PETR4,VALE3,ITUB4
//
// Usado pela Carteira para marcar a mercado as recomendações e posições abertas.
// Cache por ticker no Upstash (~60s, compartilhado) para um único conjunto de
// chamadas atender todos os usuários e poupar a cota da brapi.
import { getRedis } from "./_redis";

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const TTL_S = 60;              // frescor (segundos)
const KEEP_S = 60 * 30;        // mantém no Redis p/ fallback se a brapi cair
const MAX_TICKERS = 40;

const sanitize = (t) => String(t).toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 12);
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v))) ? null : +Number(v).toFixed(2);

async function fetchQuote(ticker) {
  const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?token=${BRAPI_TOKEN}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("brapi " + r.status);
  const j = await r.json();
  const q = j && Array.isArray(j.results) ? j.results[0] : null;
  if (!q || q.regularMarketPrice == null) throw new Error("sem dados");
  return {
    price: num(q.regularMarketPrice),
    change: num(q.regularMarketChange),
    changePct: num(q.regularMarketChangePercent),
    time: q.regularMarketTime ? (Date.parse(q.regularMarketTime) || Date.now()) : Date.now(),
  };
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

  await Promise.allSettled(missing.map(async (t) => {
    try {
      const q = await fetchQuote(t);
      q._cachedAt = Date.now();
      quotes[t] = q;
      if (redis) { try { await redis.set("forcehub:cot:" + t, q, { ex: KEEP_S }); } catch (_) {} }
    } catch (_) {
      // fallback: último valor conhecido (marcado como defasado)
      if (redis) { try { const c = await redis.get("forcehub:cot:" + t); if (c) quotes[t] = { ...c, stale: true }; } catch (__) {} }
    }
  }));

  // Não vaza o carimbo interno de cache.
  for (const t of Object.keys(quotes)) { if (quotes[t]) delete quotes[t]._cachedAt; }
  return res.status(200).json({ ok: true, quotes, generatedAt: Date.now() });
}
