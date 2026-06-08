// api/auth.js — Login / logout / sessão atual.
//   GET  /api/auth                          -> { ok, user|null }  (restaura sessão)
//   POST /api/auth { action:"login", user, pass } -> autentica + cookie
//   POST /api/auth { action:"logout" }       -> encerra a sessão
import { getRedis } from "./_redis";
import {
  getUsers, verifyPassword, isExpired, publicUser,
  createSession, destroySession, getSession, setSessionCookie, clearSessionCookie,
} from "./_auth";

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  try {
    if (req.method === "GET") {
      const sess = await getSession(req);
      return res.status(200).json({ ok: true, user: sess ? publicUser(sess) : null });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const action = (body && body.action) || "login";

      if (action === "logout") {
        await destroySession(req);
        clearSessionCookie(res);
        return res.status(200).json({ ok: true });
      }

      const u = String((body && body.user) || "").trim().toLowerCase();
      const p = String((body && body.pass) || "");
      const users = await getUsers();
      const found = users[u];
      if (!found || !verifyPassword(p, found.pass)) {
        return res.status(401).json({ ok: false, error: "Usuário ou senha incorretos." });
      }
      if (isExpired(found)) {
        return res.status(403).json({ ok: false, error: "Acesso expirado. Entre em contato com Victor Noronha." });
      }
      const token = await createSession(found);
      setSessionCookie(res, token);
      return res.status(200).json({ ok: true, user: publicUser(found) });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
