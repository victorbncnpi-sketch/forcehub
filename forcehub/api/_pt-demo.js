// api/_pt-demo.js — Dados FICTÍCIOS para demonstrar o Personal Trader. Prefixo
// "_": não vira rota (é servido por api/personal.js, action "demo").
//
// Só roda em aluno de teste (nome ou usuário com "teste") e SUBSTITUI os
// envios dele por um ciclo de 12 pregões montado a partir do plano vigente:
//   • 7 dias mais antigos, quase todos bons, já analisados (com tags,
//     comentários por operação e uma réplica do aluno);
//   • 2 dias ruins (horário, mão após perda, stop furado, reentrada, setup
//     fora do plano, limite batido e operação depois do limite);
//   • 3 dias finais dentro das regras, mas no negativo e saindo cedo do alvo.
// Assim cada alerta, o Quadro, a fila do mentor e o relatório têm o que
// mostrar. Pura: recebe o plano e a data de hoje, devolve os envios.

const r2 = (v) => Math.round(v * 100) / 100;
const pos = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : null; };
export const ehAlunoDeTeste = (...nomes) => nomes.some(n => /teste/i.test(String(n || "")));

// Os pregões anteriores a hoje (seg–sex), do mais antigo para o mais recente.
export function pregoesAntes(hojeISO, n) {
  const out = [];
  const d = new Date(hojeISO + "T12:00:00Z");
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
}

const hm = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
const minDe = (h, padrao) => { const m = /^(\d{2}):(\d{2})$/.exec(String(h || "")); return m ? (+m[1]) * 60 + (+m[2]) : padrao; };

// O que o plano precisa ter para todos os alertas aparecerem.
export function camposQueFaltam(plano) {
  const p = plano || {}, f = {};
  if (!/^\d{2}:\d{2}$/.test(p.horaInicio || "") || !/^\d{2}:\d{2}$/.test(p.horaFim || "")) { f.horaInicio = "09:00"; f.horaFim = "17:00"; }
  if (!Array.isArray(p.setups) || !p.setups.length) f.setups = ["Rompimento", "Pullback na média"];
  if (!pos(p.prejuizoDiarioLimite)) f.prejuizoDiarioLimite = null; // preenchido abaixo, com base no risco
  return f;
}

export function montarDemo(plano, hojeISO) {
  const p = plano || {};
  const vp = pos(p.valorPonto) || 0.2;
  const c = Math.round(pos(p.contratos) || 1);
  const A = pos(p.pontosAlvo) || 150, S = pos(p.pontosStop) || 100;
  const risco = S * c * vp;
  const L = pos(p.prejuizoDiarioLimite) || r2(risco * 2);
  const N = Math.round(pos(p.operacoesDia) || 4);
  const ini = minDe(p.horaInicio, 9 * 60), fim = minDe(p.horaFim, 17 * 60);
  const setup = (Array.isArray(p.setups) && p.setups[0]) || "Rompimento";
  const setup2 = (Array.isArray(p.setups) && p.setups[1]) || setup;
  const datas = pregoesAntes(hojeISO, 12);

  let seq = 0;
  const op = (min, pts, { ctr = c, st = setup, dir } = {}) => ({
    id: "demo" + (++seq), hora: hm(min), ativo: p.ativo || "WIN",
    direcao: dir || (seq % 2 ? "COMPRA" : "VENDA"), contratos: ctr,
    pontos: Math.round(pts), resultado: r2(Math.round(pts) * ctr * vp), setup: st,
  });
  const t = (min) => Math.min(Math.max(ini + min, ini), fim - 5); // dentro da janela

  // Perdas (de 2 em 2 min) até o dia passar do limite, contando o que o dia
  // já perdeu antes (`jaNoDia`). Pelo menos 1, no máximo 6.
  const ateOLimite = (min, jaNoDia, opts) => {
    const out = []; let soma = jaNoDia;
    while ((out.length === 0 || soma > -L) && out.length < 6) {
      const o = op(min + out.length * 2, -S, out.length === 0 ? opts : {}); out.push(o); soma += o.resultado;
    }
    return out;
  };

  // Depois do limite o aluno seguiu operando; garante que o dia FECHE abaixo
  // do limite (é o fechamento que o Quadro e o alerta de limite olham).
  const fecharAbaixo = (ops, min) => {
    let soma = ops.reduce((t, o) => t + o.resultado, 0), k = 0;
    while (soma > -L && k < 4) { const o = op(min + k * 6, -0.6 * S); ops.push(o); soma += o.resultado; k++; }
    return ops;
  };

  const dias = [];
  const dia = (resumo, emocional, operacoes, fb) => dias.push({ resumo, emocional, operacoes, fb });

  // ── 7 dias mais antigos: começo bom, um tropeço, retomada ──
  { const a = op(t(40), A), b = op(t(95), -0.6 * S);
    dia("Esperei o rompimento confirmar e deixei o alvo trabalhar.", 4, [a, b],
      { geral: "Ótimo começo de ciclo: entrada no gatilho e alvo respeitado. A perda da segunda operação ficou bem abaixo do stop — isso é gestão.", lido: true,
        por: { [a.id]: { tags: ["Esperou a confirmação", "Deixou o alvo trabalhar"], comentario: "Entrada no livro. Exatamente o que combinamos.", recomendacao: "" } } }); }
  { const G = pos(p.ganhoDiarioAlvo);
    const falta = G ? Math.ceil(G / (c * vp)) - Math.round(A) + 1 : 0;   // pontos para fechar o alvo do dia
    const a = op(t(30), A), b = op(t(70), Math.min(Math.max(0.9 * A, falta), 2 * A), { st: setup2 });
    dia("Bati o alvo do dia cedo e desliguei.", 5, [a, b],
      { geral: "Dia de manual: bateu o ganho diário e encerrou. É isso que protege o resultado.", lido: true,
        por: { [b.id]: { tags: ["Encerrou no alvo do dia"], comentario: "Saber parar é metade do jogo.", recomendacao: "" } } }); }
  { // três perdas pequenas (somam 1,7 stop: abaixo do limite diário de 2 stops)
    const a = op(t(20), -0.6 * S), b = op(t(35), -0.6 * S), d = op(t(50), -0.5 * S);
    dia("Mercado lateral, tomei três stops curtos seguidos. Fiquei irritado.", 2, [a, b, d],
      { geral: "Três perdas seguidas num dia lateral. As perdas ficaram pequenas, mas a terceira entrada veio rápido demais.", lido: true, replica: "Entendi. Na próxima vou levantar da cadeira depois do segundo stop.",
        por: { [d.id]: { tags: ["Ansiedade na entrada"], comentario: "Depois de 2 stops, o mercado não te deve nada.", recomendacao: "Após o 2º stop, pausa de 15 minutos." } } }); }
  { const a = op(t(45), A), b = op(t(110), -S), d = op(t(150), 0.8 * A);
    dia("Voltei com calma. Uma perda no meio, mas recuperei no setup.", 4, [a, b, d],
      { geral: "Boa retomada: manteve o tamanho da mão depois da perda e esperou o setup voltar.", lido: true,
        por: { [b.id]: { tags: ["Manteve a calma no drawdown"], comentario: "Perda dentro do plano, sem tentar recuperar no impulso.", recomendacao: "" } } }); }
  { const a = op(t(25), -0.5 * S), b = op(t(80), A);
    dia("Saí um pouco antes no stop, mas o segundo trade pagou.", 4, [a, b],
      { geral: "Dia sólido. Ótimo ter reduzido a perda quando o cenário mudou.", lido: true, por: {} }); }
  { const a = op(t(35), 0.95 * A);
    dia("Uma entrada só, bem feita.", 5, [a],
      { geral: "Uma operação, no setup, perto do alvo. Menos é mais — continue assim.", lido: false,
        por: { [a.id]: { tags: ["Setup no livro", "Execução limpa"], comentario: "Execução limpa do começo ao fim.", recomendacao: "" } } }); }
  { const a = op(t(30), -S), b = op(t(90), A);
    dia("Comecei com stop, mas segui o plano.", 3, [a, b],
      { geral: "Começar o dia com stop e ainda assim seguir o plano mostra maturidade.", lido: false,
        por: { [a.id]: { tags: ["Respeitou o stop diário"], comentario: "Stop no lugar, sem mexer.", recomendacao: "" } } }); }

  // ── 2 dias ruins (entram na janela dos alertas) ──
  { const a = op(t(20), -S);
    const b = op(t(23), -1.8 * S, { ctr: c + 1 });             // reentrada 3 min depois, mão maior, stop furado
    const lim = ateOLimite(t(40), a.resultado + b.resultado, { st: "Contra-tendência no impulso" }); // setup fora do plano até o limite
    const ultimoMin = t(40) + lim.length * 2;
    const extra = [];
    for (let k = 0; [a, b, ...lim].length + extra.length < Math.min(N + 1, 7); k++) extra.push(op(ultimoMin + 15 + k * 10, 0.3 * A));
    const dentro = fecharAbaixo([a, b, ...lim, ...extra], ultimoMin + 120);
    const fora = op(fim + 40, -0.5 * S);                         // depois do horário
    dia("Dia ruim. Tomei o primeiro stop, aumentei a mão para recuperar e perdi o controle. Ainda operei no fim da tarde.", 1, [...dentro, fora],
      { geral: "Este foi o dia que mais precisamos conversar: aumentou a mão logo depois do stop, a perda passou do stop combinado e você seguiu operando depois do limite e fora do horário.", lido: false,
        por: { [b.id]: { tags: ["Dobrou a mão", "Revenge trade"], comentario: "Aumentar a mão para recuperar é o erro mais caro do day trade.", recomendacao: "Depois de um stop, mesma mão ou menor." },
          [fora.id]: { tags: ["Operou após o stop diário"], comentario: "O dia já tinha acabado pelo plano.", recomendacao: "Bateu o limite? Feche a plataforma." } } }); }
  { const a = op(t(15), -S), b = op(t(17), -S);
    const lim = ateOLimite(t(19), a.resultado + b.resultado);
    const g = op(t(60), 0.4 * A);
    const extra = [];
    for (let k = 0; 2 + lim.length + 1 + extra.length < Math.min(N + 1, 7); k++) extra.push(op(t(90 + k * 15), 0.3 * A));
    dia("De novo comecei mal e voltei rápido demais para o mercado.", 2, fecharAbaixo([a, b, ...lim, g, ...extra], t(150)), null); }

  // ── 3 dias finais: dentro das regras, mas no negativo e saindo cedo ──
  const fecho = (txt, emo, fb) => {
    const g = op(t(40), 0.3 * A), l = op(t(100), -0.9 * S);
    const ops = [g, l];
    if (g.resultado + l.resultado >= 0) ops.push(op(t(140), -0.8 * S));
    dia(txt, emo, ops, fb);
  };
  fecho("Segui as regras, mas saí cedo do gain com medo de devolver.", 3,
    { geral: "Disciplina voltou — nenhuma regra quebrada. Agora o ponto é o alvo: você está saindo muito antes dele.", lido: true, por: {} });
  fecho("Mais um dia certinho nas regras, mas no vermelho.", 3, null);
  fecho("Respeitei tudo, mas de novo realizei o gain cedo.", 3, null);

  return datas.map((data, i) => {
    const d = dias[i];
    const feedback = d.fb ? {
      geral: d.fb.geral, porOperacao: d.fb.por || {}, autor: "mentor",
      publicadoEm: Date.parse(data + "T21:00:00Z"), atualizadoEm: Date.parse(data + "T21:00:00Z"),
      lido: !!d.fb.lido, replica: d.fb.replica || "", replicaEm: d.fb.replica ? Date.parse(data + "T23:00:00Z") : null,
    } : null;
    return {
      id: "demo-" + data.replace(/-/g, ""), data, resumo: d.resumo, emocional: d.emocional, origem: "manual",
      operacoes: d.operacoes, temRelatorio: false, temPrint: false,
      status: feedback ? "analisado" : "aguardando", enviadoEm: Date.parse(data + "T20:30:00Z"), feedback,
    };
  });
}
