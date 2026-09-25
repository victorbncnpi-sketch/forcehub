import { secao, t, eq, ehVerdade, ehFalso, resumo } from "./runner.mjs";
import { ehMes, rotuloMes, mesesDe, NOMES_MES } from "../src/shared";
import { readFileSync } from "node:fs";

secao("seletor de mês — helpers");
t("ehMes reconhece só AAAA-MM válido", () => {
  ehVerdade(ehMes("2026-09")); ehVerdade(ehMes("2026-01")); ehVerdade(ehMes("2026-12"));
  ehFalso(ehMes("2026-13")); ehFalso(ehMes("2026-00")); ehFalso(ehMes("2026-9"));
  ehFalso(ehMes("2026-09-01"));
});
t("chips de período e janelas numéricas não são mês", () => {
  for (const v of ["tudo", "30d", "90d", "ano", "hoje", "7d", 30, 0, null, undefined, ""]) ehFalso(ehMes(v), String(v));
});
t("rotuloMes escreve o mês por extenso", () => {
  eq(rotuloMes("2026-09"), "Setembro de 2026");
  eq(rotuloMes("2025-03"), "Março de 2025");
  eq(rotuloMes("tudo"), "");
});
t("doze nomes de mês, em ordem", () => { eq(NOMES_MES.length, 12); eq(NOMES_MES[0], "Janeiro"); eq(NOMES_MES[11], "Dezembro"); });
t("mesesDe tira repetição e ordena do mais recente ao mais antigo", () => {
  eq(mesesDe(["2026-07", "2026-09", "2026-07", "2025-12", "2026-08"]), ["2026-09", "2026-08", "2026-07", "2025-12"]);
});
t("mesesDe ignora lixo e lista vazia", () => {
  eq(mesesDe(["2026-09", "", null, "xx", "2026-9"]), ["2026-09"]);
  eq(mesesDe([]), []); eq(mesesDe(null), []);
});

secao("seletor de mês — filtro por mês separa certo");
// Mesmo formato das datas do Diário e da série de amplitude (AAAA-MM-DD).
const ops = [
  { data: "2026-07-31", fin: 100 }, { data: "2026-08-01", fin: -40 },
  { data: "2026-08-29", fin: 60 }, { data: "2026-09-01", fin: 25 },
  { data: "2025-08-15", fin: 999 }, // mesmo mês, outro ano: não pode entrar
];
const doMes = (ym) => ops.filter(o => o.data.startsWith(ym));
t("agosto/2026 pega só agosto de 2026 (bordas do mês incluídas)", () => {
  eq(doMes("2026-08").map(o => o.data), ["2026-08-01", "2026-08-29"]);
  eq(doMes("2026-08").reduce((s, o) => s + o.fin, 0), 20);
});
t("o ano faz parte do filtro", () => eq(doMes("2025-08").length, 1));
t("os meses oferecidos são os que têm dado", () => eq(mesesDe(ops.map(o => o.data.slice(0, 7))), ["2026-09", "2026-08", "2026-07", "2025-08"]));

secao("seletor de mês — presente em todos os filtros de período");
const app = readFileSync("src/App.jsx", "utf8");
t("Dashboard, Ranking da Turma e Estudo de Amplitude têm o seletor", () => {
  eq((app.match(/<MesSelect /g) || []).length, 3);
});
t("cada filtro de período trata o valor-mês", () => {
  ehVerdade(/ehMes\(periodo\) \? e\.ym === periodo/.test(app), "Dashboard não filtra por mês");
  ehVerdade(/mesRank \? \(e => e\.ym === mesRank\)/.test(app), "Ranking não filtra por mês");
  ehVerdade(/ehMes\(janela\)/.test(app), "Amplitude não filtra por mês");
});
console.log("");
process.exit(resumo() ? 1 : 0);
