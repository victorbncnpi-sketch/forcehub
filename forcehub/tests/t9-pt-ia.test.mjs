import { secao, t, ta, eq, ehVerdade, ehFalso, contem, resumo } from "./runner.mjs";
import { dadosParaIA, montarPrompt, limparTexto, gerarDiagnosticoIA, SISTEMA, estadoInicial, MAX_TEXTO } from "../api/_pt-ia";
import { readFileSync } from "node:fs";

await (async () => {
const CICLO = { nome: "André Gain", status: "ativo", diasPrevistos: 30,
  diagnostico: { capitalOperacional: 18000, prejuizoPassado: 15000, experiencia: "2 anos", outraRenda: true, observacoes: "SEGREDO DO MENTOR" },
  notas: "ANOTACAO PRIVADA" };
const PLANO = { ativo: "WIN", contratos: 2, pontosAlvo: 150, pontosStop: 100, horaInicio: "09:15", horaFim: "17:00", setups: ["Rompimento"] };
const ENVIOS = [{ data: "2026-11-10", dia: { resultado: -60, ops: 3 }, violacoes: [{ tipo: "sem_stop" }, { tipo: "sem_stop" }], emocional: 2,
  resumo: "Forcei a mão.", feedback: { geral: "Pare após o 2º stop." } }];

secao("diagnóstico por IA — o que vai para a IA");
t("leva plano, números, últimos dias, alertas e perfil", () => {
  const d = dadosParaIA({ ciclo: CICLO, plano: PLANO, real: { diasOperados: 1, resultado: -60, aderencia: 33 }, envios: ENVIOS,
    alertas: [{ tipo: "tilt", texto: "3 perdas seguidas" }, { tipo: "aguardando", texto: "1 envio aguardando" }], tags: [{ tag: "Tirou o stop", total: 2, tendencia: "subiu" }] });
  eq(d.primeiroNome, "André");
  eq(d.plano.horario, "09:15–17:00");
  eq(d.ultimosDias[0].regrasQuebradas, ["sem_stop"]);
  eq(d.ultimosDias[0].feedbackDoMentor, "Pare após o 2º stop.");
  eq(d.alertas, ["3 perdas seguidas"], "lembrete operacional do mentor não interessa ao aluno");
  eq(d.perfil.experiencia, "2 anos"); eq(d.perfil.prejuizoPassado, 15000);
});
t("observações e anotações privadas do mentor NÃO entram no prompt", () => {
  const p = montarPrompt(dadosParaIA({ ciclo: CICLO, plano: PLANO, real: {}, envios: ENVIOS }));
  ehFalso(p.includes("SEGREDO DO MENTOR")); ehFalso(p.includes("ANOTACAO PRIVADA"));
  ehFalso(p.includes("18000"), "capital operacional não vai para a IA");
});
t("dados vazios não explodem", () => { dadosParaIA({}); montarPrompt(dadosParaIA({})); });
t("instrução: tom de mentor amigável, sem jargão, sem citar valores financeiros", () => {
  contem(SISTEMA, "mentor amigável"); contem(SISTEMA, "Sem jargão");
  contem(SISTEMA, "Nunca cite valores de capital nem o valor do prejuízo passado");
  contem(SISTEMA, "Não prometa ganhos");
});

secao("diagnóstico por IA — texto devolvido");
t("tira markdown e mantém parágrafos", () => {
  eq(limparTexto("## Olá\n\n**André**, você foi bem.\n\n- ponto 1\n\n\n\nFim."), "Olá\n\nAndré, você foi bem.\n\nponto 1\n\nFim.");
});
t("corta no limite", () => eq(limparTexto("a".repeat(MAX_TEXTO + 50)).length, MAX_TEXTO));
await ta("gera com a função de IA injetada", async () => {
  let pedido = null;
  const texto = await gerarDiagnosticoIA({ primeiroNome: "André" }, { gerar: async (q) => { pedido = q; return "**André**, " + "você manteve o horário. ".repeat(6); } });
  ehVerdade(texto.startsWith("André, você manteve"));
  eq(pedido.system, SISTEMA); contem(pedido.messages[0].content, "André");
});
await ta("resposta vazia ou curta vira erro (não grava lixo)", async () => {
  let erro = null;
  try { await gerarDiagnosticoIA({}, { gerar: async () => "ok" }); } catch (e) { erro = e.message; }
  contem(erro, "tente gerar de novo");
});
t("estado inicial tolera lixo", () => {
  eq(estadoInicial(null).publicado, null);
  eq(estadoInicial({ publicado: { texto: "" } }).publicado, null);
  eq(estadoInicial({ rascunho: 5 }).rascunho, "");
});

secao("telas");
t("aluno vê o card; mentor revisa na aba Diagnóstico", () => {
  const src = readFileSync("src/personal.jsx", "utf8");
  contem(src, "<DiagnosticoMomento diag={jornada.diagnosticoMomento} />");
  contem(src, "<PainelDiagnosticoIA user={aluno.user}");
  ehFalso(/Capital total|Aporte mensal/.test(src), "campos removidos voltaram");
  contem(src, "Prejuízo passado (R$)");
});

console.log("");
process.exit(resumo() ? 1 : 0);
})();
