// api/carteira.js — Carteira recomendada + posições (compartilhada entre admin e clientes)
// GET  -> { ok, recomendacoes, posicoes }
// POST -> { recomendacoes, posicoes } salva o estado completo
//
// Observação de protótipo: a escrita não é autenticada no servidor (a auth é só
// no cliente). Em produção, proteger este POST com autenticação real.
import { getRedis } from "./_redis";

const KEY = "forcehub:carteira";

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });
  }

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
