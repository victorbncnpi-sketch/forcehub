// api/_gatilho.js — Máquina de estados das calls da Carteira (server-side).
//
//   AGUARDANDO --(preço toca a entrada)--> POSICIONADA --(alvo/stop)--> fechada
//        \--(N dias úteis sem acionar)--> EXPIRADA (fora do track record)
//
// Detecção (roda no GET de carteira/posições, com trava de ~10min por escopo,
// então funciona sem nenhum navegador aberto):
//   • Dias APÓS a publicação: barras diárias (low <= entrada <= high = tocou).
//   • Dia da publicação: só amostras ao vivo pós-publicação (cruzamento entre a
//     última amostra e a atual) — a máx/mín do dia inclui horas ANTERIORES à
//     publicação e geraria falso gatilho.
//   • Hoje (após o dia da publicação): máx/mín do dia da cotação atual.
// Fechamento automático: ao detectar alvo/stop DEPOIS de posicionada, fecha no
// preço do nível. Barra diária com alvo E stop no mesmo dia é ambígua (não dá
// para saber a ordem) -> assume STOP (conservador) e marca fechamentoAmbiguo.
// O dia do acionamento não usa barra/máx-mín (conteria momentos pré-gatilho);
// nesse dia só amostras ao vivo fecham a operação.
// Itens legados (sem campo gatilho) ficam POSICIONADOS desde a publicação.
import { getQuotes, getDailyBars, sanitizeTicker } from "./_brapi";

const THROTTLE_MS = 9.5 * 60 * 1000;

const dirOf = (x) => (x.direcao === "VENDA" || (x.direcao == null && Number(x.alvo) < Number(x.entrada))) ? "VENDA" : "COMPRA";
const pctOf = (x, saida) => { const r = ((saida - Number(x.entrada)) / Number(x.entrada)) * 100; return dirOf(x) === "VENDA" ? -r : r; };
const brt = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const parseBR = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || "")); return m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T15:00:00Z`) : null; };
const pubTsOf = (it) => it.pubTs || parseBR(it.addedAt) || parseBR(it.dataEntrada) || Date.now();

// Dias úteis decorridos contando o dia da publicação como dia 1.
function bizDaysSince(pubISO, todayISO) {
  let count = 0;
  const d = new Date(pubISO + "T12:00:00Z");
  for (let i = 0; i < 200; i++) {
    const iso = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) count++;
    if (iso >= todayISO) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

// Itens legados (criados antes do gatilho): mantêm o comportamento antigo —
// posicionados desde a publicação. Retorna true se migrou.
export function ensureGatilho(it) {
  if (it.gatilho && it.gatilho.status) return false;
  it.gatilho = { status: "POSICIONADA", triggeredAt: pubTsOf(it), legacy: true };
  return true;
}

async function processItem(it, q, redis, { now, today, kind }) {
  let changed = false;
  const g = it.gatilho;
  const e = Number(it.entrada), alvo = Number(it.alvo), stop = Number(it.stop);
  if (!e || !alvo || !stop) return false;
  const isBuy = dirOf(it) === "COMPRA";
  const pubDate = brt(pubTsOf(it));
  const qFresh = q && q.price != null && brt(q.time || now) === today;

  // ── Gatilho de entrada ──
  if (g.status === "AGUARDANDO") {
    let trig = null;
    if (today > pubDate) {
      const bars = await getDailyBars(it.ticker, redis);
      for (const b of bars) {
        if (b.date <= pubDate || b.date >= today) continue;
        if (b.low <= e && e <= b.high) { trig = { ts: Date.parse(b.date + "T15:00:00Z") }; break; }
      }
      if (!trig && qFresh && q.dayLow != null && q.dayHigh != null && q.dayLow <= e && e <= q.dayHigh) {
        trig = { ts: q.time || now };
      }
    } else if (qFresh && (q.time || 0) >= pubTsOf(it)) {
      // Dia da publicação: cruzamento entre amostras (ou toque exato).
      const last = g.lastPrice;
      if (q.price === e || (last != null && (last - e) * (q.price - e) <= 0)) trig = { ts: q.time || now };
      if (g.lastPrice !== q.price) { g.lastPrice = q.price; changed = true; }
    }
    if (trig) {
      g.status = "POSICIONADA"; g.triggeredAt = trig.ts; delete g.lastPrice;
      changed = true;
    }
  }

  // ── Alvo/stop após posicionada -> fechamento automático no nível ──
  if (g.status === "POSICIONADA" && it.status !== "ENCERRADA" && it.status !== "FECHADA") {
    const trigDate = brt(g.triggeredAt || pubTsOf(it));
    let hit = null; // { tipo: "alvo"|"stop", ts, ambiguo? }
    if (today > trigDate) {
      const bars = await getDailyBars(it.ticker, redis);
      for (const b of bars) {
        if (b.date <= trigDate || b.date >= today) continue;
        const a = isBuy ? b.high >= alvo : b.low <= alvo;
        const s = isBuy ? b.low <= stop : b.high >= stop;
        if (!a && !s) continue;
        const ts = Date.parse(b.date + "T15:00:00Z");
        hit = (a && s) ? { tipo: "stop", ts, ambiguo: true } : { tipo: a ? "alvo" : "stop", ts };
        break;
      }
      if (!hit && qFresh && q.dayHigh != null && q.dayLow != null) {
        const a = isBuy ? q.dayHigh >= alvo : q.dayLow <= alvo;
        const s = isBuy ? q.dayLow <= stop : q.dayHigh >= stop;
        if (a || s) hit = (a && s) ? { tipo: "stop", ts: q.time || now, ambiguo: true } : { tipo: a ? "alvo" : "stop", ts: q.time || now };
      }
    } else if (qFresh) {
      // Mesmo dia do acionamento: só o preço amostrado decide (sem máx/mín).
      const a = isBuy ? q.price >= alvo : q.price <= alvo;
      const s = isBuy ? q.price <= stop : q.price >= stop;
      if (a) hit = { tipo: "alvo", ts: q.time || now };
      else if (s) hit = { tipo: "stop", ts: q.time || now };
    }
    if (hit) {
      const level = hit.tipo === "alvo" ? alvo : stop;
      it.precoSaida = level;
      it.resultado = +pctOf(it, level).toFixed(2);
      it.dataSaida = new Date(hit.ts).toLocaleDateString("pt-BR");
      it.fechadoAuto = true;
      it.motivoFechamento = hit.tipo;
      if (hit.ambiguo) it.fechamentoAmbiguo = true;
      it.status = kind === "rec" ? "ENCERRADA" : "FECHADA";
      changed = true;
    }
  }
  return changed;
}

// Processa uma coleção (recomendações ou posições). Muta os itens; retorna true
// se algo mudou (para o chamador regravar). `scope` define a trava de 10 min.
export async function runGatilho({ redis, items, scope, kind }) {
  if (!redis || !Array.isArray(items) || !items.length) return false;
  let changed = false;

  const active = items.filter(i => i && i.ticker && i.status !== "ENCERRADA" && i.status !== "FECHADA" && i.status !== "EXPIRADA");
  for (const it of active) if (ensureGatilho(it)) changed = true;
  const pending = active.filter(i => i.gatilho.status === "AGUARDANDO" || i.gatilho.status === "POSICIONADA");
  if (!pending.length) return changed;

  // Trava por escopo: no máx. uma varredura a cada ~10 min (idempotente).
  const tkey = "forcehub:gat:ts:" + scope;
  try {
    const last = await redis.get(tkey);
    if (last && Date.now() - Number(last) < THROTTLE_MS) return changed;
    await redis.set(tkey, Date.now(), { ex: 3600 });
  } catch (_) {}

  const now = Date.now();
  const today = brt(now);

  // Expiração (sem rede): N dias úteis sem acionar -> EXPIRADA.
  for (const it of pending) {
    if (it.gatilho.status !== "AGUARDANDO") continue;
    const vd = Math.min(Math.max(parseInt(it.validadeDias) || 3, 1), 30);
    if (bizDaysSince(brt(pubTsOf(it)), today) > vd) {
      it.gatilho.status = "EXPIRADA";
      it.status = "EXPIRADA";
      it.expirouEm = new Date(now).toLocaleDateString("pt-BR");
      changed = true;
    }
  }

  const live = pending.filter(i => i.status !== "EXPIRADA");
  if (!live.length) return changed;

  let quotes = {};
  try { quotes = await getQuotes(live.map(i => i.ticker), redis); } catch (_) {}
  for (const it of live) {
    try { if (await processItem(it, quotes[sanitizeTicker(it.ticker)], redis, { now, today, kind })) changed = true; }
    catch (_) {}
  }
  return changed;
}
