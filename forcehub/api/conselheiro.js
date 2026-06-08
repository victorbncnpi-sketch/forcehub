// api/conselheiro.js — Perfil e diário do Conselheiro, por usuário (cross-device)
// GET  ?user=victor          -> { ok, perfil, diario }
// POST ?user=victor { perfil?, diario? } -> merge e salva
import { getRedis } from "./_redis";
import { getSession, sessionCan } from "./_auth";

const keyFor = (user) => "forcehub:conselheiro:" + user;

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });
  }

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!sessionCan(sess, "conselheiro")) return res.status(403).json({ ok: false, error: "Sem acesso ao Conselheiro." });

  const user = (req.query.user || "").toString().trim().toLowerCase();
  if (!user) {
    return res.status(400).json({ ok: false, error: "Parâmetro 'user' é obrigatório." });
  }
  // Cliente só acessa o próprio diário; admin pode acessar qualquer um.
  if (sess.role !== "admin" && user !== sess.user) {
    return res.status(403).json({ ok: false, error: "Acesso negado." });
  }

  try {
    if (req.method === "GET") {
      const data = (await redis.get(keyFor(user))) || {};
      return res.status(200).json({
        ok: true,
        perfil: data.perfil || null,
        diario: Array.isArray(data.diario) ? data.diario : [],
      });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const existing = (await redis.get(keyFor(user))) || {};
      const next = { ...existing };
      if (body && "perfil" in body) next.perfil = body.perfil;
      if (body && "diario" in body) next.diario = Array.isArray(body.diario) ? body.diario : (existing.diario || []);
      await redis.set(keyFor(user), next);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
