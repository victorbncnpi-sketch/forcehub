// api/_ai.js — utilitários de IA compartilhados (não vira rota: prefixo "_").
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function fetchRetry(url, opts, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok || (r.status !== 429 && r.status < 500)) return r;
      last = r;
    } catch (e) { last = e; }
    if (i < tries - 1) await sleep(700 * (i + 1));
  }
  if (last instanceof Response) return last;
  throw last || new Error("Falha de rede");
}

// Extrai um objeto/array JSON de um texto, rastreando strings e limpando vírgulas.
export function extractJSON(text, anchors = []) {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, "");
  let start = -1;
  for (const a of anchors) { const i = t.indexOf(a); if (i >= 0) { start = i; break; } }
  if (start >= 0) { while (start > 0 && t[start] !== "{" && t[start] !== "[") start--; }
  else { const c = [t.indexOf("{"), t.indexOf("[")].filter(x => x >= 0).sort((a, b) => a - b); start = c.length ? c[0] : -1; }
  if (start < 0) return null;
  const open = t[start], close = open === "{" ? "}" : "]";
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  const raw = Array.from(t.slice(start, end)).map(c => (c.charCodeAt(0) < 32 ? " " : c)).join("").replace(/,\s*([}\]])/g, "$1");
  try { return { value: JSON.parse(raw), raw }; } catch (e) { return null; }
}

// Geração de texto via Gemini (com Google Search opcional).
// thinkingBudget=0 desliga o "thinking" do gemini-2.5-flash: sem isso, os tokens
// de raciocínio consomem o maxOutputTokens e a resposta visível sai cortada
// (resumo truncado / JSON de manchetes incompleto). Para tarefas estruturadas
// e curtas, mantemos o thinking desligado por padrão.
export async function geminiText({ messages, system, search = false, maxTokens = 1500, temperature = 0.4, thinkingBudget = 0 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("IA não configurada (defina GEMINI_API_KEY).");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const payload = {
    contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content ?? "") }] })),
    generationConfig: { maxOutputTokens: maxTokens, temperature, thinkingConfig: { thinkingBudget } },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  if (search) payload.tools = [{ google_search: {} }];

  const r = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || ("Gemini HTTP " + r.status));
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => typeof p.text === "string").map(p => p.text).join("");
}
