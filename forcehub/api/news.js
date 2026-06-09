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

// FMP (Financial Modeling Prep): calendário com valor REALIZADO (actual).
// Requer FMP_API_KEY (free tier). Usado como fonte primária dos eventos; o
// ForexFactory entra como fallback se a chave faltar/falhar.
const FMP_KEY = process.env.FMP_API_KEY;
const FMP_COUNTRY = {
  US: "EUA", USA: "EUA", "United States": "EUA",
  BR: "Brasil", Brazil: "Brasil",
  GB: "Reino Unido", UK: "Reino Unido", "United Kingdom": "Reino Unido",
  CN: "China", China: "China",
  JP: "Japão", Japan: "Japão",
  CA: "Canadá", Canada: "Canadá",
  AU: "Austrália", Australia: "Austrália",
  EU: "Zona do Euro", EA: "Zona do Euro", "Euro Area": "Zona do Euro", "European Union": "Zona do Euro",
  DE: "Zona do Euro", Germany: "Zona do Euro", FR: "Zona do Euro", France: "Zona do Euro",
  IT: "Zona do Euro", Italy: "Zona do Euro", ES: "Zona do Euro", Spain: "Zona do Euro",
  NL: "Zona do Euro", Netherlands: "Zona do Euro", PT: "Zona do Euro", Portugal: "Zona do Euro",
  IE: "Zona do Euro", GR: "Zona do Euro", BE: "Zona do Euro", AT: "Zona do Euro", FI: "Zona do Euro",
};
const FMP_IMPACT = { High: 3, Medium: 2, Low: 1, None: 1, Holiday: 1 };

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

  // Busca em paralelo: agenda (FMP/feed) + resumo (IA) + manchetes (RSS real).
  const [evtRes, sumRes, headRes] = await Promise.allSettled([
    fetchEvents(todayBRT),
    briefSummary(today),
    fetchRssHeadlines(),
  ]);

  if (evtRes.status === "fulfilled") { events = evtRes.value.events; source = evtRes.value.source; }
  let summary = sumRes.status === "fulfilled" ? String(sumRes.value || "").trim() : "";
  let headlines = headRes.status === "fulfilled" ? headRes.value : [];

  // Fallback: se nenhum feed RSS respondeu, gera manchetes pela IA.
  if (!headlines.length) {
    try { headlines = await fetchHeadlines(today); } catch (_) {}
  }

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

// Fonte dos eventos: FMP (com 'actual') quando há chave; senão ForexFactory.
async function fetchEvents(todayBRT) {
  if (FMP_KEY) {
    try { const events = await fetchFMP(todayBRT); if (events.length) return { events, source: "fmp" }; } catch (_) {}
  }
  return { events: await fetchForexFactory(todayBRT), source: "forexfactory" };
}

// ─── FMP — Economic Calendar (inclui valor realizado) ────────────────────────
async function fetchFMP(todayBRT) {
  // BRT (UTC-3): o "hoje" local cobre as datas UTC de hoje e amanhã.
  const tomorrow = new Date(new Date(todayBRT + "T12:00:00Z").getTime() + 864e5).toISOString().slice(0, 10);
  const qs = `from=${todayBRT}&to=${tomorrow}&apikey=${FMP_KEY}`;
  const urls = [
    "https://financialmodelingprep.com/stable/economic-calendar?" + qs,
    "https://financialmodelingprep.com/api/v3/economic_calendar?" + qs,
  ];
  let arr = null, lastErr;
  for (const u of urls) {
    try { const r = await fetch(u, { headers: { accept: "application/json" } }); if (!r.ok) { lastErr = new Error("FMP HTTP " + r.status); continue; } const j = await r.json(); if (Array.isArray(j)) { arr = j; break; } lastErr = new Error("FMP formato"); }
    catch (e) { lastErr = e; }
  }
  if (!arr) throw lastErr || new Error("FMP indisponível");

  const toBRTdate = (s) => { try { return new Date(String(s).replace(" ", "T") + "Z").toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); } catch (_) { return ""; } };
  const toBRTtime = (s) => { try { return new Date(String(s).replace(" ", "T") + "Z").toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).slice(0, 5); } catch (_) { return ""; } };
  const fmtVal = (v, unit) => (v == null || v === "") ? "" : String(v) + (unit ? String(unit) : "");

  return arr
    .filter(e => FMP_COUNTRY[e.country])
    .filter(e => toBRTdate(e.date) === todayBRT)
    .map(e => ({
      time: toBRTtime(e.date),
      country: FMP_COUNTRY[e.country],
      title: String(e.event || ""),
      impact: FMP_IMPACT[e.impact] || 1,
      previous: fmtVal(e.previous, e.unit),
      forecast: fmtVal(e.estimate, e.unit),
      actual: fmtVal(e.actual, e.unit),
    }))
    .filter(e => e.title)
    .sort((a, b) => a.time.localeCompare(b.time));
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
  const prompt = "Hoje e " + today + ". Use a busca na web. Em 3 a 4 frases COMPLETAS, resuma o que move os mercados de Brasil e EUA hoje: " +
    "principais eventos/indicadores do dia, juros, cambio (dolar/real), commodities e o sentimento geral (risk-on/risk-off). " +
    "Responda em portugues, texto puro (sem markdown), terminando todas as frases — nao corte no meio.";
  return geminiText({ messages: [{ role: "user", content: prompt }], search: true, maxTokens: 900, temperature: 0.3 });
}

// ─── RSS: manchetes reais (com link) ─────────────────────────────────────────
// Google News RSS é acessível de datacenter (a Vercel) e traz manchetes reais
// com link + nome do veículo. InfoMoney/Money Times entram como reforço, mas
// costumam bloquear requisições de datacenter (Cloudflare) — por isso opcionais.
const gnews = (q) => "https://news.google.com/rss/search?q=" + encodeURIComponent(q + " when:2d") + "&hl=pt-BR&gl=BR&ceid=BR:pt";
const RSS_FEEDS = [
  { url: gnews("Ibovespa OR bolsa OR \"mercado financeiro\""), source: "" },
  { url: gnews("dólar OR juros OR Selic OR \"economia brasil\""), source: "" },
  { url: gnews("Fed OR \"bolsas de Nova York\" OR petróleo OR commodities"), source: "" },
  { url: "https://www.infomoney.com.br/mercados/feed/", source: "InfoMoney" },
];

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;|&#39;|&apos;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "–")
    .replace(/&hellip;|&#8230;/g, "…")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

function pickTag(block, tag) {
  const m = block.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i"));
  return m ? m[1] : "";
}

async function fetchOneFeed(feed) {
  const r = await fetch(feed.url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept": "application/rss+xml, application/xml, text/xml" } });
  if (!r.ok) throw new Error((feed.source || "rss") + " HTTP " + r.status);
  const xml = await r.text();
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  return blocks.map(b => {
    let title = decodeEntities(pickTag(b, "title"));
    const url = decodeEntities(pickTag(b, "link"));
    const pub = pickTag(b, "pubDate");
    const ts = pub ? Date.parse(pub) || 0 : 0;
    // Google News: o veículo vem em <source> e o título termina com " - Veículo".
    const srcTag = decodeEntities(pickTag(b, "source"));
    const source = feed.source || srcTag;
    if (srcTag && title.endsWith(" - " + srcTag)) title = title.slice(0, -(srcTag.length + 3)).trim();
    return { title, url, source, ts };
  }).filter(h => h.title && h.url);
}

async function fetchRssHeadlines() {
  const results = await Promise.allSettled(RSS_FEEDS.map(fetchOneFeed));
  const all = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
  if (!all.length) return [];
  // Dedup por título e ordena pela mais recente.
  const seen = new Set();
  const unique = [];
  for (const h of all.sort((a, b) => b.ts - a.ts)) {
    const key = h.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ title: h.title, url: h.url, source: h.source });
    if (unique.length >= 12) break;
  }
  return unique;
}

// ─── IA: manchetes do mercado (fallback) ─────────────────────────────────────
async function fetchHeadlines(today) {
  const prompt = "Hoje e " + today + ". Use a busca na web. Liste as principais MANCHETES do mercado financeiro de hoje " +
    "(Brasil e global): bolsa/Ibovespa, juros (Selic/Fed), cambio/dolar, commodities, empresas e economia. " +
    'Responda SOMENTE JSON valido (sem markdown): {"headlines":[{"title":"...","source":"..."}]}. ' +
    "De 8 a 12 manchetes objetivas e atuais, em portugues, sem repetir o mesmo assunto.";
  const text = await geminiText({ messages: [{ role: "user", content: prompt }], search: true, maxTokens: 1500, temperature: 0.3 });
  const parsed = extractJSON(text, ['"headlines"']);
  if (!parsed) return [];
  const v = parsed.value || {};
  return (Array.isArray(v.headlines) ? v.headlines : [])
    .map(h => ({ title: String(h.title || "").trim(), source: String(h.source || "").trim(), url: String(h.url || "").trim() }))
    .filter(h => h.title)
    .slice(0, 12);
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
