// api/market-data.js — Cotações para o Panorama
//
// WIN e WDO são FUTUROS (API v2 de futuros). No "sandbox" (sem token) a Brapi
// libera WIN e WDO, MAS só aceita o CÓDIGO DO ATIVO literal ("WIN"/"WDO") — não
// o contrato (ex.: WINM26). Por isso chamamos /historical?symbol=WIN sem token.
// IBOV (^BVSP) é índice à vista: /api/quote com o token (Free funciona).
// Dados de futuros são EOD (após ~19h BRT); 'date' vem em Unix(segundos).

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const FUT = "https://brapi.dev/api/v2/futures";

const num = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));

function toISODate(d) {
  if (d == null) return null;
  if (typeof d === "number") return new Date(d * 1000).toISOString().split("T")[0];
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (!isNaN(n)) return new Date(n * 1000).toISOString().split("T")[0];
  return null;
}

// Procura recursivamente o primeiro array de barras OHLC, seja qual for o nome
// do campo na resposta (robusto a variações de formato da API).
function findBarsArray(obj, depth = 0) {
  if (obj == null || depth > 5) return null;
  if (Array.isArray(obj)) {
    const first = obj.find(x => x && typeof x === "object");
    if (first && ("date" in first || "close" in first || "settlement" in first || "high" in first || "low" in first)) {
      return obj;
    }
    for (const it of obj) { const f = findBarsArray(it, depth + 1); if (f) return f; }
    return null;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) { const f = findBarsArray(obj[k], depth + 1); if (f) return f; }
  }
  return null;
}

function mapBars(bars) {
  return (bars || [])
    .map(b => ({
      date: toISODate(b.date),
      open: num(b.open),
      high: num(b.high),
      low: num(b.low),
      close: num(b.close) ?? num(b.settlement),
      volume: num(b.volume) ?? num(b.financialVolume),
    }))
    .filter(b => b.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// WIN/WDO: sandbox (sem token), usando o CÓDIGO DO ATIVO (não o contrato).
async function fetchFuture(asset, numDays) {
  const url = `${FUT}/historical?symbol=${asset}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`historical ${asset} HTTP ${r.status}`);
  const json = await r.json();
  const bars = findBarsArray(json);
  if (!bars || !bars.length) {
    throw new Error(`sem barras para ${asset} (keys: ${Object.keys(json || {}).join(",") || "?"})`);
  }
  return mapBars(bars).slice(-numDays);
}

// IBOV: índice à vista via /api/quote (precisa do token; Free funciona).
async function fetchIbov(numDays) {
  if (!BRAPI_TOKEN) throw new Error("BRAPI_TOKEN ausente para IBOV");
  const range = numDays <= 5 ? "5d" : numDays <= 21 ? "1mo" : "3mo";
  const url = `https://brapi.dev/api/quote/%5EBVSP?range=${range}&interval=1d&token=${BRAPI_TOKEN}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`quote IBOV HTTP ${r.status}`);
  const q = (await r.json())?.results?.[0];
  if (!q) throw new Error("Sem dados de IBOV");
  let series = mapBars(findBarsArray(q.historicalDataPrice) || []);
  if (!series.length && q.regularMarketPrice != null) {
    series = [{
      date: new Date().toISOString().split("T")[0],
      open: num(q.regularMarketOpen), high: num(q.regularMarketDayHigh),
      low: num(q.regularMarketDayLow), close: num(q.regularMarketPrice),
      volume: num(q.regularMarketVolume),
    }];
  }
  return series.slice(-numDays);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const numDays = Math.min(Math.max(parseInt(req.query.days) || 5, 1), 30);
  const data = { WIN: [], WDO: [], IBOV: [] };
  const errors = [];

  const tasks = [
    ["WIN", () => fetchFuture("WIN", numDays)],
    ["WDO", () => fetchFuture("WDO", numDays)],
    ["IBOV", () => fetchIbov(numDays)],
  ];

  await Promise.all(tasks.map(async ([key, fn]) => {
    try { data[key] = await fn(); }
    catch (e) { errors.push({ ticker: key, error: e.message }); }
  }));

  return res.status(200).json({ ok: true, data, errors });
}
