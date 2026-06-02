// api/market-data.js — Cotações ao vivo via Brapi (sem banco de dados)
// Retorna o histórico diário (OHLC) de WIN, WDO e IBOV para o Panorama.
// Formato: { ok, data: { WIN: [{date, open, high, low, close, volume}], WDO, IBOV } }

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";

const ASSETS = [
  { key: "WIN",  ticker: "WINM26" },
  { key: "WDO",  ticker: "WDOM26" },
  { key: "IBOV", ticker: "^BVSP" },
];

function rangeForDays(days) {
  if (days <= 5) return "5d";
  if (days <= 21) return "1mo";
  return "3mo";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (!BRAPI_TOKEN) {
    return res.status(503).json({ ok: false, error: "BRAPI_TOKEN não configurado." });
  }

  const numDays = Math.min(Math.max(parseInt(req.query.days) || 5, 1), 30);
  const range = rangeForDays(numDays);
  const data = { WIN: [], WDO: [], IBOV: [] };
  const errors = [];

  await Promise.all(ASSETS.map(async (asset) => {
    try {
      const ticker = encodeURIComponent(asset.ticker);
      const url = `https://brapi.dev/api/quote/${ticker}?range=${range}&interval=1d&token=${BRAPI_TOKEN}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      const q = json?.results?.[0];
      if (!q) throw new Error("Sem dados");

      const hist = Array.isArray(q.historicalDataPrice) ? q.historicalDataPrice : [];
      let series = hist
        .filter(h => h && h.date)
        .map(h => ({
          date: new Date(h.date * 1000).toISOString().split("T")[0],
          open: h.open ?? null,
          high: h.high ?? null,
          low: h.low ?? null,
          close: h.close ?? null,
          volume: h.volume ?? null,
        }));

      // Fallback: sem histórico, usa a cotação atual como único ponto.
      if (!series.length && q.regularMarketPrice != null) {
        series = [{
          date: new Date().toISOString().split("T")[0],
          open: q.regularMarketOpen ?? null,
          high: q.regularMarketDayHigh ?? null,
          low: q.regularMarketDayLow ?? null,
          close: q.regularMarketPrice ?? null,
          volume: q.regularMarketVolume ?? null,
        }];
      }

      data[asset.key] = series.slice(-numDays);
    } catch (e) {
      errors.push({ ticker: asset.key, error: e.message });
    }
  }));

  return res.status(200).json({ ok: true, data, errors });
}
