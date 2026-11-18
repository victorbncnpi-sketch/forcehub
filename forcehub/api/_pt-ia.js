// api/_pt-ia.js — Diagnóstico do momento do aluno, escrito por IA e APROVADO
// pelo mentor. Prefixo "_": não vira rota (é servido por api/personal.js).
//
// O fluxo é sempre: a IA escreve um RASCUNHO → o mentor (Victor/moderador) lê,
// edita e publica → só então o aluno vê. A IA nunca fala direto com o aluno.
//
// O que vai para a IA: plano, números do ciclo, últimos dias, alertas, tags do
// feedback e o perfil (experiência, outra renda, prejuízo passado). O que NÃO
// vai: observações e anotações privadas do mentor — o texto gerado é destinado
// ao aluno, então nada que ele não possa ler entra no prompt.
import { geminiText } from "./_ai";

export const MAX_TEXTO = 3000;
const corta = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const r2 = (v) => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;

// Resumo compacto e determinístico do que a IA precisa saber. Pura: testável.
export function dadosParaIA({ ciclo, plano, real, envios, alertas, tags }) {
  const c = ciclo || {}, p = plano || {}, r = real || {}, d = c.diagnostico || {};
  const lista = [...(envios || [])].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  return {
    primeiroNome: corta(c.nome, 80).split(" ")[0] || "aluno",
    ciclo: { status: c.status || "ativo", diasOperados: r.diasOperados || 0, diasPrevistos: c.diasPrevistos || 30 },
    perfil: {
      experiencia: corta(d.experiencia, 120) || null,
      outraRenda: !!d.outraRenda,
      prejuizoPassado: d.prejuizoPassado || null,
    },
    plano: {
      ativo: p.ativo, contratos: p.contratos, pontosAlvo: p.pontosAlvo, pontosStop: p.pontosStop,
      ganhoDiarioAlvo: p.ganhoDiarioAlvo, prejuizoDiarioLimite: p.prejuizoDiarioLimite,
      horario: p.horaInicio && p.horaFim ? `${p.horaInicio}–${p.horaFim}` : null,
      setups: p.setups || [], operacoesDia: p.operacoesDia,
    },
    numeros: {
      resultado: r.resultado, operacoes: r.ops, acerto: r.winRate, payoff: r.payoff,
      aderenciaAoPlanoPct: r.aderencia, diasComViolacao: r.diasComViolacao, diasSeguidosSemViolacao: r.sequenciaLimpa,
      violacoesPorTipo: r.violacoesPorTipo || {}, mediaPontosGain: r.mediaPontosGain, mediaPontosLoss: r.mediaPontosLoss,
      maiorQuedaNoCiclo: r.drawdownReal, operacoesPorDia: r.opsDia,
    },
    ultimosDias: lista.slice(-7).map(e => ({
      data: e.data, resultado: e.dia && e.dia.resultado, operacoes: e.dia && e.dia.ops,
      regrasQuebradas: [...new Set((e.violacoes || []).map(v => v.tipo))],
      humor1a5: e.emocional || null,
      relatoDoAluno: corta(e.resumo, 240) || null,
      feedbackDoMentor: corta(e.feedback && e.feedback.geral, 300) || null,
    })),
    alertas: (alertas || []).filter(a => a.tipo !== "aguardando").map(a => a.texto),
    padroesMarcadosPeloMentor: (tags || []).slice(0, 8).map(t => ({ tag: t.tag, vezes: t.total, tendencia: t.tendencia })),
  };
}

export const SISTEMA = `Você é a voz de um mentor de day trade (mini índice e mini dólar na B3) escrevendo para um aluno do acompanhamento "Personal Trader".
Escreva como um mentor amigável e experiente falaria numa conversa: humano, leve, acolhedor e honesto. Português do Brasil, segunda pessoa ("você"), frases curtas.
Regras:
- Comece pelo nome do aluno e reconheça algo positivo REAL dos dados (mesmo que pequeno).
- Traga no máximo 2 pontos de atenção, concretos e com os números do próprio aluno (dias, pontos, contratos, horários). Explique o porquê de forma simples.
- Termine com 1 ou 2 próximos passos práticos para os próximos pregões e uma frase de incentivo.
- Disciplina e processo vêm antes de resultado financeiro. Não julgue o aluno por não bater o alvo do dia.
- Sem jargão sem explicação (nada de "tilt", "drawdown", "payoff", "revenge trade").
- Nunca cite valores de capital nem o valor do prejuízo passado; se usar esse contexto, fale de forma geral e respeitosa.
- Não prometa ganhos, não dê recomendação de compra ou venda, não invente dados que não estão abaixo.
- 150 a 260 palavras, em 3 a 5 parágrafos curtos. Texto corrido, sem títulos, sem listas, sem markdown, sem emojis em excesso (no máximo 1).
Responda apenas com o texto para o aluno.`;

export function montarPrompt(dados) {
  return `Dados do aluno (JSON). Valores em R$, pontos e datas ISO; "acerto" é fração de 0 a 1.\n${JSON.stringify(dados)}\n\nEscreva agora o diagnóstico do momento para ${dados.primeiroNome}.`;
}

// Tira markdown, aspas de bloco e espaço sobrando; mantém parágrafos.
export function limparTexto(t) {
  const s = String(t == null ? "" : t)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
    .replace(/^[ \t]*[-*•][ \t]+/gm, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .split(/\n\s*\n+/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
  return s.slice(0, MAX_TEXTO).trim();
}

export async function gerarDiagnosticoIA(dados, { gerar = geminiText } = {}) {
  const texto = limparTexto(await gerar({ system: SISTEMA, messages: [{ role: "user", content: montarPrompt(dados) }], maxTokens: 1400, temperature: 0.7 }));
  if (texto.length < 80) throw new Error("A IA não devolveu um texto utilizável — tente gerar de novo.");
  return texto;
}

// Estado guardado no ciclo: { rascunho, geradoEm, geradoPor, baseDias,
// editadoEm, publicado: { texto, em, por } | null }.
export function estadoInicial(atual) {
  const a = atual && typeof atual === "object" ? atual : {};
  return {
    rascunho: typeof a.rascunho === "string" ? a.rascunho : "",
    geradoEm: a.geradoEm || null, geradoPor: a.geradoPor || null, baseDias: a.baseDias ?? null,
    editadoEm: a.editadoEm || null,
    publicado: a.publicado && a.publicado.texto ? a.publicado : null,
  };
}

// ─── Feedback geral do dia (IA escreve, mentor revisa e publica) ─────────────
// Mesmo princípio do diagnóstico: a IA só devolve um TEXTO para o campo do
// mentor; nada é gravado nem chega ao aluno até ele clicar em "Publicar".
// Entram as tags e comentários que o mentor já marcou nas operações (ainda
// não salvos), para a leitura do dia seguir o que ele mesmo apontou.
export const MAX_FEEDBACK = 4000;
export function dadosDoDiaParaIA({ ciclo, plano, envio, anteriores, porOperacao }) {
  const c = ciclo || {}, p = plano || {}, e = envio || {}, d = e.dia || {};
  const fbOps = porOperacao && typeof porOperacao === "object" ? porOperacao : {};
  return {
    primeiroNome: corta(c.nome, 80).split(" ")[0] || "aluno",
    data: e.data,
    plano: {
      ativo: p.ativo, contratos: p.contratos, pontosAlvo: p.pontosAlvo, pontosStop: p.pontosStop,
      ganhoDiarioAlvo: p.ganhoDiarioAlvo, prejuizoDiarioLimite: p.prejuizoDiarioLimite,
      horario: p.horaInicio && p.horaFim ? `${p.horaInicio}–${p.horaFim}` : null, setups: p.setups || [],
    },
    relatoDoAluno: corta(e.resumo, 600) || null,
    humor1a5: e.emocional || null,
    dia: { resultado: d.resultado, operacoes: d.ops, gains: d.gains, losses: d.losses, bateuAlvoDoDia: !!d.atingiuAlvo,
      bateuLimiteDePerda: !!d.atingiuLimite, maiorSequenciaDePerdas: d.maxPerdasSeguidas },
    operacoes: (e.operacoes || []).slice(0, 40).map(o => {
      const f = fbOps[o.id] || {};
      return {
        hora: o.hora, direcao: o.direcao, contratos: o.contratos, pontos: o.pontos, resultado: o.resultado, setup: o.setup || null,
        regrasQuebradas: o.violacoes || [],
        tagsDoMentor: Array.isArray(f.tags) ? f.tags.slice(0, 8).map(t => corta(t, 60)) : [],
        comentarioDoMentor: corta(f.comentario, 300) || null, recomendacaoDoMentor: corta(f.recomendacao, 200) || null,
      };
    }),
    regrasQuebradas: (e.violacoes || []).map(v => corta(v.texto, 200)),
    quadro: (e.quadro || []).map(l => ({ linha: corta(l.label, 60), definido: l.definidoTxt, hoje: l.hojeTxt, status: l.status })),
    diasAnteriores: (anteriores || []).slice(-2).map(a => ({ data: a.data, resultado: a.dia && a.dia.resultado,
      regrasQuebradas: [...new Set((a.violacoes || []).map(v => v.tipo))], feedbackDoMentor: corta(a.feedback && a.feedback.geral, 300) || null })),
  };
}

export const SISTEMA_FEEDBACK = `Você é a voz de um mentor de day trade (mini índice e mini dólar na B3) escrevendo o FEEDBACK GERAL DE UM DIA para um aluno do acompanhamento "Personal Trader".
Tom: mentor amigável e experiente, humano, leve e honesto, como numa conversa. Português do Brasil, segunda pessoa ("você"), frases curtas.
Estrutura (texto corrido, 2 ou 3 parágrafos curtos):
1) O que sustentou o dia — comece reconhecendo algo concreto que o aluno fez bem (mesmo num dia ruim).
2) O que precisa mudar — no máximo 2 pontos, com os números do próprio dia (horários, pontos, contratos). Use as tags e comentários do mentor como guia principal: se ele marcou algo, o texto precisa refletir isso.
3) O foco de amanhã — 1 ação prática e simples, e uma frase de incentivo.
Regras:
- Processo antes de resultado: não bater o alvo do dia não é erro; quebrar regra do plano é o que importa.
- Leve em conta o relato e o humor do aluno; se o dia foi difícil emocionalmente, acolha antes de corrigir.
- Sem jargão sem explicação (nada de "tilt", "drawdown", "payoff", "revenge trade", "overtrading").
- Não prometa ganhos, não recomende compra ou venda, não invente dados que não estão abaixo.
- 80 a 170 palavras. Sem títulos, sem listas, sem markdown, no máximo 1 emoji.
Responda apenas com o texto do feedback.`;

export async function gerarFeedbackIA(dados, { gerar = geminiText } = {}) {
  const prompt = `Dados do dia (JSON). Valores em R$, pontos e horários do pregão.\n${JSON.stringify(dados)}\n\nEscreva agora o feedback geral do dia ${dados.data || ""} para ${dados.primeiroNome}.`;
  const texto = limparTexto(await gerar({ system: SISTEMA_FEEDBACK, messages: [{ role: "user", content: prompt }], maxTokens: 900, temperature: 0.7 })).slice(0, MAX_FEEDBACK);
  if (texto.length < 60) throw new Error("A IA não devolveu um texto utilizável — tente de novo.");
  return texto;
}
