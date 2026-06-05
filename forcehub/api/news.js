// api/news.js — Agenda econômica (Brasil + EUA) + resumo do dia, com cache.
//
// Eventos: feed gratuito e estruturado do ForexFactory (faireconomy.media),
//   filtrado para HOJE e países US/BR. Muito mais completo que pedir à IA.
// Resumo: gerado pela IA (best-effort). Fallback: agenda 100% via IA se o feed cair.
//
// GET /api/news            -> usa cache (regenera no máx a cada TTL_MIN minutos)
// GET /api/news?refresh=1  -> força nova geração
import { getRedis } from "./_redis";
import { geminiText, extractJSON } from "./_ai";

const TTL_MIN = 15;
const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const COUNTRIES = { USD: "EUA", BRL: "Brasil", EUR: "Zona do Euro", GBP: "Reino Unido", CNY: "China", JPY: "Japão", CAD: "Canadá", AUD: "Austrália" };
const IMPACT = { High: 3, Medium: 2, Low: 1, Holiday: 1 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const today = new Date().toLocaleDateString("pt-BR");
  const todayBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
  const cacheKey = "forcehub:news:" + todayBRT;
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";
  const redis = getRedis();

  try {
    if (!refresh && redis) {
      const cached = await redis.get(cacheKey);
      if (cached && cached.generatedAt && (Date.now() - cached.generatedAt) < TTL_MIN * 60 * 1000) {
        return res.status(200).json({ ok: true, cached: true, ...cached });
      }
    }
    const data = await generate(today, todayBRT);
    const payload = { generatedAt: Date.now(), date: today, ...data };
    if (redis) { try { await redis.set(cacheKey, payload, { ex: 60 * 60 * 24 }); } catch (e) {} }
    return res.status(200).json({ ok: true, cached: false, ...payload });
  } catch (e) {
    if (redis) {
      try { const c = await redis.get(cacheKey); if (c) return res.status(200).json({ ok: true, cached: true, stale: true, ...c }); }
      catch (_) {}
    }
    return res.status(200).json({ ok: false, error: e.message, date: today, summary: "", events: [] });
  }
}

async function generate(today, todayBRT) {
  let events = [];
  let source = "forexfactory";

  // Busca em paralelo: agenda (feed) + resumo (IA) + manchetes (IA).
  const [evtRes, sumRes, headRes] = await Promise.allSettled([
    fetchForexFactory(todayBRT),
    briefSummary(today),
    fetchHeadlines(today),
  ]);

  if (evtRes.status === "fulfilled") events = evtRes.value;
  let summary = sumRes.status === "fulfilled" ? String(sumRes.value || "").trim() : "";
  const headlines = headRes.status === "fulfilled" ? headRes.value : [];

  // Fallback: se o feed não trouxe eventos, gera a agenda pela IA.
  if (!events.length) {
    try {
      const g = await aiEvents(today);
      events = g.events;
      if (!summary) summary = g.summary;
      source = "gemini";
    } catch (e) {
      if (!summary && !headlines.length) throw e;
    }
  }
  return { summary, events, headlines, source };
}

// ─── ForexFactory (feed gratuito, estruturado) ───────────────────────────────
async function fetchForexFactory(todayBRT) {
  const r = await fetch(FF_URL, { headers: { "user-agent": "Mozilla/5.0 (FORCEHUB)", "accept": "application/json" } });
  if (!r.ok) throw new Error("ForexFactory HTTP " + r.status);
  const arr = await r.json();
  if (!Array.isArray(arr)) throw new Error("ForexFactory formato inesperado");

  const inBRT = (iso, opts) => { try { return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", ...opts }); } catch (_) { return ""; } };

  return arr
    .filter(e => COUNTRIES[e.country])
    .filter(e => {
      try { return new Date(e.date).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) === todayBRT; }
      catch (_) { return false; }
    })
    .map(e => ({
      time: inBRT(e.date, { hour: "2-digit", minute: "2-digit" }).replace(/[^\d:]/g, "").slice(0, 5),
      country: COUNTRIES[e.country],
      title: String(e.title || ""),
      impact: IMPACT[e.impact] || 1,
      previous: String(e.previous ?? ""),
      forecast: String(e.forecast ?? ""),
      actual: String(e.actual ?? ""),
    }))
    .filter(e => e.title)
    .sort((a, b) => a.time.localeCompare(b.time));
}

// ─── IA: resumo do dia ───────────────────────────────────────────────────────
async function briefSummary(today) {
  const prompt = "Hoje e " + today + ". Em 2 a 3 frases COMPLETAS, resuma o que move os mercados de Brasil e EUA hoje " +
    "(principais eventos/indicadores, juros, cambio e o sentimento geral). Responda em portugues, texto puro (sem markdown), " +
    "terminando as frases — nao corte no meio.";
  return geminiText({ messages: [{ role: "user", content: prompt }], search: true, maxTokens: 700, temperature: 0.3 });
}

// ─── IA: manchetes do mercado ────────────────────────────────────────────────
async function fetchHeadlines(today) {
  const prompt = "Hoje e " + today + ". Use a busca na web. Liste as principais MANCHETES do mercado financeiro de hoje " +
    "(Brasil e global): bolsa/Ibovespa, juros, cambio/dolar, commodities, empresas e economia. " +
    'Responda SOMENTE JSON valido (sem markdown): {"headlines":[{"title":"...","source":"..."}]}. ' +
    "De 6 a 10 manchetes objetivas e atuais, em portugues.";
  const text = await geminiText({ messages: [{ role: "user", content: prompt }], search: true, maxTokens: 1200, temperature: 0.3 });
  const parsed = extractJSON(text, ['"headlines"']);
  if (!parsed) return [];
  const v = parsed.value || {};
  return (Array.isArray(v.headlines) ? v.headlines : [])
    .map(h => ({ title: String(h.title || "").trim(), source: String(h.source || "").trim(), url: String(h.url || "").trim() }))
    .filter(h => h.title)
    .slice(0, 10);
}

// ─── IA: agenda completa (fallback se o feed falhar) ─────────────────────────
async function aiEvents(today) {
  const prompt =
    "Hoje e " + today + ". Use a busca na web para o CALENDARIO ECONOMICO de HOJE (Brasil e EUA).\n" +
    "Responda SOMENTE JSON valido (sem markdown):\n" +
    '{"summary":"resumo de 1-2 frases","events":[{"time":"09:30","country":"EUA","title":"Payroll","impact":3,"previous":"150K","forecast":"180K","actual":""}]}\n' +
    "Inclua impacto ALTO (3) e MEDIO (2); 'impact' = 1, 2 ou 3; ordene por horario; 'country' = 'Brasil' ou 'EUA'; preencha 'actual' se ja divulgado.";
  const text = await geminiText({ messages: [{ role: "user", content: prompt }], search: true, maxTokens: 2500, temperature: 0.3 });
  const parsed = extractJSON(text, ['"events"', '"summary"']);
  if (!parsed) throw new Error("Não foi possível ler o calendário agora.");
  const v = parsed.value || {};
  const events = (Array.isArray(v.events) ? v.events : [])
    .map(e => ({
      time: String(e.time || ""), country: String(e.country || ""), title: String(e.title || ""),
      impact: Math.min(Math.max(parseInt(e.impact) || 1, 1), 3),
      previous: String(e.previous || ""), forecast: String(e.forecast || ""), actual: String(e.actual || ""),
    }))
    .filter(e => e.title)
    .sort((a, b) => a.time.localeCompare(b.time));
  return { summary: String(v.summary || ""), events };
}
