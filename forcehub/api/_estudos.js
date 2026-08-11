// api/_estudos.js — Séries históricas dos Estudos. Prefixo "_": não vira rota
// própria na Vercel (é servido por /api/market?kind=estudos).
//
// ── Estudo 1: amplitude diária do Mini Índice (WIN) x Ibovespa ────────────────
// Guarda, dia a dia, a máxima/mínima/fechamento de cada um. A amplitude
// (máxima − mínima) é derivada na leitura, em pontos e em % do fechamento.
//
// FONTE DO MINI ÍNDICE — duas, em ordem de preferência:
//   1) Série EMENDADA (o "WINFUT"): montada por nós em _market-data.js, juntando
//      o histórico de cada contrato e ficando, em cada dia, com o contrato que
//      era o vigente naquela data. A brapi não expõe símbolo contínuo pronto.
//      Cobre anos e, por construção, cada dia vem do contrato líquido da época.
//   2) CONTRATO vigente (WINQ26...): plano B, se a emenda falhar. Um contrato só
//      enxerga a própria vida útil, então rende ~2 meses e "reinicia" a cada
//      rolagem.
//   Confira o que a brapi está entregando com /api/market-data?probe=winfut.
//
// POR QUE ARMAZENAR mesmo assim: com a fonte 2 é indispensável (a coleta
// incremental é o que faz a série atravessar as rolagens); com a fonte 1 é
// resiliência — a série sobrevive a indisponibilidade da brapi e a limites de
// range do plano.
//
// REGRA DE ESCRITA, e por que ela depende da fonte:
//   • Série emendada: pode sobrescrever à vontade. Todo dia dela já vem do
//     contrato vigente na época, ou seja, sempre o dado bom — e regravar ainda
//     corrige dias ruins gravados por uma coleta antiga.
//   • Contrato único: um dia já gravado NUNCA é sobrescrito (exceto hoje, cuja
//     barra ainda está se formando). O contrato vigente também traz os dias em
//     que ele era o "segundo" contrato — liquidez baixa, amplitude subestimada.
//     O primeiro registro de cada dia é o bom, e é ele que fica.
//
// SEM FALLBACK PARA O IBOV: o /api/market-data usa o Ibovespa como proxy do WIN
// quando os futuros falham. Aqui isso seria destrutivo — gravaria o Ibov como
// se fosse o WIN e produziria correlação artificial de 100%. Se os futuros
// falharem, o WIN daquela varredura é simplesmente pulado.
import { fetchIbovBarsFor, fetchFuture, fetchWinEmendado } from "./_market-data";
import { getRedis } from "./_redis";

const KEY = "forcehub:estudos:amplitude";
const MAX_DIAS = 700;                       // ~2,5 anos de pregões
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

// Acrescenta as barras de um ativo ao acumulado. Devolve quantos dias INÉDITOS
// entraram. `sobrescrever` só é ligado para fontes confiáveis dia a dia (série
// contínua) — ver "REGRA DE ESCRITA" no cabeçalho.
function merge(dias, bars, campo, today, sobrescrever = false) {
  let novos = 0;
  for (const b of (bars || [])) {
    if (!b || !b.date) continue;
    if (b.date > today) continue;             // barra futura (fuso da fonte): ignora
    const bar = barOf(b);
    if (!bar) continue;
    const dia = dias[b.date] || (dias[b.date] = {});
    if (dia[campo] && b.date !== today && !sobrescrever) continue; // dia fechado já gravado
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

  // Ibovespa à vista: pede o range mais longo que a fonte aceitar. Precisa
  // acompanhar o alcance do mini índice — a série do gráfico só usa dias em que
  // os DOIS têm barra, então um Ibov curto encurtaria o estudo inteiro.
  try { novosIbov = merge(store.dias, await fetchIbovBarsFor(["2y", "1y", "3mo", "1mo"]), "ibov", today); }
  catch (e) { errors.push({ ativo: "IBOV", error: String(e && e.message || e) }); }

  // Mini índice: série emendada e, se falhar, o contrato vigente sozinho.
  // Sem proxy para o Ibovespa em hipótese alguma (ver cabeçalho).
  let win = null;
  try { const e = await fetchWinEmendado(redis); win = { bars: e.bars, src: `emendada:${e.contratos.length} contratos`, emendada: true }; }
  catch (e1) {
    try { const f = await fetchFuture("WIN"); win = { bars: f.bars, src: "contrato:" + f.symbol, emendada: false }; }
    catch (e2) { errors.push({ ativo: "WIN", error: String(e1 && e1.message || e1) + " | " + String(e2 && e2.message || e2) }); }
  }
  if (win) {
    novosWin = merge(store.dias, win.bars, "win", today, win.emendada);
    store.sources.win = win.src;
  }

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
