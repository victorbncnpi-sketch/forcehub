// api/_cron.js — Varredura periódica (acionada pela cron da Vercel via
// /api/posicoes?cron=1). Prefixo "_": não vira rota própria (economiza função).
//
// Percorre, sem depender de ninguém com a tela aberta:
//   1) as recomendações compartilhadas  -> gatilho/expiração/encerramento;
//   2) as posições aceitas de cada usuário -> idem;
//   3) a carteira própria de cada usuário  -> marcação EOD das opções +
//      encerramento automático por alvo/stop (ações e opções).
//
// A detecção reaproveita as MESMAS funções usadas no GET das telas, cada uma com
// sua trava por escopo — então cron e navegação cooperam (nada roda em dobro).
import { runGatilho } from "./_gatilho";
import { runOptionMarks, runOwnAutoClose } from "./_options";
import { getUsers } from "./_auth";

const CART_KEY = "forcehub:carteira";
const keyRec = (u) => "forcehub:positions:" + u;
const keyOwn = (u) => "forcehub:portfolio:" + u;
const asArr = (d) => Array.isArray(d) ? d : (Array.isArray(d && d.posicoes) ? d.posicoes : []);

export async function cronSweep(redis) {
  const out = { recs: false, users: 0, pos: 0, own: 0, errors: [] };
  if (!redis) return out;

  // 1) Recomendações compartilhadas (carteira do analista).
  try {
    const cart = (await redis.get(CART_KEY)) || {};
    const recs = Array.isArray(cart.recomendacoes) ? cart.recomendacoes : [];
    if (recs.length && await runGatilho({ redis, items: recs, scope: "carteira", kind: "rec" })) {
      await redis.set(CART_KEY, { ...cart, recomendacoes: recs });
      out.recs = true;
    }
  } catch (e) { out.errors.push("recs:" + (e && e.message || e)); }

  // 2/3) Por usuário: posições aceitas + carteira própria.
  let users = {};
  try { users = await getUsers(); } catch (e) { out.errors.push("users:" + (e && e.message || e)); }
  for (const u of Object.keys(users)) {
    out.users++;
    // Posições aceitas das recomendações.
    try {
      const pos = asArr(await redis.get(keyRec(u)));
      if (pos.length && await runGatilho({ redis, items: pos, scope: "pos:" + u, kind: "pos" })) {
        await redis.set(keyRec(u), pos);
        out.pos++;
      }
    } catch (e) { out.errors.push("pos:" + u); }
    // Carteira própria (ações + opções).
    try {
      const own = asArr(await redis.get(keyOwn(u)));
      if (own.length) {
        let ch = false;
        if (await runOptionMarks({ redis, items: own, scope: "own:" + u })) ch = true;
        if (await runOwnAutoClose({ redis, items: own, scope: "own:" + u })) ch = true;
        if (ch) { await redis.set(keyOwn(u), own); out.own++; }
      }
    } catch (e) { out.errors.push("own:" + u); }
  }

  return out;
}
