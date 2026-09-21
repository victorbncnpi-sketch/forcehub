// api/_pt-regras.js — Motor de regras do PERSONAL TRADER. Prefixo "_": não vira
// rota na Vercel (é só domínio puro, sem I/O nem Redis).
//
// Tudo aqui é FUNÇÃO PURA: recebe plano + envio e devolve campos calculados,
// violações, projeção e o Quadro de Gerenciamento. Isso é proposital —
//   • o servidor calcula uma vez, na hora do envio, e GRAVA o resultado junto
//     com o envio (o aluno e o mentor veem exatamente a mesma coisa);
//   • a violação fica amarrada à versão do plano vigente NA DATA da operação,
//     nunca à versão atual (se o mentor afrouxar o stop no dia 20, o dia 7
//     continua julgado pelo plano do dia 7);
//   • sem IA: são regras determinísticas e auditáveis. A IA entra depois, como
//     copiloto do texto do feedback (COMANDO 6), nunca como juiz das regras.
//
// Vocabulário: "pontos" é o movimento do ativo; "R$" é pontos × contratos ×
// valor do ponto. O risco de 1 operação (pontos_stop × contratos × valor do
// ponto) é o "R" do trader — é nele que a projeção é ancorada.

// ─── Tolerâncias e faixas do semáforo ────────────────────────────────────────
// Deixadas explícitas e nomeadas para que qualquer ajuste seja uma decisão
// consciente, não um número mágico perdido no meio do código.
const TOL_STOP = 1.15;   // até 15% além do stop = slippage/gap, não indisciplina
const ALVO_OK = 0.90;    // realizou >= 90% do alvo médio: verde
const ALVO_ATENCAO = 0.70;
const STOP_ATENCAO = 1.30;
const PREJ_ATENCAO = 0.70; // consumiu >= 70% do limite diário: atenção
const META_ATENCAO = 0.80; // >= 80% do ritmo necessário: amarelo (abaixo: vermelho)

// Níveis do semáforo do Quadro. "fora" é o vermelho — significa fora da faixa
// combinada, que NEM SEMPRE é quebra de regra (a linha da meta mensal fica
// vermelha só por estar atrás do ritmo). Quebra de regra é violação, e vive
// na lista de violações, que é outra coisa.
export const NIVEIS = ["ok", "atencao", "fora", "neutro"];

export const TIPOS_VIOLACAO = {
  prejuizo_diario: "Prejuízo diário",
  contratos_acima: "Contratos acima do plano",
  fora_de_horario: "Fora do horário permitido",
  sem_stop: "Stop não respeitado",
  overtrading: "Overtrading",
  setup_nao_autorizado: "Setup não autorizado",
};

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : null;
const pos = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };
const round2 = (v) => v == null ? null : Math.round(v * 100) / 100;

// Formatação pt-BR para os textos que vão gravados no envio (violações, avisos
// e alertas). Eles são lidos como estão na tela, então já saem daqui prontos.
const brl = (v) => v == null ? "—" : (v < 0 ? "−R$ " : "R$ ") + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso) => { const p = String(iso || "").split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || "—"); };

// ─── Plano: campos calculados ────────────────────────────────────────────────
// São os quatro derivados do COMANDO 1, mais o ganho por operação (usado na
// projeção e no Quadro). Nunca são gravados no plano: recalculamos sempre, para
// que um plano antigo não carregue número derivado de fórmula antiga.
export function camposCalculados(plano) {
  const p = plano || {};
  const valorPonto = pos(p.valorPonto) || 0;
  const contratos = pos(p.contratos) || 0;
  const pontosAlvo = pos(p.pontosAlvo) || 0;
  const pontosStop = pos(p.pontosStop) || 0;
  const riscoPorOperacao = round2(pontosStop * contratos * valorPonto);
  const ganhoPorOperacao = round2(pontosAlvo * contratos * valorPonto);
  const prejuizoDiarioLimite = pos(p.prejuizoDiarioLimite);
  const dias = pos(p.diasPrevistosOperando);
  return {
    payoff: pontosStop > 0 ? round2(pontosAlvo / pontosStop) : null,
    riscoPorOperacao,
    ganhoPorOperacao,
    maxOperacoesPerdedorasDia: (riscoPorOperacao > 0 && prejuizoDiarioLimite)
      ? Math.floor(prejuizoDiarioLimite / riscoPorOperacao) : null,
    ganhoDiarioNecessario: (dias && pos(p.metaMensal)) ? round2(p.metaMensal / dias) : null,
  };
}

// ─── Sessão Zero: coerência do plano ─────────────────────────────────────────
// Não bloqueiam o salvamento — o mentor é quem decide. São avisos para ele ver
// o conflito ANTES de fechar o plano com o aluno na reunião.
export function avisosDoPlano(plano, diagnostico) {
  const p = plano || {}, d = diagnostico || {};
  const c = camposCalculados(p);
  const out = [];
  if (c.ganhoDiarioNecessario != null && pos(p.ganhoDiarioAlvo) && c.ganhoDiarioNecessario > p.ganhoDiarioAlvo) {
    out.push({
      tipo: "meta_agressiva", tom: "red",
      texto: `Meta agressiva para o risco definido: a meta mensal exige ${brl(c.ganhoDiarioNecessario)} por dia, mas o ganho diário alvo é ${brl(Number(p.ganhoDiarioAlvo))}.`,
    });
  }
  if (c.payoff != null && c.payoff < 1) {
    out.push({
      tipo: "payoff_baixo", tom: "red",
      texto: `Relação risco/retorno desfavorável: payoff ${c.payoff.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (o alvo é menor que o stop). Exige acerto acima de ${Math.round(100 / (1 + c.payoff))}% só para empatar.`,
    });
  }
  const capital = pos(d.capitalOperacional);
  if (capital && c.riscoPorOperacao) {
    const pct = (c.riscoPorOperacao / capital) * 100;
    if (pct > 2) {
      out.push({
        tipo: "risco_elevado", tom: "red",
        texto: `Risco elevado para o capital: cada operação arrisca ${brl(c.riscoPorOperacao)}, ou ${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do capital operacional (referência: até 2%).`,
      });
    }
  }
  if (c.maxOperacoesPerdedorasDia != null && c.maxOperacoesPerdedorasDia < 2) {
    out.push({
      tipo: "stop_diario_apertado", tom: "gold",
      texto: `Stop diário muito apertado: o limite de prejuízo cabe em ${c.maxOperacoesPerdedorasDia} operação perdedora. O aluno encerra o dia no primeiro erro.`,
    });
  }
  return out;
}

// ─── Versionamento: qual plano valia naquele dia ─────────────────────────────
// O plano vigente numa data é o de maior vigenciaInicio <= data. Antes da
// primeira vigência, vale a v1 (o ciclo não existe sem ela).
export function planoVigenteEm(planos, dataISO) {
  const lista = Array.isArray(planos) ? planos.filter(Boolean) : [];
  if (!lista.length) return null;
  const ord = [...lista].sort((a, b) => String(a.vigenciaInicio || "").localeCompare(String(b.vigenciaInicio || "")));
  let escolhido = ord[0];
  for (const p of ord) if (String(p.vigenciaInicio || "") <= String(dataISO || "")) escolhido = p;
  return escolhido;
}

// ─── Envio: operações, violações e resumo do dia ─────────────────────────────
// Percorre as operações NA ORDEM DO DIA, porque duas regras dependem do que já
// aconteceu antes (overtrading e prejuízo diário). Devolve as operações
// enriquecidas (pontos/resultado completados, stopRespeitado, dentroDoPlano),
// a lista de violações e o resumo do dia.
export function analisarEnvio(envio, plano) {
  const p = plano || {};
  const c = camposCalculados(p);
  const valorPonto = pos(p.valorPonto) || 0;
  const alvoDia = pos(p.ganhoDiarioAlvo);
  const limiteDia = pos(p.prejuizoDiarioLimite);
  const setups = Array.isArray(p.setups) ? p.setups.filter(Boolean) : [];
  const hIni = /^\d{2}:\d{2}$/.test(p.horaInicio || "") ? p.horaInicio : null;
  const hFim = /^\d{2}:\d{2}$/.test(p.horaFim || "") ? p.horaFim : null;

  const brutas = Array.isArray(envio && envio.operacoes) ? envio.operacoes : [];
  const ops = [...brutas].sort((a, b) => String(a.hora || "").localeCompare(String(b.hora || "")));

  const violacoes = [];
  const addV = (tipo, esperado, real, texto, opId) => violacoes.push({ tipo, esperado, real, texto, opId: opId || null });

  let acumulado = 0;            // resultado do dia ANTES da operação corrente
  let encerrouPor = null;       // "alvo" | "limite" — o dia já deveria ter acabado
  let perdasSeguidas = 0, maxPerdasSeguidas = 0;
  let somaPontosGain = 0, nGain = 0, somaPontosLoss = 0, nLoss = 0, maxContratos = 0;

  const saida = ops.map((o, i) => {
    const contratos = pos(o.contratos) || pos(p.contratos) || 1;
    const porContrato = contratos * valorPonto;
    // Pontos e financeiro são o mesmo número em unidades diferentes: o que
    // faltar é derivado do outro (o CSV do Profit costuma trazer só o R$).
    let pontos = num(o.pontos);
    let resultado = num(o.resultado);
    if (pontos == null && resultado != null && porContrato > 0) pontos = round2(resultado / porContrato);
    if (resultado == null && pontos != null) resultado = round2(pontos * porContrato);
    pontos = pontos == null ? null : round2(pontos);
    resultado = resultado == null ? 0 : round2(resultado);

    const id = o.id || ("op" + (i + 1));
    const perdeu = resultado < 0;
    const stopRespeitado = !perdeu || pontos == null || !c.riscoPorOperacao || !pos(p.pontosStop)
      ? true
      : Math.abs(pontos) <= p.pontosStop * TOL_STOP;

    const daOp = [];
    if (pos(p.contratos) && contratos > p.contratos) {
      addV("contratos_acima", p.contratos, contratos, `${contratos} contratos às ${o.hora || "—"} (o plano permite ${p.contratos}).`, id);
      daOp.push("contratos_acima");
    }
    if (hIni && hFim && /^\d{2}:\d{2}/.test(o.hora || "")) {
      const h = String(o.hora).slice(0, 5);
      if (h < hIni || h > hFim) {
        addV("fora_de_horario", `${hIni}–${hFim}`, h, `Operação às ${h}, fora da faixa permitida (${hIni} às ${hFim}).`, id);
        daOp.push("fora_de_horario");
      }
    }
    if (!stopRespeitado) {
      addV("sem_stop", p.pontosStop, Math.abs(pontos), `Perda de ${Math.round(Math.abs(pontos)).toLocaleString("pt-BR")} pontos às ${o.hora || "—"} — o stop do plano é ${p.pontosStop}.`, id);
      daOp.push("sem_stop");
    }
    if (setups.length && o.setup && !setups.includes(o.setup)) {
      addV("setup_nao_autorizado", setups.join(", "), o.setup, `Setup "${o.setup}" às ${o.hora || "—"} não está entre os autorizados.`, id);
      daOp.push("setup_nao_autorizado");
    }
    // Overtrading: o plano encerra o dia ao atingir o ganho alvo OU o limite de
    // prejuízo. Operar depois disso é operar um dia que já tinha acabado.
    if (encerrouPor) {
      const motivo = encerrouPor === "alvo" ? "após atingir o ganho diário alvo" : "após atingir o limite de prejuízo do dia";
      addV("overtrading", encerrouPor === "alvo" ? alvoDia : -limiteDia, round2(acumulado), `Operação às ${o.hora || "—"} ${motivo} (o dia já estava encerrado pelo plano).`, id);
      daOp.push("overtrading");
    }

    acumulado = round2(acumulado + resultado);
    if (!encerrouPor) {
      if (alvoDia && acumulado >= alvoDia) encerrouPor = "alvo";
      else if (limiteDia && acumulado <= -limiteDia) encerrouPor = "limite";
    }
    if (perdeu) { perdasSeguidas++; maxPerdasSeguidas = Math.max(maxPerdasSeguidas, perdasSeguidas); }
    else if (resultado > 0) perdasSeguidas = 0;
    if (pontos != null) { if (resultado > 0) { somaPontosGain += pontos; nGain++; } else if (resultado < 0) { somaPontosLoss += Math.abs(pontos); nLoss++; } }
    maxContratos = Math.max(maxContratos, contratos);

    return {
      ...o, id, contratos, pontos, resultado,
      stopRespeitado, dentroDoPlano: daOp.length === 0, violacoes: daOp,
    };
  });

  if (limiteDia && acumulado <= -limiteDia) {
    addV("prejuizo_diario", -limiteDia, acumulado, `O dia fechou em ${brl(acumulado)}, atingindo o limite de prejuízo (${brl(limiteDia)}).`, null);
  }

  const dia = {
    resultado: round2(acumulado),
    pontos: round2(saida.reduce((s, o) => s + (o.pontos || 0), 0)),
    ops: saida.length,
    gains: saida.filter(o => o.resultado > 0).length,
    losses: saida.filter(o => o.resultado < 0).length,
    mediaPontosGain: nGain ? round2(somaPontosGain / nGain) : null,
    mediaPontosLoss: nLoss ? round2(somaPontosLoss / nLoss) : null,
    maxContratos: maxContratos || null,
    maxPerdasSeguidas,
    atingiuAlvo: !!(alvoDia && acumulado >= alvoDia),
    atingiuLimite: !!(limiteDia && acumulado <= -limiteDia),
    foraDoPlano: saida.filter(o => !o.dentroDoPlano).length,
  };

  return { operacoes: saida, violacoes, dia };
}

// ─── Quadro de Gerenciamento (6 linhas: Definido | Hoje | Semáforo) ──────────
// É o coração da tela do aluno: o mesmo quadro aparece no topo de tudo e na
// lateral da tela de análise do mentor. Por isso ele é calculado UMA vez, aqui.
//
// Direção de cada linha importa:
//   • alvo  -> realizar MENOS que o planejado é o desvio (sair cedo demais);
//   • stop  -> perder MAIS que o planejado é o desvio;
//   • contratos -> passar do teto é violação binária, não gradiente;
//   • ganho diário é ALVO (nunca fica vermelho por não atingir);
//   • prejuízo diário é LIMITE (fica vermelho ao atingir);
//   • meta mensal olha o RITMO, não o valor absoluto.
export function quadroGerenciamento(plano, dia, ciclo) {
  const p = plano || {};
  const c = camposCalculados(p);
  const d = dia || {};
  const acumulado = num(ciclo && ciclo.acumulado);
  const diasOperados = num(ciclo && ciclo.diasOperados) || 0;
  const brl = (v) => v == null ? "—" : (v < 0 ? "−R$ " : "R$ ") + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pts = (v) => v == null ? "—" : Math.round(v).toLocaleString("pt-BR") + " pts";

  const linhas = [];

  // 1. Pontos alvo — média realizada nas operações vencedoras.
  const alvoReal = num(d.mediaPontosGain);
  linhas.push({
    chave: "pontos_alvo", label: "Pontos alvo (por operação)",
    definido: pos(p.pontosAlvo), definidoTxt: pts(pos(p.pontosAlvo)),
    hoje: alvoReal, hojeTxt: pts(alvoReal),
    status: alvoReal == null || !pos(p.pontosAlvo) ? "neutro"
      : alvoReal >= p.pontosAlvo * ALVO_OK ? "ok"
      : alvoReal >= p.pontosAlvo * ALVO_ATENCAO ? "atencao" : "fora",
    nota: "Média de pontos nas operações vencedoras do dia.",
  });

  // 2. Pontos de stop — média das perdas (em módulo).
  const stopReal = num(d.mediaPontosLoss);
  linhas.push({
    chave: "pontos_stop", label: "Pontos de stop (por operação)",
    definido: pos(p.pontosStop), definidoTxt: pts(pos(p.pontosStop)),
    hoje: stopReal, hojeTxt: pts(stopReal),
    status: stopReal == null || !pos(p.pontosStop) ? "neutro"
      : stopReal <= p.pontosStop ? "ok"
      : stopReal <= p.pontosStop * STOP_ATENCAO ? "atencao" : "fora",
    nota: "Média de pontos perdidos nas operações negativas.",
  });

  // 3. Contratos por entrada — o maior usado no dia.
  const ctrReal = num(d.maxContratos);
  linhas.push({
    chave: "contratos", label: "Contratos por entrada",
    definido: pos(p.contratos), definidoTxt: pos(p.contratos) != null ? String(p.contratos) : "—",
    hoje: ctrReal, hojeTxt: ctrReal != null ? String(ctrReal) : "—",
    status: ctrReal == null || !pos(p.contratos) ? "neutro" : ctrReal > p.contratos ? "fora" : "ok",
    nota: "Maior número de contratos usado numa entrada do dia.",
  });

  // 4. Ganho diário — ALVO. Não atingir não é erro; é só não ter chegado.
  const res = num(d.resultado);
  linhas.push({
    chave: "ganho_diario", label: "Ganho diário (alvo)",
    definido: pos(p.ganhoDiarioAlvo), definidoTxt: brl(pos(p.ganhoDiarioAlvo)),
    hoje: res, hojeTxt: brl(res),
    status: res == null || !pos(p.ganhoDiarioAlvo) ? "neutro"
      : res >= p.ganhoDiarioAlvo ? "ok"
      : res > 0 ? "atencao" : "neutro",
    nota: "Atingiu o alvo? O plano autoriza encerrar o dia.",
  });

  // 5. Prejuízo diário — LIMITE rígido.
  const consumo = (res != null && res < 0 && pos(p.prejuizoDiarioLimite)) ? Math.abs(res) / p.prejuizoDiarioLimite : 0;
  linhas.push({
    chave: "prejuizo_diario", label: "Prejuízo diário (limite)",
    definido: pos(p.prejuizoDiarioLimite), definidoTxt: brl(pos(p.prejuizoDiarioLimite)),
    hoje: res != null && res < 0 ? Math.abs(res) : 0, hojeTxt: brl(res != null && res < 0 ? Math.abs(res) : 0),
    status: res == null || !pos(p.prejuizoDiarioLimite) ? "neutro"
      : consumo >= 1 ? "fora" : consumo >= PREJ_ATENCAO ? "atencao" : "ok",
    nota: "Atingiu o limite? O dia encerra — é regra, não sugestão.",
  });

  // 6. Meta mensal — compara o acumulado com o RITMO necessário até aqui.
  const necessarioAteAqui = c.ganhoDiarioNecessario != null ? round2(c.ganhoDiarioNecessario * diasOperados) : null;
  const ritmo = (necessarioAteAqui && necessarioAteAqui > 0 && acumulado != null) ? acumulado / necessarioAteAqui : null;
  // Com menos de 3 dias operados o ritmo é ruído: mostra o número, sem julgar.
  const ritmoVale = ritmo != null && diasOperados >= 3;
  linhas.push({
    chave: "meta_mensal", label: "Meta mensal",
    definido: pos(p.metaMensal), definidoTxt: brl(pos(p.metaMensal)),
    hoje: acumulado, hojeTxt: brl(acumulado),
    status: !ritmoVale ? "neutro" : ritmo >= 1 ? "ok" : ritmo >= META_ATENCAO ? "atencao" : "fora",
    nota: necessarioAteAqui != null
      ? `Ritmo necessário até aqui: ${brl(necessarioAteAqui)} (${brl(c.ganhoDiarioNecessario)} por dia operado).`
      : "Defina meta mensal e dias previstos para acompanhar o ritmo.",
  });

  return linhas;
}

// ─── Projeção de 30 dias (faixa: pessimista / base / otimista) ───────────────
// Só o ACERTO varia entre os cenários (±10 p.p. sobre o alvo do plano). Payoff,
// frequência e risco vêm do plano — são o que o aluno controla por disciplina;
// o acerto é o que o mercado entrega. Isso mantém a faixa honesta: ela mede a
// incerteza do resultado, não três planos diferentes.
//
// Resultado esperado do dia = operações/dia × expectativa(em R) × risco.
// Depois é LIMITADO pelas duas travas do plano (alvo de ganho e limite de
// prejuízo), porque o plano manda encerrar o dia nos dois extremos. É uma
// simplificação declarada: aplica o teto sobre a média, não sobre cada dia.
const clamp = (v, min, max) => Math.min(max == null ? v : max, Math.max(min == null ? v : min, v));

export function expectativaEmR(winRate, payoff) {
  if (winRate == null || payoff == null) return null;
  return round2(winRate * payoff - (1 - winRate));
}

// Maior sequência de perdas esperada em n operações com acerto w:
// ln(n) / ln(1/(1-w)). É a estimativa clássica e explicável em uma linha —
// sempre apresentada como estimativa, nunca como garantia.
function sequenciaPerdasEsperada(n, w) {
  if (!n || w == null || w <= 0 || w >= 1) return null;
  return Math.max(1, Math.round(Math.log(n) / Math.log(1 / (1 - w))));
}

export function projecao(plano) {
  const p = plano || {};
  const c = camposCalculados(p);
  const dias = pos(p.diasPrevistosOperando) || 0;
  const opsDia = pos(p.operacoesDia) || 0;
  const risco = c.riscoPorOperacao || 0;
  const wBase = (num(p.winRateAlvo) != null && p.winRateAlvo > 0 && p.winRateAlvo < 1) ? p.winRateAlvo : null;
  if (!dias || !opsDia || !risco || !c.payoff || wBase == null) return null;

  const alvoDia = pos(p.ganhoDiarioAlvo);
  const limiteDia = pos(p.prejuizoDiarioLimite);
  const CENARIOS = [
    { chave: "pessimista", label: "Pessimista", delta: -0.10 },
    { chave: "base", label: "Base", delta: 0 },
    { chave: "otimista", label: "Otimista", delta: +0.10 },
  ];

  const cenarios = CENARIOS.map(cn => {
    const w = clamp(wBase + cn.delta, 0.05, 0.95);
    const expR = expectativaEmR(w, c.payoff);
    const bruto = opsDia * expR * risco;
    const porDia = round2(clamp(bruto, limiteDia ? -limiteDia : null, alvoDia || null));
    const curva = [0];
    for (let d = 1; d <= dias; d++) curva.push(round2(porDia * d));
    const seq = sequenciaPerdasEsperada(dias * opsDia, w);
    return {
      chave: cn.chave, label: cn.label,
      winRateAlvo: round2(w), expectativaEmR: expR,
      resultadoDia: porDia,
      resultadoProjetado: curva[curva.length - 1],
      // Drawdown esperado: a maior sequência de perdas provável, em R$, com
      // piso no limite diário (um dia inteiro de stop já é esse tamanho).
      drawdownEsperado: seq ? round2(Math.max(seq * risco, limiteDia || 0)) : null,
      sequenciaPerdas: seq,
      curva,
    };
  });

  return { dias, operacoesDia: opsDia, riscoPorOperacao: risco, payoff: c.payoff, cenarios };
}

// ─── Projetado x Real: ritmo e decomposição do desvio ────────────────────────
// A pergunta que o aluno faz é "por que estou atrás?". A resposta vem de
// trocar UMA variável por vez pelo valor real e medir o estrago (ou o ganho)
// que só ela explica. Os deltas não somam exatamente o desvio total — há
// interação entre as variáveis —, por isso apresentamos o MAIOR como "principal
// explicação", nunca como decomposição contábil fechada.
export function comparaProjecao(plano, real, diasOperados) {
  const p = plano || {};
  const c = camposCalculados(p);
  const proj = projecao(p);
  if (!proj) return null;
  const base = proj.cenarios.find(x => x.chave === "base");
  const d = Math.max(0, Math.min(num(diasOperados) || 0, proj.dias));
  const projetadoAteAqui = round2(base.resultadoDia * d);
  const realizado = round2(num(real && real.resultado) || 0);
  const desvio = round2(realizado - projetadoAteAqui);

  const alvoDia = pos(p.ganhoDiarioAlvo), limiteDia = pos(p.prejuizoDiarioLimite);
  const f = (w, payoff, ops, risco) => {
    const e = expectativaEmR(w, payoff);
    if (e == null || !ops || !risco) return 0;
    return round2(clamp(ops * e * risco, limiteDia ? -limiteDia : null, alvoDia || null) * d);
  };
  const w0 = base.winRateAlvo, p0 = c.payoff, n0 = proj.operacoesDia, r0 = c.riscoPorOperacao;
  const ref = f(w0, p0, n0, r0);
  const variaveis = [
    { chave: "win_rate", label: "Acerto", planejado: w0, real: num(real && real.winRate), fmt: "pct", delta: null },
    { chave: "payoff", label: "Payoff", planejado: p0, real: num(real && real.payoff), fmt: "num", delta: null },
    { chave: "frequencia", label: "Operações por dia", planejado: n0, real: num(real && real.opsDia), fmt: "num", delta: null },
    { chave: "risco", label: "Risco médio por operação", planejado: r0, real: num(real && real.riscoMedio), fmt: "brl", delta: null },
  ];
  variaveis[0].delta = variaveis[0].real == null ? null : round2(f(variaveis[0].real, p0, n0, r0) - ref);
  variaveis[1].delta = variaveis[1].real == null ? null : round2(f(w0, variaveis[1].real, n0, r0) - ref);
  variaveis[2].delta = variaveis[2].real == null ? null : round2(f(w0, p0, variaveis[2].real, r0) - ref);
  variaveis[3].delta = variaveis[3].real == null ? null : round2(f(w0, p0, n0, variaveis[3].real) - ref);

  const comDelta = variaveis.filter(v => v.delta != null && v.delta !== 0);
  // A principal explicação é a variável que puxou PARA O MESMO LADO do desvio:
  // se o aluno está atrás, interessa o que o atrasou. A maior sensibilidade em
  // módulo não serve — ela pode apontar justamente a variável que ajudou (um
  // risco acima do plano empurra o projetado para cima enquanto o aluno perde).
  const mesmoLado = comDelta.filter(v => desvio === 0 || (v.delta > 0) === (desvio > 0));
  const pool = mesmoLado.length ? mesmoLado : comDelta;
  const principal = pool.length ? pool.reduce((a, b) => Math.abs(b.delta) > Math.abs(a.delta) ? b : a) : null;

  // "No ritmo" com tolerância de 10% do projetado — abaixo disso é ruído.
  const tol = Math.max(Math.abs(projetadoAteAqui) * 0.10, (c.riscoPorOperacao || 0));
  const ritmo = d === 0 ? "sem_dados" : desvio > tol ? "adiantado" : desvio < -tol ? "atrasado" : "no_ritmo";

  return {
    diasOperados: d, projetadoAteAqui, realizado, desvio,
    desvioPct: projetadoAteAqui ? round2((desvio / Math.abs(projetadoAteAqui)) * 100) : null,
    ritmo, variaveis, principal,
  };
}

// Projeção do PRÓXIMO ciclo, recalibrada com os números que o aluno realmente
// entregou (COMANDO 5, seção 6). Em vez de repetir o plano da Sessão Zero,
// troca acerto, payoff e frequência pelos valores realizados — é a diferença
// entre projetar o trader que a gente imaginou e o trader que apareceu.
// O risco por operação segue vindo do plano: quanto arriscar é decisão do
// mentor, não consequência do que o aluno fez sem autorização. As médias
// entram em PONTOS porque o ciclo pode ter atravessado mudanças de contrato,
// e aí a média em R$ deixa de ser comparável consigo mesma.
export function projecaoRecalibrada(plano, real) {
  const p = plano || {};
  if (!real || !real.diasOperados || real.winRate == null) return null;
  const alvo = num(real.mediaPontosGain) ? Math.round(real.mediaPontosGain) : pos(p.pontosAlvo);
  const stop = num(real.mediaPontosLoss) ? Math.round(real.mediaPontosLoss) : pos(p.pontosStop);
  if (!alvo || !stop) return null;
  const base = {
    ...p,
    pontosAlvo: alvo,
    pontosStop: stop,
    operacoesDia: Math.max(1, Math.round(num(real.opsDia) || p.operacoesDia || 1)),
    winRateAlvo: Math.min(0.95, Math.max(0.05, real.winRate)),
  };
  const proj = projecao(base);
  return proj ? { ...proj, plano: base } : null;
}

// ─── Alertas ao mentor ───────────────────────────────────────────────────────
// Recebem o ciclo já consolidado (envios ordenados por data, com dia/violações
// gravados). Tudo aqui é observação de PROCESSO — é o que o mentor precisa ver
// antes de abrir a análise do dia.
export function alertasDoAluno(ciclo, envios, hojeISO) {
  const lista = Array.isArray(envios) ? [...envios].sort((a, b) => String(a.data).localeCompare(String(b.data))) : [];
  const out = [];
  const ultimo = lista[lista.length - 1] || null;

  // 1. Tilt: 3 perdas seguidas no mesmo dia, olhando os últimos 3 envios (o
  // alerta continua valendo no dia seguinte — é isso que o mentor precisa ver
  // ao abrir a fila, não só o que aconteceu no último dia enviado).
  const comTilt = lista.slice(-3).filter(e => e.dia && e.dia.maxPerdasSeguidas >= 3);
  const tilt = comTilt[comTilt.length - 1];
  if (tilt) {
    out.push({ tipo: "tilt", tom: "red", texto: `${tilt.dia.maxPerdasSeguidas} operações perdedoras seguidas em ${dmy(tilt.data)} — possível tilt.` });
  }

  // 2. Métrica fora da faixa por 3 dias seguidos (olha o Quadro já gravado).
  const ult3 = lista.slice(-3);
  if (ult3.length === 3) {
    const conta = {};
    ult3.forEach(e => (e.quadro || []).forEach(l => {
      if (l.status === "fora" || l.status === "atencao") conta[l.label] = (conta[l.label] || 0) + 1;
    }));
    Object.entries(conta).filter(([, n]) => n === 3).forEach(([label]) => {
      out.push({ tipo: "metrica_persistente", tom: "gold", texto: `"${label}" fora da faixa nos últimos 3 envios — vale revisar o gerenciamento.` });
    });
  }

  // 3. Drawdown real acima do esperado da projeção.
  const dd = num(ciclo && ciclo.drawdownReal);
  const ddEsp = num(ciclo && ciclo.drawdownEsperado);
  if (dd != null && ddEsp != null && ddEsp > 0 && dd > ddEsp) {
    out.push({ tipo: "drawdown", tom: "red", texto: `Drawdown real de ${brl(dd)} acima do esperado na projeção (${brl(ddEsp)}).` });
  }

  // 4. Sete dias sem envio (só para ciclo ativo — pausado/concluído não alerta).
  if (ultimo && (!ciclo || ciclo.status === "ativo")) {
    const diff = Math.floor((Date.parse(hojeISO + "T12:00:00Z") - Date.parse(ultimo.data + "T12:00:00Z")) / 864e5);
    if (isFinite(diff) && diff >= 7) {
      out.push({ tipo: "sem_envio", tom: "gold", texto: `Sem envio há ${diff} dias (último: ${dmy(ultimo.data)}).` });
    }
  }

  // 5. Envio aguardando análise (o mentor é o gargalo — isto é o lembrete).
  const pend = lista.filter(e => e.status !== "analisado").length;
  if (pend) out.push({ tipo: "aguardando", tom: "blue", texto: `${pend} envio${pend > 1 ? "s" : ""} aguardando análise.` });

  return out;
}

// ─── Consolidação do ciclo (métricas reais, usadas em tudo) ──────────────────
// Recebe os envios já analisados e devolve os números "reais" que alimentam o
// Quadro (linha da meta), a comparação com a projeção e o relatório final.
export function consolidaCiclo(envios, plano) {
  const lista = Array.isArray(envios) ? [...envios].sort((a, b) => String(a.data).localeCompare(String(b.data))) : [];
  const ops = lista.flatMap(e => Array.isArray(e.operacoes) ? e.operacoes : []);
  const decididas = ops.filter(o => num(o.resultado) != null && o.resultado !== 0);
  const gains = decididas.filter(o => o.resultado > 0);
  const losses = decididas.filter(o => o.resultado < 0);
  const soma = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const resultado = round2(soma(lista, e => e.dia && e.dia.resultado));
  const mediaGain = gains.length ? soma(gains, o => o.resultado) / gains.length : null;
  const mediaLoss = losses.length ? Math.abs(soma(losses, o => o.resultado) / losses.length) : null;

  // Curva diária acumulada + drawdown real (pico a vale, em R$).
  const curva = [0];
  let cum = 0, pico = 0, ddMax = 0;
  lista.forEach(e => {
    cum = round2(cum + ((e.dia && e.dia.resultado) || 0));
    curva.push(cum);
    if (cum > pico) pico = cum;
    if (pico - cum > ddMax) ddMax = round2(pico - cum);
  });

  const diasOperados = lista.length;
  const violacoes = lista.flatMap(e => Array.isArray(e.violacoes) ? e.violacoes : []);
  const porTipo = {};
  violacoes.forEach(v => { porTipo[v.tipo] = (porTipo[v.tipo] || 0) + 1; });
  const dentro = ops.filter(o => o.dentroDoPlano).length;

  // Sequência atual de dias sem nenhuma violação (meta de PROCESSO).
  let sequenciaLimpa = 0;
  for (let i = lista.length - 1; i >= 0; i--) {
    if ((lista[i].violacoes || []).length === 0) sequenciaLimpa++; else break;
  }

  const c = camposCalculados(plano);
  const riscoMedio = losses.length ? round2(mediaLoss) : (c.riscoPorOperacao || null);

  return {
    diasOperados, resultado, curva,
    ops: ops.length, gains: gains.length, losses: losses.length,
    winRate: decididas.length ? round2(gains.length / decididas.length) : null,
    payoff: (mediaGain != null && mediaLoss) ? round2(mediaGain / mediaLoss) : null,
    mediaGain: round2(mediaGain), mediaLoss: round2(mediaLoss), riscoMedio,
    opsDia: diasOperados ? round2(ops.length / diasOperados) : null,
    // Em pontos, a média atravessa mudanças de contrato sem distorcer — é ela
    // que recalibra o plano do próximo ciclo.
    mediaPontosGain: (() => { const a = gains.map(o => o.pontos).filter(v => v != null); return a.length ? round2(a.reduce((t, v) => t + v, 0) / a.length) : null; })(),
    mediaPontosLoss: (() => { const a = losses.map(o => o.pontos).filter(v => v != null); return a.length ? round2(Math.abs(a.reduce((t, v) => t + v, 0) / a.length)) : null; })(),
    drawdownReal: ddMax,
    violacoes: violacoes.length, violacoesPorTipo: porTipo,
    aderencia: ops.length ? round2((dentro / ops.length) * 100) : null,
    diasComViolacao: lista.filter(e => (e.violacoes || []).length > 0).length,
    sequenciaLimpa,
    melhorDia: lista.length ? lista.reduce((a, b) => ((b.dia && b.dia.resultado) || 0) > ((a.dia && a.dia.resultado) || 0) ? b : a) : null,
    piorDia: lista.length ? lista.reduce((a, b) => ((b.dia && b.dia.resultado) || 0) < ((a.dia && a.dia.resultado) || 0) ? b : a) : null,
  };
}

// Evolução das tags ao longo do ciclo: quantas vezes cada uma foi aplicada e se
// ela caiu ou persistiu da primeira metade para a segunda (mapa de erros do
// COMANDO 5). Sem isso o relatório final vira só um extrato financeiro.
export function mapaDeTags(envios) {
  const lista = Array.isArray(envios) ? [...envios].sort((a, b) => String(a.data).localeCompare(String(b.data))) : [];
  const meio = Math.ceil(lista.length / 2);
  const conta = {};
  lista.forEach((e, i) => {
    const porOp = (e.feedback && e.feedback.porOperacao) || {};
    Object.values(porOp).forEach(fo => (Array.isArray(fo.tags) ? fo.tags : []).forEach(t => {
      const c = conta[t] || (conta[t] = { tag: t, total: 0, primeira: 0, segunda: 0 });
      c.total++; if (i < meio) c.primeira++; else c.segunda++;
    }));
  });
  return Object.values(conta)
    .map(c => ({ ...c, tendencia: c.segunda < c.primeira ? "caiu" : c.segunda > c.primeira ? "subiu" : "estavel" }))
    .sort((a, b) => b.total - a.total);
}
