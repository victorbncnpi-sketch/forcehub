// api/fetch-market.js — Vercel Serverless Function
// Busca WIN, WDO, IBOV na Brapi e salva no KV
// Chamada pela cron todo dia útil às 19h

import { kv } from "@vercel/kv";

// Token da Brapi via variável de ambiente (não versionar segredos no código).
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";

const ASSETS = [
  { key: "WIN",  ticker: "WINM26" },
  { key: "WDO",  ticker: "WDOM26" },
  { key: "IBOV", ticker: "%5EBVSP" },
];

// Detecta dia útil (seg-sex, não feriado simples)
function isDiaUtil() {
  const d = new Date().getDay();
  return d >= 1 && d <= 5;
}

export default async function handler(req, res) {
  // Aceita GET (cron) ou POST manual
  // Proteção básica com secret
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!BRAPI_TOKEN) {
    return res.status(503).json({ error: "BRAPI_TOKEN não configurado nas variáveis de ambiente." });
  }

  if (!isDiaUtil()) {
    return res.status(200).json({ message: "Fim de semana — sem pregão" });
  }

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const results = {};
  const errors = [];

  for (const asset of ASSETS) {
    try {
      const url = `https://brapi.dev/api/quote/${asset.ticker}?range=1d&interval=1d&token=${BRAPI_TOKEN}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const q = data?.results?.[0];
      if (!q) throw new Error("Sem dados");

      const entry = {
        date:   today,
        ticker: asset.key,
        open:   q.regularMarketOpen,
        high:   q.regularMarketDayHigh,
        low:    q.regularMarketDayLow,
        close:  q.regularMarketPrice,
        volume: q.regularMarketVolume,
        savedAt: new Date().toISOString(),
      };

      // Salva entrada do dia
      await kv.hset(`market:${today}`, { [asset.key]: JSON.stringify(entry) });

      // Salva histórico (lista dos últimos 60 dias)
      const histKey = `history:${asset.key}`;
      const hist = (await kv.lrange(histKey, 0, 59)) || [];
      // Evita duplicatas do mesmo dia
      if (!hist.some(h => JSON.parse(h).date === today)) {
        await kv.lpush(histKey, JSON.stringify(entry));
        await kv.ltrim(histKey, 0, 59); // mantém só 60 entradas
      }

      results[asset.key] = entry;
    } catch (e) {
      errors.push({ ticker: asset.key, error: e.message });
    }
  }

  return res.status(200).json({
    date: today,
    saved: Object.keys(results),
    results,
    errors,
  });
}
