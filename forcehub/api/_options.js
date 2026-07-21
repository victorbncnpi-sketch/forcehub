// api/_options.js — Opções da B3 via brapi PRO (/api/v2/options/*).
// Prefixo "_": não vira rota na Vercel; é acoplado ao roteador api/market.js
// (kind=options) e reutilizado por api/posicoes.js para marcar a carteira
// própria de opções a mercado.
//
// Fluxo da brapi (dados EOD, processados ~19h BRT):
//   expirations(underlying)            -> datas de vencimento
//   strikes(underlying, exp)           -> strikes daquele vencimento
//   chain(underlying, exp)             -> séries negociadas { symbol, side, strike, close, bid, ask }
//   historical(symbol, exp)            -> histórico diário de uma série (marcação)
//   analytics(underlying, exp)         -> gregas + volatilidade implícita por série
//
// O `symbol` (ex.: PETRE370) traz o strike codificado; o strike EM REAIS vem do
// chain/strikes. Todas as chamadas levam BRAPI_TOKEN (plano Pro cobre todos os
// ativos; o sandbox só PETR4).
import { getJson, findBarsArray, toISODate } from "./_market-data";
import { getSession, sessionCan } from "./_auth";
import { getQuotes, getDailyBars, sanitizeTicker } from "./_brapi";

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const OPT = "https://brapi.dev/api/v2/options";
const TOK = BRAPI_TOKEN ? `&token=${BRAPI_TOKEN}` : "";

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v);
const round = (v, d = 2) => (num(v) == null ? null : +Number(v).toFixed(d));
const saneUnderlying = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 12);
const saneSymbol = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
const todayBRT = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

// Procura o primeiro array de objetos que contenha uma das chaves indicadas.
function pickArray(j, preferred, keys) {
  if (!j) return [];
  for (const k of preferred) if (Array.isArray(j[k])) return j[k];
  const seen = [];
  const walk = (o, depth) => {
    if (o == null || depth > 4 || seen.length) return;
    if (Array.isArray(o)) {
      const first = o.find(x => x && typeof x === "object");
      if (first && keys.some(k => k in first)) { seen.push(o); return; }
      for (const it of o) walk(it, depth + 1);
      return;
    }
    if (typeof o === "object") for (const k of Object.keys(o)) walk(o[k], depth + 1);
  };
  walk(j, 0);
  return seen[0] || [];
}

// Cache curto no Upstash (dados EOD): 30 min. Best-effort — nunca quebra a chamada.
async function cached(redis, key, ttl, producer) {
  if (redis) {
    try { const c = await redis.get(key); if (c && c._at && (Date.now() - c._at) < ttl * 1000) return c.v; } catch (_) {}
  }
  const v = await producer();
  if (redis) { try { await redis.set(key, { v, _at: Date.now() }, { ex: ttl * 2 }); } catch (_) {} }
  return v;
}

// ─── Fetchers ────────────────────────────────────────────────────────────────
export async function optExpirations(underlying, redis) {
  const u = saneUnderlying(underlying);
  if (!u) return [];
  return cached(redis, "forcehub:opt:exp:" + u, 30 * 60, async () => {
    const j = await getJson(`${OPT}/expirations?underlying=${encodeURIComponent(u)}${TOK}`);
    const arr = Array.isArray(j?.expirations) ? j.expirations
      : pickArray(j, ["results", "data"], ["expirationDate", "date"]);
    const today = todayBRT();
    return [...new Set(arr
      .map(x => (typeof x === "string" ? x : (x?.expirationDate || x?.date)))
      .map(toISODate).filter(Boolean))]
      .filter(d => d >= today)
      .sort((a, b) => a.localeCompare(b));
  });
}

export async function optStrikes(underlying, exp, redis) {
  const u = saneUnderlying(underlying), e = toISODate(exp);
  if (!u || !e) return [];
  return cached(redis, `forcehub:opt:strk:${u}:${e}`, 30 * 60, async () => {
    const j = await getJson(`${OPT}/strikes?underlying=${encodeURIComponent(u)}&expirationDate=${e}${TOK}`);
    const arr = Array.isArray(j?.strikes) ? j.strikes : pickArray(j, ["results", "data"], ["strike"]);
    return [...new Set(arr.map(x => num(typeof x === "object" ? x.strike : x)).filter(v => v != null))]
      .sort((a, b) => a - b);
  });
}

export async function optChain(underlying, exp, redis) {
  const u = saneUnderlying(underlying), e = toISODate(exp);
  if (!u || !e) return [];
  return cached(redis, `forcehub:opt:chain:${u}:${e}`, 30 * 60, async () => {
    const j = await getJson(`${OPT}/chain?underlying=${encodeURIComponent(u)}&expirationDate=${e}${TOK}`);
    const arr = pickArray(j, ["series", "results", "data"], ["symbol"]);
    return arr.map(s => ({
      symbol: saneSymbol(s.symbol),
      side: /put/i.test(s.side || s.type || "") ? "put" : "call",
      strike: num(s.strike),
      close: round(s.close ?? s.premium ?? s.lastPrice, 3),
      bid: round(s.bid, 3),
      ask: round(s.ask, 3),
      trades: num(s.trades ?? s.volume),
    })).filter(s => s.symbol && s.strike != null);
  });
}

// Último pregão de uma série específica (marcação a mercado, EOD).
export async function optHistoricalLast(symbol, exp, redis) {
  const s = saneSymbol(symbol), e = toISODate(exp);
  if (!s) return null;
  return cached(redis, `forcehub:opt:hist:${s}`, 30 * 60, async () => {
    const url = `${OPT}/historical?symbol=${encodeURIComponent(s)}${e ? `&expirationDate=${e}` : ""}${TOK}`;
    const bars = findBarsArray(await getJson(url)) || [];
    if (!bars.length) return null;
    const last = bars[bars.length - 1];
    return {
      close: round(last.close ?? last.settlement, 3),
      bid: round(last.bid, 3),
      ask: round(last.ask, 3),
      date: toISODate(last.date),
    };
  });
}

// Gregas + IV por vencimento (mapa symbol -> { delta, gamma, theta, vega, iv }).
export async function optAnalyticsMap(underlying, exp, redis) {
  const u = saneUnderlying(underlying), e = toISODate(exp);
  if (!u || !e) return {};
  return cached(redis, `forcehub:opt:greeks:${u}:${e}`, 30 * 60, async () => {
    const j = await getJson(`${OPT}/analytics?underlying=${encodeURIComponent(u)}&expirationDate=${e}${TOK}`);
    const arr = pickArray(j, ["analytics", "series", "results", "data"], ["delta", "impliedVolatility", "symbol"]);
    const map = {};
    for (const g of arr) {
      const sym = saneSymbol(g.symbol);
      if (!sym) continue;
      map[sym] = {
        delta: round(g.delta, 4), gamma: round(g.gamma, 4),
        theta: round(g.theta, 4), vega: round(g.vega, 4),
        iv: round(g.impliedVolatility ?? g.iv, 4),
      };
    }
    return map;
  });
}

// ─── Marcação da carteira própria de opções (EOD) ────────────────────────────
// Anexa preço atual + gregas às posições de opção ABERTAS. Trava por escopo
// (~30 min) para não bater na brapi a cada GET. Muta os itens; retorna true se
// algo mudou (para o chamador regravar).
export async function runOptionMarks({ redis, items, scope }) {
  if (!Array.isArray(items)) return false;
  const open = items.filter(i => i && i.kind === "opcao" && i.symbol && i.status !== "FECHADA");
  if (!open.length) return false;

  if (redis) {
    const tkey = "forcehub:optmark:" + scope;
    try {
      const last = await redis.get(tkey);
      if (last && Date.now() - Number(last) < 30 * 60 * 1000) return false;
      await redis.set(tkey, Date.now(), { ex: 3600 });
    } catch (_) {}
  }

  // Agrupa por (ativo, vencimento) para buscar as gregas de uma vez.
  const groups = {};
  for (const it of open) (groups[`${it.ticker}|${it.expirationDate}`] ||= []).push(it);

  let changed = false;
  for (const gk of Object.keys(groups)) {
    const [underlying, exp] = gk.split("|");
    let greeks = {};
    try { greeks = await optAnalyticsMap(underlying, exp, redis); } catch (_) {}
    for (const it of groups[gk]) {
      try {
        const h = await optHistoricalLast(it.symbol, exp, redis);
        if (h && h.close != null) { it.precoAtual = h.close; it.precoAtualEm = h.date || todayBRT(); changed = true; }
        const g = greeks[it.symbol];
        if (g) { it.greeks = g; changed = true; }
      } catch (_) {}
    }
  }
  return changed;
}

// ─── Encerramento automático da carteira própria (alvo/stop) ─────────────────
// Fecha as posições ABERTAS que tocaram alvo/stop, do MESMO jeito das
// recomendações: ações via barras diárias desde a abertura + cotação do dia
// (delay ~15 min); opções via preço EOD (precoAtual, marcado por runOptionMarks).
// Sempre fecha NO NÍVEL, direção-aware, e marca fechadoAuto/motivoFechamento.
// Trava por escopo (~10 min). Muta os itens; retorna true se algo mudou.
const OWN_THROTTLE_MS = 9.5 * 60 * 1000;
const ownIsLong = (p) => p.direcao !== "VENDA"; // COMPRA/long (+) vs VENDA/short (−)
const hasLvl = (v) => v != null && v !== "" && !Number.isNaN(Number(v));
const parseBRdate = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || "")); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const brtOf = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

function ownClose(p, tipo, level, ts) {
  const dir = ownIsLong(p) ? 1 : -1;
  p.status = "FECHADA";
  p.precoSaida = +Number(level).toFixed(p.kind === "opcao" ? 3 : 2);
  p.resultado = p.precoMedio ? +(dir * ((p.precoSaida - p.precoMedio) / p.precoMedio) * 100).toFixed(2) : null;
  p.dataSaida = new Date(ts).toLocaleDateString("pt-BR");
  p.fechadoAuto = true;
  p.motivoFechamento = tipo;
}

export async function runOwnAutoClose({ redis, items, scope }) {
  if (!Array.isArray(items) || !items.length) return false;
  const open = items.filter(p => p && p.status === "ABERTA" && (hasLvl(p.alvo) || hasLvl(p.stop)));
  if (!open.length) return false;

  if (redis) {
    const tkey = "forcehub:ownclose:" + scope;
    try {
      const last = await redis.get(tkey);
      if (last && Date.now() - Number(last) < OWN_THROTTLE_MS) return false;
      await redis.set(tkey, Date.now(), { ex: 3600 });
    } catch (_) {}
  }

  const now = Date.now();
  const today = todayBRT();
  let changed = false;

  // Opções: preço EOD já marcado (precoAtual). Cruzou o nível -> fecha no nível.
  for (const p of open.filter(x => x.kind === "opcao")) {
    const price = num(p.precoAtual);
    if (price == null) continue;
    const long = ownIsLong(p);
    const a = hasLvl(p.alvo) && (long ? price >= Number(p.alvo) : price <= Number(p.alvo));
    const s = hasLvl(p.stop) && (long ? price <= Number(p.stop) : price >= Number(p.stop));
    if (a || s) {
      const tipo = a ? "alvo" : "stop";
      ownClose(p, tipo, tipo === "alvo" ? p.alvo : p.stop, now);
      if (a && s) p.fechamentoAmbiguo = true;
      changed = true;
    }
  }

  // Ações: barras diárias desde a abertura + cotação do dia (delay ~15 min).
  const acoes = open.filter(x => x.kind !== "opcao" && x.ticker && x.status === "ABERTA");
  if (acoes.length) {
    let quotes = {};
    try { quotes = await getQuotes(acoes.map(x => x.ticker), redis); } catch (_) {}
    for (const p of acoes) {
      try {
        if (p.status !== "ABERTA") continue;
        const long = ownIsLong(p);
        const alvo = Number(p.alvo), stop = Number(p.stop);
        const hA = hasLvl(p.alvo), hS = hasLvl(p.stop);
        const openDate = parseBRdate(p.abertoEm) || today;
        const q = quotes[sanitizeTicker(p.ticker)];
        const fresh = q && q.price != null && brtOf(q.time || now) === today;
        let hit = null;
        if (today > openDate) {
          // Dias após a abertura: máx/mín da barra tocou o nível.
          const bars = await getDailyBars(p.ticker, redis);
          for (const b of bars) {
            if (b.date <= openDate || b.date >= today) continue;
            const a = hA && (long ? b.high >= alvo : b.low <= alvo);
            const s = hS && (long ? b.low <= stop : b.high >= stop);
            if (!a && !s) continue;
            const ts = Date.parse(b.date + "T18:00:00Z");
            hit = (a && s) ? { tipo: "stop", level: stop, ts, ambiguo: true } : (a ? { tipo: "alvo", level: alvo, ts } : { tipo: "stop", level: stop, ts });
            break;
          }
          // Hoje (após o dia da abertura): dia inteiro é válido -> máx/mín do dia.
          if (!hit && fresh && q.dayHigh != null && q.dayLow != null) {
            const a = hA && (long ? q.dayHigh >= alvo : q.dayLow <= alvo);
            const s = hS && (long ? q.dayLow <= stop : q.dayHigh >= stop);
            if (a || s) hit = (a && s) ? { tipo: "stop", level: stop, ts: q.time || now, ambiguo: true } : (a ? { tipo: "alvo", level: alvo, ts: q.time || now } : { tipo: "stop", level: stop, ts: q.time || now });
          }
        } else if (fresh) {
          // Mesmo dia da abertura: só o preço amostrado (sem máx/mín, que
          // conteria momentos anteriores à montagem da posição).
          const a = hA && (long ? q.price >= alvo : q.price <= alvo);
          const s = hS && (long ? q.price <= stop : q.price >= stop);
          if (a) hit = { tipo: "alvo", level: alvo, ts: q.time || now };
          else if (s) hit = { tipo: "stop", level: stop, ts: q.time || now };
        }
        if (hit) { ownClose(p, hit.tipo, hit.level, hit.ts); if (hit.ambiguo) p.fechamentoAmbiguo = true; changed = true; }
      } catch (_) {}
    }
  }

  return changed;
}

// ─── Handler roteado (kind=options) ──────────────────────────────────────────
// Alimenta o seletor guiado do cadastro de opção. Exige sessão + cap portfolio.
//   ?op=expirations&underlying=PETR4
//   ?op=strikes&underlying=PETR4&exp=2026-05-15
//   ?op=chain&underlying=PETR4&exp=2026-05-15
import { getRedis } from "./_redis";
export default async function handler(req, res) {
  const redis = getRedis();
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!sessionCan(sess, "portfolio")) return res.status(403).json({ ok: false, error: "Sem acesso à carteira própria." });
  if (!BRAPI_TOKEN) return res.status(503).json({ ok: false, error: "Cotações de opções indisponíveis (BRAPI_TOKEN ausente)." });

  const op = String(req.query.op || "").trim();
  const underlying = req.query.underlying;
  const exp = req.query.exp || req.query.expirationDate;

  try {
    if (op === "expirations") return res.status(200).json({ ok: true, expirations: await optExpirations(underlying, redis) });
    if (op === "strikes") return res.status(200).json({ ok: true, strikes: await optStrikes(underlying, exp, redis) });
    if (op === "chain") return res.status(200).json({ ok: true, series: await optChain(underlying, exp, redis) });
    return res.status(400).json({ ok: false, error: "Operação de opções desconhecida." });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "Falha ao consultar opções na brapi: " + (e && e.message || e) });
  }
}
