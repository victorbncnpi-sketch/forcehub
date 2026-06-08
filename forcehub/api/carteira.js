// api/carteira.js — Carteira recomendada + posições (compartilhada entre admin e clientes)
// GET  -> { ok, recomendacoes, posicoes }
// POST -> { recomendacoes, posicoes } salva o estado completo
//
// Acesso: GET exige sessão válida; POST (edição da carteira) exige admin.
import { getRedis } from "./_redis";
import { getSession } from "./_auth";

const KEY = "forcehub:carteira";

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });
  }

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });

  try {
    if (req.method === "GET") {
      const data = (await redis.get(KEY)) || {};
      return res.status(200).json({
        ok: true,
        recomendacoes: Array.isArray(data.recomendacoes) ? data.recomendacoes : [],
        posicoes: Array.isArray(data.posicoes) ? data.posicoes : [],
      });
    }

    if (req.method === "POST") {
      if (sess.role !== "admin") return res.status(403).json({ ok: false, error: "Apenas administradores podem editar a carteira." });
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const recomendacoes = Array.isArray(body?.recomendacoes) ? body.recomendacoes : [];
      const posicoes = Array.isArray(body?.posicoes) ? body.posicoes : [];
      await redis.set(KEY, { recomendacoes, posicoes });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
