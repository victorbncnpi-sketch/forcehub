import { secao, t, eq, ehVerdade, ehFalso, contem, resumo } from "./runner.mjs";
import { parseProfitCsv, brNum, brDateTime, rootAtivo, deburr } from "../src/shared";
import { readFileSync } from "node:fs";


// Layout real do relatório "Operações" do Profit: preâmbulo + grade ;-separada.
const CSV = [
  "Conta;12345",
  "Titular;ANDRE GAIN",
  "Periodo;01/09/2026 a 30/09/2026",
  "",
  "Ativo;Abertura;Fechamento;Lado;Qtd;Preço Compra;Preço Venda;Res. Operação;Res. Operação (%)",
  "WINV26;10/09/2026 09:32:14;10/09/2026 09:41:02;C;2;142.500;142.650;60,00;0,10",
  "WINV26;10/09/2026 10:05:33;10/09/2026 10:22:10;V;2;142.300;142.200;-40,00;-0,07",
  "WINV26;11/09/2026 09:20:00;11/09/2026 09:35:00;C;4;141.900;142.100;160,00;0,14",
  "WDOV26;11/09/2026 14:00:00;11/09/2026 14:10:00;C;1;5.432,50;5.435,00;25,00;0,05",
  "LIXO;sem data;;;;;;;",
  "",
].join("\r\n");

secao("helpers de parsing");
t("brNum lê o formato BR", () => { eq(brNum("1.234,50"), 1234.5); eq(brNum("-40,00"), -40); eq(brNum("0"), 0); });
t("brNum rejeita lixo", () => { eq(brNum("abc"), null); eq(brNum(""), null); eq(brNum(null), null); });
t("brDateTime separa data e hora", () => eq(brDateTime("10/09/2026 09:32:14"), { data: "2026-09-10", hora: "09:32:14" }));
t("brDateTime sem hora", () => eq(brDateTime("10/09/2026"), { data: "2026-09-10", hora: "" }));
t("rootAtivo corta o vencimento do futuro", () => {
  eq(rootAtivo("WINV26"), "WIN"); eq(rootAtivo("WDOG26"), "WDO"); eq(rootAtivo("PETR4"), "PETR4");
});
t("deburr tira acento e caixa", () => eq(deburr(" Res. Operação "), "res. operacao"));

secao("parseProfitCsv — regressão do Diário");
const r = parseProfitCsv(CSV, null);
t("sem erro e encontra a coluna de resultado", () => { eq(r.error, undefined); contem(r.resCol, "Res. Operação"); });
t("lê as 4 operações válidas e descarta a linha suja", () => { eq(r.trades.length, 4); eq(r.invalid, 1); });
t("campos originais preservados (o Diário depende deles)", () => {
  const t0 = r.trades[0];
  eq(t0.data, "2026-09-10"); eq(t0.ativo, "WIN"); eq(t0.direcao, "COMPRA");
  eq(t0.fin, 60); eq(t0.r, null); eq(t0.notas, "WINV26");
  contem(t0.ext, "profit:WINV26:2026-09-10 09:32:14:60");
});
t("ext continua único por operação (dedup do Diário)", () => {
  eq(new Set(r.trades.map(t => t.ext)).size, 4);
});
t("direção lida da coluna Lado", () => eq(r.trades.map(t => t.direcao), ["COMPRA","VENDA","COMPRA","COMPRA"]));

secao("parseProfitCsv — campos NOVOS do Personal Trader");
t("hora vem em HH:MM", () => eq(r.trades.map(t => t.hora), ["09:32","10:05","09:20","14:00"]));
t("qtd (contratos) vem da coluna Qtd", () => eq(r.trades.map(t => t.qtd), [2,2,4,1]));
t("qtd combinada com o lado ('6 C') também é lida", () => {
  const csv2 = ["Ativo;Abertura;Lado;Qtd;Res. Operação",
                "WINV26;10/09/2026 09:32:14;C;6 C;60,00"].join("\n");
  eq(parseProfitCsv(csv2, null).trades[0].qtd, 6);
});
t("sem coluna Qtd, qtd vira null (e o plano decide)", () => {
  const csv3 = ["Ativo;Abertura;Fechamento;Lado;Res. Operação", "WINV26;10/09/2026 09:32:14;;C;60,00"].join("\n");
  eq(parseProfitCsv(csv3, null).trades[0].qtd, null);
});

secao("parseProfitCsv — robustez");
t("cabeçalho irreconhecível devolve erro explicativo", () => {
  const e = parseProfitCsv("nada;disso;aqui", null);
  ehVerdade(e.error); contem(e.error, "Profit");
});
t("export ENXUTO (5 colunas) é aceito — piso de colunas do cabeçalho", () => {
  const csv = ["Ativo;Abertura;Lado;Qtd;Res. Operação", "WINV26;10/09/2026 09:32:14;C;2;60,00"].join("\n");
  const e = parseProfitCsv(csv, null);
  eq(e.error, undefined, "export enxuto não pode ser recusado: " + e.error);
  eq(e.trades[0].fin, 60);
});
t("sem coluna de resultado em R$ avisa em vez de adivinhar", () => {
  const csv = ["Ativo;Abertura;Lado;Qtd;Res. Operação (%)", "WINV26;10/09/2026 09:32:14;C;2;0,10"].join("\n");
  const e = parseProfitCsv(csv, null);
  ehVerdade(e.error, "deveria recusar"); contem(e.error, "pontos");
});
t("preâmbulo do Profit não vira cabeçalho por engano", () => {
  const csv = ["Conta;12345", "Titular;X", "Periodo;01/09 a 30/09", "",
               "Ativo;Abertura;Lado;Qtd;Res. Operação", "WINV26;10/09/2026 09:32:14;C;2;60,00"].join("\n");
  eq(parseProfitCsv(csv, null).trades.length, 1);
});
t("nunca confunde a coluna de % com a de R$", () => {
  const csv = ["Ativo;Abertura;Lado;Qtd;Res. Operação (%);Res. Operação",
               "WINV26;10/09/2026 09:32:14;C;2;0,10;60,00"].join("\n");
  eq(parseProfitCsv(csv, null).trades[0].fin, 60);
});
t("Diário PERSISTE hora e qtd (senão o Personal Trader fica cego)", async () => {
  const src = readFileSync("api/trades.js", "utf8");
  ehVerdade(/hora:/.test(src), "sanitizeTrades não grava hora");
  ehVerdade(/qtd:/.test(src), "sanitizeTrades não grava qtd");
});
t("arquivo vazio não explode", () => { parseProfitCsv("", null); parseProfitCsv(null, null); });

secao("integração CSV -> Personal Trader");
t("o filtro por dia do EnviarDia separa certo", () => {
  const dia = r.trades.filter(t => t.data === "2026-09-10");
  eq(dia.length, 2);
  eq(dia.reduce((s, t) => s + t.fin, 0), 20);
});
t("as operações do CSV entram no motor com hora e contratos reais", async () => {
  const { sanitizeOperacoes } = await import("../api/_pt");
  const { analisarEnvio } = await import("../api/_pt-regras");
  const P = { valorPonto: 0.2, pontosAlvo: 150, pontosStop: 100, contratos: 2, ganhoDiarioAlvo: 500,
    prejuizoDiarioLimite: 500, horaInicio: "09:15", horaFim: "17:00", setups: [] };
  const ops = sanitizeOperacoes(r.trades.filter(t => t.data === "2026-09-11")
    .map(t => ({ hora: t.hora, ativo: t.ativo, direcao: t.direcao, contratos: t.qtd, resultado: t.fin })), 2);
  const a = analisarEnvio({ operacoes: ops }, P);
  eq(a.operacoes.map(o => o.contratos), [4, 1]);
  ehVerdade(a.violacoes.some(v => v.tipo === "contratos_acima"), "4 contratos deveria violar o teto de 2");
});
console.log("");
process.exit(resumo() ? 1 : 0);
