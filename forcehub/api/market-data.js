// api/market-data.js — Cotações para o Panorama (fontes gratuitas, com fallback)
//
// Estratégia por ativo (tenta a fonte primária; se falhar, usa o fallback):
//   IBOV : Brapi /quote ^BVSP (Free + token)
//   WIN  : Brapi futuros sandbox -> fallback: Ibovespa (^BVSP), pois o mini
//          índice acompanha o índice (mesma escala de pontos)
//   WDO  : Brapi futuros sandbox -> fallback: USD/BRL (Yahoo Finance) x1000,
//          pois o mini dólar acompanha a cotação do dólar
// Datas em Unix(segundos) ou ISO; barras sem high/low válidos são descartadas.

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const FUT = "https://brapi.dev/api/v2/futures";
const UA = "Mozilla/5.0 (FORCEHUB)";

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

function findBarsArray(obj, depth = 0) {
  if (obj == null || depth > 5) return null;
  if (Array.isArray(obj)) {
    const first = obj.find(x => x && typeof x === "object");
    if (first && ("date" in first || "close" in first || "settlement" in first || "high" in first || "low" in first)) return obj;
    for (const it of obj) { const f = findBarsArray(it, depth + 1); if (f) return f; }
    return null;
  }
  if (typeof obj === "object") for (const k of Object.keys(obj)) { const f = findBarsArray(obj[k], depth + 1); if (f) return f; }
  return null;
}

function mapBars(bars, scale = 1) {
  return (bars || [])
    .map(b => ({
      date: toISODate(b.date),
      open: num(b.open) != null ? num(b.open) * scale : null,
      high: num(b.high) != null ? num(b.high) * scale : null,
      low: num(b.low) != null ? num(b.low) * scale : null,
      close: (num(b.close) ?? num(b.settlement)) != null ? (num(b.close) ?? num(b.settlement)) * scale : null,
      volume: num(b.volume) ?? num(b.financialVolume),
    }))
    .filter(b => b.date && b.high != null && b.low != null) // descarta dias sem pregão
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Brapi: Ibovespa (^BVSP) ──
async function fetchIbovBars(numDays) {
  if (!BRAPI_TOKEN) throw new Error("BRAPI_TOKEN ausente");
  const range = numDays <= 5 ? "5d" : numDays <= 21 ? "1mo" : "3mo";
  const r = await fetch(`https://brapi.dev/api/quote/%5EBVSP?range=${range}&interval=1d&token=${BRAPI_TOKEN}`);
  if (!r.ok) throw new Error(`quote IBOV HTTP ${r.status}`);
  const q = (await r.json())?.results?.[0];
  if (!q) throw new Error("Sem dados de IBOV");
  return mapBars(findBarsArray(q.historicalDataPrice) || []);
}

// ── Brapi: futuros sandbox (sem token; só aceita o código do ativo) ──
async function fetchFuture(asset) {
  const r = await fetch(`${FUT}/historical?symbol=${asset}`);
  if (!r.ok) throw new Error(`futuros ${asset} HTTP ${r.status}`);
  const bars = findBarsArray(await r.json());
  if (!bars || !bars.length) throw new Error(`futuros ${asset} sem barras`);
  return mapBars(bars);
}

// ── Yahoo Finance: chart diário (sem chave) ──
async function fetchYahoo(symbol, scale = 1) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`yahoo ${symbol} HTTP ${r.status}`);
  const res = (await r.json())?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const q = res?.indicators?.quote?.[0] || {};
  const bars = ts.map((t, i) => ({ date: t, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] }));
  return mapBars(bars, scale);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  // Sondagem do sandbox de futuros (sem token): /api/market-data?probe=futures
  if (req.query.probe === "futures") {
    const out = {};
    for (const asset of ["WIN", "WDO"]) {
      out[asset] = {};
      const urls = [
        ["term-structure", `${FUT}/term-structure?asset=${asset}`],
        ["historical-asset", `${FUT}/historical?symbol=${asset}`],
        ["quote", `${FUT}/quote?symbols=${asset}`],
      ];
      for (const [label, url] of urls) {
        try {
          const r = await fetch(url, { headers: { "user-agent": UA } });
          const text = await r.text();
          let j = null; try { j = JSON.parse(text); } catch (_) {}
          out[asset][label] = { status: r.status, topKeys: j && typeof j === "object" ? Object.keys(j) : null, sample: (j ? JSON.stringify(j) : text).slice(0, 500) };
        } catch (e) { out[asset][label] = { error: String((e && e.message) || e) }; }
      }
    }
    return res.status(200).json({ ok: true, probe: out });
  }

  const numDays = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 30);
  const data = { WIN: [], WDO: [], IBOV: [] };
  const errors = [];
  const last = (arr) => arr.slice(-numDays);

  // IBOV primeiro (reutilizado como fallback de WIN).
  let ibovBars = [];
  try { ibovBars = await fetchIbovBars(numDays); data.IBOV = last(ibovBars); }
  catch (e) { errors.push({ ticker: "IBOV", error: e.message }); }

  // WIN: futuros -> Ibovespa (proxy).
  try { data.WIN = last(await fetchFuture("WIN")); }
  catch (e1) {
    if (ibovBars.length) { data.WIN = last(ibovBars); errors.push({ ticker: "WIN", error: "futuros indisponível; usando Ibovespa", fallback: "ibov" }); }
    else errors.push({ ticker: "WIN", error: e1.message });
  }

  // WDO: futuros -> USD/BRL (Yahoo) x1000.
  try { data.WDO = last(await fetchFuture("WDO")); }
  catch (e1) {
    try { data.WDO = last(await fetchYahoo("USDBRL=X", 1000)); errors.push({ ticker: "WDO", error: "futuros indisponível; usando USD/BRL", fallback: "usdbrl" }); }
    catch (e2) { errors.push({ ticker: "WDO", error: e1.message + " | " + e2.message }); }
  }

  return res.status(200).json({ ok: true, data, errors });
}
