// api/carteira.js — Carteira recomendada + posições (compartilhada entre admin e clientes)
// GET  -> { ok, recomendacoes, posicoes }
// POST -> { recomendacoes, posicoes } salva o estado completo
//
// Imagens das recomendações (prints de gráfico) ficam em chaves próprias para
// não estourar o limite de ~1MB por requisição do Upstash:
//   GET  /api/carteira?img=<id>          -> { ok, image }
//   POST /api/carteira?img=<id> { data } -> grava (data=null remove)
//
// Acesso: GET exige a permissão "carteira"; POST exige "carteira_write".
import { getRedis } from "./_redis";
import { getSession, sessionCan } from "./_auth";

const KEY = "forcehub:carteira";
const imgKey = (id) => "forcehub:carteira:img:" + String(id).replace(/[^\w.-]/g, "");
const MAX_IMG = 900 * 1024; // ~900KB por imagem (margem sob o limite do Upstash)

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });
  }

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });

  const imgId = req.query.img != null ? String(req.query.img) : null;

  try {
    // ── Imagem de uma recomendação ──
    if (imgId) {
      if (req.method === "GET") {
        if (!sessionCan(sess, "carteira")) return res.status(403).json({ ok: false, error: "Sem acesso à carteira." });
        const image = await redis.get(imgKey(imgId));
        return res.status(200).json({ ok: true, image: image || null });
      }
      if (req.method === "POST") {
        if (!sessionCan(sess, "carteira_write")) return res.status(403).json({ ok: false, error: "Sem permissão para editar a carteira." });
        let body = req.body;
        if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
        const data = body && body.data;
        if (data == null || data === "") { await redis.del(imgKey(imgId)); return res.status(200).json({ ok: true }); }
        if (typeof data !== "string" || data.length > MAX_IMG) return res.status(413).json({ ok: false, error: "Imagem muito grande." });
        await redis.set(imgKey(imgId), data);
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ ok: false, error: "Método não permitido" });
    }

    if (req.method === "GET") {
      if (!sessionCan(sess, "carteira")) return res.status(403).json({ ok: false, error: "Sem acesso à carteira." });
      const data = (await redis.get(KEY)) || {};
      return res.status(200).json({
        ok: true,
        recomendacoes: Array.isArray(data.recomendacoes) ? data.recomendacoes : [],
        posicoes: Array.isArray(data.posicoes) ? data.posicoes : [],
      });
    }

    if (req.method === "POST") {
      if (!sessionCan(sess, "carteira_write")) return res.status(403).json({ ok: false, error: "Sem permissão para editar a carteira." });
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

