import { secao, t, ta, eq, ehVerdade, ehFalso, contem, resumo, fakeRedis, chamar } from "./runner.mjs";
import handler, {
  faseDoPregao, diaUtilAnterior, dataBRT, resumoDeBarras, ibovDaCotacao, escolherDestaques,
  normalizarAnalise, montarPrompt, estaCompleto, obterFechamento, MAX_TENT,
} from "../api/_fechamento";
import { parseRss, juntarManchetes } from "../api/_rss";
import { readFileSync, readdirSync } from "node:fs";

// Brasília = UTC-3 (sem horário de verão desde 2019).
const brt = (data, hora) => new Date(`${data}T${hora}:00-03:00`);

secao("fechamento — relógio do pregão");
t("terça 15h: pregão aberto, o fechamento que vale é o de segunda", () => {
  eq(faseDoPregao(brt("2026-10-13", "15:00")), { hoje: "2026-10-13", emPregao: true, alvo: "2026-10-12" });
});
t("terça 18h45: pregão encerrado, o alvo é hoje", () => {
  eq(faseDoPregao(brt("2026-10-13", "18:45")), { hoje: "2026-10-13", emPregao: false, alvo: "2026-10-13" });
});
t("18h29 ainda é pregão (WDO), 18h30 já não", () => {
  ehVerdade(faseDoPregao(brt("2026-10-13", "18:29")).emPregao);
  ehFalso(faseDoPregao(brt("2026-10-13", "18:30")).emPregao);
});
t("antes das 9h o dia não abriu: vale o pregão anterior", () => {
  eq(faseDoPregao(brt("2026-10-13", "08:00")), { hoje: "2026-10-13", emPregao: false, alvo: "2026-10-12" });
  eq(faseDoPregao(brt("2026-10-12", "08:00")).alvo, "2026-10-09", "segunda cedo volta para sexta");
});
t("fim de semana: sem pregão, alvo é a sexta", () => {
  eq(faseDoPregao(brt("2026-10-17", "12:00")), { hoje: "2026-10-17", emPregao: false, alvo: "2026-10-16" });
  eq(faseDoPregao(brt("2026-10-18", "20:00")).alvo, "2026-10-16");
});
t("23h30 em Brasília já é outro dia em UTC — o dia é o de Brasília", () => {
  eq(faseDoPregao(brt("2026-10-13", "23:30")).hoje, "2026-10-13");
});
t("dia útil anterior pula o fim de semana", () => {
  eq(diaUtilAnterior("2026-10-12"), "2026-10-09");
  eq(diaUtilAnterior("2026-10-14"), "2026-10-13");
});
t("dataBRT aceita segundos, ms e ISO, e usa o fuso de Brasília", () => {
  const iso = "2026-10-14T01:00:00Z";            // 22h do dia 13 em Brasília
  eq(dataBRT(iso), "2026-10-13");
  eq(dataBRT(Date.parse(iso)), "2026-10-13");
  eq(dataBRT(Date.parse(iso) / 1000), "2026-10-13");
  eq(dataBRT(null), null); eq(dataBRT("lixo"), null);
});

secao("fechamento — cotações");
const BARS = [
  { date: "2026-10-09", high: 131000, low: 129500, close: 130000 },
  { date: "2026-10-12", high: 131800, low: 129900, close: 131300 },
  { date: "2026-10-13", high: 132500, low: 130800, close: 132613 },
];
t("pega a barra do pregão e calcula a variação contra a anterior", () => {
  eq(resumoDeBarras(BARS, "2026-10-13"), { data: "2026-10-13", fech: 132613, max: 132500, min: 130800, varPct: 1 });
});
t("barra do pregão ainda não publicada: usa a anterior, com a data dela", () => {
  const r = resumoDeBarras(BARS.slice(0, 2), "2026-10-13");
  eq(r.data, "2026-10-12");
  eq(r.varPct, 1);
});
t("barra posterior ao pregão (fonte adiantada) não entra", () => {
  eq(resumoDeBarras(BARS, "2026-10-12").data, "2026-10-12");
});
t("sem barras válidas = null", () => {
  eq(resumoDeBarras([], "2026-10-13"), null);
  eq(resumoDeBarras([{ date: "2026-10-13", high: null, low: 1 }], "2026-10-13"), null);
});
t("Ibovespa: a cotação da brapi define o pregão e traz máx/mín/variação", () => {
  const q = { regularMarketTime: "2026-10-13T20:10:00.000Z", regularMarketPrice: 132613.4, regularMarketDayHigh: 132900, regularMarketDayLow: 130800, regularMarketChangePercent: 0.854 };
  eq(ibovDaCotacao(q, []), { data: "2026-10-13", fech: 132613.4, max: 132900, min: 130800, varPct: 0.85 });
});
t("Ibovespa sem cotação completa cai nas barras diárias", () => {
  eq(ibovDaCotacao({ regularMarketPrice: 1 }, BARS).data, "2026-10-13");
  eq(ibovDaCotacao(null, []), null);
});

secao("fechamento — destaques do dia");
const s = (stock, change, close = 20, volume = 1000, name = "") => ({ stock, change, close, volume, name });
t("3 maiores altas e 3 maiores baixas, em ordem", () => {
  const d = escolherDestaques([s("A3", 1), s("B3", 5), s("C3", -2), s("D3", 3), s("E3", -6), s("F3", 0.5), s("G3", -1)]);
  eq(d.altas.map(x => x.ticker), ["B3", "D3", "A3"]);
  eq(d.baixas.map(x => x.ticker), ["E3", "C3", "G3"]);
  eq(d.altas[0], { ticker: "B3", nome: "", preco: 20, varPct: 5 });
});
t("fica de fora: abaixo de R$ 1, sem negócio, fracionário, repetido e sem variação", () => {
  const d = escolherDestaques([s("PENY3", 40, 0.4), s("PARA3", 30, 10, 0), s("PETR4F", 20), s("OK3", 2), s("OK3", 9), s("NAN3", null), s("X3", -1)]);
  eq(d.altas.map(x => x.ticker), ["OK3", "X3"]);
  eq(d.baixas.map(x => x.ticker), [], "universo pequeno: ninguém aparece nas duas listas");
});
t("lista vazia ou nula não quebra", () => {
  eq(escolherDestaques([]), { altas: [], baixas: [] });
  eq(escolherDestaques(null), { altas: [], baixas: [] });
});

secao("fechamento — o que a IA devolve");
t("normaliza, apara e descarta o que não serve", () => {
  const a = normalizarAnalise({
    resumo: "  Dia de  alta. ", noticias: [{ titulo: "Copom", texto: "Manteve.", efeito: "IBOV subiu." }, { texto: "sem título" }, null],
    ativos: { IBOV: "Subiu.", WIN: "", WDO: "Caiu.", XYZ: "intruso" },
  });
  eq(a, { resumo: "Dia de alta.", noticias: [{ titulo: "Copom", texto: "Manteve.", efeito: "IBOV subiu." }], ativos: { IBOV: "Subiu.", WDO: "Caiu." } });
});
t("no máximo 6 notícias", () => {
  const n = Array.from({ length: 9 }, (_, i) => ({ titulo: "N" + i }));
  eq(normalizarAnalise({ resumo: "x", noticias: n }).noticias.length, 6);
});
t("sem resumo e sem notícia = nada aproveitável", () => {
  eq(normalizarAnalise({ ativos: { IBOV: "x" } }), null);
  eq(normalizarAnalise(null), null); eq(normalizarAnalise("texto"), null);
});
t("o prompt leva os números reais, formatados, e avisa dado atrasado", () => {
  const p = montarPrompt({
    pregao: "2026-10-13",
    ativos: {
      IBOV: { data: "2026-10-13", fech: 132613, max: 132900, min: 130800, varPct: 0.85 },
      WIN: { data: "2026-10-12", fech: 134500, max: 135000, min: 133000, varPct: -0.2, contrato: "WINZ26" },
      WDO: null,
    },
    destaques: { altas: [{ ticker: "PETR4", varPct: 3.1 }], baixas: [{ ticker: "VALE3", varPct: -2 }] },
    manchetes: [{ title: "Ibovespa fecha em alta", source: "Valor" }],
  });
  contem(p, "13/10/2026");
  contem(p, "Ibovespa: fechou em 132.613 (+0,85%), máxima 132.900, mínima 130.800");
  contem(p, "Mini Índice (WINZ26)");
  contem(p, "dado de 12/10/2026");
  contem(p, "Mini Dólar: dado indisponível");
  contem(p, "MAIORES ALTAS: PETR4 +3,10%");
  contem(p, "Ibovespa fecha em alta (Valor)");
  contem(p, "SOMENTE JSON");
});

secao("fechamento — geração, cache e novas tentativas");
const ANALISE = { resumo: "Dia positivo.", noticias: [{ titulo: "Copom", texto: "", efeito: "" }], ativos: { IBOV: "Subiu." } };
const LISTA = { stocks: [s("A3", 4), s("B3", 2), s("C3", 1), s("D3", -1), s("E3", -2), s("F3", -5)], criterio: "market_cap_basic" };
function fontes({ pregao = "2026-10-13", winData = pregao, ia = true, winFalha = false } = {}) {
  const chamadas = { ibov: 0, futuro: 0, lista: 0, manchetes: 0, ia: 0 };
  const f = {
    chamadas,
    ibov: async () => { chamadas.ibov++; return { data: pregao, fech: 132613, max: 132900, min: 130800, varPct: 0.85 }; },
    futuro: async (asset) => {
      chamadas.futuro++;
      if (asset === "WIN" && winFalha) throw new Error("brapi 500");
      return { data: asset === "WIN" ? winData : pregao, fech: asset === "WIN" ? 134500 : 5432.5, max: 1, min: 0, varPct: 0.1, contrato: asset + "Z26" };
    },
    lista: async () => { chamadas.lista++; return LISTA; },
    manchetes: async () => { chamadas.manchetes++; return [{ title: "Ibovespa fecha em alta", url: "https://x", source: "Valor", ts: 1 }]; },
    ia: async () => { chamadas.ia++; if (!ia) throw new Error("cota de IA"); return ANALISE; },
  };
  return f;
}
const DEPOIS = brt("2026-10-13", "19:00");
const MIN = 60 * 1000;
const depois = (min) => new Date(DEPOIS.getTime() + min * MIN);

await ta("durante o pregão não gera nada: devolve o último", async () => {
  const redis = fakeRedis(); const f = fontes();
  const r = await obterFechamento(redis, { agora: brt("2026-10-13", "14:00"), fontes: f });
  eq(r.fechamento, null);
  eq(f.chamadas.ibov, 0);
});
await ta("depois das 18h30, sem fechamento: gera, grava e marca como último", async () => {
  const redis = fakeRedis(); const f = fontes();
  const r = await obterFechamento(redis, { agora: DEPOIS, fontes: f });
  eq(r.fechamento.data, "2026-10-13");
  ehVerdade(r.fechamento.completo);
  eq(r.fechamento.destaques.altas.map(x => x.ticker), ["A3", "B3", "C3"]);
  eq(r.fechamento.destaques.criterio, "market_cap_basic");
  eq(r.fechamento.manchetes, [{ title: "Ibovespa fecha em alta", url: "https://x", source: "Valor" }], "sem o ts interno");
  eq(await redis.get("forcehub:fechamento:ultimo"), "2026-10-13");
  eq(await redis.get("forcehub:fechamento:lock"), null, "a trava é liberada no fim");
});
await ta("completo: os próximos acessos só leem (sem rede, sem IA)", async () => {
  const redis = fakeRedis(); const f = fontes();
  await obterFechamento(redis, { agora: DEPOIS, fontes: f });
  const r = await obterFechamento(redis, { agora: depois(40), fontes: f });
  eq(r.fechamento.data, "2026-10-13");
  eq(f.chamadas.ibov, 1); eq(f.chamadas.ia, 1);
});
await ta("no dia seguinte, durante o pregão, mostra o de ontem", async () => {
  const redis = fakeRedis(); const f = fontes();
  await obterFechamento(redis, { agora: DEPOIS, fontes: f });
  const r = await obterFechamento(redis, { agora: brt("2026-10-14", "11:00"), fontes: f });
  eq(r.fechamento.data, "2026-10-13");
  ehVerdade(r.fase.emPregao);
});
await ta("WIN do pregão ainda não publicado: grava parcial e só tenta de novo após 15 min", async () => {
  const redis = fakeRedis(); const f = fontes({ winData: "2026-10-12" });
  const r1 = await obterFechamento(redis, { agora: DEPOIS, fontes: f });
  ehFalso(r1.fechamento.completo);
  eq(r1.fechamento.ativos.WIN.data, "2026-10-12");
  await obterFechamento(redis, { agora: depois(5), fontes: f });
  eq(f.chamadas.ibov, 1, "dentro de 15 min não refaz");
  const f2 = fontes();                          // agora o WIN do dia saiu
  const r3 = await obterFechamento(redis, { agora: depois(16), fontes: f2 });
  ehVerdade(r3.fechamento.completo);
  eq(r3.fechamento.tentativas, 2);
  eq(f2.chamadas.ia, 1, "a análise é refeita junto (cita os números)");
});
await ta("parcial para de tentar depois de MAX_TENT tentativas", async () => {
  const redis = fakeRedis();
  let f;
  for (let i = 0; i < MAX_TENT + 3; i++) {
    f = fontes({ winData: "2026-10-12" });
    await obterFechamento(redis, { agora: depois(i * 16), fontes: f });
  }
  eq((await redis.get("forcehub:fechamento:2026-10-13")).tentativas, MAX_TENT);
  eq(f.chamadas.ibov, 0, "esgotado: nem consulta a fonte");
});
await ta("feriado: a cotação do Ibovespa é de ontem e ontem já está completo — não refaz", async () => {
  const redis = fakeRedis();
  await obterFechamento(redis, { agora: brt("2026-10-12", "19:00"), fontes: fontes({ pregao: "2026-10-12" }) });
  const f = fontes({ pregao: "2026-10-12" });
  const r = await obterFechamento(redis, { agora: DEPOIS, fontes: f });
  eq(r.fechamento.data, "2026-10-12");
  eq(f.chamadas.ibov, 1); eq(f.chamadas.ia, 0);
});
await ta("outro acesso gerando agora: responde 'gerando' sem gerar em dobro", async () => {
  const redis = fakeRedis(); const f = fontes();
  await redis.set("forcehub:fechamento:lock", depois(-0.5).getTime());
  const r = await obterFechamento(redis, { agora: DEPOIS, fontes: f });
  ehVerdade(r.gerando);
  eq(f.chamadas.ibov, 0);
});
await ta("trava esquecida (processo morto) expira e não bloqueia para sempre", async () => {
  const redis = fakeRedis(); const f = fontes();
  await redis.set("forcehub:fechamento:lock", depois(-10).getTime());
  const r = await obterFechamento(redis, { agora: DEPOIS, fontes: f });
  ehFalso(r.gerando);
  eq(r.fechamento.data, "2026-10-13");
});
await ta("IA falhou: grava o resto, mantém a análise anterior e fica parcial", async () => {
  const redis = fakeRedis();
  await obterFechamento(redis, { agora: DEPOIS, fontes: fontes() });
  const r = await obterFechamento(redis, { agora: depois(1), forcar: true, fontes: fontes({ ia: false }) });
  eq(r.fechamento.analise, ANALISE);
  ehFalso(r.fechamento.completo, "análise herdada cita números velhos");
  ehVerdade(r.fechamento.erros.some(e => e.startsWith("ia:")));
});
await ta("WIN caiu na fonte: mantém o WIN da tentativa anterior", async () => {
  const redis = fakeRedis();
  await obterFechamento(redis, { agora: DEPOIS, fontes: fontes() });
  const r = await obterFechamento(redis, { agora: depois(1), forcar: true, fontes: fontes({ winFalha: true }) });
  eq(r.fechamento.ativos.WIN.contrato, "WINZ26");
  ehVerdade(r.fechamento.erros.some(e => e.startsWith("WIN:")));
});
await ta("Ibovespa indisponível: devolve o erro e o último fechamento, sem gravar lixo", async () => {
  const redis = fakeRedis(); const f = fontes(); f.ibov = async () => null;
  const r = await obterFechamento(redis, { agora: DEPOIS, fontes: f });
  contem(r.erro, "Ibovespa");
  eq(r.fechamento, null);
  eq(await redis.get("forcehub:fechamento:ultimo"), null);
});
t("estaCompleto exige os 3 ativos do pregão, destaques e análise", () => {
  const ok = { data: "D", ativos: { IBOV: { data: "D", fech: 1 }, WIN: { data: "D", fech: 1 }, WDO: { data: "D", fech: 1 } }, destaques: { altas: [{}] }, analise: {} };
  ehVerdade(estaCompleto(ok));
  ehFalso(estaCompleto({ ...ok, analise: null }));
  ehFalso(estaCompleto({ ...ok, destaques: { altas: [] } }));
  ehFalso(estaCompleto({ ...ok, ativos: { ...ok.ativos, WDO: { data: "D", fech: null } } }));
});

secao("fechamento — acesso");
const CLI = { user: "c1", name: "C1", role: "client", perms: ["panorama"] };
const SEM = { user: "c2", name: "C2", role: "client", perms: ["trades"] };
await ta("sem sessão = 401; sem o Panorama = 403", async () => {
  const redis = fakeRedis();
  eq((await chamar(handler, { query: { leve: "1" }, redis })).status, 401);
  eq((await chamar(handler, { query: { leve: "1" }, session: SEM, redis })).status, 403);
});
await ta("cliente lê (leitura leve não gera)", async () => {
  const redis = fakeRedis();
  await obterFechamento(redis, { agora: DEPOIS, fontes: fontes() });
  const r = await chamar(handler, { query: { leve: "1" }, session: CLI, redis });
  eq(r.status, 200);
  eq(r.body.fechamento.data, "2026-10-13");
  ehVerdade(r.body.fase && r.body.fase.hoje);
});
await ta("só staff refaz (POST)", async () => {
  const r = await chamar(handler, { method: "POST", session: CLI, redis: fakeRedis() });
  eq(r.status, 403);
});

secao("fechamento — RSS compartilhado com as notícias");
t("lê item do Google News e tira o ' - Veículo' do título", () => {
  const xml = `<rss><channel><item><title>Ibovespa fecha em alta - Valor</title><link>https://n/1</link><pubDate>Tue, 13 Oct 2026 21:00:00 GMT</pubDate><source url="x">Valor</source></item><item><title>sem link</title></item></channel></rss>`;
  eq(parseRss(xml), [{ title: "Ibovespa fecha em alta", url: "https://n/1", source: "Valor", ts: Date.parse("Tue, 13 Oct 2026 21:00:00 GMT") }]);
});
t("junta feeds: sem repetição, mais recente primeiro, filtro antes do corte", () => {
  const a = [{ title: "A", ts: 1 }, { title: "B", ts: 3 }];
  const b = [{ title: "a", ts: 5 }, { title: "C", ts: 2 }];
  eq(juntarManchetes([a, b]).map(h => h.title), ["a", "B", "C"]);
  eq(juntarManchetes([a, b], { filtro: h => h.ts < 3 }).map(h => h.title), ["C", "A"]);
  eq(juntarManchetes([a, b], { max: 1 }).length, 1);
});

secao("fechamento — ligado na rota, na cron e na tela");
t("roteador de mercado + rewrite /api/fechamento", () => {
  contem(readFileSync("api/market.js", "utf8"), "fechamento };");
  const v = JSON.parse(readFileSync("vercel.json", "utf8"));
  ehVerdade(v.rewrites.some(r => r.source === "/api/fechamento" && r.destination === "/api/market?kind=fechamento"));
});
t("continua no teto de 12 funções da Vercel", () => {
  eq(readdirSync("api").filter(f => f.endsWith(".js") && !f.startsWith("_")).length, 12);
});
t("a cron das 19h30 gera o fechamento", () => contem(readFileSync("api/_cron.js", "utf8"), "await obterFechamento(redis)"));
t("as notícias usam o RSS compartilhado", () => {
  const n = readFileSync("api/news.js", "utf8");
  contem(n, 'from "./_rss"');
  ehFalso(/function decodeEntities/.test(n), "news.js voltou a ter cópia do parser");
});
t("botão no Panorama abre o modal", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const pan = app.slice(app.indexOf("function PanoramaScreen"));
  ehVerdade(/<FechamentoBotao info=\{fechInfo\}/.test(pan));
  ehVerdade(/<FechamentoModal session=\{session\}/.test(pan));
  contem(app, 'api.get("/api/fechamento?leve=1")');
});
t("o botão fica abaixo das cotações e acima de notícias/panorama", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const pan = app.slice(app.indexOf("function PanoramaScreen"));
  const botao = pan.indexOf("<FechamentoBotao");
  ehVerdade(pan.indexOf('<MarketBoard title="Cripto"') < botao, "precisa vir depois dos painéis de cotação");
  ehVerdade(botao < pan.indexOf('<div className="fh-news-grid">'), "precisa vir antes de Panorama IA + Notícias");
});
console.log("");
process.exit(resumo() ? 1 : 0);
