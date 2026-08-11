// api/market-data.js — Cotações para o Panorama (brapi PRO com token; fallbacks)
//
// Estratégia por ativo (tenta a fonte primária; se falhar, usa o fallback):
//   IBOV : Brapi /quote ^BVSP (token)
//   WIN  : Brapi futuros com token (contrato vigente) -> fallback: Ibovespa
//          (^BVSP), pois o mini índice acompanha o índice (mesma escala)
//   WDO  : Brapi futuros com token (contrato vigente) -> fallback: USD/BRL
//          (Yahoo Finance) x1000, pois o mini dólar acompanha o dólar
// Todas as chamadas à brapi levam BRAPI_TOKEN — nunca o sandbox grátis.
// Datas em Unix(segundos) ou ISO; barras sem high/low válidos são descartadas.

import { getRedis } from "./_redis";

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
export const FUT = "https://brapi.dev/api/v2/futures";
const UA = "Mozilla/5.0 (FORCEHUB)";

const num = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));

// fetch + parse JSON com retry leve (a API de futuros às vezes dá 404/5xx).
export async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { "user-agent": UA } }); if (r.ok) return await r.json(); last = new Error("HTTP " + r.status); }
    catch (e) { last = e; }
  }
  throw last || new Error("falha");
}

export function toISODate(d) {
  if (d == null) return null;
  if (typeof d === "number") return new Date(d * 1000).toISOString().split("T")[0];
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (!isNaN(n)) return new Date(n * 1000).toISOString().split("T")[0];
  return null;
}

export function findBarsArray(obj, depth = 0) {
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

export function mapBars(bars, scale = 1) {
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
// O /quote do índice às vezes devolve historicalDataPrice vazio; usa getJson
// (com retry) e tenta um range maior antes de desistir.
export async function fetchIbovBarsFor(ranges) {
  if (!BRAPI_TOKEN) throw new Error("BRAPI_TOKEN ausente");
  const tok = `&token=${BRAPI_TOKEN}`;
  for (const range of ranges) {
    try {
      const j = await getJson(`https://brapi.dev/api/quote/%5EBVSP?range=${range}&interval=1d${tok}`);
      const q = j?.results?.[0];
      const bars = mapBars(findBarsArray(q?.historicalDataPrice) || []);
      if (bars.length) return bars;
    } catch (_) { /* tenta o próximo range */ }
  }
  throw new Error("IBOV sem dados de histórico");
}

async function fetchIbovBars(numDays) {
  return fetchIbovBarsFor(numDays <= 5 ? ["5d", "1mo"] : ["1mo", "3mo"]);
}

// ── Brapi: futuros (sempre com o token PRO) ──
// O /historical exige o CONTRATO vigente (ex.: WINM26), não o código genérico.
// Fluxo: term-structure (descobre o contrato) -> historical desse contrato.
// Escolhe o contrato vigente: o de vencimento MAIS PRÓXIMO ainda não vencido (o
// mais líquido). Não confiar na ordem do array — ordenar pela data de vencimento.
export function pickFront(contracts, todayBRT) {
  const valid = (contracts || []).filter(c => c && c.symbol);
  const dated = valid.filter(c => c.expirationDate);
  if (!dated.length) return valid[0] || null;
  const upcoming = dated.filter(c => c.expirationDate >= todayBRT).sort((a, b) => a.expirationDate.localeCompare(b.expirationDate));
  if (upcoming.length) return upcoming[0];
  // Todos vencidos: usa o de vencimento mais recente.
  return dated.slice().sort((a, b) => b.expirationDate.localeCompare(a.expirationDate))[0];
}

// ── Série contínua do mini índice, emendada por nós ("WINFUT") ──
// A brapi NÃO expõe um símbolo contínuo pronto: WINFUT, WIN1!, WIN$, WIN$N e até
// WIN puro devolvem 404 no /historical, que exige um CONTRATO específico
// (confirmado em produção com token PRO via ?probe=winfut).
//
// Montamos a série então: pegamos a lista REAL de contratos do ativo (inclusive
// os vencidos, via includeExpired), baixamos o histórico de cada um e, para cada
// dia, ficamos com a barra do contrato que era o VIGENTE naquela data. É assim
// que uma série contínua se compõe.
//
// A lista traz `lastTradeDate` — o último pregão real de cada contrato —, então
// o corte entre um contrato e o seguinte é exato, sem aproximação de calendário.
//
// Para AMPLITUDE (máxima − mínima do dia) a emenda não precisa de ajuste de gap:
// o salto da rolagem desloca o NÍVEL de preço, não a variação dentro de um mesmo
// pregão. A amplitude diária é idêntica com ou sem ajuste.
const COD_MES = { 2: "G", 4: "J", 6: "M", 8: "Q", 10: "V", 12: "Z" };

// Plano B, se a listagem falhar: gera os códigos pela convenção do WIN/IND
// (vencimentos em meses pares), aproximando o vencimento pelo dia 15.
export function contratosWin(mesesAtras = 30, hojeISO) {
  const hoje = hojeISO || new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [ay, am] = hoje.split("-").map(Number);
  const out = [];
  for (let d = -mesesAtras; d <= 2; d++) {
    const tot = ay * 12 + (am - 1) + d;
    const ano = Math.floor(tot / 12), mes = (tot % 12) + 1;
    if (!COD_MES[mes]) continue;
    out.push({ symbol: `WIN${COD_MES[mes]}${String(ano).slice(-2)}`, exp: `${ano}-${String(mes).padStart(2, "0")}-15`, ultimo: null });
  }
  return out;
}

// Lista real de contratos de um ativo, incluindo os já vencidos (é isso que
// permite reconstruir o histórico). Resposta paginada; cache de 1 dia.
export async function listarContratosFuturos(asset, redis, { includeExpired = true } = {}) {
  const key = `forcehub:fut:list:${asset}:${includeExpired ? 1 : 0}`;
  if (redis) { try { const c = await redis.get(key); if (c && Array.isArray(c.contratos) && c.contratos.length) return c.contratos; } catch (_) {} }
  if (!BRAPI_TOKEN) throw new Error("BRAPI_TOKEN ausente");
  const tok = `&token=${BRAPI_TOKEN}`;
  const out = [];
  let page = 1, totalPages = 1;
  do {
    const j = await getJson(`${FUT}/list?asset=${encodeURIComponent(asset)}&includeExpired=${includeExpired}&limit=100&page=${page}${tok}`, 2);
    for (const f of (Array.isArray(j && j.futures) ? j.futures : [])) {
      if (!f || !f.symbol || !f.expirationDate) continue;
      out.push({
        symbol: f.symbol,
        exp: String(f.expirationDate).slice(0, 10),
        primeiro: f.firstTradeDate ? String(f.firstTradeDate).slice(0, 10) : null,
        ultimo: f.lastTradeDate ? String(f.lastTradeDate).slice(0, 10) : null,
      });
    }
    totalPages = Math.max(1, Number(j && j.pagination && j.pagination.totalPages) || 1);
    page++;
  } while (page <= totalPages && page <= 20); // trava de segurança contra loop
  if (!out.length) throw new Error(`sem contratos para ${asset}`);
  out.sort((a, b) => a.exp.localeCompare(b.exp));
  if (redis) { try { await redis.set(key, { contratos: out }, { ex: 60 * 60 * 24 }); } catch (_) {} }
  return out;
}

// Histórico de UM contrato, com cache. Contrato vencido nunca mais muda, então
// vale cache longo — é o que faz o backfill custar caro só na primeira vez.
export async function fetchContratoBars(symbol, redis, vencido) {
  const key = "forcehub:fut:hist:" + symbol;
  if (redis) { try { const c = await redis.get(key); if (c && Array.isArray(c.bars)) return c.bars; } catch (_) {} }
  let bars = [];
  const tok = BRAPI_TOKEN ? `&token=${BRAPI_TOKEN}` : "";
  try { bars = mapBars(findBarsArray(await getJson(`${FUT}/historical?symbol=${encodeURIComponent(symbol)}${tok}`, 1)) || []); }
  catch (_) { bars = []; }
  // Sem barras também é cacheado (TTL curto): evita repetir 404 a cada coleta.
  if (redis) {
    const ex = !bars.length ? 60 * 60 * 24 : (vencido ? 60 * 60 * 24 * 180 : 3600);
    try { await redis.set(key, { bars }, { ex }); } catch (_) {}
  }
  return bars;
}

const menosMeses = (iso, meses) => {
  const [y, m, d] = iso.split("-").map(Number);
  const tot = y * 12 + (m - 1) - meses;
  return `${Math.floor(tot / 12)}-${String((tot % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export async function fetchWinEmendado(redis, mesesAtras = 30) {
  const hojeISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const limite = menosMeses(hojeISO, mesesAtras);
  let contratos, fonte;
  try { contratos = (await listarContratosFuturos("WIN", redis)).filter(c => c.exp >= limite); fonte = "lista"; }
  catch (_) { contratos = contratosWin(mesesAtras, hojeISO); fonte = "gerado"; }

  const hist = await Promise.allSettled(contratos.map(c => fetchContratoBars(c.symbol, redis, (c.ultimo || c.exp) < hojeISO)));

  const porDia = new Map(); // data -> { bar, exp do contrato escolhido }
  const usados = [];
  contratos.forEach((c, i) => {
    const bars = hist[i].status === "fulfilled" ? hist[i].value : [];
    if (!bars.length) return;
    usados.push(c.symbol);
    const fim = c.ultimo || c.exp;                 // último pregão real do contrato
    for (const b of bars) {
      if (b.date > fim) continue;
      const cur = porDia.get(b.date);
      if (!cur || c.exp < cur.exp) porDia.set(b.date, { bar: b, exp: c.exp }); // vence o vencimento mais próximo
    }
  });

  const bars = [...porDia.keys()].sort().map(d => porDia.get(d).bar);
  if (!bars.length) throw new Error("nenhum contrato WIN com histórico");
  return { bars, contratos: usados, fonte };
}

export async function fetchFuture(asset) {
  // Sempre com o token PRO: sem ele, nem tenta o sandbox grátis (limites e
  // instabilidade) — cai direto no fallback do chamador (Ibov/USDBRL proxy).
  if (!BRAPI_TOKEN) throw new Error("BRAPI_TOKEN ausente");
  const tok = `&token=${BRAPI_TOKEN}`;
  const ts = await getJson(`${FUT}/term-structure?asset=${asset}${tok}`);
  const contracts = Array.isArray(ts && ts.contracts) ? ts.contracts : [];
  const todayBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const front = pickFront(contracts, todayBRT);
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

  // Diagnóstico dos futuros: /api/market-data?probe=futures
  // Mostra os contratos, qual foi escolhido como vigente, e os últimos pregões
  // crus (com presença de máx/mín) vs. os que sobrevivem ao filtro — assim dá
  // para ver se um dia some na origem ou por falta de high/low. Usa o token (PRO)
  // sem jamais expô-lo na resposta.
  if (req.query.probe === "futures") {
    const tok = BRAPI_TOKEN ? `&token=${BRAPI_TOKEN}` : "";
    const todayBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const out = {};
    for (const asset of ["WIN", "WDO"]) {
      out[asset] = {};
      try {
        const ts = await getJson(`${FUT}/term-structure?asset=${asset}${tok}`);
        const contracts = Array.isArray(ts && ts.contracts) ? ts.contracts : [];
        out[asset].contracts = contracts.map(c => ({ symbol: c.symbol, exp: c.expirationDate || null }));
        const front = pickFront(contracts, todayBRT);
        out[asset].front = front ? front.symbol : null;
        if (front) {
          const raw = findBarsArray(await getJson(`${FUT}/historical?symbol=${encodeURIComponent(front.symbol)}${tok}`)) || [];
          out[asset].recentRaw = raw.slice(-14).map(b => ({ date: toISODate(b.date), high: b.high ?? null, low: b.low ?? null, close: (b.close ?? b.settlement) ?? null }));
          out[asset].keptDates = mapBars(raw).slice(-14).map(b => b.date);
        }
      } catch (e) { out[asset].error = String((e && e.message) || e); }
    }
    return res.status(200).json({ ok: true, today: todayBRT, tokenUsed: !!BRAPI_TOKEN, probe: out });
  }

  // Diagnóstico da emenda do mini índice: /api/market-data?probe=winfut
  // Mostra a lista de contratos que a brapi devolve (com includeExpired), a
  // cobertura de histórico contrato a contrato e o resultado da emenda. É o que
  // confirma se o estudo tem histórico longo ou só o contrato vigente.
  if (req.query.probe === "winfut") {
    const redis = getRedis();
    const hojeISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const meses = Math.min(Math.max(parseInt(req.query.meses) || 30, 2), 120);
    const out = { meses, lista: null, contratos: {}, emenda: null };

    let contratos = [];
    try {
      const todos = await listarContratosFuturos("WIN", redis);
      out.lista = { fonte: "brapi /futures/list", total: todos.length, primeiro: todos[0] || null, ultimo: todos[todos.length - 1] || null };
      contratos = todos.slice(-Math.ceil(meses / 2) - 2);
    } catch (e) {
      out.lista = { fonte: "gerado (listagem falhou)", erro: String((e && e.message) || e) };
      contratos = contratosWin(meses, hojeISO);
    }

    const hist = await Promise.allSettled(contratos.map(c => fetchContratoBars(c.symbol, redis, (c.ultimo || c.exp) < hojeISO)));
    contratos.forEach((c, i) => {
      const bars = hist[i].status === "fulfilled" ? hist[i].value : [];
      out.contratos[c.symbol] = bars.length
        ? { venc: c.exp, ultimoPregao: c.ultimo, barras: bars.length, de: bars[0].date, ate: bars[bars.length - 1].date }
        : { venc: c.exp, barras: 0, erro: hist[i].status === "rejected" ? String(hist[i].reason) : "sem barras" };
    });

    try {
      const e = await fetchWinEmendado(redis, meses);
      out.emenda = {
        fonte: e.fonte, pregoes: e.bars.length, de: e.bars[0].date, ate: e.bars[e.bars.length - 1].date,
        contratosUsados: e.contratos,
        amostra: e.bars.slice(-3).map(b => ({ date: b.date, amplitude: +(b.high - b.low).toFixed(1) })),
      };
    } catch (e) { out.emenda = { erro: String((e && e.message) || e) }; }
    return res.status(200).json({ ok: true, tokenUsed: !!BRAPI_TOKEN, hoje: hojeISO, probe: out });
  }

  // Diagnóstico dos futuros agrícolas: /api/market-data?probe=agro
  // Confirma quais códigos-raiz (asset) a brapi reconhece e mostra o contrato
  // vigente + últimos fechamentos. Inclui alternativas de soja para acharmos a
  // raiz correta no ambiente com token (a brapi bloqueia acesso local aqui).
  if (req.query.probe === "agro") {
    const tok = BRAPI_TOKEN ? `&token=${BRAPI_TOKEN}` : "";
    const todayBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const out = {};
    for (const asset of ["CCM", "ICF", "BGI", "SOJ", "SFI", "SJC", "SOY"]) {
      out[asset] = {};
      try {
        const ts = await getJson(`${FUT}/term-structure?asset=${asset}${tok}`);
        const contracts = Array.isArray(ts && ts.contracts) ? ts.contracts : [];
        out[asset].contracts = contracts.map(c => ({ symbol: c.symbol, exp: c.expirationDate || null }));
        const front = pickFront(contracts, todayBRT);
        out[asset].front = front ? front.symbol : null;
        if (front) {
          const raw = findBarsArray(await getJson(`${FUT}/historical?symbol=${encodeURIComponent(front.symbol)}${tok}`)) || [];
          out[asset].recentRaw = raw.slice(-8).map(b => ({ date: toISODate(b.date), close: (b.close ?? b.settlement) ?? null }));
        }
      } catch (e) { out[asset].error = String((e && e.message) || e); }
    }
    return res.status(200).json({ ok: true, today: todayBRT, tokenUsed: !!BRAPI_TOKEN, probe: out });
  }

  // Diagnóstico do DI de 1 dia: /api/market-data?probe=di
  // Confirma a raiz (asset) do futuro de DI e mostra alguns contratos da curva
  // com os últimos fechamentos (taxa). Testa alternativas caso "DI1" não seja a
  // raiz esperada no ambiente com token.
  if (req.query.probe === "di") {
    const tok = BRAPI_TOKEN ? `&token=${BRAPI_TOKEN}` : "";
    const todayBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const out = {};
    for (const asset of ["DI1", "DI", "OC1"]) {
      out[asset] = {};
      try {
        const ts = await getJson(`${FUT}/term-structure?asset=${asset}${tok}`);
        const contracts = Array.isArray(ts && ts.contracts) ? ts.contracts : [];
        out[asset].count = contracts.length;
        out[asset].contracts = contracts.slice(0, 6).map(c => ({ symbol: c.symbol, exp: c.expirationDate || null }));
        const front = pickFront(contracts, todayBRT);
        out[asset].front = front ? front.symbol : null;
        if (front) {
          const raw = findBarsArray(await getJson(`${FUT}/historical?symbol=${encodeURIComponent(front.symbol)}${tok}`)) || [];
          out[asset].recentRaw = raw.slice(-6).map(b => ({ date: toISODate(b.date), close: (b.close ?? b.settlement) ?? null }));
        }
      } catch (e) { out[asset].error = String((e && e.message) || e); }
    }
    return res.status(200).json({ ok: true, today: todayBRT, tokenUsed: !!BRAPI_TOKEN, probe: out });
  }

  // Diagnóstico das opções: /api/market-data?probe=opcoes[&underlying=VALE3]
  // Confirma o acesso do token PRO à API de opções (o sandbox só libera PETR4).
  // Mostra os vencimentos e uma amostra da cadeia (symbol/strike/close) do
  // vencimento mais próximo, para um ativo de teste além de PETR4.
  if (req.query.probe === "opcoes") {
    const tok = BRAPI_TOKEN ? `&token=${BRAPI_TOKEN}` : "";
    const OPT = "https://brapi.dev/api/v2/options";
    const out = {};
    for (const u of ["PETR4", String(req.query.underlying || "VALE3").toUpperCase()]) {
      out[u] = {};
      try {
        const je = await getJson(`${OPT}/expirations?underlying=${encodeURIComponent(u)}${tok}`);
        const exps = (Array.isArray(je && je.expirations) ? je.expirations : []).map(toISODate).filter(Boolean);
        out[u].expirations = exps.slice(0, 6);
        const exp = exps.find(d => d >= new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })) || exps[0];
        if (exp) {
          const jc = await getJson(`${OPT}/chain?underlying=${encodeURIComponent(u)}&expirationDate=${exp}${tok}`);
          const series = findBarsArray(jc) || (Array.isArray(jc && jc.series) ? jc.series : []);
          out[u].chainExp = exp;
          out[u].chainSample = (Array.isArray(series) ? series : []).slice(0, 4).map(s => ({ symbol: s.symbol, side: s.side || s.type, strike: s.strike, close: s.close }));
        }
      } catch (e) { out[u].error = String((e && e.message) || e); }
    }
    return res.status(200).json({ ok: true, tokenUsed: !!BRAPI_TOKEN, probe: out });
  }

  const numDays = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 30);
  const redis = getRedis();
  const cacheKey = "forcehub:marketdata:" + numDays;
  const complete = (p) => p && p.data && (p.data.WIN || []).length && (p.data.WDO || []).length && (p.data.IBOV || []).length;
  let prev = null;
  if (redis) { try { prev = await redis.get(cacheKey); } catch (_) {} }
  // Só serve o cache como fresco se estiver COMPLETO (os 3 ativos com dados); um
  // payload com algum ativo vazio (ex.: IBOV de uma falha passada) é regenerado.
  if (prev && req.query.refresh !== "1" && complete(prev) && prev.generatedAt && (Date.now() - prev.generatedAt) < 20 * 60 * 1000) {
    return res.status(200).json({ ...prev, cached: true });
  }

  const data = { WIN: [], WDO: [], IBOV: [] };
  const sources = {};
  const errors = [];
  const last = (arr) => arr.slice(-numDays);

  // IBOV primeiro (reutilizado como fallback de WIN).
  let ibovBars = [];
  try { ibovBars = await fetchIbovBars(numDays); sources.IBOV = "brapi"; }
  catch (e) { errors.push({ ticker: "IBOV", error: e.message }); }

  // WIN: futuros (contrato vigente) -> Ibovespa (proxy).
  let winBars = [];
  try { const f = await fetchFuture("WIN"); winBars = f.bars; sources.WIN = "futures:" + f.symbol; }
  catch (e1) {
    if (ibovBars.length) { winBars = ibovBars; sources.WIN = "ibov-proxy"; errors.push({ ticker: "WIN", error: "futuros indisponível; usando Ibovespa", fallback: "ibov" }); }
    else errors.push({ ticker: "WIN", error: e1.message });
  }

  // WDO: futuros (contrato vigente) -> USD/BRL (Yahoo) x1000.
  let wdoBars = [];
  try { const f = await fetchFuture("WDO"); wdoBars = f.bars; sources.WDO = "futures:" + f.symbol; }
  catch (e1) {
    try { wdoBars = await fetchYahoo("USDBRL=X", 1000); sources.WDO = "usdbrl-proxy"; errors.push({ ticker: "WDO", error: "futuros indisponível; usando USD/BRL", fallback: "usdbrl" }); }
    catch (e2) { errors.push({ ticker: "WDO", error: e1.message + " | " + e2.message }); }
  }

  // Devolve só barras reais (com máx/mín) por ativo — sem inventar células
  // vazias. O Panorama decide quais datas mostrar (eixo recente de futuros para
  // WIN/WDO; IBOV à vista segue independente, pode ter o dia de hoje).
  data.IBOV = last(ibovBars);
  data.WIN = last(winBars);
  data.WDO = last(wdoBars);

  // Por ativo: se a fonte falhou agora mas o cache tinha dado bom, reaproveita —
  // assim uma falha pontual (ex.: IBOV) não zera aquela tabela para todos.
  for (const tk of ["WIN", "WDO", "IBOV"]) {
    if (!data[tk].length && prev && prev.data && (prev.data[tk] || []).length) {
      data[tk] = prev.data[tk];
      sources[tk] = (prev.sources && prev.sources[tk]) || sources[tk];
      errors.push({ ticker: tk, error: "fonte indisponível agora; mantido o último dado bom", fallback: "cache" });
    }
  }

  const payload = { ok: true, data, sources, errors, generatedAt: Date.now() };
  const total = data.WIN.length + data.WDO.length + data.IBOV.length;
  if (redis && total) { try { await redis.set(cacheKey, payload, { ex: 60 * 60 * 24 }); } catch (_) {} }
  return res.status(200).json(payload);
}
