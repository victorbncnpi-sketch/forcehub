// api/posicoes.js — Posições por usuário (cada cliente acompanha as suas).
//   GET  /api/posicoes[?user=<u>]  -> { ok, posicoes }
//   POST /api/posicoes { posicoes } -> salva as posições do próprio usuário
//
// Recomendações (api/carteira.js) são compartilhadas (o admin publica); as
// POSIÇÕES são individuais: o usuário "aceita" uma recomendação e passa a
// acompanhar o resultado dela na própria carteira.
//
// Acesso: exige a permissão "carteira" (a mesma que vê as recomendações).
//   Leitura: própria, ou qualquer uma para staff (admin/moderador).
//   Escrita: apenas as próprias posições.
import { getRedis } from "./_redis";
import { getSession, sessionCan } from "./_auth";

const keyFor = (u) => "forcehub:positions:" + u;

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!sessionCan(sess, "carteira")) return res.status(403).json({ ok: false, error: "Sem acesso à carteira." });

  const user = (req.query.user || sess.user).toString().trim().toLowerCase();
  const isStaff = sess.role === "superadmin" || sess.role === "moderator";

  try {
    if (req.method === "GET") {
      if (user !== sess.user && !isStaff) return res.status(403).json({ ok: false, error: "Acesso negado." });
      const data = await redis.get(keyFor(user));
      const posicoes = Array.isArray(data) ? data : (Array.isArray(data && data.posicoes) ? data.posicoes : []);
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
