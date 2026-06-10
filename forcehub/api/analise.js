// api/analise.js — Análise técnica por IA dos 3 ativos do Panorama (WIN/WDO/IBOV).
//   GET  /api/analise            -> { ok, analises: { WIN, WDO, IBOV } }  (qualquer usuário com Panorama)
//   GET  /api/analise?img=WIN    -> { ok, image }                          (print usado na análise)
//   POST /api/analise            -> gera e publica (apenas staff: superadmin/moderador)
//        body { ativo, texto, imagem (dataURL|null) }
//
// A análise é gerada pela IA (Gemini, visão) a partir do print do gráfico + as
// observações do analista, e fica compartilhada para todos os clientes lerem.
import { getRedis } from "./_redis";
import { getSession, sessionCan, isStaff } from "./_auth";

const ATIVOS = ["WIN", "WDO", "IBOV"];
const LABELS = { WIN: "Mini Índice (WIN) — futuro do Ibovespa", WDO: "Mini Dólar (WDO) — futuro do dólar", IBOV: "Ibovespa (índice à vista)" };
const KEY = "forcehub:analise";
const imgKey = (a) => "forcehub:analise:img:" + a;
const MAX_IMG = 1100 * 1024; // ~1.1MB (dataURL) — margem sob o limite do Upstash

const SYSTEM = "Você é um analista técnico CNPI especializado em day trade e swing trade na B3. " +
  "Gere uma análise técnica objetiva do ativo informado a partir do PRINT do gráfico anexado e das observações do analista. " +
  "Estruture a resposta EXATAMENTE nestas seções, cada uma começando com o título em maiúsculas seguido de ':' e bullets com '- ':\n" +
  "TENDÊNCIA: (curtíssimo prazo e do dia)\n" +
  "NÍVEIS: (suportes e resistências visíveis no gráfico)\n" +
  "CENÁRIO: (viés de compra, venda ou neutro, com o gatilho de confirmação)\n" +
  "GESTÃO: (stop e parciais sugeridos)\n" +
  "Regras: baseie-se NO QUE ESTÁ VISÍVEL no gráfico — não invente preços. Seja conciso e técnico, em português, texto puro (sem markdown além dos bullets '- '). " +
  "Encerre com a linha: 'Conteúdo educacional — não é recomendação de investimento.'";

async function gerarAnalise(ativo, texto, imagem) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("IA não configurada (defina GEMINI_API_KEY).");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const parts = [{ text: "Ativo: " + (LABELS[ativo] || ativo) + ".\nObservações do analista: " + (texto || "(sem observações)") + "\n\nAnalise o gráfico anexado e produza a análise técnica no formato pedido." }];
  if (imagem && typeof imagem === "string") {
    const m = imagem.match(/^data:([^;]+);base64,(.*)$/);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const payload = {
    contents: [{ role: "user", parts }],
    systemInstruction: { parts: [{ text: SYSTEM }] },
    generationConfig: { maxOutputTokens: 1400, temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || ("Gemini HTTP " + r.status));
  const text = (data?.candidates?.[0]?.content?.parts || []).filter(p => typeof p.text === "string").map(p => p.text).join("").trim();
  if (!text) throw new Error("A IA não retornou análise (possível bloqueio de conteúdo). Tente outro print/observação.");
  return text;
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado." });
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!sessionCan(sess, "panorama")) return res.status(403).json({ ok: false, error: "Sem acesso ao Panorama." });

  try {
    // Imagem (print) de um ativo.
    if (req.query.img) {
      const a = String(req.query.img).toUpperCase();
      if (!ATIVOS.includes(a)) return res.status(400).json({ ok: false, error: "Ativo inválido." });
      const image = await redis.get(imgKey(a));
      return res.status(200).json({ ok: true, image: image || null });
    }

    if (req.method === "GET") {
      const data = (await redis.get(KEY)) || {};
      const analises = {};
      for (const a of ATIVOS) analises[a] = data[a] || null;
      return res.status(200).json({ ok: true, analises });
    }

    if (req.method === "POST") {
      if (!isStaff(sess.role)) return res.status(403).json({ ok: false, error: "Apenas moderadores ou super admin podem gerar análises." });
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const a = String((body && body.ativo) || "").toUpperCase();
      if (!ATIVOS.includes(a)) return res.status(400).json({ ok: false, error: "Ativo inválido." });
      const texto = String((body && body.texto) || "").slice(0, 4000);
      const imagem = body && typeof body.imagem === "string" && body.imagem.startsWith("data:") ? body.imagem : null;
      if (imagem && imagem.length > MAX_IMG) return res.status(413).json({ ok: false, error: "Imagem muito grande." });
      if (!texto && !imagem) return res.status(400).json({ ok: false, error: "Envie um print do gráfico e/ou observações." });

      const analise = await gerarAnalise(a, texto, imagem);

      if (imagem) { await redis.set(imgKey(a), imagem); }
      else { await redis.del(imgKey(a)); }

      const data = (await redis.get(KEY)) || {};
      data[a] = { ativo: a, analise, texto, hasImage: !!imagem, autor: sess.name || sess.user, generatedAt: Date.now() };
      await redis.set(KEY, data);
      return res.status(200).json({ ok: true, analise: data[a] });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
