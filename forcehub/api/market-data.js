// api/market-data.js — Cotações para o Panorama (fontes gratuitas, com fallback)
//
// Estratégia por ativo (tenta a fonte primária; se falhar, usa o fallback):
//   IBOV : Brapi /quote ^BVSP (Free + token)
//   WIN  : Brapi futuros sandbox -> fallback: Ibovespa (^BVSP), pois o mini
//          índice acompanha o índice (mesma escala de pontos)
//   WDO  : Brapi futuros sandbox -> fallback: USD/BRL (Yahoo Finance) x1000,
//          pois o mini dólar acompanha a cotação do dólar
// Datas em Unix(segundos) ou ISO; barras sem high/low válidos são descartadas.

import { getRedis } from "./_redis";

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const FUT = "https://brapi.dev/api/v2/futures";
const UA = "Mozilla/5.0 (FORCEHUB)";

const num = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));

// fetch + parse JSON com retry leve (o sandbox de futuros às vezes dá 404/5xx).
async function getJson(url, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { "user-agent": UA } }); if (r.ok) return await r.json(); last = new Error("HTTP " + r.status); }
    catch (e) { last = e; }
  }
  throw last || new Error("falha");
}

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

// ── Brapi: futuros (token PRO; sandbox sem token cobre só WIN/WDO) ──
// O /historical exige o CONTRATO vigente (ex.: WINM26), não o código genérico.
// Fluxo: term-structure (descobre o contrato) -> historical desse contrato.
async function fetchFuture(asset) {
  const tok = BRAPI_TOKEN ? `&token=${BRAPI_TOKEN}` : "";
  const ts = await getJson(`${FUT}/term-structure?asset=${asset}${tok}`);
  const contracts = Array.isArray(ts && ts.contracts) ? ts.contracts : [];
  // Vigente = vencimento mais próximo AINDA NÃO vencido (na virada de contrato,
  // contracts[0] pode ser o que vence hoje/já venceu).
  const todayBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const front = contracts.find(c => c && c.symbol && (!c.expirationDate || c.expirationDate >= todayBRT)) || contracts.find(c => c && c.symbol);
  if (!front) throw new Error(`futuros ${asset} sem contrato vigente`);
  const bars = findBarsArray(await getJson(`${FUT}/historical?symbol=${encodeURIComponent(front.symbol)}${tok}`)); // série em future.history[]
  if (!bars || !bars.length) throw new Error(`futuros ${front.symbol} sem barras`);
  return { bars: mapBars(bars), symbol: front.symbol };
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
    const probeUrl = async (url) => { try { const r = await fetch(url, { headers: { "user-agent": UA } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j, sample: (j ? JSON.stringify(j) : t).slice(0, 700) }; } catch (e) { return { error: String((e && e.message) || e) }; } };
    const out = {};
    for (const asset of ["WIN", "WDO"]) {
      out[asset] = {};
      const tsr = await probeUrl(`${FUT}/term-structure?asset=${asset}`);
      const front = tsr.json && Array.isArray(tsr.json.contracts) && tsr.json.contracts[0] ? tsr.json.contracts[0].symbol : null;
      out[asset]["term-structure"] = { status: tsr.status, sample: tsr.sample };
      out[asset].front = front;
      if (front) { const h = await probeUrl(`${FUT}/historical?symbol=${encodeURIComponent(front)}`); out[asset]["historical-front"] = { status: h.status, sample: h.sample }; }
    }
    return res.status(200).json({ ok: true, probe: out });
  }

  const numDays = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 30);
  const redis = getRedis();
  const cacheKey = "forcehub:marketdata:" + numDays;
  if (redis && req.query.refresh !== "1") {
    try { const c = await redis.get(cacheKey); if (c && c.generatedAt && (Date.now() - c.generatedAt) < 20 * 60 * 1000) return res.status(200).json({ ...c, cached: true }); } catch (_) {}
  }

  const data = { WIN: [], WDO: [], IBOV: [] };
  const sources = {};
  const errors = [];
  const last = (arr) => arr.slice(-numDays);

  // IBOV primeiro (reutilizado como fallback de WIN).
  let ibovBars = [];
  try { ibovBars = await fetchIbovBars(numDays); data.IBOV = last(ibovBars); sources.IBOV = "brapi"; }
  catch (e) { errors.push({ ticker: "IBOV", error: e.message }); }

  // WIN: futuros (contrato vigente) -> Ibovespa (proxy).
  try { const f = await fetchFuture("WIN"); data.WIN = last(f.bars); sources.WIN = "futures:" + f.symbol; }
  catch (e1) {
    if (ibovBars.length) { data.WIN = last(ibovBars); sources.WIN = "ibov-proxy"; errors.push({ ticker: "WIN", error: "futuros indisponível; usando Ibovespa", fallback: "ibov" }); }
    else errors.push({ ticker: "WIN", error: e1.message });
  }

  // WDO: futuros (contrato vigente) -> USD/BRL (Yahoo) x1000.
  try { const f = await fetchFuture("WDO"); data.WDO = last(f.bars); sources.WDO = "futures:" + f.symbol; }
  catch (e1) {
    try { data.WDO = last(await fetchYahoo("USDBRL=X", 1000)); sources.WDO = "usdbrl-proxy"; errors.push({ ticker: "WDO", error: "futuros indisponível; usando USD/BRL", fallback: "usdbrl" }); }
    catch (e2) { errors.push({ ticker: "WDO", error: e1.message + " | " + e2.message }); }
  }

  const payload = { ok: true, data, sources, errors, generatedAt: Date.now() };
  // Não cacheia respostas vazias (evita fixar um erro total); fallback ao último bom.
  const total = data.WIN.length + data.WDO.length + data.IBOV.length;
  if (redis && total) { try { await redis.set(cacheKey, payload, { ex: 60 * 60 * 24 }); } catch (_) {} }
  else if (redis && !total) { try { const c = await redis.get(cacheKey); if (c) return res.status(200).json({ ...c, cached: true, stale: true }); } catch (_) {} }
  return res.status(200).json(payload);
}
