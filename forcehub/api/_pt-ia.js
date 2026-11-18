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
