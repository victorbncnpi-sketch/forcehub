import { secao, t, eq, ehVerdade, ehFalso, contem, resumo } from "./runner.mjs";
import { camposCalculados, analisarEnvio, quadroGerenciamento, projecao, comparaProjecao,
         alertasDoAluno, consolidaCiclo, mapaDeTags, projecaoRecalibrada } from "../api/_pt-regras";

const P = { versao: 1, vigenciaInicio: "2026-09-01", valorPonto: 0.2, pontosAlvo: 150, pontosStop: 100,
  contratos: 2, ganhoDiarioAlvo: 120, prejuizoDiarioLimite: 80, metaMensal: 2000,
  diasPrevistosOperando: 20, horaInicio: "09:15", horaFim: "17:00", setups: ["Rompimento"],
  operacoesDia: 4, winRateAlvo: 0.5 };
const nivel = (q, chave) => q.find(l => l.chave === chave).status;

secao("quadroGerenciamento — semáforo linha a linha");
const Q = (dia, ciclo = { acumulado: 0, diasOperados: 5 }) => quadroGerenciamento(P, dia, ciclo);
t("sem dados e sem dias operados = tudo neutro (é o que a API passa)", () => {
  const q = quadroGerenciamento(P, {}, { acumulado: 0, diasOperados: 0 });
  eq(q.filter(l => l.status !== "neutro").length, 0);
});
t("5 dias operados com R$0 acumulado: meta fica vermelha (correto)", () => {
  eq(nivel(quadroGerenciamento(P, {}, { acumulado: 0, diasOperados: 5 }), "meta_mensal"), "fora");
});
t("sempre 6 linhas, na ordem do documento", () => {
  eq(Q({}).map(l => l.chave), ["pontos_alvo","pontos_stop","contratos","ganho_diario","prejuizo_diario","meta_mensal"]);
});
t("pontos alvo: 90% do definido = ok (fronteira)", () => eq(nivel(Q({ mediaPontosGain: 135 }), "pontos_alvo"), "ok"));
t("pontos alvo: 89% = atenção", () => eq(nivel(Q({ mediaPontosGain: 133 }), "pontos_alvo"), "atencao"));
t("pontos alvo: 69% = fora", () => eq(nivel(Q({ mediaPontosGain: 103 }), "pontos_alvo"), "fora"));
t("pontos alvo: acima do alvo = ok", () => eq(nivel(Q({ mediaPontosGain: 300 }), "pontos_alvo"), "ok"));
t("stop: exatamente no stop = ok", () => eq(nivel(Q({ mediaPontosLoss: 100 }), "pontos_stop"), "ok"));
t("stop: 130% = atenção (fronteira)", () => eq(nivel(Q({ mediaPontosLoss: 130 }), "pontos_stop"), "atencao"));
t("stop: 131% = fora", () => eq(nivel(Q({ mediaPontosLoss: 131 }), "pontos_stop"), "fora"));
t("contratos: no teto = ok / acima = fora (binário)", () => {
  eq(nivel(Q({ maxContratos: 2 }), "contratos"), "ok");
  eq(nivel(Q({ maxContratos: 3 }), "contratos"), "fora");
});
t("ganho diário é ALVO: nunca fica vermelho por não atingir", () => {
  eq(nivel(Q({ resultado: 120 }), "ganho_diario"), "ok");
  eq(nivel(Q({ resultado: 60 }), "ganho_diario"), "atencao");
  eq(nivel(Q({ resultado: -50 }), "ganho_diario"), "neutro");
});
t("prejuízo diário é LIMITE: 70% = atenção, 100% = fora", () => {
  eq(nivel(Q({ resultado: -55 }), "prejuizo_diario"), "ok");    // 69%
  eq(nivel(Q({ resultado: -56 }), "prejuizo_diario"), "atencao"); // 70%
  eq(nivel(Q({ resultado: -80 }), "prejuizo_diario"), "fora");
});
t("meta mensal com menos de 3 dias = neutro (ruído)", () => {
  eq(nivel(quadroGerenciamento(P, {}, { acumulado: -500, diasOperados: 2 }), "meta_mensal"), "neutro");
});
t("meta mensal com 3+ dias passa a julgar", () => {
  eq(nivel(quadroGerenciamento(P, {}, { acumulado: -500, diasOperados: 3 }), "meta_mensal"), "fora");
  eq(nivel(quadroGerenciamento(P, {}, { acumulado: 300, diasOperados: 3 }), "meta_mensal"), "ok");
});
t("plano sem meta mensal não finge ritmo", () => {
  eq(nivel(quadroGerenciamento({ ...P, metaMensal: null }, {}, { acumulado: 999, diasOperados: 9 }), "meta_mensal"), "neutro");
});
t("textos formatados em pt-BR", () => {
  const q = Q({ resultado: 1234.5 });
  contem(q.find(l => l.chave === "ganho_diario").definidoTxt, "R$ 120,00");
  contem(q.find(l => l.chave === "pontos_alvo").definidoTxt, "150 pts");
});

secao("projecao");
t("caso feliz devolve 3 cenários ordenados", () => {
  const p = projecao(P);
  eq(p.cenarios.map(c => c.chave), ["pessimista", "base", "otimista"]);
  ehVerdade(p.cenarios[0].winRateAlvo < p.cenarios[1].winRateAlvo);
  ehVerdade(p.cenarios[1].resultadoProjetado <= p.cenarios[2].resultadoProjetado);
});
t("drawdown esperado é MAIOR no pessimista", () => {
  const p = projecao(P);
  ehVerdade(p.cenarios[0].drawdownEsperado >= p.cenarios[2].drawdownEsperado);
});
t("curva tem dias+1 pontos e começa em zero", () => {
  const c = projecao(P).cenarios[1].curva;
  eq(c.length, P.diasPrevistosOperando + 1); eq(c[0], 0);
});
t("resultado diário é limitado pelo alvo de ganho do plano", () => {
  const p = projecao({ ...P, operacoesDia: 50 });  // 50 op/dia estouraria o alvo
  eq(p.cenarios[1].resultadoDia, P.ganhoDiarioAlvo);
});
t("resultado diário é limitado pelo limite de prejuízo", () => {
  const p = projecao({ ...P, operacoesDia: 50, winRateAlvo: 0.1 });
  eq(p.cenarios[1].resultadoDia, -P.prejuizoDiarioLimite);
});
t("faltando campo obrigatório devolve null (não meio-gráfico)", () => {
  eq(projecao({ ...P, operacoesDia: null }), null);
  eq(projecao({ ...P, winRateAlvo: null }), null);
  eq(projecao({ ...P, diasPrevistosOperando: null }), null);
  eq(projecao({}), null); eq(projecao(null), null);
});
t("winRate fora de (0,1) é rejeitado", () => {
  eq(projecao({ ...P, winRateAlvo: 0 }), null);
  eq(projecao({ ...P, winRateAlvo: 1 }), null);
  eq(projecao({ ...P, winRateAlvo: 1.5 }), null);
});
t("cenários não escapam de [5%, 95%]", () => {
  const p = projecao({ ...P, winRateAlvo: 0.92 });
  ehVerdade(p.cenarios[2].winRateAlvo <= 0.95);
});

secao("consolidaCiclo");
const mkEnvio = (data, ops) => { const r = analisarEnvio({ data, operacoes: ops }, P); return { data, ...r }; };
t("ciclo vazio não explode", () => {
  const r = consolidaCiclo([], P);
  eq(r.diasOperados, 0); eq(r.resultado, 0); eq(r.winRate, null); eq(r.curva, [0]);
});
t("null não explode", () => { consolidaCiclo(null, null); });
t("winRate e payoff corretos", () => {
  const e = [mkEnvio("2026-09-10", [{ hora: "10:00", resultado: 60, contratos: 2, setup: "Rompimento" },
                                     { hora: "11:00", resultado: -40, contratos: 2, setup: "Rompimento" }])];
  const r = consolidaCiclo(e, P);
  eq(r.winRate, 0.5); eq(r.payoff, 1.5); eq(r.resultado, 20);
});
t("drawdown real é pico-a-vale", () => {
  const e = [mkEnvio("2026-09-10", [{ hora: "10:00", resultado: 100, contratos: 2, setup: "Rompimento" }]),
             mkEnvio("2026-09-11", [{ hora: "10:00", resultado: -40, contratos: 2, setup: "Rompimento" }]),
             mkEnvio("2026-09-14", [{ hora: "10:00", resultado: -20, contratos: 2, setup: "Rompimento" }])];
  eq(consolidaCiclo(e, P).drawdownReal, 60);
});
t("sequenciaLimpa conta a partir do FIM", () => {
  const sujo = mkEnvio("2026-09-10", [{ hora: "18:00", resultado: 20, contratos: 2, setup: "Rompimento" }]);
  const limpo1 = mkEnvio("2026-09-11", [{ hora: "10:00", resultado: 20, contratos: 2, setup: "Rompimento" }]);
  const limpo2 = mkEnvio("2026-09-14", [{ hora: "10:00", resultado: 20, contratos: 2, setup: "Rompimento" }]);
  eq(consolidaCiclo([sujo, limpo1, limpo2], P).sequenciaLimpa, 2);
  // A ordem do array não importa: consolidaCiclo ordena por data antes de contar.
  eq(consolidaCiclo([limpo1, limpo2, sujo], P).sequenciaLimpa, 2);
  const sujoNoFim = mkEnvio("2026-09-20", [{ hora: "18:00", resultado: 20, contratos: 2, setup: "Rompimento" }]);
  eq(consolidaCiclo([limpo1, limpo2, sujoNoFim], P).sequenciaLimpa, 0);
});
t("aderência = % de operações dentro do plano", () => {
  const e = [mkEnvio("2026-09-10", [{ hora: "10:00", resultado: 60, contratos: 2, setup: "Rompimento" },
                                     { hora: "18:00", resultado: 20, contratos: 2, setup: "Rompimento" }])];
  eq(consolidaCiclo(e, P).aderencia, 50);
});
t("envios chegam fora de ordem e a curva sai cronológica", () => {
  const a = mkEnvio("2026-09-14", [{ hora: "10:00", resultado: 30, contratos: 2, setup: "Rompimento" }]);
  const b = mkEnvio("2026-09-10", [{ hora: "10:00", resultado: 10, contratos: 2, setup: "Rompimento" }]);
  eq(consolidaCiclo([a, b], P).curva, [0, 10, 40]);
});

secao("comparaProjecao");
const real11 = { resultado: 100, winRate: 0.4, payoff: 1.2, opsDia: 3, riscoMedio: 50, diasOperados: 5 };
t("ritmo atrasado quando o real fica abaixo", () => {
  eq(comparaProjecao(P, { ...real11, resultado: -500 }, 5).ritmo, "atrasado");
});
t("ritmo adiantado quando supera", () => {
  eq(comparaProjecao(P, { ...real11, resultado: 5000 }, 5).ritmo, "adiantado");
});
t("dia zero = sem_dados", () => eq(comparaProjecao(P, real11, 0).ritmo, "sem_dados"));
t("principal aponta para o MESMO LADO do desvio", () => {
  const c = comparaProjecao(P, { resultado: -500, winRate: 0.2, payoff: 1.0, opsDia: 1, riscoMedio: 200 }, 5);
  ehVerdade(c.desvio < 0);
  ehVerdade(c.principal.delta < 0, "atrasado deve ser explicado por variável negativa, veio " + JSON.stringify(c.principal));
});
t("sem projeção devolve null", () => eq(comparaProjecao({}, real11, 5), null));
t("diasOperados maior que o plano é limitado", () => {
  eq(comparaProjecao(P, real11, 999).diasOperados, P.diasPrevistosOperando);
});
t("variáveis reais ausentes não geram impacto falso", () => {
  const c = comparaProjecao(P, { resultado: 10 }, 5);
  eq(c.variaveis.filter(v => v.delta != null).length, 0);
  eq(c.principal, null);
});

secao("projecaoRecalibrada");
t("usa médias em PONTOS (atravessa mudança de contrato)", () => {
  const r = projecaoRecalibrada({ ...P, contratos: 1 },
    { diasOperados: 10, winRate: 0.5, mediaPontosGain: 143, mediaPontosLoss: 98, opsDia: 3 });
  eq(r.plano.pontosAlvo, 143); eq(r.plano.pontosStop, 98); eq(r.plano.operacoesDia, 3);
});
t("sem dados reais devolve null", () => {
  eq(projecaoRecalibrada(P, { diasOperados: 0 }), null);
  eq(projecaoRecalibrada(P, null), null);
});
t("acerto real extremo é grampeado para caber na faixa", () => {
  const r = projecaoRecalibrada(P, { diasOperados: 5, winRate: 1, mediaPontosGain: 100, mediaPontosLoss: 50, opsDia: 2 });
  ehVerdade(r.plano.winRateAlvo <= 0.95);
});

secao("alertasDoAluno");
const envComTilt = mkEnvio("2026-09-10", [{ hora: "09:30", resultado: -20, contratos: 2, setup: "Rompimento" },
  { hora: "09:40", resultado: -20, contratos: 2, setup: "Rompimento" }, { hora: "09:50", resultado: -20, contratos: 2, setup: "Rompimento" }]);
t("tilt dispara", () => {
  const a = alertasDoAluno({ status: "ativo" }, [{ ...envComTilt, status: "analisado" }], "2026-09-10").map(x => x.tipo);
  ehVerdade(a.includes("tilt"));
});
t("tilt continua valendo no dia seguinte", () => {
  const limpo = { ...mkEnvio("2026-09-11", [{ hora: "10:00", resultado: 20, contratos: 2, setup: "Rompimento" }]), status: "analisado" };
  const a = alertasDoAluno({ status: "ativo" }, [{ ...envComTilt, status: "analisado" }, limpo], "2026-09-11").map(x => x.tipo);
  ehVerdade(a.includes("tilt"));
});
t("7 dias sem envio dispara; 6 não", () => {
  const e = [{ ...mkEnvio("2026-09-10", []), status: "analisado" }];
  ehVerdade(alertasDoAluno({ status: "ativo" }, e, "2026-09-17").some(x => x.tipo === "sem_envio"));
  ehFalso(alertasDoAluno({ status: "ativo" }, e, "2026-09-16").some(x => x.tipo === "sem_envio"));
});
t("ciclo pausado não alerta ausência", () => {
  const e = [{ ...mkEnvio("2026-09-10", []), status: "analisado" }];
  ehFalso(alertasDoAluno({ status: "pausado" }, e, "2026-10-30").some(x => x.tipo === "sem_envio"));
});
t("drawdown acima do esperado dispara", () => {
  const a = alertasDoAluno({ status: "ativo", drawdownReal: 300, drawdownEsperado: 100 }, [], "2026-09-10");
  ehVerdade(a.some(x => x.tipo === "drawdown"));
});
t("envio pendente vira alerta 'aguardando'", () => {
  const a = alertasDoAluno({ status: "ativo" }, [{ ...mkEnvio("2026-09-10", []), status: "aguardando" }], "2026-09-10");
  ehVerdade(a.some(x => x.tipo === "aguardando"));
});
t("sem envios não explode", () => { alertasDoAluno(null, null, "2026-09-10"); alertasDoAluno({}, [], "2026-09-10"); });
t("datas nos alertas saem em dd/mm/aaaa", () => {
  const a = alertasDoAluno({ status: "ativo" }, [{ ...mkEnvio("2026-09-10", []), status: "analisado" }], "2026-09-20");
  const txt = a.find(x => x.tipo === "sem_envio").texto;
  contem(txt, "10/09/2026"); ehFalso(txt.includes("2026-09-10"), "não pode vazar ISO");
});

secao("mapaDeTags");
t("classifica tendência entre metades", () => {
  const fb = (tags) => ({ porOperacao: { op1: { tags, comentario: "" } } });
  const e = (d, tags) => ({ data: d, feedback: fb(tags) });
  const m = mapaDeTags([e("2026-09-01", ["A"]), e("2026-09-02", ["A"]), e("2026-09-03", ["B"]), e("2026-09-04", ["B"])]);
  eq(m.find(x => x.tag === "A").tendencia, "caiu");
  eq(m.find(x => x.tag === "B").tendencia, "subiu");
});
t("sem feedback devolve lista vazia", () => eq(mapaDeTags([{ data: "2026-09-01" }]), []));
t("null não explode", () => eq(mapaDeTags(null), []));
console.log("");
process.exit(resumo() ? 1 : 0);
