// api/_pt.js — Armazenamento do PERSONAL TRADER. Prefixo "_": não vira rota
// (é servido por api/personal.js). Aqui mora tudo que toca o Redis; as regras
// de negócio ficam em _pt-regras.js, puras e testáveis.
//
// CHAVES
//   forcehub:pt:alunos              índice dos alunos com ciclo (evita varrer
//                                   todos os usuários para montar a fila)
//   forcehub:pt:ciclo:<user>        ciclo + diagnóstico + versões do plano
//   forcehub:pt:envios:<user>       envios do ciclo (com operações e feedback)
//   forcehub:pt:img:<user>:<id>     prints (relatório / performance), 1 por chave
//   forcehub:pt:tags                biblioteca de tags compartilhada
//
// POR QUE CICLO E ENVIOS SÃO SEPARADOS: a fila do mentor e a lista de alunos
// precisam do ciclo de todo mundo, mas dos envios só o resumo. Separar deixa a
// leitura do painel barata e mantém cada valor longe do teto de payload do
// Upstash. Os prints ficam em chave própria pelo mesmo motivo — uma imagem
// sozinha já passa do tamanho de um ciclo inteiro.
import { getRedis } from "./_redis";
import { getUsers, saveUsers } from "./_auth";
import { analisarEnvio, quadroGerenciamento, planoVigenteEm, consolidaCiclo } from "./_pt-regras";

const K_INDEX = "forcehub:pt:alunos";
const K_TAGS = "forcehub:pt:tags";
const uid = (u) => String(u == null ? "" : u).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
export const kCiclo = (u) => "forcehub:pt:ciclo:" + uid(u);
export const kEnvios = (u) => "forcehub:pt:envios:" + uid(u);
export const kImg = (u, id) => "forcehub:pt:img:" + uid(u) + ":" + String(id).replace(/[^\w.-]/g, "");

export const MAX_IMG = 900 * 1024;   // ~900KB por print (margem sob o Upstash)
const MAX_ENVIOS = 400;
const MAX_OPS = 300;
const MAX_PLANOS = 60;
const MAX_TAGS = 120;
const MAX_SNIPPETS = 8;

export const STATUS_CICLO = new Set(["ativo", "concluido", "pausado"]);
const CATEGORIAS_TAG = new Set(["decisao", "execucao", "gestao", "emocional"]);
const POLARIDADES = new Set(["erro", "acerto"]);

export const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// ─── Saneamento (nunca confiar no shape do cliente) ──────────────────────────
const txt = (v, max) => v == null ? "" : String(v).replace(/[\x00-\x1f]/g, " ").trim().slice(0, max);
const nOrNull = (v) => { const n = Number(v); return isFinite(n) ? n : null; };
const nPos = (v) => { const n = nOrNull(v); return n != null && n > 0 ? n : null; };
const hora = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v || "").trim()); return m ? String(m[1]).padStart(2, "0") + ":" + m[2] : ""; };

export function sanitizePlano(p, versao, anterior) {
  const a = anterior || {};
  const o = p || {};
  const pick = (k, fn, padrao = null) => {
    if (k in o) { const v = fn(o[k]); return v != null ? v : padrao; }
    return a[k] != null ? a[k] : padrao;
  };
  return {
    versao,
    vigenciaInicio: isISO(o.vigenciaInicio) ? o.vigenciaInicio : hojeISO(),
    motivo: txt(o.motivo, 400) || (versao === 1 ? "Plano inicial (Sessão Zero)" : "Ajuste de gerenciamento"),
    ativo: txt(o.ativo, 16).toUpperCase() || a.ativo || "WIN",
    valorPonto: pick("valorPonto", nPos, 0.2),
    pontosAlvo: pick("pontosAlvo", nPos),
    pontosStop: pick("pontosStop", nPos),
    contratos: pick("contratos", nPos),
    ganhoDiarioAlvo: pick("ganhoDiarioAlvo", nPos),
    prejuizoDiarioLimite: pick("prejuizoDiarioLimite", nPos),
    metaMensal: pick("metaMensal", nPos),
    diasPrevistosOperando: pick("diasPrevistosOperando", nPos, 20),
    horaInicio: "horaInicio" in o ? hora(o.horaInicio) : (a.horaInicio || ""),
    horaFim: "horaFim" in o ? hora(o.horaFim) : (a.horaFim || ""),
    setups: Array.isArray(o.setups) ? [...new Set(o.setups.map(s => txt(s, 60)).filter(Boolean))].slice(0, 20)
      : (Array.isArray(a.setups) ? a.setups : []),
    // Entradas da projeção. Não estão na lista de campos do COMANDO 1, mas sem
    // elas não existe "frequência" nem "acerto alvo" para comparar com o real —
    // e a decomposição do desvio pede exatamente essas duas referências.
    operacoesDia: pick("operacoesDia", nPos, 4),
    winRateAlvo: (() => {
      const v = nOrNull("winRateAlvo" in o ? o.winRateAlvo : a.winRateAlvo);
      if (v == null) return 0.5;
      const w = v > 1 ? v / 100 : v;             // aceita 55 ou 0.55
      return w > 0 && w < 1 ? Math.round(w * 100) / 100 : 0.5;
    })(),
    criadoEm: a.criadoEm && versao === a.versao ? a.criadoEm : Date.now(),
  };
}

function sanitizeDiagnostico(d) {
  const o = d || {};
  return {
    capitalOperacional: nPos(o.capitalOperacional),
    capitalTotal: nPos(o.capitalTotal),
    outraRenda: !!o.outraRenda,
    aporteMensal: nOrNull(o.aporteMensal),
    experiencia: txt(o.experiencia, 120),
    resultadoHistorico: txt(o.resultadoHistorico, 1200),
    observacoes: txt(o.observacoes, 2000),
  };
}

export function sanitizeOperacoes(arr, planoContratos) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const o of arr) {
    if (!o || typeof o !== "object") continue;
    const resultado = nOrNull(o.resultado);
    const pontos = nOrNull(o.pontos);
    if (resultado == null && pontos == null) continue;   // linha sem resultado não é operação
    out.push({
      id: txt(o.id, 24) || ("op" + (out.length + 1)),
      hora: hora(o.hora),
      ativo: txt(o.ativo, 16).toUpperCase() || null,
      direcao: o.direcao === "VENDA" ? "VENDA" : o.direcao === "COMPRA" ? "COMPRA" : null,
      contratos: nPos(o.contratos) || nPos(planoContratos) || 1,
      precoEntrada: nOrNull(o.precoEntrada),
      precoSaida: nOrNull(o.precoSaida),
      pontos, resultado,
      setup: txt(o.setup, 60),
      ext: txt(o.ext, 64) || undefined,
    });
    if (out.length >= MAX_OPS) break;
  }
  return out;
}

function sanitizeFeedback(f, anterior) {
  const a = anterior || {};
  const o = f || {};
  const porOperacao = {};
  const src = (o.porOperacao && typeof o.porOperacao === "object") ? o.porOperacao : {};
  for (const k of Object.keys(src).slice(0, MAX_OPS)) {
    const v = src[k] || {};
    const tags = Array.isArray(v.tags) ? [...new Set(v.tags.map(t => txt(t, 60)).filter(Boolean))].slice(0, 8) : [];
    const comentario = txt(v.comentario, 1200);
    const recomendacao = txt(v.recomendacao, 600);
    if (!tags.length && !comentario && !recomendacao) continue;
    porOperacao[txt(k, 24)] = { tags, comentario, recomendacao };
  }
  return {
    geral: txt(o.geral, 4000),
    porOperacao,
    autor: o.autor === "ia" ? "ia" : "mentor",
    publicadoEm: a.publicadoEm || Date.now(),
    atualizadoEm: Date.now(),
    lido: !!a.lido,
    replica: txt(a.replica, 800),
    replicaEm: a.replicaEm || null,
  };
}

// ─── Leitura / escrita ───────────────────────────────────────────────────────
export async function lerCiclo(redis, user) {
  const c = await redis.get(kCiclo(user));
  if (!c || typeof c !== "object") return null;
  return { ...c, planos: Array.isArray(c.planos) ? c.planos : [] };
}
export async function salvarCiclo(redis, user, ciclo) {
  const c = { ...ciclo, user: uid(user), atualizadoEm: Date.now() };
  await redis.set(kCiclo(user), c);
  return c;
}
export async function lerEnvios(redis, user) {
  const e = await redis.get(kEnvios(user));
  return Array.isArray(e) ? e : (Array.isArray(e && e.envios) ? e.envios : []);
}
export async function salvarEnvios(redis, user, envios) {
  const lista = [...envios].sort((a, b) => String(a.data).localeCompare(String(b.data))).slice(-MAX_ENVIOS);
  await redis.set(kEnvios(user), lista);
  return lista;
}

export async function lerIndice(redis) {
  const i = await redis.get(K_INDEX);
  return Array.isArray(i) ? i.filter(Boolean).map(uid) : [];
}
async function indiceAdd(redis, user) {
  const atual = await lerIndice(redis);
  if (atual.includes(uid(user))) return atual;
  const novo = [...atual, uid(user)];
  await redis.set(K_INDEX, novo);
  return novo;
}
async function indiceDel(redis, user) {
  const novo = (await lerIndice(redis)).filter(u => u !== uid(user));
  await redis.set(K_INDEX, novo);
  return novo;
}

// Matricular no Personal Trader concede a permissão da página ao aluno — o
// acesso acompanha a matrícula, sem o mentor precisar lembrar de ir na tela de
// Clientes. Tirar o ciclo NÃO tira a permissão: o aluno que concluiu continua
// podendo reler o próprio histórico e o relatório final.
async function garantirPermissao(user) {
  try {
    const users = await getUsers();
    const u = users[uid(user)];
    if (!u || u.role !== "client" || !Array.isArray(u.perms)) return false;
    if (u.perms.includes("personal")) return false;
    u.perms.push("personal");
    await saveUsers(users);
    return true;
  } catch (e) { return false; }
}

// ─── Reanálise: o estado derivado é sempre recalculado ───────────────────────
// Operações, violações, resumo do dia e Quadro NUNCA são o que o cliente
// mandou: são recalculados a partir do plano vigente NA DATA de cada envio.
// Rodamos isso em todo envio e sempre que um plano muda (inclusive quando uma
// nova versão passa a valer para dias já enviados). O que o humano escreveu —
// resumo do aluno, feedback do mentor, réplica — é preservado intacto.
export function reanalisar(ciclo, envios) {
  const planos = (ciclo && ciclo.planos) || [];
  const lista = [...(envios || [])].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const acumuladoAte = [];
  let cum = 0;
  const analisados = lista.map(e => {
    const plano = planoVigenteEm(planos, e.data) || {};
    const { operacoes, violacoes, dia } = analisarEnvio(e, plano);
    cum = Math.round((cum + (dia.resultado || 0)) * 100) / 100;
    acumuladoAte.push(cum);
    return { ...e, planoVersao: plano.versao || null, operacoes, violacoes, dia };
  });
  // O Quadro precisa do acumulado do ciclo ATÉ aquele dia (linha da meta).
  return analisados.map((e, i) => ({
    ...e,
    quadro: quadroGerenciamento(planoVigenteEm(planos, e.data) || {}, e.dia, { acumulado: acumuladoAte[i], diasOperados: i + 1 }),
  }));
}

// ─── Visão completa de um aluno (usada pelo aluno e pelo mentor) ─────────────
export async function visaoAluno(redis, user) {
  const [ciclo, envios] = await Promise.all([lerCiclo(redis, user), lerEnvios(redis, user)]);
  if (!ciclo) return { ciclo: null, envios: [], plano: null, real: null };
  const lista = reanalisar(ciclo, envios);
  const plano = planoVigenteEm(ciclo.planos, hojeISO());
  const real = consolidaCiclo(lista, plano);
  return { ciclo, envios: lista, plano, real };
}

// ─── Biblioteca de tags (COMANDO 6) ──────────────────────────────────────────
// Toda tag acumula os snippets que o mentor mais usa com ela. É o que permite,
// na fase de copiloto, treinar a IA no vocabulário do próprio mentor em vez de
// texto genérico — por isso feedback nunca é salvo só como texto livre.
const TAGS_SEED = [
  { nome: "Entrou sem gatilho", categoria: "decisao", polaridade: "erro" },
  { nome: "Antecipou o rompimento", categoria: "decisao", polaridade: "erro" },
  { nome: "Operou contra a tendência", categoria: "decisao", polaridade: "erro" },
  { nome: "Setup no livro", categoria: "decisao", polaridade: "acerto" },
  { nome: "Esperou a confirmação", categoria: "decisao", polaridade: "acerto" },
  { nome: "Saiu antes do alvo", categoria: "execucao", polaridade: "erro" },
  { nome: "Tirou o stop", categoria: "execucao", polaridade: "erro" },
  { nome: "Mão pesada no clique", categoria: "execucao", polaridade: "erro" },
  { nome: "Execução limpa", categoria: "execucao", polaridade: "acerto" },
  { nome: "Deixou o alvo trabalhar", categoria: "execucao", polaridade: "acerto" },
  { nome: "Dobrou a mão", categoria: "gestao", polaridade: "erro" },
  { nome: "Operou após o stop diário", categoria: "gestao", polaridade: "erro" },
  { nome: "Risco acima do plano", categoria: "gestao", polaridade: "erro" },
  { nome: "Encerrou no alvo do dia", categoria: "gestao", polaridade: "acerto" },
  { nome: "Respeitou o stop diário", categoria: "gestao", polaridade: "acerto" },
  { nome: "Revenge trade", categoria: "emocional", polaridade: "erro" },
  { nome: "Ansiedade na entrada", categoria: "emocional", polaridade: "erro" },
  { nome: "Medo de puxar o gatilho", categoria: "emocional", polaridade: "erro" },
  { nome: "Manteve a calma no drawdown", categoria: "emocional", polaridade: "acerto" },
  { nome: "Parou quando devia parar", categoria: "emocional", polaridade: "acerto" },
];

export async function lerTags(redis) {
  const t = await redis.get(K_TAGS);
  const lista = Array.isArray(t && t.tags) ? t.tags : (Array.isArray(t) ? t : null);
  if (!lista || !lista.length) {
    const seed = TAGS_SEED.map(x => ({ ...x, snippets: [], usos: 0 }));
    await redis.set(K_TAGS, { tags: seed });
    return seed;
  }
  return lista;
}

export async function salvarTags(redis, tags) {
  await redis.set(K_TAGS, { tags: (tags || []).slice(0, MAX_TAGS) });
}

export function sanitizeTag(t) {
  const o = t || {};
  const nome = txt(o.nome, 60);
  if (!nome) return null;
  return {
    nome,
    categoria: CATEGORIAS_TAG.has(o.categoria) ? o.categoria : "decisao",
    polaridade: POLARIDADES.has(o.polaridade) ? o.polaridade : "erro",
    snippets: Array.isArray(o.snippets) ? o.snippets.map(s => ({ texto: txt(s && s.texto, 300), usos: Math.max(0, Number(s && s.usos) || 0) })).filter(s => s.texto).slice(0, MAX_SNIPPETS) : [],
    usos: Math.max(0, Number(o.usos) || 0),
  };
}

// Aprende com o feedback publicado: conta o uso de cada tag e guarda o
// comentário que o mentor escreveu junto dela como snippet sugerido. Sobe os
// mais usados e corta a cauda — a lista tem que caber na tela de análise.
export async function aprenderTags(redis, feedback) {
  try {
    const tags = await lerTags(redis);
    const porNome = new Map(tags.map(t => [t.nome, t]));
    let mudou = false;
    for (const fo of Object.values((feedback && feedback.porOperacao) || {})) {
      for (const nome of (fo.tags || [])) {
        let t = porNome.get(nome);
        if (!t) {
          if (porNome.size >= MAX_TAGS) continue;
          t = sanitizeTag({ nome }); if (!t) continue;
          porNome.set(nome, t); tags.push(t);
        }
        t.usos = (t.usos || 0) + 1; mudou = true;
        const frase = txt(fo.comentario, 300);
        if (!frase) continue;
        t.snippets = Array.isArray(t.snippets) ? t.snippets : [];
        const ja = t.snippets.find(s => s.texto === frase);
        if (ja) ja.usos++;
        else t.snippets.push({ texto: frase, usos: 1 });
        t.snippets.sort((a, b) => b.usos - a.usos);
        t.snippets = t.snippets.slice(0, MAX_SNIPPETS);
      }
    }
    if (mudou) {
      tags.sort((a, b) => (b.usos || 0) - (a.usos || 0));
      await redis.set(K_TAGS, { tags: tags.slice(0, MAX_TAGS) });
    }
  } catch (e) { /* aprender tag nunca pode derrubar a publicação do feedback */ }
}

export { sanitizeDiagnostico, sanitizeFeedback, indiceAdd, indiceDel, garantirPermissao, uid, txt, nOrNull, nPos, isISO, MAX_ENVIOS, MAX_PLANOS };
