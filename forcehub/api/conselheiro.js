// api/conselheiro.js — Perfil e diário do Conselheiro, por usuário e por conta.
// GET  ?user=victor[&account=real|sim]          -> { ok, perfil, diario }
// POST ?user=victor[&account=real|sim] { perfil?, diario? } -> merge e salva
//
// Contas: espelha api/trades.js. A conta real usa a chave legada (sem sufixo),
// então o perfil/diário existentes viram a conta real (sem migração); a conta
// simulador usa ":sim". Cada conta tem seu próprio perfil e diário.
import { getRedis } from "./_redis";
import { getSession, sessionCan } from "./_auth";

const ACCOUNTS = new Set(["real", "sim"]);
const accountOf = (q) => { const a = String(q == null ? "" : q).trim().toLowerCase(); return ACCOUNTS.has(a) ? a : "real"; };
const keyFor = (user, acc) => "forcehub:conselheiro:" + user + (acc === "sim" ? ":sim" : "");

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });
  }

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!sessionCan(sess, "conselheiro")) return res.status(403).json({ ok: false, error: "Sem acesso ao Conselheiro." });

  const user = (req.query.user || "").toString().trim().toLowerCase();
  const account = accountOf(req.query.account);
  if (!user) {
    return res.status(400).json({ ok: false, error: "Parâmetro 'user' é obrigatório." });
  }
  const isStaff = sess.role === "superadmin" || sess.role === "moderator";
  // Escrita: apenas o próprio usuário. Leitura: própria, ou qualquer uma para
  // staff (necessário para o drill-down do aluno no painel da Turma).
  if (user !== sess.user && !(req.method === "GET" && isStaff)) {
    return res.status(403).json({ ok: false, error: "Acesso negado." });
  }

  try {
    if (req.method === "GET") {
      const data = (await redis.get(keyFor(user, account))) || {};
      return res.status(200).json({
        ok: true,
        perfil: data.perfil || null,
        diario: Array.isArray(data.diario) ? data.diario : [],
        account,
      });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const existing = (await redis.get(keyFor(user, account))) || {};
      const next = { ...existing };
      if (body && "perfil" in body) next.perfil = body.perfil;
      if (body && "diario" in body) next.diario = Array.isArray(body.diario) ? body.diario : (existing.diario || []);
      await redis.set(keyFor(user, account), next);
      return res.status(200).json({ ok: true, account });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
