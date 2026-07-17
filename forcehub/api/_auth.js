// api/_auth.js — Autenticação: hash de senha (scrypt nativo) + sessões em
// cookie httpOnly guardadas no Upstash Redis. Sem dependências externas.
// Prefixo "_": não vira rota na Vercel.
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getRedis } from "./_redis";

const USERS_KEY = "forcehub:users";
const SESS_PREFIX = "forcehub:session:";
export const SESSION_TTL = 60 * 60 * 24 * 7; // 7 dias
const COOKIE = "fh_session";

// Super admin: irrestrito e imutável (ninguém edita/rebaixa/remove).
export const SUPERADMIN = "victor";
export const ROLES = ["client", "moderator", "superadmin"];

// Permissões granulares por página (controlam clientes). Staff (moderador/super
// admin) tem todas implicitamente.
export const PAGE_CAPS = ["panorama", "carteira", "carteira_write", "conselheiro", "trades", "portfolio"];
export const DEFAULT_CLIENT_PERMS = ["panorama", "carteira", "conselheiro", "trades", "portfolio"];

// Cadastro inicial — usado apenas se o banco ainda não tiver usuários.
// Estas senhas são só a semente; troque-as pelo painel admin após o 1º login.
const SEED = [
  { user: "victor",       pass: "forcehub2026", role: "superadmin", expiry: null,         name: "Victor Noronha", email: "victorbn.cnpi@gmail.com" },
  { user: "cliente1",     pass: "xp2026c1",     role: "client",     expiry: "2027-06-01", name: "Cliente 1" },
  { user: "cliente2",     pass: "xp2026c2",     role: "client",     expiry: "2027-06-01", name: "Cliente 2" },
  { user: "andre.gain",   pass: "xp2026ag",     role: "client",     expiry: "2027-06-01", name: "Andre Gain" },
  { user: "maria.emilia", pass: "xp2026me",     role: "client",     expiry: "2027-06-01", name: "Maria Emilia" },
];

// E-mail (opcional): usado para futuros alertas e redefinição de senha.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeEmail(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s ? s : null;
}

// ─── Senha (scrypt) ───────────────────────────────────────────────────────────
export function hashPassword(pass) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(pass), salt, 64).toString("hex");
  return salt + ":" + hash;
}
export function verifyPassword(pass, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const h = scryptSync(String(pass), salt, 64);
  const hb = Buffer.from(hash, "hex");
  return h.length === hb.length && timingSafeEqual(h, hb);
}

// Senha gerada automaticamente para novos acessos: legível e sem caracteres
// ambíguos (sem 0/O, 1/l/I), para o staff repassar ao cliente sem confusão.
export function generatePassword(len = 10) {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ─── Modelagem / permissões ───────────────────────────────────────────────────
export function isStaff(role) { return role === "superadmin" || role === "moderator"; }

// Permissões efetivas: staff recebe todas as páginas; cliente usa o próprio array.
export function effectivePerms(u) {
  if (!u) return [];
  if (isStaff(u.role)) return [...PAGE_CAPS];
  return Array.isArray(u.perms) ? u.perms.filter(p => PAGE_CAPS.includes(p)) : [];
}

// Verifica uma capacidade a partir do payload de sessão ({ role, perms }) ou de
// um usuário completo. Capacidades administrativas derivam do papel.
export function sessionCan(s, cap) {
  if (!s) return false;
  if (s.role === "superadmin") return true;
  // Moderadores têm os mesmos poderes administrativos; a única exceção (não
  // alterar o super admin) é aplicada caso a caso em api/users.js.
  if (cap === "manage_staff" || cap === "manage_clients") return s.role === "moderator";
  const perms = Array.isArray(s.perms) ? s.perms : effectivePerms(s);
  return perms.includes(cap);
}

export function publicUser(u) {
  return u ? { user: u.user, name: u.name, email: u.email || null, phone: u.phone || null, role: u.role, expiry: u.expiry || null, perms: effectivePerms(u) } : null;
}
export function isExpired(u) {
  if (!u || !u.expiry) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(u.expiry) < today;
}

// Normaliza/migra usuários para o modelo atual (papéis + perms). Retorna true se
// algo mudou (para regravar). Migração do modelo antigo: role "admin" => super
// admin (se for o victor) ou moderador; clientes ganham permissões padrão.
function normalizeUsers(map) {
  let changed = false;
  for (const k of Object.keys(map)) {
    const u = map[k];
    if (!u || typeof u !== "object") continue;
    if (u.user === SUPERADMIN && u.role !== "superadmin") { u.role = "superadmin"; changed = true; }
    if (u.role === "admin") { u.role = u.user === SUPERADMIN ? "superadmin" : "moderator"; changed = true; }
    if (!ROLES.includes(u.role)) { u.role = "client"; changed = true; }
    if (u.role === "client" && !Array.isArray(u.perms)) { u.perms = [...DEFAULT_CLIENT_PERMS]; changed = true; }
    if (!("email" in u)) { u.email = u.user === SUPERADMIN ? "victorbn.cnpi@gmail.com" : null; changed = true; }
    // Migração única do cap "trades" (Diário + Dashboard): concede a clientes
    // antigos uma vez só. O flag evita reconceder caso o admin opte por remover.
    if (u.role === "client" && Array.isArray(u.perms) && !u.tradesMigrated) {
      if (!u.perms.includes("trades")) u.perms.push("trades");
      u.tradesMigrated = true; changed = true;
    }
    // Idem para "portfolio" (carteira própria de ações e opções): concessão única.
    if (u.role === "client" && Array.isArray(u.perms) && !u.portfolioMigrated) {
      if (!u.perms.includes("portfolio")) u.perms.push("portfolio");
      u.portfolioMigrated = true; changed = true;
    }
  }
  return changed;
}

// ─── Armazenamento de usuários (semeia na primeira leitura) ───────────────────
export async function getUsers() {
  const redis = getRedis();
  if (!redis) return {};
  let map = await redis.get(USERS_KEY);
  if (!map || typeof map !== "object" || Array.isArray(map) || !Object.keys(map).length) {
    map = {};
    for (const s of SEED) {
      map[s.user] = {
        user: s.user, name: s.name, email: s.email || null, role: s.role, expiry: s.expiry,
        pass: hashPassword(s.pass), createdAt: Date.now(),
        ...(s.role === "client" ? { perms: [...DEFAULT_CLIENT_PERMS] } : {}),
      };
    }
    await redis.set(USERS_KEY, map);
  } else if (normalizeUsers(map)) {
    await redis.set(USERS_KEY, map);
  }
  return map;
}
export async function saveUsers(map) {
  const redis = getRedis();
  if (redis) await redis.set(USERS_KEY, map);
}

// ─── Cookies ──────────────────────────────────────────────────────────────────
export function parseCookies(req) {
  const out = {};
  const raw = (req.headers && req.headers.cookie) || "";
  raw.split(";").forEach(p => { const i = p.indexOf("="); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`);
}
export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

// ─── Sessões ────────────────────────────────────────────────────────────────
export async function createSession(user) {
  const redis = getRedis();
  const token = randomBytes(32).toString("hex");
  if (redis) await redis.set(SESS_PREFIX + token, publicUser(user), { ex: SESSION_TTL });
  return token;
}
export async function getSession(req) {
  const redis = getRedis();
  if (!redis) return null;
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const data = await redis.get(SESS_PREFIX + token);
  return data ? { token, ...data } : null;
}
export async function destroySession(req) {
  const redis = getRedis();
  const token = parseCookies(req)[COOKIE];
  if (redis && token) await redis.del(SESS_PREFIX + token);
}
// Regrava o payload público da sessão atual (após o usuário editar o próprio
// perfil), mantendo o mesmo token/cookie.
export async function refreshSession(token, user) {
  const redis = getRedis();
  if (redis && token) await redis.set(SESS_PREFIX + token, publicUser(user), { ex: SESSION_TTL });
}
