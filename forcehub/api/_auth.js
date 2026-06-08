// api/_auth.js — Autenticação: hash de senha (scrypt nativo) + sessões em
// cookie httpOnly guardadas no Upstash Redis. Sem dependências externas.
// Prefixo "_": não vira rota na Vercel.
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getRedis } from "./_redis";

const USERS_KEY = "forcehub:users";
const SESS_PREFIX = "forcehub:session:";
export const SESSION_TTL = 60 * 60 * 24 * 7; // 7 dias
const COOKIE = "fh_session";

// Cadastro inicial — usado apenas se o banco ainda não tiver usuários.
// Estas senhas são só a semente; troque-as pelo painel admin após o 1º login.
const SEED = [
  { user: "victor",       pass: "forcehub2026", role: "admin",  expiry: null,         name: "Victor Noronha" },
  { user: "cliente1",     pass: "xp2026c1",     role: "client", expiry: "2027-06-01", name: "Cliente 1" },
  { user: "cliente2",     pass: "xp2026c2",     role: "client", expiry: "2027-06-01", name: "Cliente 2" },
  { user: "andre.gain",   pass: "xp2026ag",     role: "client", expiry: "2027-06-01", name: "Andre Gain" },
  { user: "maria.emilia", pass: "xp2026me",     role: "client", expiry: "2027-06-01", name: "Maria Emilia" },
];

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

// ─── Modelagem ──────────────────────────────────────────────────────────────
export function publicUser(u) {
  return u ? { user: u.user, name: u.name, role: u.role, expiry: u.expiry || null } : null;
}
export function isExpired(u) {
  if (!u || !u.expiry) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(u.expiry) < today;
}

// ─── Armazenamento de usuários (semeia na primeira leitura) ───────────────────
export async function getUsers() {
  const redis = getRedis();
  if (!redis) return {};
  let map = await redis.get(USERS_KEY);
  if (!map || typeof map !== "object" || Array.isArray(map) || !Object.keys(map).length) {
    map = {};
    for (const s of SEED) {
      map[s.user] = { user: s.user, name: s.name, role: s.role, expiry: s.expiry, pass: hashPassword(s.pass), createdAt: Date.now() };
    }
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
