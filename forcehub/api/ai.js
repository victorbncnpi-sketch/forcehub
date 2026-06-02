// api/ai.js — Proxy serverless para a API da Anthropic
// A chave fica SOMENTE no backend (process.env.ANTHROPIC_API_KEY).
// O frontend chama /api/ai e nunca tem acesso à chave.

const DEFAULT_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "IA indisponível: defina ANTHROPIC_API_KEY nas variáveis de ambiente.",
    });
  }

  // O body já vem parseado pelo runtime do Vercel; tolera string por segurança.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { messages, system, max_tokens = 1500, tools, model } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Requisição inválida: 'messages' é obrigatório." });
  }

  const payload = {
    model: model || DEFAULT_MODEL,
    max_tokens: Math.min(Math.max(parseInt(max_tokens) || 1500, 1), 4096),
    messages,
  };
  if (system) payload.system = system;
  if (Array.isArray(tools) && tools.length) payload.tools = tools;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || "Falha ao chamar a IA";
      return res.status(r.status).json({ error: msg });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "Erro de conexão com a IA: " + e.message });
  }
}
