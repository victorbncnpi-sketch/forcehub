// api/news.js — Agenda econômica + resumo do dia, gerado por IA com cache compartilhado.
// GET /api/news            -> usa cache (regenera no máx a cada TTL_MIN minutos)
// GET /api/news?refresh=1  -> força nova geração
import { getRedis } from "./_redis";
import { geminiText, extractJSON } from "./_ai";

const TTL_MIN = 30; // janela de frescor do cache (minutos)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const today = new Date().toLocaleDateString("pt-BR");
  const isoDay = new Date().toISOString().split("T")[0];
  const cacheKey = "forcehub:news:" + isoDay;
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";
  const redis = getRedis();

  try {
    if (!refresh && redis) {
      const cached = await redis.get(cacheKey);
      if (cached && cached.generatedAt && (Date.now() - cached.generatedAt) < TTL_MIN * 60 * 1000) {
        return res.status(200).json({ ok: true, cached: true, ...cached });
      }
    }

    const data = await generate(today);
    const payload = { generatedAt: Date.now(), date: today, ...data };
    if (redis) { try { await redis.set(cacheKey, payload, { ex: 60 * 60 * 24 }); } catch (e) {} }
    return res.status(200).json({ ok: true, cached: false, ...payload });
  } catch (e) {
    // Fallback: serve o último cache do dia, mesmo que "velho".
    if (redis) {
      try { const c = await redis.get(cacheKey); if (c) return res.status(200).json({ ok: true, cached: true, stale: true, ...c }); }
      catch (_) {}
    }
    return res.status(200).json({ ok: false, error: e.message, date: today, summary: "", events: [] });
  }
}

async function generate(today) {
  const prompt =
    "Hoje e " + today + ". Use a busca na web para consultar o CALENDARIO ECONOMICO e as principais noticias de mercado de HOJE (Brasil e EUA).\n" +
    "Responda SOMENTE com um JSON valido (sem markdown, sem texto fora do JSON) neste formato:\n" +
    '{"summary":"resumo de 1 a 2 frases do que move o mercado hoje","events":[{"time":"09:30","country":"EUA","title":"Payroll (NFP)","impact":3,"previous":"150K","forecast":"180K","actual":""}]}\n' +
    "Regras: inclua eventos de impacto ALTO (impact=3) e MEDIO (impact=2); 'impact' deve ser 1, 2 ou 3; ordene por horario; " +
    "preencha 'actual' se o dado ja foi divulgado, senao use string vazia. Cubra os principais indicadores do dia " +
    "(decisoes de juros como Copom/Fed, inflacao IPCA/CPI/PCE, emprego/Payroll/Caged, PIB, PMIs, vendas no varejo). " +
    "'country' deve ser 'Brasil' ou 'EUA'. Se nao houver dado, use string vazia. Sempre preencha 'summary'.";

  const text = await geminiText({
    messages: [{ role: "user", content: prompt }],
    search: true,
    maxTokens: 2500,
    temperature: 0.3,
  });

  const parsed = extractJSON(text, ['"events"', '"summary"']);
  if (!parsed) throw new Error("Não foi possível ler o calendário agora. Tente novamente.");
  const v = parsed.value || {};

  const events = (Array.isArray(v.events) ? v.events : [])
    .map(e => ({
      time: String(e.time || ""),
      country: String(e.country || ""),
      title: String(e.title || ""),
      impact: Math.min(Math.max(parseInt(e.impact) || 1, 1), 3),
      previous: String(e.previous || ""),
      forecast: String(e.forecast || ""),
      actual: String(e.actual || ""),
    }))
    .filter(e => e.title)
    .sort((a, b) => a.time.localeCompare(b.time));

  return { summary: String(v.summary || ""), events };
}
