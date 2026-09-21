import { secao, t, eq, ehVerdade, ehFalso, contem, resumo } from "./runner.mjs";
import {
  camposCalculados, avisosDoPlano, planoVigenteEm, analisarEnvio, quadroGerenciamento,
  projecao, comparaProjecao, alertasDoAluno, consolidaCiclo, mapaDeTags, projecaoRecalibrada,
} from "../api/_pt-regras";

const P = {
  versao: 1, vigenciaInicio: "2026-09-01", ativo: "WIN", valorPonto: 0.2,
  pontosAlvo: 150, pontosStop: 100, contratos: 2, ganhoDiarioAlvo: 120,
  prejuizoDiarioLimite: 80, metaMensal: 2000, diasPrevistosOperando: 20,
  horaInicio: "09:15", horaFim: "17:00", setups: ["Rompimento", "Pullback"],
  operacoesDia: 4, winRateAlvo: 0.5,
};
const env = (ops, data = "2026-09-10") => ({ data, operacoes: ops });
const op = (hora, resultado, extra = {}) => ({ hora, resultado, contratos: 2, setup: "Rompimento", ...extra });

secao("camposCalculados — degenerados");
t("plano vazio não explode e devolve nulos", () => {
  const c = camposCalculados({});
  eq(c.payoff, null); eq(c.maxOperacoesPerdedorasDia, null); eq(c.ganhoDiarioNecessario, null);
});
t("plano null não explode", () => { camposCalculados(null); camposCalculados(undefined); });
t("stop zero não divide por zero", () => eq(camposCalculados({ ...P, pontosStop: 0 }).payoff, null));
t("valores negativos são tratados como ausentes", () => {
  const c = camposCalculados({ ...P, contratos: -5 });
  eq(c.riscoPorOperacao, 0);
});
t("cálculo correto no caso feliz", () => {
  const c = camposCalculados(P);
  eq(c.payoff, 1.5); eq(c.riscoPorOperacao, 40); eq(c.ganhoPorOperacao, 60);
  eq(c.maxOperacoesPerdedorasDia, 2); eq(c.ganhoDiarioNecessario, 100);
});

secao("avisosDoPlano — os 4 do COMANDO 4");
t("meta agressiva", () => {
  const a = avisosDoPlano({ ...P, metaMensal: 4000 }, {}).map(x => x.tipo);
  ehVerdade(a.includes("meta_agressiva"), "esperava meta_agressiva, veio " + a);
});
t("payoff < 1", () => {
  const a = avisosDoPlano({ ...P, pontosAlvo: 50 }, {}).map(x => x.tipo);
  ehVerdade(a.includes("payoff_baixo"));
});
t("risco > 2% do capital", () => {
  const a = avisosDoPlano(P, { capitalOperacional: 1000 }).map(x => x.tipo);
  ehVerdade(a.includes("risco_elevado"));
});
t("risco <= 2% NÃO alerta (fronteira exata)", () => {
  const a = avisosDoPlano(P, { capitalOperacional: 2000 }).map(x => x.tipo);  // 40/2000 = 2,0%
  ehFalso(a.includes("risco_elevado"), "2,0% exato não deve alertar");
});
t("stop diário apertado", () => {
  const a = avisosDoPlano({ ...P, prejuizoDiarioLimite: 50 }, {}).map(x => x.tipo); // cabe 1
  ehVerdade(a.includes("stop_diario_apertado"));
});
t("plano saudável não gera aviso", () => eq(avisosDoPlano(P, { capitalOperacional: 20000 }).length, 0));
t("textos saem em pt-BR (vírgula decimal, sem ponto)", () => {
  const txt = avisosDoPlano({ ...P, metaMensal: 4000 }, {})[0].texto;
  contem(txt, "R$ 200,00"); ehFalso(/\d\.\d\d\b/.test(txt), "não pode ter ponto decimal: " + txt);
});

secao("planoVigenteEm — versionamento");
const v2 = { ...P, versao: 2, vigenciaInicio: "2026-09-15" };
t("antes da v2 devolve v1", () => eq(planoVigenteEm([P, v2], "2026-09-14").versao, 1));
t("no dia exato da vigência já é v2", () => eq(planoVigenteEm([P, v2], "2026-09-15").versao, 2));
t("antes de qualquer vigência cai na primeira", () => eq(planoVigenteEm([P, v2], "2020-01-01").versao, 1));
t("lista fora de ordem ainda resolve certo", () => eq(planoVigenteEm([v2, P], "2026-09-20").versao, 2));
t("lista vazia devolve null", () => eq(planoVigenteEm([], "2026-09-20"), null));
t("lista com buracos não explode", () => eq(planoVigenteEm([null, P, undefined], "2026-09-20").versao, 1));

secao("analisarEnvio — as 6 violações");
t("contratos_acima", () => {
  const r = analisarEnvio(env([op("10:00", 60, { contratos: 5 })]), P);
  eq(r.violacoes.map(v => v.tipo), ["contratos_acima"]);
});
t("contratos iguais ao teto NÃO violam", () => {
  const r = analisarEnvio(env([op("10:00", 60, { contratos: 2 })]), P);
  eq(r.violacoes.length, 0);
});
t("fora_de_horario antes da abertura", () => {
  const r = analisarEnvio(env([op("09:00", 60)]), P);
  eq(r.violacoes.map(v => v.tipo), ["fora_de_horario"]);
});
t("fora_de_horario depois do fim", () => {
  const r = analisarEnvio(env([op("17:01", 60)]), P);
  eq(r.violacoes.map(v => v.tipo), ["fora_de_horario"]);
});
t("horário exato nas bordas NÃO viola", () => {
  eq(analisarEnvio(env([op("09:15", 60)]), P).violacoes.length, 0);
  eq(analisarEnvio(env([op("17:00", 60)]), P).violacoes.length, 0);
});
t("operação sem hora não gera fora_de_horario", () => {
  eq(analisarEnvio(env([op("", 60)]), P).violacoes.length, 0);
});
t("sem_stop quando perde mais que o stop + tolerância", () => {
  // stop 100 pts, tolerância 15% -> 115 pts. R$ -48 / 0,4 = -120 pts
  const r = analisarEnvio(env([op("10:00", -48)]), P);
  eq(r.violacoes.map(v => v.tipo), ["sem_stop"]);
});
t("perda dentro da tolerância NÃO viola (slippage)", () => {
  const r = analisarEnvio(env([op("10:00", -44)]), P); // -110 pts < 115
  eq(r.violacoes.length, 0);
});
t("ganho grande nunca vira sem_stop", () => {
  eq(analisarEnvio(env([op("10:00", 1000)]), P).violacoes.filter(v => v.tipo === "sem_stop").length, 0);
});
t("setup_nao_autorizado", () => {
  const r = analisarEnvio(env([op("10:00", 60, { setup: "Scalp" })]), P);
  eq(r.violacoes.map(v => v.tipo), ["setup_nao_autorizado"]);
});
t("plano sem lista de setups não checa setup", () => {
  const r = analisarEnvio(env([op("10:00", 60, { setup: "Qualquer" })]), { ...P, setups: [] });
  eq(r.violacoes.length, 0);
});
t("operação sem setup não viola", () => {
  eq(analisarEnvio(env([op("10:00", 60, { setup: "" })]), P).violacoes.length, 0);
});
t("prejuizo_diario quando o dia fecha no limite", () => {
  const r = analisarEnvio(env([op("10:00", -80)]), P);
  ehVerdade(r.violacoes.some(v => v.tipo === "prejuizo_diario"));
});
t("dia que TOCA o limite e recupera: sem prejuizo_diario, mas com overtrading", () => {
  const r = analisarEnvio(env([op("10:00", -80), op("11:00", 40)]), P);
  ehFalso(r.violacoes.some(v => v.tipo === "prejuizo_diario"), "fechou em -40, não é prejuízo diário");
  ehVerdade(r.violacoes.some(v => v.tipo === "overtrading"), "operou depois de bater o limite");
});
t("overtrading depois de bater o alvo", () => {
  const r = analisarEnvio(env([op("10:00", 120), op("11:00", 20)]), P);
  const ot = r.violacoes.filter(v => v.tipo === "overtrading");
  eq(ot.length, 1); eq(r.operacoes[1].dentroDoPlano, false);
});
t("parar exatamente no alvo NÃO é overtrading", () => {
  eq(analisarEnvio(env([op("10:00", 120)]), P).violacoes.length, 0);
});
t("ordem cronológica é respeitada mesmo com input embaralhado", () => {
  const r = analisarEnvio(env([op("11:00", 20), op("10:00", 120)]), P);
  eq(r.operacoes.map(o => o.hora), ["10:00", "11:00"]);
  eq(r.violacoes.filter(v => v.tipo === "overtrading").length, 1);
});

secao("analisarEnvio — derivação pontos x R$");
t("deriva pontos a partir do R$", () => eq(analisarEnvio(env([op("10:00", 60)]), P).operacoes[0].pontos, 150));
t("deriva R$ a partir dos pontos", () => {
  const r = analisarEnvio(env([{ hora: "10:00", pontos: 150, contratos: 2, setup: "Rompimento" }]), P);
  eq(r.operacoes[0].resultado, 60);
});
t("usa os contratos DA OPERAÇÃO, não os do plano, na conversão", () => {
  const r = analisarEnvio(env([{ hora: "10:00", resultado: 60, contratos: 1, setup: "Rompimento" }]), P);
  eq(r.operacoes[0].pontos, 300, "1 contrato: 60/0,2 = 300 pts");
});
t("envio sem operações devolve dia zerado", () => {
  const r = analisarEnvio(env([]), P);
  eq(r.dia.ops, 0); eq(r.dia.resultado, 0); eq(r.violacoes.length, 0);
});
t("envio null não explode", () => { analisarEnvio(null, P); analisarEnvio(undefined, null); });
t("plano sem valorPonto não explode", () => {
  const r = analisarEnvio(env([op("10:00", 60)]), { ...P, valorPonto: null });
  eq(r.dia.resultado, 60);
});
t("maxPerdasSeguidas conta corretamente", () => {
  const r = analisarEnvio(env([op("09:30", -20), op("09:40", -20), op("09:50", 60), op("10:00", -20), op("10:10", -20), op("10:20", -20)]), P);
  eq(r.dia.maxPerdasSeguidas, 3);
});
t("operação zerada não conta como ganho nem perda", () => {
  const r = analisarEnvio(env([op("10:00", 0)]), P);
  eq(r.dia.gains, 0); eq(r.dia.losses, 0); eq(r.dia.ops, 1);
});
console.log("");
process.exit(resumo() ? 1 : 0);
