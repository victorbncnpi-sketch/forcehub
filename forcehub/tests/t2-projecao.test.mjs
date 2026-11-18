import { readFileSync } from "node:fs";
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

t("todo alerta traz a orientação ao aluno, sem jargão; o mentor mantém o texto técnico", () => {
  const ruim = { ...mkEnvio("2026-09-10", []), status: "aguardando", quadro: [{ chave: "pontos_stop", label: "Pontos de stop (por operação)", status: "fora" }] };
  const env = [{ ...envComTilt, status: "analisado", quadro: ruim.quadro }, { ...ruim, data: "2026-09-11" }, { ...ruim, data: "2026-09-12" }];
  const a = alertasDoAluno({ status: "ativo", drawdownReal: 300, drawdownEsperado: 100 }, env, "2026-09-22");
  eq(a.map(x => x.tipo).sort(), ["aguardando", "drawdown", "metrica_persistente", "sem_envio", "tilt"]);
  for (const x of a) {
    ehVerdade(x.orientacao && x.orientacao !== x.texto, x.tipo + " sem orientação própria");
    ehFalso(/tilt|drawdown|envio(s)? aguardando/i.test(x.orientacao), x.tipo + " com jargão: " + x.orientacao);
  }
  contem(a.find(x => x.tipo === "tilt").texto, "possível tilt", "o mentor continua lendo o termo técnico");
  contem(a.find(x => x.tipo === "metrica_persistente").orientacao, '"Pontos de stop"');
  contem(a.find(x => x.tipo === "tilt").orientacao, "pare por hoje");
});
t("tela: aluno vê a orientação, mentor o texto técnico", () => {
  const src = readFileSync("src/personal.jsx", "utf8");
  contem(src, '<Alertas itens={jornada.alertas} titulo="Fique de olho" aluno />');
  contem(src, "aluno && a.orientacao ? a.orientacao : a.texto");
  eq((src.match(/<Alertas itens=\{jornada\.alertas\} \/>/g) || []).length, 1, "a ficha do mentor segue sem `aluno`");
});
t("tela do aluno: resumo do dia, aviso de feedback, legenda e envio em 3 passos", () => {
  const src = readFileSync("src/personal.jsx", "utf8");
  const aluno = src.slice(src.indexOf("function PersonalAluno"), src.indexOf("function PersonalAluno") + 2500);
  contem(aluno, "<AvisoFeedback "); contem(aluno, "<ResumoDoDia ");
  contem(src, "<LegendaSemaforo />");
  eq((src.match(/<Passo n=\{[123]\}/g) || []).length, 3);
  contem(src, "<ComoExportarCsv />");
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

secao("alertasDoAluno — comportamento nos dias recentes");
const CIC = { status: "ativo", planos: [P] };
const op = (hora, resultado, contratos = 2, setup = "Rompimento") => ({ hora, resultado, contratos, setup });
const env = (data, ops) => ({ ...mkEnvio(data, ops), status: "analisado" });
const tipos = (a) => a.map(x => x.tipo);
const al = (envios, hoje = "2026-09-20") => alertasDoAluno(CIC, envios, hoje);
t("operação fora do horário vira alerta com a hora e a janela do plano", () => {
  const a = al([env("2026-09-10", [op("17:42", 30)])]);
  const x = a.find(z => z.tipo === "fora_de_horario");
  ehVerdade(x, "sem alerta de horário");
  contem(x.orientacao, "17:42"); contem(x.orientacao, "09:15 às 17:00"); contem(x.orientacao, "10/09/2026");
});
t("perda maior que o stop: cita o stop e a pior perda", () => {
  const a = al([env("2026-09-10", [op("10:00", -72)])]); // 72 / (2 × 0,2) = 180 pts
  const x = a.find(z => z.tipo === "perda_acima_stop");
  ehVerdade(x); contem(x.orientacao, "stop de 100 pontos"); contem(x.orientacao, "180 pontos");
});
t("perda dentro da tolerância do stop (até 15%) não alerta", () => {
  ehFalso(tipos(al([env("2026-09-10", [op("10:00", -45)])])).includes("perda_acima_stop")); // 112 pts
});
t("contratos acima do combinado", () => {
  const x = al([env("2026-09-10", [op("10:00", 30, 4)])]).find(z => z.tipo === "contratos_acima");
  ehVerdade(x); contem(x.orientacao, "chegou a 4"); contem(x.orientacao, "o seu plano é 2");
});
t("continuou operando depois de bater o alvo do dia", () => {
  ehVerdade(tipos(al([env("2026-09-10", [op("10:00", 130), op("11:00", 10)])])).includes("overtrading"));
});
t("aumentou a mão logo depois de uma perda (mesmo dentro do teto)", () => {
  const x = al([env("2026-09-10", [op("10:00", -20, 1), op("10:30", 30, 2)])]).find(z => z.tipo === "mao_apos_perda");
  ehVerdade(x); contem(x.orientacao, "de 1 para 2");
});
t("reentrada até 5 min depois de um stop: alerta a partir de 2 vezes", () => {
  const uma = [env("2026-09-10", [op("10:00", -20), op("10:03", 10)])];
  ehFalso(tipos(al(uma)).includes("reentrada_impulso"), "uma vez só não é padrão");
  const duas = [...uma, env("2026-09-11", [op("11:00", -20), op("11:05", 10)])];
  ehVerdade(tipos(al(duas)).includes("reentrada_impulso"));
});
t("saiu antes do alvo na maioria dos gains", () => {
  // 20 R$ / 0,4 = 50 pts, alvo 150 → bem abaixo de 70%
  const a = al([env("2026-09-10", [op("10:00", 20), op("11:00", 24)])]);
  const x = a.find(z => z.tipo === "saiu_antes_do_alvo");
  ehVerdade(x); contem(x.orientacao, "o alvo é 150");
});
t("gains perto do alvo não contam como saída cedo", () => {
  ehFalso(tipos(al([env("2026-09-10", [op("10:00", 56), op("11:00", 58)])])).includes("saiu_antes_do_alvo")); // 140 pts
});
t("mais operações que o planejado em 2 dias", () => {
  const cinco = (d) => env(d, ["09:30", "10:00", "10:30", "11:00", "11:30"].map(h => op(h, 5)));
  ehFalso(tipos(al([cinco("2026-09-10")])).includes("excesso_operacoes"));
  ehVerdade(tipos(al([cinco("2026-09-10"), cinco("2026-09-11")])).includes("excesso_operacoes"));
});
t("setup fora da lista combinada", () => {
  const x = al([env("2026-09-10", [op("10:00", 30, 2, "Pullback")])]).find(z => z.tipo === "setup_nao_autorizado");
  ehVerdade(x); contem(x.orientacao, '"Pullback"');
});
t("3 dias seguidos no negativo", () => {
  const d = (data) => env(data, [op("10:00", -10)]);
  ehVerdade(tipos(al([d("2026-09-10"), d("2026-09-11"), d("2026-09-14")])).includes("dias_negativos"));
});
t("3 dias seguidos sem quebrar regra: reconhecimento em verde, por último", () => {
  const ok = (data) => env(data, [op("10:00", 60)]);
  const a = al([env("2026-09-09", [op("17:45", 10)]), ok("2026-09-10"), ok("2026-09-11"), ok("2026-09-14")]);
  const x = a.find(z => z.tipo === "sequencia_limpa");
  ehVerdade(x); eq(x.tom, "green"); eq(a[a.length - 1].tipo, "sequencia_limpa");
  eq(a[0].tom, "red", "regra quebrada vem primeiro");
});
t("janela curta: o que aconteceu há mais de 5 envios não alerta mais", () => {
  const ok = (data) => env(data, [op("10:00", 60)]);
  const a = al([env("2026-09-01", [op("17:45", 10)]), ok("2026-09-02"), ok("2026-09-03"), ok("2026-09-04"), ok("2026-09-07"), ok("2026-09-08")]);
  ehFalso(tipos(a).includes("fora_de_horario"));
});
t("perda acima do stop por 3 dias não repete como 'métrica persistente'", () => {
  const ruim = (data) => env(data, [op("10:00", -72)]);
  const a = al([ruim("2026-09-10"), ruim("2026-09-11"), ruim("2026-09-14")]);
  ehVerdade(tipos(a).includes("perda_acima_stop"));
  ehFalso(a.some(x => x.tipo === "metrica_persistente" && /stop/i.test(x.texto)), "assunto repetido");
});
t("alertas novos: orientação ao aluno própria e sem jargão", () => {
  const dias = [env("2026-09-10", [op("10:00", -72, 1), op("10:02", 20, 3, "Pullback"), op("17:45", -20)]),
    env("2026-09-11", [op("11:00", -20), op("11:04", 20), op("11:30", 20)])];
  const a = al(dias);
  ehVerdade(a.length >= 6, "esperava vários alertas, veio " + tipos(a).join(","));
  for (const x of a) {
    ehVerdade(x.orientacao && x.orientacao !== x.texto, x.tipo + " sem orientação");
    ehFalso(/tilt|drawdown|revenge|overtrading|payoff|violaç/i.test(x.orientacao), x.tipo + ": " + x.orientacao);
    ehFalso("cobre" in x, "campo interno vazou");
  }
});

console.log("");
process.exit(resumo() ? 1 : 0);
