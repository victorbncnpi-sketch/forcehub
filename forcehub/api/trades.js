// api/trades.js — Diário de trades pessoal (por usuário).
//   GET  /api/trades[?user=<u>]      -> { ok, trades, valorR }
//   POST /api/trades { trades, valorR } -> salva o diário do próprio usuário
//
// Este é o registro MANUAL do cliente (uma linha por operação). O Dashboard
// agrega este diário com o que O Conselheiro registra (api/conselheiro.js) e,
// opcionalmente, com as posições da carteira (api/posicoes.js). `valorR` é
// quanto vale 1R em R$ — usado para converter R-múltiplo <-> financeiro.
//
// Acesso: exige a permissão "trades".
//   Leitura: própria, ou qualquer uma para staff (admin/moderador).
//   Escrita: apenas as próprias operações.
import { getRedis } from "./_redis";
import { getSession, sessionCan } from "./_auth";

const keyFor = (u) => "forcehub:trades:" + u;

// Teto de operações por diário: protege o Redis e o payload de crescimento
// ilimitado (ex.: importação de CSV gigante). Folgado para anos de day trade.
const MAX_TRADES = 20000;
const DIRECOES = new Set(["COMPRA", "VENDA"]);

// Tira caracteres de controle e limita o tamanho — defesa contra payload
// malicioso/inflado vindo do cliente (incl. importação de planilha).
function cleanStr(v, max) {
  return v == null ? "" : String(v).replace(/[\x00-\x1f]/g, "").trim().slice(0, max);
}
const isNum = (v) => typeof v === "number" && isFinite(v);

// Normaliza e valida o diário recebido. Descarta linhas sem data válida e
// recorta cada campo ao formato esperado; nunca confia no shape do cliente.
function sanitizeTrades(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const t of arr) {
    if (!t || typeof t !== "object") continue;
    const data = cleanStr(t.data, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue; // exige data ISO válida
    const o = {
      id: isNum(t.id) ? t.id : undefined,
      data,
      ativo: cleanStr(t.ativo, 24) || null,
      direcao: DIRECOES.has(t.direcao) ? t.direcao : null,
      r: isNum(t.r) ? t.r : null,
      fin: isNum(t.fin) ? t.fin : null,
      setup: cleanStr(t.setup, 200),
      notas: cleanStr(t.notas, 200),
    };
    // Chave externa (ex.: timestamp+contrato do Profit) p/ deduplicar reimportações.
    if (t.ext != null) o.ext = cleanStr(t.ext, 48);
    out.push(o);
    if (out.length >= MAX_TRADES) break;
  }
  return out;
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!sessionCan(sess, "trades")) return res.status(403).json({ ok: false, error: "Sem acesso ao diário de trades." });

  const user = (req.query.user || sess.user).toString().trim().toLowerCase();
  const isStaff = sess.role === "superadmin" || sess.role === "moderator";

  try {
    if (req.method === "GET") {
      if (user !== sess.user && !isStaff) return res.status(403).json({ ok: false, error: "Acesso negado." });
      const data = await redis.get(keyFor(user));
      const trades = Array.isArray(data) ? data : (Array.isArray(data && data.trades) ? data.trades : []);
      const valorR = data && typeof data.valorR === "number" && data.valorR > 0 ? data.valorR : null;
      return res.status(200).json({ ok: true, trades, valorR });
    }

    if (req.method === "POST") {
      if (user !== sess.user) return res.status(403).json({ ok: false, error: "Você só pode alterar as suas próprias operações." });
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const raw = Array.isArray(body && body.trades) ? body.trades : [];
      if (raw.length > MAX_TRADES) return res.status(413).json({ ok: false, error: `Diário excede o limite de ${MAX_TRADES} operações.` });
      const trades = sanitizeTrades(raw);
      const valorR = Number(body && body.valorR) > 0 ? Number(body.valorR) : null;
      await redis.set(keyFor(user), { trades, valorR });
      return res.status(200).json({ ok: true, saved: trades.length });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
