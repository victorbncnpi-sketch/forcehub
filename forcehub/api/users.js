// api/users.js — Gestão de usuários.
//   Acesso: super admin (tudo) ou moderador (apenas clientes).
//   GET  /api/users  -> { ok, users:[...] }  (moderador só vê clientes)
//   POST /api/users { action:"create"|"update"|"delete", ... }
//
// Regras:
//   - Super admin (victor) é imutável: ninguém edita/rebaixa/remove.
//   - Moderador gerencia só clientes (dados básicos); não toca em staff nem
//     define papel/permissões.
//   - Somente o super admin define papel (cliente/moderador) e permissões.
import { getRedis } from "./_redis";
import {
  getSession, getUsers, saveUsers, hashPassword, publicUser,
  sessionCan, isStaff, SUPERADMIN, PAGE_CAPS, DEFAULT_CLIENT_PERMS,
} from "./_auth";

const USER_RE = /^[a-z0-9._-]{3,32}$/;
const sanitizePerms = (arr) =>
  Array.isArray(arr) ? [...new Set(arr.filter(p => PAGE_CAPS.includes(p)))] : [...DEFAULT_CLIENT_PERMS];

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!sessionCan(sess, "manage_clients")) return res.status(403).json({ ok: false, error: "Sem permissão para gerenciar usuários." });

  const isSuper = sess.role === "superadmin";

  try {
    const users = await getUsers();

    if (req.method === "GET") {
      let list = Object.values(users).map(publicUser);
      if (!isSuper) list = list.filter(u => u.role === "client"); // moderador só vê clientes
      list.sort((a, b) => a.user.localeCompare(b.user));
      return res.status(200).json({ ok: true, users: list, viewerRole: sess.role });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const action = body && body.action;
      const uid = String((body && body.user) || "").trim().toLowerCase();
      const target = users[uid];
      const targetIsSuper = uid === SUPERADMIN || (target && target.role === "superadmin");
      const moderatorBlocked = !isSuper && target && isStaff(target.role); // moderador não toca em staff

      if (action === "create") {
        if (!USER_RE.test(uid)) return res.status(400).json({ ok: false, error: "Usuário inválido (3-32 caracteres: letras, números, . _ -)." });
        if (users[uid]) return res.status(409).json({ ok: false, error: "Já existe um usuário com esse login." });
        if (!body.pass || String(body.pass).length < 6) return res.status(400).json({ ok: false, error: "A senha precisa ter ao menos 6 caracteres." });
        let role = body.role === "moderator" ? "moderator" : "client";
        if (!isSuper) role = "client"; // moderador só cria cliente
        const u = {
          user: uid, name: String(body.name || uid).trim(), role,
          expiry: body.expiry || null, pass: hashPassword(body.pass), createdAt: Date.now(),
        };
        if (role === "client") u.perms = isSuper ? sanitizePerms(body.perms) : [...DEFAULT_CLIENT_PERMS];
        users[uid] = u;
        await saveUsers(users);
        return res.status(200).json({ ok: true });
      }

      if (action === "update") {
        if (!target) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });
        if (targetIsSuper && !(isSuper && uid === sess.user)) return res.status(403).json({ ok: false, error: "O super admin não pode ser alterado." });
        if (moderatorBlocked) return res.status(403).json({ ok: false, error: "Você não pode editar este usuário." });

        if (body.name != null) target.name = String(body.name).trim();
        if ("expiry" in body) target.expiry = body.expiry || null;
        if (body.pass) {
          if (String(body.pass).length < 6) return res.status(400).json({ ok: false, error: "A senha precisa ter ao menos 6 caracteres." });
          target.pass = hashPassword(body.pass);
        }
        // Papel e permissões: somente super admin, e nunca sobre o super admin.
        if (isSuper && !targetIsSuper) {
          if (body.role === "moderator" || body.role === "client") target.role = body.role;
          if (target.role === "client") target.perms = sanitizePerms("perms" in body ? body.perms : target.perms);
          else delete target.perms; // staff não usa permissões granulares
        }
        await saveUsers(users);
        return res.status(200).json({ ok: true });
      }

      if (action === "delete") {
        if (uid === sess.user) return res.status(400).json({ ok: false, error: "Você não pode remover a sua própria conta." });
        if (!target) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });
        if (targetIsSuper) return res.status(403).json({ ok: false, error: "O super admin não pode ser removido." });
        if (moderatorBlocked) return res.status(403).json({ ok: false, error: "Você não pode remover este usuário." });
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
