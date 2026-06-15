// api/cohort.js — Painel da Turma (consolidado do mentor). Apenas staff.
//   GET /api/cohort -> { ok, students: [{ user, name, role, staff, expiry, valorR, trades, diario, positions }] }
//
// Devolve os dados crus de cada participante; o frontend reaproveita a mesma
// lógica de estatística (buildEvents/computeStats) para agregar a turma e abrir
// o dashboard de cada um. Inclui os alunos (clientes) e também os membros da
// equipe que operam (têm diário próprio), marcados com staff:true.
import { getRedis } from "./_redis";
import { getSession, getUsers, isStaff } from "./_auth";

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!isStaff(sess.role)) return res.status(403).json({ ok: false, error: "Apenas a equipe acessa o painel da turma." });
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método não permitido" });

  try {
    const users = await getUsers();
    // Alunos (sempre) + equipe (só quem tem atividade própria, para não poluir).
    const candidates = Object.values(users).filter(u => u && (u.role === "client" || isStaff(u.role)));
    const rows = await Promise.all(candidates.map(async (u) => {
      const [t, c, p] = await Promise.all([
        redis.get("forcehub:trades:" + u.user),
        redis.get("forcehub:conselheiro:" + u.user),
        redis.get("forcehub:positions:" + u.user),
      ]);
      const trades = Array.isArray(t) ? t : (Array.isArray(t && t.trades) ? t.trades : []);
      const valorR = t && typeof t.valorR === "number" && t.valorR > 0 ? t.valorR : null;
      const diario = Array.isArray(c && c.diario) ? c.diario : [];
      const positions = Array.isArray(p) ? p : (Array.isArray(p && p.posicoes) ? p.posicoes : []);
      const staff = isStaff(u.role);
      // Membro da equipe só aparece se tiver dados próprios (trades/diário/posições).
      if (staff && !trades.length && !diario.length && !positions.length) return null;
      return { user: u.user, name: u.name || u.user, role: u.role, staff, expiry: u.expiry || null, valorR, trades, diario, positions };
    }));
    const students = rows.filter(Boolean);
    students.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return res.status(200).json({ ok: true, students });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
