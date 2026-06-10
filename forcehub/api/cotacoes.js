// api/cotacoes.js — Cotações ao vivo (delay ~15min) de ações da B3, via brapi.
//   GET /api/cotacoes?tickers=PETR4,VALE3,ITUB4
//
// Usado pela Carteira para marcar a mercado as recomendações e posições abertas.
// Toda a lógica (lotes do plano PRO, cache de 10 min por ticker, fallback ao
// último valor conhecido) vive em api/_brapi.js, compartilhada com o detector
// de gatilho (api/_gatilho.js). Inclui máx/mín do dia (dayHigh/dayLow).
import { getRedis } from "./_redis";
import { getQuotes, sanitizeTicker } from "./_brapi";

const MAX_TICKERS = 40;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const tickers = [...new Set(String(req.query.tickers || "").split(",").map(sanitizeTicker).filter(Boolean))].slice(0, MAX_TICKERS);
  if (!tickers.length) return res.status(200).json({ ok: true, quotes: {} });
  if (!process.env.BRAPI_TOKEN) return res.status(200).json({ ok: false, error: "BRAPI_TOKEN ausente", quotes: {} });

  const quotes = await getQuotes(tickers, getRedis());
  for (const t of Object.keys(quotes)) { if (quotes[t]) delete quotes[t]._cachedAt; }
  return res.status(200).json({ ok: true, quotes, generatedAt: Date.now() });
}
