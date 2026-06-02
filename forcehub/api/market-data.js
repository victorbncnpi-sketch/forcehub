// api/market-data.js — Cotações para o Panorama
//
// WIN e WDO são FUTUROS: usam a API v2 de futuros da Brapi. No "sandbox"
// (sem token) WIN e WDO são liberados — então NÃO enviamos token nessas
// chamadas (o plano Free retorna 403 para futuros, mas o sandbox libera).
// Fluxo: term-structure (contrato mais próximo) -> historical (série diária).
//
// IBOV (^BVSP) é índice à vista: usa /api/quote com o token (Free funciona).
// Dados de futuros são EOD (fim do dia, após ~19h BRT); 'date' vem em Unix(s).

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

// Localiza o array de barras na resposta, tolerando variações de formato.
function extractBars(json) {
  let arr = [json?.historicalData, json?.historicalDataPrice, json?.data, json?.history]
    .find(a => Array.isArray(a) && a.length);
  if (!arr && Array.isArray(json)) arr = json;
  if (!arr && Array.isArray(json?.results) && json.results[0]) {
    arr = json.results[0].historicalData || json.results[0].historicalDataPrice || json.results[0].history;
  }
  return Array.isArray(arr) ? arr : [];
}

function mapBars(bars) {
  return bars
    .map(b => ({
      date: toISODate(b.date),
      open: num(b.open),
      high: num(b.high),
      low: num(b.low),
      // close pode vir null em contrato com pouca liquidez -> usa o ajuste oficial
      close: num(b.close) ?? num(b.settlement),
      volume: num(b.volume) ?? num(b.financialVolume),
    }))
    .filter(b => b.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// WIN/WDO: sem token (sandbox). Pega o contrato da frente e seu histórico.
async function fetchFuture(asset, numDays) {
  const tsRes = await fetch(`${FUT}/term-structure?asset=${asset}`);
  if (!tsRes.ok) throw new Error(`term-structure HTTP ${tsRes.status}`);
  const ts = await tsRes.json();
  const contracts = ts?.contracts || ts?.results || [];
  const symbol = contracts[0]?.symbol;
  if (!symbol) throw new Error("Sem contrato na curva");

  const hRes = await fetch(`${FUT}/historical?symbol=${encodeURIComponent(symbol)}`);
  if (!hRes.ok) throw new Error(`historical HTTP ${hRes.status}`);
  const series = mapBars(extractBars(await hRes.json()));
  return series.slice(-numDays);
}

// IBOV: índice à vista via /api/quote (precisa do token; Free funciona).
async function fetchIbov(numDays) {
  if (!BRAPI_TOKEN) throw new Error("BRAPI_TOKEN ausente para IBOV");
  const range = numDays <= 5 ? "5d" : numDays <= 21 ? "1mo" : "3mo";
  const url = `https://brapi.dev/api/quote/%5EBVSP?range=${range}&interval=1d&token=${BRAPI_TOKEN}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`quote HTTP ${r.status}`);
  const q = (await r.json())?.results?.[0];
  if (!q) throw new Error("Sem dados");
  let series = mapBars(extractBars({ historicalDataPrice: q.historicalDataPrice }));
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
