// api/_estudos.js — Séries históricas dos Estudos. Prefixo "_": não vira rota
// própria na Vercel (é servido por /api/market?kind=estudos).
//
// ── Estudo 1: amplitude diária do Mini Índice (WIN) x Ibovespa ────────────────
// Guarda, dia a dia, a máxima/mínima/fechamento de cada um. A amplitude
// (máxima − mínima) é derivada na leitura, em pontos e em % do fechamento.
//
// POR QUE ARMAZENAR, se a brapi já devolve histórico?
//   O histórico dos futuros vem do CONTRATO vigente, e contratos ROLAM (WIN
//   vence a cada 2 meses). Um contrato só enxerga a própria vida útil, então a
//   série da brapi nunca passa de ~2 meses e "reinicia" a cada rolagem. Aqui a
//   coleta é incremental: cada varredura acrescenta os dias novos ao que já
//   está gravado, e a série cresce indefinidamente atravessando as rolagens.
//
// REGRA DE ESCRITA (importante): um dia já gravado NUNCA é sobrescrito, exceto
// se for o dia de hoje (a barra ainda está se formando e é atualizada no
// fechamento). Motivo: quando o contrato rola, o novo contrato vigente também
// traz os dias em que ele ainda era o "segundo" contrato — dias de liquidez
// baixa, cuja amplitude subestima o mercado. O primeiro registro de cada dia é
// o bom (feito quando aquele contrato era o vigente), e é ele que fica.
//
// SEM FALLBACK PARA O IBOV: o /api/market-data usa o Ibovespa como proxy do WIN
// quando os futuros falham. Aqui isso seria destrutivo — gravaria o Ibov como
// se fosse o WIN e produziria correlação artificial de 100%. Se os futuros
// falharem, o WIN daquela varredura é simplesmente pulado.
import { fetchIbovBarsFor, fetchFuture } from "./_market-data";
import { getRedis } from "./_redis";

const KEY = "forcehub:estudos:amplitude";
const MAX_DIAS = 500;                       // ~2 anos de pregões
const FRESH_MS = 30 * 60 * 1000;            // recoleta no máximo a cada 30 min
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const n2 = (v) => (v == null || !isFinite(Number(v))) ? null : +Number(v).toFixed(2);

const barOf = (b) => {
  const h = n2(b.high), l = n2(b.low), c = n2(b.close);
  // Fechamento pode faltar em barra de futuro; a amplitude em pontos ainda vale.
  return (h == null || l == null || h < l) ? null : { h, l, c };
};

async function ler(redis) {
  try { const s = await redis.get(KEY); if (s && typeof s === "object") return { dias: s.dias || {}, updatedAt: s.updatedAt || 0, sources: s.sources || {} }; }
  catch (_) {}
  return { dias: {}, updatedAt: 0, sources: {} };
}

// Acrescenta as barras novas de um ativo ao acumulado. Devolve quantos dias
// entraram (dias já gravados são preservados; só "hoje" é atualizado).
function merge(dias, bars, campo, today) {
  let novos = 0;
  for (const b of (bars || [])) {
    if (!b || !b.date) continue;
    if (b.date > today) continue;             // barra futura (fuso da fonte): ignora
    const bar = barOf(b);
    if (!bar) continue;
    const dia = dias[b.date] || (dias[b.date] = {});
    if (dia[campo] && b.date !== today) continue; // já gravado num dia fechado
    if (!dia[campo]) novos++;
    dia[campo] = bar;
  }
  return novos;
}

// Coleta e grava. Chamada pelo cron (diariamente) e sob demanda pela tela.
export async function coletarAmplitude(redis, { force = false } = {}) {
  if (!redis) return { ok: false, error: "sem redis" };
  const store = await ler(redis);
  if (!force && store.updatedAt && (Date.now() - store.updatedAt) < FRESH_MS) {
    return { ok: true, cached: true, dias: Object.keys(store.dias).length };
  }
  const today = hoje();
  const errors = [];
  let novosIbov = 0, novosWin = 0;

  // Ibovespa à vista: 3 meses de uma vez (o backfill inicial já nasce com massa).
  try { novosIbov = merge(store.dias, await fetchIbovBarsFor(["3mo", "1mo"]), "ibov", today); }
  catch (e) { errors.push({ ativo: "IBOV", error: String(e && e.message || e) }); }

  // Mini índice: histórico do contrato vigente. Sem proxy (ver cabeçalho).
  try {
    const f = await fetchFuture("WIN");
    novosWin = merge(store.dias, f.bars, "win", today);
    store.sources.win = "futures:" + f.symbol;
  } catch (e) { errors.push({ ativo: "WIN", error: String(e && e.message || e) }); }

  // Poda: mantém só os MAX_DIAS mais recentes.
  const datas = Object.keys(store.dias).sort();
  if (datas.length > MAX_DIAS) for (const d of datas.slice(0, datas.length - MAX_DIAS)) delete store.dias[d];

  store.updatedAt = Date.now();
  try { await redis.set(KEY, store); } catch (e) { errors.push({ ativo: "redis", error: String(e && e.message || e) }); }
  return { ok: true, dias: Object.keys(store.dias).length, novosIbov, novosWin, errors };
}

// Série pronta para o gráfico: só os dias em que os DOIS têm barra (a comparação
// e a correlação precisam de pares), em ordem crescente de data.
export async function serieAmplitude(redis) {
  const store = await ler(redis);
  const serie = Object.keys(store.dias).sort()
    .map(d => ({ date: d, ...store.dias[d] }))
    .filter(x => x.win && x.ibov);
  return { serie, updatedAt: store.updatedAt, sources: store.sources };
}

// GET /api/market?kind=estudos[&refresh=1]
export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado." });
  let coleta = null;
  try { coleta = await coletarAmplitude(redis, { force: req.query.refresh === "1" }); }
  catch (e) { coleta = { ok: false, error: String(e && e.message || e) }; }
  const { serie, updatedAt, sources } = await serieAmplitude(redis);
  return res.status(200).json({ ok: true, serie, updatedAt, sources, coleta });
}
