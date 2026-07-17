// api/posicoes.js — Posições por usuário (cada cliente acompanha as suas).
//   GET  /api/posicoes[?user=<u>]            -> { ok, posicoes }   (aceitas das recomendações)
//   POST /api/posicoes { posicoes }          -> salva as próprias
//   GET  /api/posicoes?scope=own             -> { ok, posicoes }   (carteira PRÓPRIA: ações + opções)
//   POST /api/posicoes?scope=own { posicoes } -> salva a carteira própria
//
// Dois "baldes" por usuário, isolados:
//   • scope "rec"  (padrão): posições que o usuário aceitou de uma recomendação
//     do analista. Cap "carteira". Gatilho/alvo/stop automáticos (ações à vista).
//   • scope "own"          : carteira montada pelo próprio usuário, com ações e
//     OPÇÕES. Cap "portfolio". Ações são marcadas a mercado no frontend (via
//     /api/cotacoes); as OPÇÕES (dado EOD da brapi) são marcadas aqui no GET.
//
// Acesso: leitura própria (staff lê qualquer uma); escrita só das próprias.
import { getRedis } from "./_redis";
import { getSession, sessionCan } from "./_auth";
import { runGatilho } from "./_gatilho";
import { runOptionMarks } from "./_options";

const keyRec = (u) => "forcehub:positions:" + u;
const keyOwn = (u) => "forcehub:portfolio:" + u;

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  const own = req.query.scope === "own";
  const cap = own ? "portfolio" : "carteira";
  const keyFor = own ? keyOwn : keyRec;

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!sessionCan(sess, cap)) return res.status(403).json({ ok: false, error: "Sem acesso à carteira." });

  const user = (req.query.user || sess.user).toString().trim().toLowerCase();
  const isStaff = sess.role === "superadmin" || sess.role === "moderator";

  try {
    if (req.method === "GET") {
      if (user !== sess.user && !isStaff) return res.status(403).json({ ok: false, error: "Acesso negado." });
      const data = await redis.get(keyFor(user));
      const posicoes = Array.isArray(data) ? data : (Array.isArray(data && data.posicoes) ? data.posicoes : []);
      if (own) {
        // Carteira própria: marca as OPÇÕES a mercado (EOD, trava de ~30min).
        try { if (await runOptionMarks({ redis, items: posicoes, scope: "own:" + user })) await redis.set(keyFor(user), posicoes); }
        catch (e) { /* best-effort */ }
      } else {
        // Gatilho/expiração/fechamento automático, por usuário (trava de ~10min).
        try { if (await runGatilho({ redis, items: posicoes, scope: "pos:" + user, kind: "pos" })) await redis.set(keyFor(user), posicoes); }
        catch (e) { /* best-effort */ }
      }
      return res.status(200).json({ ok: true, posicoes });
    }

    if (req.method === "POST") {
      if (user !== sess.user) return res.status(403).json({ ok: false, error: "Você só pode alterar as suas próprias posições." });
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const posicoes = Array.isArray(body && body.posicoes) ? body.posicoes : [];
      await redis.set(keyFor(user), posicoes);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
