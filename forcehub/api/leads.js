// api/leads.js — Pré-cadastros ("Mostrar Interesse").
//   POST /api/leads { action:"submit", nome, email, telefone }   (PÚBLICO)
//   GET  /api/leads                                  -> staff: lista de interessados
//   POST /api/leads { action:"convert", id, user?, role?, expiry? }
//        -> staff: cria o usuário ativo com senha gerada e devolve as credenciais
//   POST /api/leads { action:"delete", id }          -> staff: descarta um interessado
//
// Os leads ficam numa lista única (forcehub:leads); converter ou descartar
// remove o lead da lista. As credenciais geradas só voltam para o staff (nunca
// no caminho público), para que Victor/moderadores enviem ao novo cliente.
import { getRedis } from "./_redis";
import {
  getSession, sessionCan, getUsers, saveUsers, hashPassword, generatePassword,
  EMAIL_RE, normalizeEmail, DEFAULT_CLIENT_PERMS,
} from "./_auth";

const LEADS_KEY = "forcehub:leads";
const MAX_LEADS = 500;
const USER_RE = /^[a-z0-9._-]{3,32}$/;

const clean = (v, max) => String(v == null ? "" : v).replace(/[\x00-\x1f]/g, "").trim().slice(0, max);
const onlyDigits = (v) => String(v == null ? "" : v).replace(/\D/g, "");

async function getLeads(redis) {
  const data = await redis.get(LEADS_KEY);
  return Array.isArray(data) ? data : [];
}

// Sugere um login (a-z 0-9 . _ -) a partir do nome (ou e-mail), garantindo único.
function slugLogin(nome, email) {
  let base = clean(nome, 60).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  base = base.replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  if (base.length < 3 && email) base = String(email).split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, ".");
  base = base.replace(/[^a-z0-9._-]/g, "").slice(0, 32);
  return base.length >= 3 ? base : "cliente";
}
function uniqueLogin(base, users) {
  if (!users[base]) return base;
  for (let i = 2; i < 9999; i++) { const c = base.slice(0, 28) + "." + i; if (!users[c]) return c; }
  return base + "." + Date.now().toString(36);
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const action = (body && body.action) || (req.method === "POST" ? "submit" : "list");

    // ─── PÚBLICO: registrar interesse ─────────────────────────────────────────
    if (req.method === "POST" && action === "submit") {
      const nome = clean(body && body.nome, 80);
      const email = normalizeEmail(body && body.email);
      const telefone = onlyDigits(body && body.telefone);
      if (nome.length < 2) return res.status(400).json({ ok: false, error: "Informe seu nome." });
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: "Informe um e-mail válido." });
      if (telefone.length < 10 || telefone.length > 11) return res.status(400).json({ ok: false, error: "Informe um telefone válido com DDD." });

      // Throttle anti-spam por IP (5 envios / 10 min).
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
      const tkey = "forcehub:leadthrottle:" + ip;
      const n = await redis.incr(tkey);
      if (n === 1) await redis.expire(tkey, 600);
      if (n > 5) return res.status(429).json({ ok: false, error: "Muitas solicitações. Tente novamente em alguns minutos." });

      const leads = await getLeads(redis);
      if (leads.length >= MAX_LEADS) return res.status(503).json({ ok: false, error: "Não foi possível registrar agora. Tente mais tarde." });
      // Ignora duplicado óbvio (mesmo e-mail ainda pendente), sem revelar isso.
      if (!leads.some(l => l.email === email)) {
        const lead = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), nome, email, telefone, createdAt: Date.now() };
        leads.unshift(lead);
        await redis.set(LEADS_KEY, leads);
      }
      return res.status(200).json({ ok: true });
    }

    // ─── A partir daqui: apenas staff ─────────────────────────────────────────
    const sess = await getSession(req);
    if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
    if (!sessionCan(sess, "manage_clients")) return res.status(403).json({ ok: false, error: "Sem permissão para ver interessados." });

    if (req.method === "GET") {
      const leads = await getLeads(redis);
      return res.status(200).json({ ok: true, leads });
    }

    if (req.method === "POST" && action === "delete") {
      const id = clean(body && body.id, 40);
      const leads = await getLeads(redis);
      await redis.set(LEADS_KEY, leads.filter(l => l.id !== id));
      return res.status(200).json({ ok: true });
    }

    if (req.method === "POST" && action === "convert") {
      const id = clean(body && body.id, 40);
      const leads = await getLeads(redis);
      const lead = leads.find(l => l.id === id);
      if (!lead) return res.status(404).json({ ok: false, error: "Interessado não encontrado (talvez já convertido)." });

      const users = await getUsers();
      let login = clean(body && body.user, 32).toLowerCase();
      if (!login) login = uniqueLogin(slugLogin(lead.nome, lead.email), users);
      if (!USER_RE.test(login)) return res.status(400).json({ ok: false, error: "Login inválido (3-32 caracteres: letras minúsculas, números, . _ -)." });
      if (users[login]) return res.status(409).json({ ok: false, error: "Já existe um usuário com esse login. Escolha outro." });

      const role = (body && body.role) === "moderator" ? "moderator" : "client";
      const pass = generatePassword(10);
      const u = {
        user: login, name: lead.nome, email: lead.email, role,
        expiry: (body && body.expiry) || null, pass: hashPassword(pass), createdAt: Date.now(),
        telefone: lead.telefone || null,
      };
      if (role === "client") u.perms = [...DEFAULT_CLIENT_PERMS];
      users[login] = u;
      await saveUsers(users);
      await redis.set(LEADS_KEY, leads.filter(l => l.id !== id));
      // Credenciais voltam só aqui (staff autenticado) para repasse ao cliente.
      return res.status(200).json({ ok: true, login, pass, name: lead.nome, email: lead.email });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
