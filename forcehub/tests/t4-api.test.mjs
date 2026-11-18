import { secao, ta, eq, ehVerdade, ehFalso, contem, resumo, fakeRedis, chamar } from "./runner.mjs";
import handler from "../api/personal";
import { readFileSync } from "node:fs";

const ALUNO = { user: "andre.gain", name: "André Gain", role: "client", perms: ["personal", "trades"] };
const OUTRO = { user: "maria.emilia", name: "Maria Emília", role: "client", perms: ["personal"] };
const SEM_CAP = { user: "cliente1", name: "Cliente 1", role: "client", perms: ["panorama"] };
const MENTOR = { user: "victor", name: "Victor", role: "superadmin", perms: [] };
const MOD = { user: "mod1", name: "Mod", role: "moderator", perms: [] };
const USERS = { "andre.gain": ALUNO, "maria.emilia": OUTRO, "cliente1": SEM_CAP, victor: MENTOR, mod1: MOD };

const PLANO = { vigenciaInicio: "2026-09-01", ativo: "WIN", valorPonto: 0.2, pontosAlvo: 150, pontosStop: 100,
  contratos: 2, ganhoDiarioAlvo: 120, prejuizoDiarioLimite: 80, metaMensal: 2000, diasPrevistosOperando: 20,
  horaInicio: "09:15", horaFim: "17:00", setups: ["Rompimento"], operacoesDia: 4, winRateAlvo: 55 };

// Um ambiente novo, já com o ciclo do André criado pelo mentor.
async function ambiente() {
  const redis = fakeRedis();
  const users = JSON.parse(JSON.stringify(USERS));
  const ctx = { redis, users };
  await chamar(handler, { method: "POST", session: MENTOR, users, redis,
    query: { user: "andre.gain" },
    body: { action: "ciclo", nome: "André Gain", inicio: "2026-09-01", diasPrevistos: 30,
      diagnostico: { capitalOperacional: 18000, observacoes: "SEGREDO DO MENTOR" },
      plano: PLANO } });
  await chamar(handler, { method: "POST", session: MENTOR, users, redis, query: { user: "andre.gain" },
    body: { action: "notas", notas: "ANOTACAO PRIVADA" } });
  return ctx;
}
const post = (ctx, session, body, query = {}) => chamar(handler, { method: "POST", session, users: ctx.users, redis: ctx.redis, query, body });
const get = (ctx, session, query = {}) => chamar(handler, { method: "GET", session, users: ctx.users, redis: ctx.redis, query });

await (async () => {

secao("o dublê de _auth reexporta a regra real (não copia)");
await ta("sessionCan/PAGE_CAPS vêm de api/_auth.js, não de uma cópia", async () => {
  const src = readFileSync("tests/stubs/_auth.js", "utf8");
  contem(src, 'from "../../api/_auth.js"');
  ehFalso(/function sessionCan/.test(src), "o dublê redefiniu sessionCan — vira cobertura falsa");
  ehFalso(/PAGE_CAPS = \[/.test(src), "o dublê redefiniu PAGE_CAPS");
});
await ta("a regra reexportada é a que os testes exercitam", async () => {
  const { sessionCan, PAGE_CAPS } = await import("../api/_auth.js");
  ehVerdade(PAGE_CAPS.includes("personal"), "o cap novo precisa estar em api/_auth.js");
  ehVerdade(sessionCan({ role: "moderator", perms: [] }, "personal"), "staff acessa mesmo com sessão antiga");
  ehFalso(sessionCan({ role: "client", perms: ["panorama"] }, "personal"));
  ehVerdade(sessionCan({ role: "client", perms: ["personal"] }, "personal"));
});

secao("autenticação e capacidade");
await ta("sem sessão = 401", async () => {
  const ctx = await ambiente();
  eq((await get(ctx, null)).status, 401);
});
await ta("cliente sem o cap 'personal' = 403", async () => {
  const ctx = await ambiente();
  eq((await get(ctx, SEM_CAP)).status, 403);
});
await ta("moderador com sessão ANTIGA (sem o cap) ainda entra — staff passa por cima", async () => {
  const ctx = await ambiente();
  const r = await get(ctx, { ...MOD, perms: ["panorama"] });
  eq(r.status, 200);
});
await ta("método não suportado = 405", async () => {
  const ctx = await ambiente();
  eq((await chamar(handler, { method: "DELETE", session: MENTOR, users: ctx.users, redis: ctx.redis, query: {} })).status, 405);
});
await ta("sem banco = 503", async () => {
  eq((await chamar(handler, { method: "GET", session: MENTOR, redis: null })).status, 503);
});

secao("ISOLAMENTO ENTRE ALUNOS");
await ta("aluno pedindo ?user=outro recebe os PRÓPRIOS dados, não os do outro", async () => {
  const ctx = await ambiente();
  const r = await get(ctx, OUTRO, { user: "andre.gain" });
  eq(r.status, 200);
  eq(r.body.ciclo, null, "Maria não tem ciclo; não pode ver o do André");
});
await ta("aluno não consegue escrever envio na conta de outro", async () => {
  const ctx = await ambiente();
  const r = await post(ctx, OUTRO, { action: "envio", data: "2026-09-10", resumo: "invasao" }, { user: "andre.gain" });
  eq(r.status, 404, "cai no ciclo dela (inexistente), não no dele");
  const dele = await get(ctx, MENTOR, { user: "andre.gain" });
  eq(dele.body.envios.length, 0, "nada foi gravado no André");
});
await ta("aluno não lê o print de outro aluno", async () => {
  const ctx = await ambiente();
  await post(ctx, MENTOR, { action: "img", id: "e1-print", data: "data:image/jpeg;base64,AAA" }, { user: "andre.gain" });
  const r = await get(ctx, OUTRO, { fn: "img", id: "e1-print", user: "andre.gain" });
  eq(r.body.image, null, "veio a imagem do André para a Maria");
});
await ta("aluno não acessa a fila do mentor", async () => {
  const ctx = await ambiente();
  eq((await get(ctx, ALUNO, { fn: "alunos" })).status, 403);
});

secao("PRIVACIDADE — diagnóstico e anotações");
await ta("aluno NÃO recebe diagnóstico nem notas", async () => {
  const ctx = await ambiente();
  const r = await get(ctx, ALUNO);
  eq(r.status, 200);
  ehFalso("diagnostico" in r.body.ciclo, "diagnóstico vazou para o aluno");
  ehFalso("notas" in r.body.ciclo, "anotações vazaram para o aluno");
  ehFalso(JSON.stringify(r.body).includes("SEGREDO DO MENTOR"), "texto do diagnóstico vazou");
  ehFalso(JSON.stringify(r.body).includes("ANOTACAO PRIVADA"), "anotação vazou");
});
await ta("mentor recebe diagnóstico e notas", async () => {
  const ctx = await ambiente();
  const r = await get(ctx, MENTOR, { user: "andre.gain" });
  contem(JSON.stringify(r.body), "SEGREDO DO MENTOR");
  contem(JSON.stringify(r.body), "ANOTACAO PRIVADA");
});
await ta("aluno não vê o alerta interno de 'aguardando análise'", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", resumo: "dia", operacoes: [{ hora: "10:00", resultado: 60, setup: "Rompimento" }] });
  const aluno = await get(ctx, ALUNO);
  ehFalso(aluno.body.alertas.some(a => a.tipo === "aguardando"));
  const mentor = await get(ctx, MENTOR, { user: "andre.gain" });
  ehVerdade(mentor.body.alertas.some(a => a.tipo === "aguardando"));
});

secao("AÇÕES RESTRITAS AO MENTOR");
for (const [acao, corpo] of [
  ["ciclo", { plano: PLANO }], ["plano", { plano: { ...PLANO, motivo: "x" } }],
  ["status", { status: "concluido" }], ["notas", { notas: "x" }],
  ["remover-ciclo", {}], ["feedback", { envioId: "x", feedback: { geral: "x" } }],
  ["tag", { tag: { nome: "X" } }],
]) {
  await ta(`aluno não executa "${acao}"`, async () => {
    const ctx = await ambiente();
    const r = await post(ctx, ALUNO, { action: acao, ...corpo });
    eq(r.status, 403, `${acao} deveria ser 403, veio ${r.status} ${JSON.stringify(r.body)}`);
  });
}
await ta("moderador PODE executar ações de mentor", async () => {
  const ctx = await ambiente();
  eq((await post(ctx, MOD, { action: "notas", notas: "do moderador" }, { user: "andre.gain" })).status, 200);
});
await ta("ação desconhecida = 400", async () => {
  const ctx = await ambiente();
  eq((await post(ctx, MENTOR, { action: "dropTable" }, { user: "andre.gain" })).status, 400);
});

secao("ENVIO DO DIA");
await ta("envio no futuro é recusado", async () => {
  const ctx = await ambiente();
  const r = await post(ctx, ALUNO, { action: "envio", data: "2099-01-01", resumo: "x" });
  eq(r.status, 400);
});
await ta("envio sem operações E sem resumo é recusado", async () => {
  const ctx = await ambiente();
  eq((await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", resumo: "", operacoes: [] })).status, 400);
});
await ta("envio grava violações calculadas no SERVIDOR", async () => {
  const ctx = await ambiente();
  const r = await post(ctx, ALUNO, { action: "envio", data: "2026-09-10",
    operacoes: [{ hora: "18:30", resultado: 60, contratos: 9, setup: "Scalp" }] });
  eq(r.status, 200);
  const tipos = r.body.envio.violacoes.map(v => v.tipo).sort();
  eq(tipos, ["contratos_acima", "fora_de_horario", "setup_nao_autorizado"]);
});
await ta("cliente NÃO consegue forjar violações/quadro no payload", async () => {
  const ctx = await ambiente();
  const r = await post(ctx, ALUNO, { action: "envio", data: "2026-09-10",
    operacoes: [{ hora: "18:30", resultado: 60, contratos: 9, setup: "Scalp" }],
    violacoes: [], quadro: [], dia: { resultado: 999999 }, status: "analisado",
    feedback: { geral: "eu me aprovo" } });
  ehVerdade(r.body.envio.violacoes.length > 0, "as violações forjadas (vazias) prevaleceram");
  eq(r.body.envio.dia.resultado, 60, "o dia forjado prevaleceu");
  eq(r.body.envio.status, "aguardando", "o aluno se marcou como analisado");
  eq(r.body.envio.feedback, null, "o aluno escreveu o próprio feedback");
});
await ta("reenviar o mesmo dia substitui em vez de duplicar", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 60, setup: "Rompimento" }] });
  const r = await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 30, setup: "Rompimento" }] });
  ehVerdade(r.body.substituiu);
  const v = await get(ctx, ALUNO);
  eq(v.body.envios.length, 1); eq(v.body.envios[0].dia.resultado, 30);
});
await ta("aluno NÃO reabre um dia já analisado", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 60, setup: "Rompimento" }] });
  const e = (await get(ctx, ALUNO)).body.envios[0];
  await post(ctx, MENTOR, { action: "feedback", envioId: e.id, feedback: { geral: "ok" } }, { user: "andre.gain" });
  eq((await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 999, setup: "Rompimento" }] })).status, 409);
});
await ta("mentor PODE relançar um dia analisado", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 60, setup: "Rompimento" }] });
  const e = (await get(ctx, ALUNO)).body.envios[0];
  await post(ctx, MENTOR, { action: "feedback", envioId: e.id, feedback: { geral: "ok" } }, { user: "andre.gain" });
  eq((await post(ctx, MENTOR, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 30, setup: "Rompimento" }] }, { user: "andre.gain" })).status, 200);
});
await ta("ciclo concluído não aceita envio", async () => {
  const ctx = await ambiente();
  await post(ctx, MENTOR, { action: "status", status: "concluido" }, { user: "andre.gain" });
  eq((await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", resumo: "x" })).status, 409);
});
await ta("aluno sem ciclo recebe 404 explicativo ao enviar", async () => {
  const ctx = await ambiente();
  const r = await post(ctx, OUTRO, { action: "envio", data: "2026-09-10", resumo: "x" });
  eq(r.status, 404); contem(r.body.error, "mentor");
});

secao("FEEDBACK E RÉPLICA");
async function comFeedback() {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 60, setup: "Rompimento" }] });
  const e = (await get(ctx, ALUNO)).body.envios[0];
  await post(ctx, MENTOR, { action: "feedback", envioId: e.id,
    feedback: { geral: "leitura do dia", porOperacao: { [e.operacoes[0].id]: { tags: ["Execução limpa"], comentario: "boa entrada" } } } }, { user: "andre.gain" });
  return { ctx, envioId: e.id };
}
await ta("publicar feedback marca o envio como analisado e NÃO lido", async () => {
  const { ctx } = await comFeedback();
  const e = (await get(ctx, ALUNO)).body.envios[0];
  eq(e.status, "analisado"); eq(e.feedback.lido, false);
});
await ta("feedback vazio é recusado", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 60, setup: "Rompimento" }] });
  const e = (await get(ctx, ALUNO)).body.envios[0];
  eq((await post(ctx, MENTOR, { action: "feedback", envioId: e.id, feedback: { geral: "" } }, { user: "andre.gain" })).status, 400);
});
await ta("envio inexistente = 404", async () => {
  const ctx = await ambiente();
  eq((await post(ctx, MENTOR, { action: "feedback", envioId: "nao-existe", feedback: { geral: "x" } }, { user: "andre.gain" })).status, 404);
});
await ta("aluno marca como lido e devolve a réplica", async () => {
  const { ctx, envioId } = await comFeedback();
  eq((await post(ctx, ALUNO, { action: "lido", envioId, replica: "e às 10h?" })).status, 200);
  const e = (await get(ctx, ALUNO)).body.envios[0];
  eq(e.feedback.lido, true); eq(e.feedback.replica, "e às 10h?");
});
await ta("republicar o feedback zera o 'lido' (aluno precisa reler)", async () => {
  const { ctx, envioId } = await comFeedback();
  await post(ctx, ALUNO, { action: "lido", envioId, replica: "pergunta" });
  await post(ctx, MENTOR, { action: "feedback", envioId, feedback: { geral: "revisado" } }, { user: "andre.gain" });
  const e = (await get(ctx, ALUNO)).body.envios[0];
  eq(e.feedback.lido, false);
  eq(e.feedback.replica, "pergunta", "a pergunta do aluno sobreviveu à republicação");
});
await ta("publicar alimenta a biblioteca de tags com o snippet", async () => {
  const { ctx } = await comFeedback();
  const tags = (await get(ctx, MENTOR, { fn: "tags" })).body.tags;
  const t1 = tags.find(x => x.nome === "Execução limpa");
  eq(t1.usos, 1); contem(t1.snippets[0].texto, "boa entrada");
});

secao("PLANO — versionamento pela API");
await ta("nova versão exige motivo", async () => {
  const ctx = await ambiente();
  eq((await post(ctx, MENTOR, { action: "plano", plano: { ...PLANO, pontosStop: 70 } }, { user: "andre.gain" })).status, 400);
});
await ta("nova versão reanalisa envios já gravados", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: -40, contratos: 2, setup: "Rompimento" }] });
  eq((await get(ctx, ALUNO)).body.envios[0].violacoes.length, 0, "sob v1 (stop 100) está ok");
  await post(ctx, MENTOR, { action: "plano",
    plano: { ...PLANO, motivo: "aperta o stop", vigenciaInicio: "2026-09-01", pontosStop: 70 } }, { user: "andre.gain" });
  const e = (await get(ctx, ALUNO)).body.envios[0];
  eq(e.planoVersao, 2);
  ehVerdade(e.violacoes.some(v => v.tipo === "sem_stop"), "sob v2 (stop 70) deveria violar");
});
await ta("vigência futura NÃO reescreve o passado", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: -40, contratos: 2, setup: "Rompimento" }] });
  await post(ctx, MENTOR, { action: "plano",
    plano: { ...PLANO, motivo: "vale só daqui pra frente", vigenciaInicio: "2026-09-20", pontosStop: 70 } }, { user: "andre.gain" });
  const e = (await get(ctx, ALUNO)).body.envios[0];
  eq(e.planoVersao, 1); eq(e.violacoes.length, 0);
});
await ta("Sessão Zero trava depois que existe v2", async () => {
  const ctx = await ambiente();
  await post(ctx, MENTOR, { action: "plano", plano: { ...PLANO, motivo: "v2" } }, { user: "andre.gain" });
  eq((await post(ctx, MENTOR, { action: "ciclo", plano: PLANO }, { user: "andre.gain" })).status, 409);
});
await ta("ciclo para usuário inexistente = 404", async () => {
  const ctx = await ambiente();
  eq((await post(ctx, MENTOR, { action: "ciclo", plano: PLANO }, { user: "fantasma" })).status, 404);
});
await ta("matricular concede o cap 'personal' ao aluno", async () => {
  const ctx = await ambiente();
  ehVerdade(ctx.users["andre.gain"].perms.includes("personal"));
  const semCap = JSON.parse(JSON.stringify(ctx.users));
  semCap["cliente1"].perms = ["panorama"];
  await chamar(handler, { method: "POST", session: MENTOR, users: semCap, redis: ctx.redis,
    query: { user: "cliente1" }, body: { action: "ciclo", plano: PLANO } });
  ehVerdade(globalThis.__USERS__["cliente1"].perms.includes("personal"), "não concedeu o acesso na matrícula");
});
await ta("avisos de coerência voltam na resposta da Sessão Zero", async () => {
  const ctx = await ambiente();
  const r = await post(ctx, MENTOR, { action: "ciclo",
    diagnostico: { capitalOperacional: 500 }, plano: { ...PLANO, pontosAlvo: 50 } }, { user: "andre.gain" });
  const tipos = r.body.avisos.map(a => a.tipo);
  ehVerdade(tipos.includes("payoff_baixo") && tipos.includes("risco_elevado"), "veio " + tipos);
});

secao("IMAGENS");
await ta("imagem acima do teto = 413", async () => {
  const ctx = await ambiente();
  eq((await post(ctx, ALUNO, { action: "img", id: "e1-print", data: "x".repeat(1000 * 1024) })).status, 413);
});
await ta("data vazio apaga a chave", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "img", id: "e1-print", data: "data:image/jpeg;base64,AAA" });
  await post(ctx, ALUNO, { action: "img", id: "e1-print", data: null });
  eq((await get(ctx, ALUNO, { fn: "img", id: "e1-print" })).body.image, null);
});
await ta("remover o envio apaga os prints dele", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 60, setup: "Rompimento" }] });
  const e = (await get(ctx, ALUNO)).body.envios[0];
  await post(ctx, ALUNO, { action: "img", id: e.id + "-print", data: "data:image/jpeg;base64,AAA" });
  await post(ctx, ALUNO, { action: "remover-envio", envioId: e.id });
  eq((await get(ctx, ALUNO, { fn: "img", id: e.id + "-print" })).body.image, null);
  eq((await get(ctx, ALUNO)).body.envios.length, 0);
});
await ta("aluno não remove envio já analisado", async () => {
  const { ctx, envioId } = await comFeedback();
  eq((await post(ctx, ALUNO, { action: "remover-envio", envioId })).status, 409);
  eq((await post(ctx, MENTOR, { action: "remover-envio", envioId }, { user: "andre.gain" })).status, 200);
});

secao("FILA DO MENTOR");
await ta("fila lista pendentes e ignora analisados", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 60, setup: "Rompimento" }] });
  let lista = (await get(ctx, MENTOR, { fn: "alunos" })).body;
  eq(lista.alunos.length, 1); eq(lista.alunos[0].pendentes.length, 1);
  const e = (await get(ctx, MENTOR, { user: "andre.gain" })).body.envios[0];
  await post(ctx, MENTOR, { action: "feedback", envioId: e.id, feedback: { geral: "ok" } }, { user: "andre.gain" });
  lista = (await get(ctx, MENTOR, { fn: "alunos" })).body;
  eq(lista.alunos[0].pendentes.length, 0);
});
await ta("a fila NÃO carrega operações (payload enxuto)", async () => {
  const ctx = await ambiente();
  await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", operacoes: [{ hora: "10:00", resultado: 60, setup: "Rompimento" }] });
  const p = (await get(ctx, MENTOR, { fn: "alunos" })).body.alunos[0].pendentes[0];
  ehFalso("operacoes" in p, "a fila está carregando as operações inteiras");
  ehVerdade("resultado" in p && "violacoes" in p);
});
await ta("'disponiveis' traz só clientes ainda sem ciclo", async () => {
  const ctx = await ambiente();
  const d = (await get(ctx, MENTOR, { fn: "alunos" })).body.disponiveis.map(x => x.user).sort();
  eq(d, ["cliente1", "maria.emilia"]);
});
await ta("remover o ciclo tira o aluno do índice", async () => {
  const ctx = await ambiente();
  await post(ctx, MENTOR, { action: "remover-ciclo" }, { user: "andre.gain" });
  eq((await get(ctx, MENTOR, { fn: "alunos" })).body.alunos.length, 0);
});


secao("DIAGNÓSTICO — campos da Sessão Zero");
await ta("prejuízo passado é gravado; capital total e aporte mensal saíram", async () => {
  const ctx = await ambiente();
  await post(ctx, MENTOR, { action: "ciclo", diagnostico: { capitalOperacional: 18000, prejuizoPassado: "15000", capitalTotal: 90000, aporteMensal: 500 } }, { user: "andre.gain" });
  const d = (await get(ctx, MENTOR, { user: "andre.gain" })).body.ciclo.diagnostico;
  eq(d.prejuizoPassado, 15000); ehFalso("capitalTotal" in d); ehFalso("aporteMensal" in d);
  const r = await get(ctx, ALUNO);
  ehFalso(JSON.stringify(r.body).includes("15000"), "prejuízo passado vazou para o aluno");
});
await ta("prejuízo passado negativo ou texto vira vazio", async () => {
  const ctx = await ambiente();
  await post(ctx, MENTOR, { action: "ciclo", diagnostico: { prejuizoPassado: -3 } }, { user: "andre.gain" });
  eq((await get(ctx, MENTOR, { user: "andre.gain" })).body.ciclo.diagnostico.prejuizoPassado, null);
});

secao("DIAGNÓSTICO DO MOMENTO — IA escreve, mentor aprova, aluno lê");
const TXT1 = "André, você fechou a semana respeitando o horário em todos os dias. Isso é disciplina de verdade e merece ser reconhecido.";
const TXT2 = "André, nova leitura: o stop foi respeitado em todas as operações desta semana, e isso mostra que o plano já está virando hábito.";
const diag = (ctx, s, body) => post(ctx, s, { action: "diag-ia", ...body }, { user: "andre.gain" });
await ta("aluno não pode gerar, salvar nem publicar", async () => {
  const ctx = await ambiente();
  for (const op of ["gerar", "salvar", "publicar", "retirar"]) eq((await diag(ctx, ALUNO, { op, texto: TXT1 })).status, 403, op);
});
await ta("moderador também revisa e publica", async () => {
  const ctx = await ambiente();
  eq((await diag(ctx, MOD, { op: "publicar", texto: TXT1 })).status, 200);
});
await ta("rascunho salvo NÃO chega ao aluno", async () => {
  const ctx = await ambiente();
  eq((await diag(ctx, MENTOR, { op: "salvar", texto: TXT1 })).status, 200);
  const r = await get(ctx, ALUNO);
  eq(r.body.diagnosticoMomento, null);
  ehFalso("diagIA" in r.body.ciclo, "estado do rascunho vazou");
  ehFalso(JSON.stringify(r.body).includes("fechou a semana"), "texto do rascunho vazou");
  contem(JSON.stringify((await get(ctx, MENTOR, { user: "andre.gain" })).body.ciclo.diagIA), "fechou a semana");
});
await ta("publicado chega ao aluno; novo rascunho não troca o publicado até publicar", async () => {
  const ctx = await ambiente();
  await diag(ctx, MENTOR, { op: "publicar", texto: TXT1 });
  eq((await get(ctx, ALUNO)).body.diagnosticoMomento.texto, TXT1);
  await diag(ctx, MENTOR, { op: "salvar", texto: TXT2 });
  const a = (await get(ctx, ALUNO)).body;
  eq(a.diagnosticoMomento.texto, TXT1, "o aluno continua vendo a versão aprovada");
  ehFalso(JSON.stringify(a).includes("nova leitura"));
  await diag(ctx, MENTOR, { op: "publicar", texto: TXT2 });
  eq((await get(ctx, ALUNO)).body.diagnosticoMomento.texto, TXT2);
});
await ta("retirar tira do aluno e mantém o rascunho para o mentor", async () => {
  const ctx = await ambiente();
  await diag(ctx, MENTOR, { op: "publicar", texto: TXT1 });
  await diag(ctx, MENTOR, { op: "retirar" });
  eq((await get(ctx, ALUNO)).body.diagnosticoMomento, null);
  eq((await get(ctx, MENTOR, { user: "andre.gain" })).body.ciclo.diagIA.rascunho, TXT1);
});
await ta("publicar texto vazio ou curto é recusado", async () => {
  const ctx = await ambiente();
  eq((await diag(ctx, MENTOR, { op: "publicar", texto: "  oi  " })).status, 400);
  eq((await get(ctx, ALUNO)).body.diagnosticoMomento, null);
});
await ta("sem IA configurada: 502 com mensagem clara, nada é gravado", async () => {
  const ctx = await ambiente();
  const antes = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  const r = await diag(ctx, MENTOR, { op: "gerar" });
  if (antes) process.env.GEMINI_API_KEY = antes;
  eq(r.status, 502); contem(r.body.error, "Não consegui gerar");
  eq((await get(ctx, MENTOR, { user: "andre.gain" })).body.ciclo.diagIA, undefined);
});
await ta("editar a Sessão Zero não apaga o diagnóstico publicado", async () => {
  const ctx = await ambiente();
  await diag(ctx, MENTOR, { op: "publicar", texto: TXT1 });
  await post(ctx, MENTOR, { action: "ciclo", nome: "André G." }, { user: "andre.gain" });
  eq((await get(ctx, ALUNO)).body.diagnosticoMomento.texto, TXT1);
});
await ta("operação desconhecida é recusada", async () => {
  eq((await diag(await ambiente(), MENTOR, { op: "apagar-tudo" })).status, 400);
});

secao("DADOS FICTÍCIOS — só aluno de teste");
async function comTeste(planoExtra = {}) {
  const ctx = await ambiente();
  ctx.users["cliente.teste"] = { user: "cliente.teste", name: "Cliente Teste", role: "client", perms: ["personal"] };
  await post(ctx, MENTOR, { action: "ciclo", nome: "Cliente Teste", inicio: "2026-11-18", diasPrevistos: 30,
    diagnostico: { capitalOperacional: 9000 }, plano: { ...PLANO, ...planoExtra } }, { user: "cliente.teste" });
  return ctx;
}
await ta("aluno real NÃO pode receber dados fictícios", async () => {
  const ctx = await ambiente();
  const r = await post(ctx, MENTOR, { action: "demo" }, { user: "andre.gain" });
  eq(r.status, 403); contem(r.body.error, "alunos de teste");
});
await ta("aluno não gera dados fictícios", async () => {
  const ctx = await comTeste();
  eq((await post(ctx, { user: "cliente.teste", name: "Cliente Teste", role: "client", perms: ["personal"] }, { action: "demo" })).status, 403);
});
await ta("Cliente Teste ganha 12 pregões, feedbacks, fila e todos os alertas novos", async () => {
  const ctx = await comTeste();
  const r = await post(ctx, MENTOR, { action: "demo" }, { user: "cliente.teste" });
  eq(r.status, 200); eq(r.body.dias, 12); eq(r.body.planoCompletado, false);
  const j = (await get(ctx, MENTOR, { user: "cliente.teste" })).body;
  eq(j.envios.length, 12);
  ehVerdade(j.envios.every(e => e.data < j.hoje), "nenhum dia no futuro nem hoje");
  ehVerdade(j.envios.every(e => { const w = new Date(e.data + "T12:00:00Z").getUTCDay(); return w >= 1 && w <= 5; }), "só dias úteis");
  const tipos = j.alertas.map(a => a.tipo);
  for (const t of ["fora_de_horario", "perda_acima_stop", "contratos_acima", "overtrading", "mao_apos_perda", "reentrada_impulso",
    "saiu_antes_do_alvo", "excesso_operacoes", "setup_nao_autorizado", "limite_repetido", "dias_negativos", "sequencia_limpa", "aguardando"])
    ehVerdade(tipos.includes(t), "faltou o alerta " + t + " (veio " + tipos.join(",") + ")");
  eq(j.envios.filter(e => e.feedback && !e.feedback.lido).length, 3, "3 feedbacks novos para o aviso");
  ehVerdade(j.envios.some(e => e.feedback && e.feedback.replica), "uma réplica do aluno");
  ehVerdade(j.tags.length > 3, "evolução das tags");
  eq(j.ciclo.diagnostico.prejuizoPassado, 12000, "diagnóstico ganha prejuízo passado fictício");
  eq(j.ciclo.diagnostico.capitalOperacional, 9000, "o que já existia é mantido");
  eq(j.ciclo.inicio, j.envios[0].data, "o ciclo passa a começar no primeiro dia fictício");
  const fila = (await get(ctx, MENTOR, { fn: "alunos" })).body.alunos.find(a => a.user === "cliente.teste");
  eq(fila.pendentes.length, 3);
  const a = (await get(ctx, { user: "cliente.teste", name: "Cliente Teste", role: "client", perms: ["personal"] })).body;
  ehFalso("diagnostico" in a.ciclo, "diagnóstico fictício também não vai para o aluno");
});
await ta("plano sem horário/setups/limite: publica versão que completa e avisa", async () => {
  const ctx = await comTeste({ horaInicio: "", horaFim: "", setups: [], prejuizoDiarioLimite: null });
  const r = await post(ctx, MENTOR, { action: "demo" }, { user: "cliente.teste" });
  eq(r.body.planoCompletado, true);
  const j = (await get(ctx, MENTOR, { user: "cliente.teste" })).body;
  eq(j.ciclo.planos.length, 2); eq(j.plano.horaInicio, "09:00"); ehVerdade(j.plano.setups.length > 0); ehVerdade(j.plano.prejuizoDiarioLimite > 0);
  ehVerdade(j.alertas.some(a => a.tipo === "fora_de_horario"));
});
await ta("gerar de novo substitui (não duplica)", async () => {
  const ctx = await comTeste();
  await post(ctx, MENTOR, { action: "demo" }, { user: "cliente.teste" });
  const r = await post(ctx, MENTOR, { action: "demo" }, { user: "cliente.teste" });
  eq(r.body.substituidos, 12);
  eq((await get(ctx, MENTOR, { user: "cliente.teste" })).body.envios.length, 12);
});

secao("FEEDBACK GERAL POR IA — só rascunho, quem publica é o mentor");
async function comEnvio() {
  const ctx = await ambiente();
  const r = await post(ctx, ALUNO, { action: "envio", data: "2026-09-10", resumo: "Dobrei a mão.", emocional: 2,
    operacoes: [{ id: "o1", hora: "10:00", resultado: -40, contratos: 2, setup: "Rompimento" }, { id: "o2", hora: "10:03", resultado: -60, contratos: 3, setup: "Rompimento" }] });
  ctx.envioId = r.body.envio.id; return ctx;
}
await ta("aluno não pode pedir rascunho de feedback", async () => {
  const ctx = await comEnvio();
  eq((await post(ctx, ALUNO, { action: "feedback-ia", envioId: ctx.envioId })).status, 403);
});
await ta("envio inexistente: 404", async () => {
  eq((await post(await comEnvio(), MENTOR, { action: "feedback-ia", envioId: "nao-existe" }, { user: "andre.gain" })).status, 404);
});
await ta("sem IA configurada: 502 claro", async () => {
  const ctx = await comEnvio();
  const antes = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  const r = await post(ctx, MENTOR, { action: "feedback-ia", envioId: ctx.envioId }, { user: "andre.gain" });
  if (antes) process.env.GEMINI_API_KEY = antes;
  eq(r.status, 502); contem(r.body.error, "Não consegui gerar o feedback");
});
await ta("devolve o texto, leva as tags marcadas ao prompt e NÃO grava nem publica nada", async () => {
  const ctx = await comEnvio();
  const antesKey = process.env.GEMINI_API_KEY, antesFetch = globalThis.fetch;
  let enviado = null;
  process.env.GEMINI_API_KEY = "fake";
  globalThis.fetch = async (url, opts) => { enviado = JSON.parse(opts.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "André, você manteve o horário e registrou o dia com honestidade. Hoje o ponto foi a mão maior logo depois do stop das 10:00." }] } }] }), { status: 200 }); };
  let r;
  try {
    r = await post(ctx, MENTOR, { action: "feedback-ia", envioId: ctx.envioId, porOperacao: { o2: { tags: ["Dobrou a mão"], comentario: "Mão maior para recuperar." } } }, { user: "andre.gain" });
  } finally { globalThis.fetch = antesFetch; if (antesKey) process.env.GEMINI_API_KEY = antesKey; else delete process.env.GEMINI_API_KEY; }
  eq(r.status, 200); contem(r.body.texto, "mão maior logo depois do stop");
  const prompt = JSON.stringify(enviado);
  contem(prompt, "Dobrou a mão"); contem(prompt, "Dobrei a mão.");
  ehFalso(prompt.includes("SEGREDO DO MENTOR") || prompt.includes("ANOTACAO PRIVADA"), "dado privado foi para a IA");
  const e = (await get(ctx, MENTOR, { user: "andre.gain" })).body.envios.find(x => x.id === ctx.envioId);
  eq(e.feedback, null, "o rascunho não pode virar feedback sozinho"); eq(e.status, "aguardando");
});

console.log("");
process.exit(resumo() ? 1 : 0);
})();
