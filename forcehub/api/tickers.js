// api/tickers.js — Busca de ativos da B3 (autocomplete da Carteira), via brapi.
//   GET /api/tickers?q=PETR -> { ok, results: [{ ticker, nome, preco }] }
//
// Fonte: /api/quote/list da brapi (lista oficial de ações/FIIs/BDRs/ETFs).
// Garante que recomendações usem só tickers existentes. Cache por termo (6h):
// a lista de ativos listados muda raramente.
import { getRedis } from "./_redis";

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const TTL_S = 60 * 60 * 6;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = String(req.query.q || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  if (q.length < 2) return res.status(200).json({ ok: true, results: [] });
  if (!BRAPI_TOKEN) return res.status(200).json({ ok: false, error: "BRAPI_TOKEN ausente", results: [] });

  const redis = getRedis();
  const key = "forcehub:tickers:" + q;
  if (redis) {
    try { const c = await redis.get(key); if (c) return res.status(200).json({ ok: true, cached: true, results: c }); } catch (_) {}
  }

  try {
    const r = await fetch(`https://brapi.dev/api/quote/list?search=${encodeURIComponent(q)}&limit=12&token=${BRAPI_TOKEN}`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("brapi " + r.status);
    const j = await r.json();
    const results = (j && Array.isArray(j.stocks) ? j.stocks : [])
      .map(s => ({
        ticker: String(s.stock || "").toUpperCase(),
        nome: String(s.name || ""),
        preco: s.close != null && !Number.isNaN(Number(s.close)) ? +Number(s.close).toFixed(2) : null,
      }))
      .filter(s => s.ticker)
      .slice(0, 12);
    if (redis) { try { await redis.set(key, results, { ex: TTL_S }); } catch (_) {} }
    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message, results: [] });
  }
}
