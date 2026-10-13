// api/_fechamento.js — "Fechamento do dia": o resumo do pregão que o Panorama
// abre num modal. Prefixo "_": é servido por /api/market?kind=fechamento (rewrite
// /api/fechamento no vercel.json) — o plano Hobby está no teto de 12 funções.
//   GET  /api/fechamento         -> o último fechamento; gera o do dia se faltar
//   GET  /api/fechamento?leve=1  -> só lê (não gera) — usado pelo botão
//   POST /api/fechamento         -> refaz agora (staff)
//
// O QUE ENTRA:
//   • IBOV, WIN e WDO — fechamento, máxima, mínima e variação do pregão;
//   • as 3 maiores altas e as 3 maiores baixas do dia entre as 100 maiores
//     empresas da B3 por valor de mercado (sem esse recorte o topo da lista é
//     sempre penny stock que andou 30% com meia dúzia de negócios);
//   • o resumo das notícias do dia e a leitura delas contra o movimento dos 3
//     ativos — pela IA (Gemini com busca), alimentada com os números reais.
//
// QUANDO É GERADO: uma vez por pregão, gravado no Redis e compartilhado por
// todos. Quem gera é a cron das 19h30 (_cron.js) ou, se ela ainda não rodou, o
// primeiro usuário que abrir o modal depois das 18h30. Durante o pregão o modal
// mostra o fechamento anterior: o do dia ainda não existe.
//
// INCOMPLETO: os futuros da brapi são EOD (processados à noite) e às vezes o
// pregão de hoje ainda não está lá na hora da geração. O fechamento é gravado
// assim mesmo, marcado incompleto, e refeito — no máximo a cada 15 min, até
// MAX_TENT vezes. A análise é refeita junto, porque ela cita os números.
import { getRedis } from "./_redis";
import { getSession, sessionCan, isStaff } from "./_auth";
import { getJson, findBarsArray, mapBars, fetchFuture } from "./_market-data";
import { geminiText, extractJSON } from "./_ai";
import { gnews, lerFeeds } from "./_rss";

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
export const ATIVOS = ["IBOV", "WIN", "WDO"];
const KEY = (data) => "forcehub:fechamento:" + data;
const KEY_ULT = "forcehub:fechamento:ultimo";
const KEY_LOCK = "forcehub:fechamento:lock";
const KEY_TENT = "forcehub:fechamento:tentativa";
const GUARDA_S = 60 * 60 * 24 * 120;   // cada fechamento fica 120 dias
const LOCK_MS = 2 * 60 * 1000;         // uma geração leva ~20s; 2 min cobre folga
const ESPERA_MS = 15 * 60 * 1000;      // intervalo entre tentativas automáticas
export const MAX_TENT = 8;             // ~2h tentando completar o dia
const UNIVERSO = 100;                  // recorte das maiores empresas

// ─── Relógio do pregão (horário de Brasília) ─────────────────────────────────
// WIN/WDO abrem às 9h; o WDO é o último a encerrar, às 18h30. Entre um e outro
// o dia ainda está em aberto.
const ABRE_MIN = 9 * 60;
const FECHA_MIN = 18 * 60 + 30;

export function diaUtilAnterior(iso) {
  const d = new Date(iso + "T12:00:00Z");
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

// { hoje, emPregao, alvo } — `alvo` é o pregão cujo fechamento já deveria
// existir: hoje depois das 18h30, senão o dia útil anterior. Feriado não entra
// na conta (não há calendário da B3 aqui): quem descobre o pregão de verdade é
// a data da cotação do Ibovespa, na geração.
export function faseDoPregao(agora = new Date()) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(agora)) p[x.type] = x.value;
  const hoje = `${p.year}-${p.month}-${p.day}`;
  const min = (+p.hour) * 60 + (+p.minute);
  const dow = new Date(hoje + "T12:00:00Z").getUTCDay();
  const util = dow >= 1 && dow <= 5;
  return {
    hoje,
    emPregao: util && min >= ABRE_MIN && min < FECHA_MIN,
    alvo: util && min >= FECHA_MIN ? hoje : diaUtilAnterior(hoje),
  };
}

// Data (AAAA-MM-DD) em Brasília de um instante: ISO, ms ou segundos Unix.
export function dataBRT(t) {
  if (t == null || t === "") return null;
  let ms = typeof t === "number" ? t : (/^\d+$/.test(String(t)) ? Number(t) : Date.parse(t));
  if (!isFinite(ms)) return null;
  if (ms < 1e12) ms *= 1000;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

const n2 = (v) => (v == null || v === "" || !isFinite(Number(v))) ? null : +Number(v).toFixed(2);

// ─── Cotações ─────────────────────────────────────────────────────────────────
// Resume um ativo pelas barras diárias: a barra do pregão (ou a última antes
// dele — carrega a própria data, para a tela avisar) e a variação contra a
// barra anterior.
export function resumoDeBarras(bars, pregao) {
  const ok = (bars || [])
    .filter(b => b && b.date && (!pregao || b.date <= pregao) && b.high != null && b.low != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!ok.length) return null;
  const b = ok[ok.length - 1], ant = ok[ok.length - 2];
  const fech = n2(b.close), prev = ant ? n2(ant.close) : null;
  return {
    data: b.date, fech, max: n2(b.high), min: n2(b.low),
    varPct: fech != null && prev ? +((fech - prev) / prev * 100).toFixed(2) : null,
  };
}

// Ibovespa pela cotação da brapi (que já traz máx/mín/variação do dia); as
// barras diárias são o plano B. É a data DESTA cotação que define o pregão.
export function ibovDaCotacao(q, bars) {
  const data = q ? dataBRT(q.regularMarketTime) : null;
  const fech = q ? n2(q.regularMarketPrice) : null;
  if (data && fech != null && q.regularMarketDayHigh != null && q.regularMarketDayLow != null) {
    return { data, fech, max: n2(q.regularMarketDayHigh), min: n2(q.regularMarketDayLow), varPct: n2(q.regularMarketChangePercent) };
  }
  return resumoDeBarras(bars, null);
}

async function cotacaoIbov() {
  if (!BRAPI_TOKEN) throw new Error("BRAPI_TOKEN ausente");
  const j = await getJson(`https://brapi.dev/api/quote/%5EBVSP?range=5d&interval=1d&token=${BRAPI_TOKEN}`, 2);
  const q = j && Array.isArray(j.results) ? j.results[0] : null;
  return ibovDaCotacao(q, mapBars(findBarsArray(q && q.historicalDataPrice) || []));
}

// WIN/WDO: barras do contrato vigente (a mesma fonte do Panorama). Sem proxy:
// mostrar o Ibovespa no lugar do WIN seria pior que admitir que faltou.
async function cotacaoFuturo(asset, pregao) {
  const f = await fetchFuture(asset);
  const r = resumoDeBarras(f.bars, pregao);
  return r ? { ...r, contrato: f.symbol } : null;
}

// ─── Destaques do dia ─────────────────────────────────────────────────────────
async function listaAcoes() {
  if (!BRAPI_TOKEN) throw new Error("BRAPI_TOKEN ausente");
  // Valor de mercado primeiro; volume é o plano B se a ordenação falhar.
  for (const criterio of ["market_cap_basic", "volume"]) {
    try {
      const j = await getJson(`https://brapi.dev/api/quote/list?type=stock&sortBy=${criterio}&sortOrder=desc&limit=${UNIVERSO}&token=${BRAPI_TOKEN}`, 2);
      const stocks = j && Array.isArray(j.stocks) ? j.stocks : [];
      if (stocks.length >= 6) return { stocks, criterio };
    } catch (_) { /* tenta o próximo critério */ }
  }
  throw new Error("lista de ações indisponível");
}

// As `n` maiores altas e baixas. Fica de fora: ação abaixo de R$ 1, sem
// negócio no dia, fracionário e ticker repetido. Uma ação nunca aparece nas
// duas listas (universo pequeno num dia de pouca variação).
export function escolherDestaques(stocks, n = 3) {
  const vistos = new Set();
  const ok = [];
  // Number(null) é 0: sem esta guarda, ação sem variação entrava como 0%.
  const num = (v) => (v == null || v === "") ? NaN : Number(v);
  for (const s of stocks || []) {
    const ticker = String((s && s.stock) || "").toUpperCase().trim();
    const varPct = num(s && s.change), preco = num(s && s.close);
    if (!ticker || vistos.has(ticker) || /\dF$/.test(ticker)) continue;
    if (!isFinite(varPct) || !isFinite(preco) || preco < 1) continue;
    if (s.volume != null && !(Number(s.volume) > 0)) continue;
    vistos.add(ticker);
    ok.push({ ticker, nome: String(s.name || "").trim(), preco: +preco.toFixed(2), varPct: +varPct.toFixed(2) });
  }
  const ord = ok.sort((a, b) => b.varPct - a.varPct);
  const altas = ord.slice(0, n);
  const baixas = ord.slice().reverse().filter(x => !altas.includes(x)).slice(0, n);
  return { altas, baixas };
}

// ─── Manchetes do pregão ──────────────────────────────────────────────────────
const FEEDS = [
  { url: gnews("\"Ibovespa fecha\" OR \"fechamento do Ibovespa\" OR \"Ibovespa hoje\"", "2d"), source: "" },
  { url: gnews("\"dólar fecha\" OR \"dólar hoje\" OR \"juros futuros\"", "2d"), source: "" },
  { url: gnews("Copom OR Fed OR \"bolsas de Nova York\" OR petróleo OR \"mercado financeiro\"", "2d"), source: "" },
];
async function manchetesDoPregao(pregao) {
  return lerFeeds(FEEDS, { max: 10, filtro: h => dataBRT(h.ts) === pregao });
}

// ─── Análise da IA ────────────────────────────────────────────────────────────
const NOME = { IBOV: "Ibovespa", WIN: "Mini Índice", WDO: "Mini Dólar" };
const fmtNum = (v, casas) => v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const fmtPct = (v) => v == null ? "variação indisponível" : (v > 0 ? "+" : "") + fmtNum(v, 2) + "%";
const casasDe = (k) => k === "WDO" ? 1 : 0;
const ddmmaaaa = (iso) => iso.split("-").reverse().join("/");

export function montarPrompt({ pregao, ativos, destaques, manchetes }) {
  const L = [`Pregão de ${ddmmaaaa(pregao)} na B3. Escreva o FECHAMENTO DO DIA.`, "", "NÚMEROS DO PREGÃO (use exatamente estes — não invente outros):"];
  for (const k of ATIVOS) {
    const a = ativos[k];
    const nome = NOME[k] + (a && a.contrato ? " (" + a.contrato + ")" : "");
    if (!a || a.fech == null) { L.push(`- ${nome}: dado indisponível`); continue; }
    const c = casasDe(k);
    L.push(`- ${nome}: fechou em ${fmtNum(a.fech, c)} (${fmtPct(a.varPct)}), máxima ${fmtNum(a.max, c)}, mínima ${fmtNum(a.min, c)}` + (a.data !== pregao ? ` — ATENÇÃO: dado de ${ddmmaaaa(a.data)}, o do pregão ainda não saiu` : ""));
  }
  if (destaques && destaques.altas.length) {
    const lin = (xs) => xs.map(x => `${x.ticker} ${fmtPct(x.varPct)}`).join("; ");
    L.push("", "MAIORES ALTAS: " + lin(destaques.altas), "MAIORES BAIXAS: " + lin(destaques.baixas));
  }
  if (manchetes && manchetes.length) {
    L.push("", "MANCHETES DO DIA:");
    for (const h of manchetes.slice(0, 10)) L.push("- " + h.title + (h.source ? " (" + h.source + ")" : ""));
  }
  L.push("",
    "Use a busca na web para levantar as notícias que moveram ESTE pregão (Brasil e exterior: juros, Copom, Fed, fiscal, dólar, commodities, balanços) e explique como elas se refletiram no Ibovespa, no mini índice e no mini dólar.",
    "Responda SOMENTE JSON válido (sem markdown), neste formato:",
    '{"resumo":"...","noticias":[{"titulo":"...","texto":"...","efeito":"..."}],"ativos":{"IBOV":"...","WIN":"...","WDO":"..."}}',
    "Regras: resumo = 3 a 5 frases sobre o dia; noticias = 4 a 6 itens (texto = o fato em 1-2 frases; efeito = como mexeu com IBOV/WIN/WDO); ativos = 1 a 3 frases por ativo explicando o movimento do dia à luz das notícias. Português, texto puro, frases completas. Não cite preços nem variações que não estejam acima.");
  return L.join("\n");
}

const SISTEMA = "Você é um estrategista de mercado da B3 (CNPI) que escreve o fechamento do dia para traders de mini índice e mini dólar. " +
  "É objetivo, técnico e factual: relaciona cada notícia ao movimento dos ativos, não faz recomendação de compra ou venda e não inventa números.";

// Valida e apara o que a IA devolveu. null = nada aproveitável.
export function normalizarAnalise(v) {
  if (!v || typeof v !== "object") return null;
  const s = (x, max) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, max);
  const resumo = s(v.resumo, 1500);
  const noticias = (Array.isArray(v.noticias) ? v.noticias : [])
    .map(x => ({ titulo: s(x && x.titulo, 180), texto: s(x && x.texto, 600), efeito: s(x && x.efeito, 500) }))
    .filter(x => x.titulo)
    .slice(0, 6);
  const at = v.ativos && typeof v.ativos === "object" ? v.ativos : {};
  const ativos = {};
  for (const k of ATIVOS) { const t = s(at[k], 700); if (t) ativos[k] = t; }
  if (!resumo && !noticias.length) return null;
  return { resumo, noticias, ativos };
}

async function analisarComIA(dados) {
  const text = await geminiText({ system: SISTEMA, messages: [{ role: "user", content: montarPrompt(dados) }], search: true, maxTokens: 2600, temperature: 0.3 });
  const a = normalizarAnalise((extractJSON(text, ['"resumo"', '"noticias"']) || {}).value);
  if (!a) throw new Error("a IA não devolveu o fechamento no formato esperado");
  return a;
}

const FONTES = { ibov: cotacaoIbov, futuro: cotacaoFuturo, lista: listaAcoes, manchetes: manchetesDoPregao, ia: analisarComIA };

// ─── Geração e leitura ────────────────────────────────────────────────────────
async function lerUltimo(redis) {
  const data = await redis.get(KEY_ULT);
  return data ? await redis.get(KEY(data)) : null;
}

export function estaCompleto(f) {
  return !!f && ATIVOS.every(k => f.ativos && f.ativos[k] && f.ativos[k].data === f.data && f.ativos[k].fech != null)
    && !!(f.destaques && f.destaques.altas && f.destaques.altas.length) && !!f.analise;
}

// Monta (ou completa) o fechamento do pregão corrente. `fontes` existe para os
// testes trocarem a rede por dados fixos.
export async function gerarFechamento(redis, { forcar = false, fontes = FONTES } = {}) {
  const ibov = await fontes.ibov();
  if (!ibov || !ibov.data) throw new Error("Cotação do Ibovespa indisponível agora — tente em instantes.");
  const pregao = ibov.data;
  const antes = await redis.get(KEY(pregao));
  const marcaUltimo = async () => { const u = await redis.get(KEY_ULT); if (!u || pregao > u) await redis.set(KEY_ULT, pregao); };
  if (antes && !forcar && (antes.completo || (antes.tentativas || 0) >= MAX_TENT)) { await marcaUltimo(); return antes; }

  const [win, wdo, lista, heads] = await Promise.allSettled([
    fontes.futuro("WIN", pregao), fontes.futuro("WDO", pregao), fontes.lista(), fontes.manchetes(pregao),
  ]);
  const val = (r) => r.status === "fulfilled" ? r.value : null;
  const erros = [];
  const pega = (r, nome) => { if (r.status === "rejected") erros.push(nome + ": " + ((r.reason && r.reason.message) || r.reason)); return val(r); };

  // O que falhou agora mas existia na tentativa anterior é mantido: uma
  // instabilidade da fonte não pode apagar o que o usuário já via.
  const velho = (antes && antes.ativos) || {};
  const ativos = { IBOV: ibov, WIN: pega(win, "WIN") || velho.WIN || null, WDO: pega(wdo, "WDO") || velho.WDO || null };
  const lst = pega(lista, "destaques");
  const destaques = lst ? { ...escolherDestaques(lst.stocks), criterio: lst.criterio } : ((antes && antes.destaques) || null);
  const manchetes = (pega(heads, "manchetes") || []).slice(0, 6).map(h => ({ title: h.title, url: h.url, source: h.source }));

  let analise = null;
  try { analise = await fontes.ia({ pregao, ativos, destaques, manchetes }); }
  catch (e) { erros.push("ia: " + ((e && e.message) || e)); }
  const fech = {
    data: pregao, ativos, destaques,
    manchetes: manchetes.length ? manchetes : ((antes && antes.manchetes) || []),
    analise: analise || (antes && antes.analise) || null,
    tentativas: ((antes && antes.tentativas) || 0) + 1,
    generatedAt: Date.now(), erros,
  };
  // Completo só se a análise desta rodada saiu: a herdada cita números velhos.
  fech.completo = estaCompleto(fech) && !!analise;
  await redis.set(KEY(pregao), fech, { ex: GUARDA_S });
  await marcaUltimo();
  return fech;
}

// Devolve o fechamento mais recente e, quando é hora e ainda falta, gera o do
// dia antes. { fechamento, fase, gerando?, erro? }
export async function obterFechamento(redis, { forcar = false, agora = new Date(), fontes } = {}) {
  const fase = faseDoPregao(agora);
  const atual = await lerUltimo(redis);
  const base = { fechamento: atual, fase };
  const t = agora.getTime();
  if (!forcar) {
    if (fase.emPregao) return base;
    if (atual && atual.data >= fase.alvo && (atual.completo || (atual.tentativas || 0) >= MAX_TENT)) return base;
    const ult = Number(await redis.get(KEY_TENT)) || 0;
    if (ult && t - ult < ESPERA_MS) return base;
  }
  const lock = Number(await redis.get(KEY_LOCK)) || 0;
  if (lock && t - lock < LOCK_MS) return { ...base, gerando: true };
  await redis.set(KEY_LOCK, t, { ex: 300 });
  await redis.set(KEY_TENT, t, { ex: 3600 });
  try {
    const novo = await gerarFechamento(redis, { forcar, fontes });
    return { fechamento: novo || atual, fase };
  } catch (e) {
    return { ...base, erro: (e && e.message) || String(e) };
  } finally {
    try { await redis.del(KEY_LOCK); } catch (_) {}
  }
}

// Só lê — o botão do Panorama mostra o resumo sem disparar geração.
export async function lerFechamento(redis, { agora = new Date() } = {}) {
  return { fechamento: await lerUltimo(redis), fase: faseDoPregao(agora) };
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado." });
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!sessionCan(sess, "panorama")) return res.status(403).json({ ok: false, error: "Sem acesso ao Panorama." });
  try {
    if (req.method === "POST") {
      if (!isStaff(sess.role)) return res.status(403).json({ ok: false, error: "Apenas moderadores ou super admin podem refazer o fechamento." });
      return res.status(200).json({ ok: true, ...(await obterFechamento(redis, { forcar: true })) });
    }
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método não permitido" });
    const r = req.query && req.query.leve === "1" ? await lerFechamento(redis) : await obterFechamento(redis);
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
