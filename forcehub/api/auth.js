// api/auth.js — Login / logout / sessão atual.
//   GET  /api/auth                          -> { ok, user|null }  (restaura sessão)
//   POST /api/auth { action:"login", user, pass } -> autentica + cookie
//   POST /api/auth { action:"logout" }       -> encerra a sessão
import { getRedis } from "./_redis";
import {
  getUsers, saveUsers, verifyPassword, hashPassword, isExpired, publicUser,
  createSession, destroySession, getSession, setSessionCookie, clearSessionCookie,
  refreshSession, EMAIL_RE, normalizeEmail, SUPERADMIN,
} from "./_auth";

const USER_RE = /^[a-z0-9._-]{3,32}$/;
const onlyDigits = (v) => String(v == null ? "" : v).replace(/\D/g, "");

// Atualiza o próprio perfil (nome, login, e-mail, telefone e senha). Qualquer
// usuário autenticado pode chamar — não exige permissão de gestão.
async function updateSelf(req, res, sess) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  const users = await getUsers();
  const me = users[sess.user];
  if (!me) return res.status(404).json({ ok: false, error: "Conta não encontrada." });

  // Nome
  if (body.name != null) {
    const name = String(body.name).trim();
    if (name.length < 2) return res.status(400).json({ ok: false, error: "Informe um nome válido." });
    me.name = name;
  }

  // E-mail (opcional, único entre as contas)
  if ("email" in body) {
    const email = normalizeEmail(body.email);
    if (email) {
      if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: "E-mail inválido." });
      const dup = Object.values(users).find(u => u && u.email === email && u.user !== sess.user);
      if (dup) return res.status(400).json({ ok: false, error: "Este e-mail já está em uso por outra conta." });
    }
    me.email = email;
  }

  // Telefone (opcional, 10-11 dígitos)
  if ("phone" in body) {
    const digits = onlyDigits(body.phone);
    if (digits && (digits.length < 10 || digits.length > 11)) {
      return res.status(400).json({ ok: false, error: "Telefone inválido (informe DDD + número)." });
    }
    me.phone = digits || null;
  }

  // Troca de senha: exige a senha atual.
  if (body.newPass) {
    if (!verifyPassword(String(body.currentPass || ""), me.pass)) {
      return res.status(400).json({ ok: false, error: "Senha atual incorreta." });
    }
    if (String(body.newPass).length < 6) {
      return res.status(400).json({ ok: false, error: "A nova senha precisa ter ao menos 6 caracteres." });
    }
    me.pass = hashPassword(String(body.newPass));
  }

  // Troca de login: rechaveia o usuário e migra os dados vinculados ao login.
  const newLogin = String(body.login || "").trim().toLowerCase();
  if (newLogin && newLogin !== sess.user) {
    if (sess.user === SUPERADMIN) return res.status(403).json({ ok: false, error: "O login do super admin não pode ser alterado." });
    if (!USER_RE.test(newLogin)) return res.status(400).json({ ok: false, error: "Login inválido (3-32 caracteres: letras, números, . _ -)." });
    if (users[newLogin]) return res.status(409).json({ ok: false, error: "Este login já está em uso." });
    const redis = getRedis();
    if (redis) {
      for (const ns of ["trades", "conselheiro"]) {
        const data = await redis.get(`forcehub:${ns}:${sess.user}`);
        if (data != null) {
          await redis.set(`forcehub:${ns}:${newLogin}`, data);
          await redis.del(`forcehub:${ns}:${sess.user}`);
        }
      }
    }
    me.user = newLogin;
    users[newLogin] = me;
    delete users[sess.user];
    sess.user = newLogin;
  }

  await saveUsers(users);
  await refreshSession(sess.token, me);
  return res.status(200).json({ ok: true, user: publicUser(me) });
}

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

      if (action === "profile") {
        const sess = await getSession(req);
        if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
        return updateSelf(req, res, sess);
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
