// api/_rss.js — Leitura de feeds RSS de notícias (Google News + veículos).
// Prefixo "_": não vira rota. Saiu de news.js quando o Fechamento do dia
// (api/_fechamento.js) passou a precisar das mesmas manchetes — duas cópias do
// parser seriam pedir para as duas divergirem.
//
// Google News RSS é acessível de datacenter (a Vercel) e traz manchetes reais
// com link + nome do veículo. InfoMoney/Money Times entram como reforço, mas
// costumam bloquear requisições de datacenter (Cloudflare) — por isso opcionais.

// Busca do Google News em português, limitada aos últimos `janela` (ex.: "1d").
export const gnews = (q, janela = "2d") => "https://news.google.com/rss/search?q=" + encodeURIComponent(q + " when:" + janela) + "&hl=pt-BR&gl=BR&ceid=BR:pt";

export function decodeEntities(s) {
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

// Lê o XML de um feed e devolve [{ title, url, source, ts }].
export function parseRss(xml, fonteFixa = "") {
  const blocks = String(xml || "").split(/<item[\s>]/i).slice(1);
  return blocks.map(b => {
    let title = decodeEntities(pickTag(b, "title"));
    const url = decodeEntities(pickTag(b, "link"));
    const pub = pickTag(b, "pubDate");
    const ts = pub ? Date.parse(pub) || 0 : 0;
    // Google News: o veículo vem em <source> e o título termina com " - Veículo".
    const srcTag = decodeEntities(pickTag(b, "source"));
    const source = fonteFixa || srcTag;
    if (srcTag && title.endsWith(" - " + srcTag)) title = title.slice(0, -(srcTag.length + 3)).trim();
    return { title, url, source, ts };
  }).filter(h => h.title && h.url);
}

async function fetchOneFeed(feed) {
  const r = await fetch(feed.url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept": "application/rss+xml, application/xml, text/xml" } });
  if (!r.ok) throw new Error((feed.source || "rss") + " HTTP " + r.status);
  return parseRss(await r.text(), feed.source);
}

// Tira repetição por título e ordena da mais recente para a mais antiga.
// `filtro(item)` restringe antes do corte (ex.: só as do pregão).
export function juntarManchetes(listas, { max = 12, filtro = null } = {}) {
  let all = (listas || []).flat().filter(Boolean);
  if (filtro) all = all.filter(filtro);
  const seen = new Set();
  const unique = [];
  for (const h of all.sort((a, b) => b.ts - a.ts)) {
    const key = h.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(h);
    if (unique.length >= max) break;
  }
  return unique;
}

// Lê vários feeds em paralelo; um feed que falhe só fica de fora.
export async function lerFeeds(feeds, opts) {
  const results = await Promise.allSettled(feeds.map(fetchOneFeed));
  return juntarManchetes(results.map(r => r.status === "fulfilled" ? r.value : []), opts);
}
