// api/users.js — Gestão de clientes (somente admin).
//   GET  /api/users                                  -> { ok, users:[...] } (sem senhas)
//   POST /api/users { action:"create", user, name, pass, role, expiry }
//   POST /api/users { action:"update", user, name?, role?, expiry?, pass? }
//   POST /api/users { action:"delete", user }
import { getRedis } from "./_redis";
import { getSession, getUsers, saveUsers, hashPassword, publicUser } from "./_auth";

const USER_RE = /^[a-z0-9._-]{3,32}$/;

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (sess.role !== "admin") return res.status(403).json({ ok: false, error: "Apenas administradores." });

  try {
    const users = await getUsers();

    if (req.method === "GET") {
      const list = Object.values(users).map(publicUser).sort((a, b) => a.user.localeCompare(b.user));
      return res.status(200).json({ ok: true, users: list });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const action = body && body.action;
      const uid = String((body && body.user) || "").trim().toLowerCase();

      if (action === "create") {
        if (!USER_RE.test(uid)) return res.status(400).json({ ok: false, error: "Usuário inválido (3-32 caracteres: letras, números, . _ -)." });
        if (users[uid]) return res.status(409).json({ ok: false, error: "Já existe um usuário com esse login." });
        if (!body.pass || String(body.pass).length < 6) return res.status(400).json({ ok: false, error: "A senha precisa ter ao menos 6 caracteres." });
        users[uid] = {
          user: uid,
          name: String(body.name || uid).trim(),
          role: body.role === "admin" ? "admin" : "client",
          expiry: body.expiry || null,
          pass: hashPassword(body.pass),
          createdAt: Date.now(),
        };
        await saveUsers(users);
        return res.status(200).json({ ok: true });
      }

      if (action === "update") {
        const ex = users[uid];
        if (!ex) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });
        if (body.name != null) ex.name = String(body.name).trim();
        if (body.role) ex.role = body.role === "admin" ? "admin" : "client";
        if ("expiry" in body) ex.expiry = body.expiry || null;
        if (body.pass) {
          if (String(body.pass).length < 6) return res.status(400).json({ ok: false, error: "A senha precisa ter ao menos 6 caracteres." });
          ex.pass = hashPassword(body.pass);
        }
        await saveUsers(users);
        return res.status(200).json({ ok: true });
      }

      if (action === "delete") {
        if (uid === sess.user) return res.status(400).json({ ok: false, error: "Você não pode remover a sua própria conta." });
        if (!users[uid]) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });
        delete users[uid];
        await saveUsers(users);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: "Ação inválida." });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
