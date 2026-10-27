// api/_produtos.js — Vitrine de produtos (página "Produtos"). Prefixo "_": é
// servido por /api/users?fn=produtos (rewrite /api/produtos no vercel.json) —
// o plano Hobby da Vercel está no teto de 12 funções.
//
//   GET  /api/produtos              -> vitrine (cliente: só itens públicos; staff: tudo)
//   GET  /api/produtos?link=<token> -> UM item pelo link de compartilhamento — sem login
//   POST /api/produtos              -> staff: { acao: "salvar" | "excluir" | "novoLink", tipo: "produto" | "combo", ... }
//
// QUEM MEXE: só staff (super admin e moderadores) cria, edita e exclui. Cliente
// com o cap "produtos" só vê.
//
// ITEM INTERNO: não aparece na vitrine dos clientes, só a equipe vê. Chega a
// quem deve por um link com token aleatório — oferta para alunos específicos,
// prêmio de sorteio externo. O link abre SEM login, porque quem ganha um
// sorteio pode nem ter conta; sem o link não há como chegar ao item. "Novo
// link" troca o token e mata o anterior (link vazou, sorteio acabou).
//
// COMBO: junta 1+ produtos com preço próprio. O preço "de" é a soma dos
// produtos, calculada na LEITURA — se o preço de um produto muda, o desconto do
// combo acompanha, sem ninguém precisar reabrir o combo.
import { randomBytes } from "crypto";
import { getRedis } from "./_redis";
import { getSession, sessionCan, isStaff } from "./_auth";

const KEY = "forcehub:produtos";
export const LIMITES = { nome: 120, descricao: 2000, link: 500, produtos: 200, combos: 100 };
const PRECO_MAX = 1e6;
export const TOKEN_RE = /^[A-Za-z0-9_-]{12,40}$/;

const novoToken = () => randomBytes(12).toString("base64url");
const novoId = (p) => p + "_" + randomBytes(5).toString("hex");

// Texto: apara, tira caracteres de controle (mantém quebra de linha) e corta.
const texto = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, max);

// Preço em reais: número finito entre 0 e 1 milhão, com 2 casas. 0 = grátis.
export function precoValido(v) {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0 || n > PRECO_MAX) return null;
  return Math.round(n * 100) / 100;
}

// Link de compra: vazio é aceito (combo de sorteio pode não ter checkout);
// preenchido, só http(s) — "javascript:" num href viraria execução de script
// no navegador de quem clicar.
export function linkValido(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (s.length > LIMITES.link || !/^https?:\/\/[^\s<>"']+$/i.test(s)) return null;
  return s;
}

// Valida os campos comuns de produto e combo. { campos } ou { erro }.
function camposBase(input) {
  const nome = texto(input && input.nome, LIMITES.nome);
  if (!nome) return { erro: "Informe o nome." };
  const preco = precoValido(input && input.preco);
  if (preco == null) return { erro: "Preço inválido — use um valor entre R$ 0 e R$ 1.000.000." };
  const link = linkValido(input && input.link);
  if (link == null) return { erro: "Link de compra inválido — ele precisa começar com https://." };
  return { campos: { nome, descricao: texto(input && input.descricao, LIMITES.descricao), preco, link, interno: !!(input && input.interno) } };
}

export function validarProduto(input) {
  return camposBase(input);
}

// Combo: os campos comuns + a lista de produtos (sem repetição, só ids que
// existem, pelo menos um).
export function validarCombo(input, produtos) {
  const base = camposBase(input);
  if (base.erro) return base;
  const existe = new Set((produtos || []).map(p => p.id));
  const pedidos = Array.isArray(input && input.itens) ? input.itens.map(String) : [];
  if (pedidos.some(id => !existe.has(id))) return { erro: "O combo cita um produto que não existe mais — recarregue a página." };
  const itens = [...new Set(pedidos)];
  if (!itens.length) return { erro: "Escolha pelo menos um produto para o combo." };
  return { campos: { ...base.campos, itens } };
}

// ─── Leitura ──────────────────────────────────────────────────────────────────
export function normalizarDoc(d) {
  return {
    produtos: Array.isArray(d && d.produtos) ? d.produtos : [],
    combos: Array.isArray(d && d.combos) ? d.combos : [],
  };
}

const r2 = (n) => Math.round(n * 100) / 100;

// "De" (soma dos produtos) e desconto em % (inteiro), calculados na leitura.
export function precoDoCombo(combo, produtos) {
  const porId = new Map((produtos || []).map(p => [p.id, p]));
  const itens = (combo.itens || []).map(id => porId.get(id)).filter(Boolean);
  const precoOriginal = r2(itens.reduce((s, p) => s + (p.preco || 0), 0));
  const desconto = precoOriginal > 0 && combo.preco < precoOriginal ? Math.round((1 - combo.preco / precoOriginal) * 100) : 0;
  return { itens, precoOriginal, desconto };
}

// O que cada um recebe. Cliente: sem item interno, sem token, sem autoria.
// Um combo PÚBLICO que inclui produto interno mostra esse produto dentro do
// combo — a tela avisa a equipe disso na hora de salvar.
export function vitrine(doc, { staff = false } = {}) {
  const { produtos, combos } = normalizarDoc(doc);
  const prodOut = (p) => staff
    ? { id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, link: p.link, interno: !!p.interno, token: p.token, criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm, autor: p.autor }
    : { id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, link: p.link };
  const comboOut = (c) => {
    const { itens, precoOriginal, desconto } = precoDoCombo(c, produtos);
    const base = { id: c.id, nome: c.nome, descricao: c.descricao, preco: c.preco, link: c.link, precoOriginal, desconto,
      itens: itens.map(p => staff ? { id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, interno: !!p.interno } : { id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco }) };
    return staff ? { ...base, interno: !!c.interno, token: c.token, criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm, autor: c.autor } : base;
  };
  const visivel = (x) => staff || !x.interno;
  return { produtos: produtos.filter(visivel).map(prodOut), combos: combos.filter(visivel).map(comboOut) };
}

// Um item pelo token do link — público ou interno. Só o necessário para a
// página de oferta: nada de token, flag interno ou autoria.
export function porLink(doc, token) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  const { produtos, combos } = normalizarDoc(doc);
  const p = produtos.find(x => x.token === token);
  if (p) return { tipo: "produto", nome: p.nome, descricao: p.descricao, preco: p.preco, link: p.link };
  const c = combos.find(x => x.token === token);
  if (!c) return null;
  const { itens, precoOriginal, desconto } = precoDoCombo(c, produtos);
  return { tipo: "combo", nome: c.nome, descricao: c.descricao, preco: c.preco, link: c.link, precoOriginal, desconto,
    itens: itens.map(x => ({ nome: x.nome, descricao: x.descricao, preco: x.preco })) };
}

// ─── Escrita (pura: recebe o doc, devolve o novo doc) ────────────────────────
// { doc, id } ou { erro, status }.
export function aplicar(docAtual, body, autor, agora = Date.now()) {
  const doc = normalizarDoc(JSON.parse(JSON.stringify(docAtual || {})));
  const acao = body && body.acao;
  const tipo = body && body.tipo;
  if (tipo !== "produto" && tipo !== "combo") return { erro: "Tipo inválido.", status: 400 };
  const lista = tipo === "produto" ? doc.produtos : doc.combos;
  const idx = (id) => lista.findIndex(x => x.id === id);

  if (acao === "salvar") {
    const v = tipo === "produto" ? validarProduto(body.item) : validarCombo(body.item, doc.produtos);
    if (v.erro) return { erro: v.erro, status: 400 };
    const id = body.item && body.item.id;
    if (id) {
      const i = idx(id);
      if (i < 0) return { erro: "Item não encontrado — ele pode ter sido excluído.", status: 404 };
      lista[i] = { ...lista[i], ...v.campos, atualizadoEm: agora, autor };
      return { doc, id };
    }
    const max = tipo === "produto" ? LIMITES.produtos : LIMITES.combos;
    if (lista.length >= max) return { erro: `Limite de ${max} ${tipo === "produto" ? "produtos" : "combos"} atingido.`, status: 400 };
    const novo = { id: novoId(tipo === "produto" ? "p" : "c"), ...v.campos, token: novoToken(), criadoEm: agora, atualizadoEm: agora, autor };
    lista.push(novo);
    return { doc, id: novo.id };
  }

  const i = idx(body && body.id);
  if (i < 0) return { erro: "Item não encontrado — ele pode ter sido excluído.", status: 404 };

  if (acao === "excluir") {
    // Produto dentro de combo não sai sozinho: o combo mudaria de conteúdo e
    // de preço "de" sem ninguém decidir isso.
    if (tipo === "produto") {
      const usam = doc.combos.filter(c => (c.itens || []).includes(lista[i].id)).map(c => c.nome);
      if (usam.length) return { erro: `Este produto está no combo ${usam.map(n => "“" + n + "”").join(", ")}. Tire-o do combo antes de excluir.`, status: 409 };
    }
    lista.splice(i, 1);
    return { doc, id: body.id };
  }

  if (acao === "novoLink") {
    lista[i] = { ...lista[i], token: novoToken(), atualizadoEm: agora, autor };
    return { doc, id: body.id };
  }

  return { erro: "Ação inválida.", status: 400 };
}

// ─── Rota ─────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado." });
  const q = req.query || {};

  try {
    // Link de compartilhamento: público, sem sessão.
    if (req.method === "GET" && q.link != null) {
      const item = porLink(await redis.get(KEY), String(q.link));
      if (!item) return res.status(404).json({ ok: false, error: "Oferta não encontrada — o link pode ter sido trocado ou o item removido." });
      return res.status(200).json({ ok: true, item });
    }

    const sess = await getSession(req);
    if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
    if (!sessionCan(sess, "produtos")) return res.status(403).json({ ok: false, error: "Sem acesso aos produtos." });
    const staff = isStaff(sess.role);

    if (req.method === "GET") {
      return res.status(200).json({ ok: true, staff, ...vitrine(await redis.get(KEY), { staff }) });
    }

    if (req.method === "POST") {
      if (!staff) return res.status(403).json({ ok: false, error: "Apenas o Victor e os moderadores cadastram produtos." });
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const r = aplicar(await redis.get(KEY), body, sess.name || sess.user);
      if (r.erro) return res.status(r.status || 400).json({ ok: false, error: r.erro });
      await redis.set(KEY, r.doc);
      return res.status(200).json({ ok: true, staff, id: r.id, ...vitrine(r.doc, { staff }) });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
