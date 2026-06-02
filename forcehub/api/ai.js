// api/ai.js — Proxy serverless de IA (provider-agnóstico)
// A chave fica SOMENTE no backend. O frontend chama /api/ai e recebe sempre
// uma resposta no formato { content: [{ type: "text", text }], stop_reason }.
//
// Provedor escolhido por variável de ambiente, em ordem de preferência:
//   1. GEMINI_API_KEY     -> Google Gemini (free tier, sem cartão)
//   2. ANTHROPIC_API_KEY  -> Anthropic (pago)

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { messages, system, max_tokens = 1500, tools } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Requisição inválida: 'messages' é obrigatório." });
  }

  const maxTokens = Math.min(Math.max(parseInt(max_tokens) || 1500, 1), 4096);
  const wantsSearch = Array.isArray(tools) && tools.some(
    t => (t.type || "").includes("web_search") || t.name === "web_search" || t.google_search
  );

  try {
    if (process.env.GEMINI_API_KEY) {
      return await viaGemini({ res, messages, system, maxTokens, wantsSearch });
    }
    if (process.env.ANTHROPIC_API_KEY) {
      return await viaAnthropic({ res, messages, system, maxTokens, tools });
    }
    return res.status(503).json({
      error: "IA indisponível: defina GEMINI_API_KEY (gratuita) ou ANTHROPIC_API_KEY.",
    });
  } catch (e) {
    return res.status(502).json({ error: "Erro de conexão com a IA: " + e.message });
  }
}

// ─── Google Gemini ────────────────────────────────────────────────────────────
async function viaGemini({ res, messages, system, maxTokens, wantsSearch }) {
  const payload = {
    contents: messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content ?? "") }],
    })),
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  if (wantsSearch) payload.tools = [{ google_search: {} }];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) {
    return res.status(r.status).json({ error: data?.error?.message || "Falha ao chamar o Gemini" });
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => typeof p.text === "string").map(p => p.text).join("");
  return res.status(200).json({
    content: [{ type: "text", text }],
    stop_reason: data?.candidates?.[0]?.finishReason || "end_turn",
  });
}

// ─── Anthropic ────────────────────────────────────────────────────────────────
async function viaAnthropic({ res, messages, system, maxTokens, tools }) {
  const payload = { model: ANTHROPIC_MODEL, max_tokens: maxTokens, messages };
  if (system) payload.system = system;
  if (Array.isArray(tools) && tools.length) payload.tools = tools;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) {
    return res.status(r.status).json({ error: data?.error?.message || "Falha ao chamar a Anthropic" });
  }
  return res.status(200).json(data);
}
