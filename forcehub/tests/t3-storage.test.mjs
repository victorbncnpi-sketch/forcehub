import { secao, t, ta, eq, ehVerdade, ehFalso, contem, resumo, fakeRedis } from "./runner.mjs";
import { sanitizePlano, sanitizeOperacoes, sanitizeFeedback, sanitizeDiagnostico, sanitizeTag,
         salvarCiclo, lerCiclo, salvarEnvios, lerEnvios, reanalisar, visaoAluno,
         lerTags, salvarTags, aprenderTags, lerIndice, indiceAdd, indiceDel, kImg } from "../api/_pt";

const BASE = { vigenciaInicio: "2026-09-01", ativo: "WIN", valorPonto: 0.2, pontosAlvo: 150, pontosStop: 100,
  contratos: 2, ganhoDiarioAlvo: 120, prejuizoDiarioLimite: 80, metaMensal: 2000, diasPrevistosOperando: 20,
  horaInicio: "09:15", horaFim: "17:00", setups: ["Rompimento", "Pullback"], operacoesDia: 4, winRateAlvo: 50 };

secao("sanitizePlano — entrada hostil");
t("aceita acerto como 55 ou 0,55", () => {
  eq(sanitizePlano({ ...BASE, winRateAlvo: 55 }, 1).winRateAlvo, 0.55);
  eq(sanitizePlano({ ...BASE, winRateAlvo: 0.55 }, 1).winRateAlvo, 0.55);
});
t("acerto absurdo cai no padrão 0,5", () => {
  eq(sanitizePlano({ ...BASE, winRateAlvo: 999 }, 1).winRateAlvo, 0.5);
  eq(sanitizePlano({ ...BASE, winRateAlvo: -3 }, 1).winRateAlvo, 0.5);
  eq(sanitizePlano({ ...BASE, winRateAlvo: "abc" }, 1).winRateAlvo, 0.5);
});
t("normaliza a hora (9:5 -> 09:5? não: exige mm)", () => {
  eq(sanitizePlano({ ...BASE, horaInicio: "9:15" }, 1).horaInicio, "09:15");
  eq(sanitizePlano({ ...BASE, horaInicio: "lixo" }, 1).horaInicio, "");
});
t("ativo vira maiúsculo e é truncado", () => {
  eq(sanitizePlano({ ...BASE, ativo: "win" }, 1).ativo, "WIN");
  ehVerdade(sanitizePlano({ ...BASE, ativo: "x".repeat(500) }, 1).ativo.length <= 16);
});
t("setups: deduplica, remove vazios e limita a 20", () => {
  const p = sanitizePlano({ ...BASE, setups: ["A", "A", "", null, ...Array.from({length:40},(_,i)=>"s"+i)] }, 1);
  eq(p.setups.length, 20);
  eq(p.setups.filter(s => s === "A").length, 1);
});
t("remove caracteres de controle do motivo", () => {
  const p = sanitizePlano({ ...BASE, motivo: "linha1\u0000\u001blinha2" }, 2);
  ehFalso(/[\u0000-\u001f]/.test(p.motivo), "sobrou caractere de controle: " + JSON.stringify(p.motivo));
});
t("motivo vazio ganha texto padrão conforme a versão", () => {
  contem(sanitizePlano({ ...BASE }, 1).motivo, "Sessão Zero");
  contem(sanitizePlano({ ...BASE }, 2).motivo, "Ajuste");
});
t("data de vigência inválida cai em hoje", () => {
  ehVerdade(/^\d{4}-\d{2}-\d{2}$/.test(sanitizePlano({ ...BASE, vigenciaInicio: "31/12/2026" }, 1).vigenciaInicio));
});
t("edição PARCIAL herda o que não foi mandado", () => {
  const v1 = sanitizePlano(BASE, 1);
  const v2 = sanitizePlano({ motivo: "só o stop", pontosStop: 70 }, 2, v1);
  eq(v2.pontosAlvo, 150); eq(v2.contratos, 2); eq(v2.metaMensal, 2000);
  eq(v2.setups, ["Rompimento", "Pullback"]); eq(v2.pontosStop, 70);
});
t("campo mandado como lixo NÃO herda o antigo (vira nulo)", () => {
  const v1 = sanitizePlano(BASE, 1);
  eq(sanitizePlano({ motivo: "x", pontosAlvo: "abc" }, 2, v1).pontosAlvo, null);
});

secao("sanitizeOperacoes");
t("descarta linha sem resultado e sem pontos", () => {
  eq(sanitizeOperacoes([{ hora: "10:00" }, { hora: "11:00", resultado: 10 }], 2).length, 1);
});
t("aceita resultado ZERO (não é ausência)", () => eq(sanitizeOperacoes([{ hora: "10:00", resultado: 0 }], 2).length, 1));
t("direção fora da allowlist vira null", () => {
  eq(sanitizeOperacoes([{ resultado: 1, direcao: "SHORT" }], 2)[0].direcao, null);
  eq(sanitizeOperacoes([{ resultado: 1, direcao: "VENDA" }], 2)[0].direcao, "VENDA");
});
t("contratos ausentes caem no plano", () => eq(sanitizeOperacoes([{ resultado: 1 }], 7)[0].contratos, 7));
t("teto de 300 operações", () => eq(sanitizeOperacoes(Array.from({length:500},()=>({resultado:1})), 2).length, 300));
t("entrada não-array vira []", () => { eq(sanitizeOperacoes(null, 2), []); eq(sanitizeOperacoes("x", 2), []); });
t("itens não-objeto são pulados", () => eq(sanitizeOperacoes([null, "x", 5, { resultado: 1 }], 2).length, 1));
t("setup é truncado", () => ehVerdade(sanitizeOperacoes([{ resultado: 1, setup: "x".repeat(500) }], 2)[0].setup.length <= 60));

secao("sanitizeFeedback — superfície de escrita do mentor");
t("réplica do aluno NÃO pode ser escrita pelo mentor", () => {
  const f = sanitizeFeedback({ geral: "oi", replica: "forjada" }, { replica: "a original" });
  eq(f.replica, "a original");
});
t("lido NÃO pode ser forçado pelo payload", () => {
  eq(sanitizeFeedback({ geral: "oi", lido: true }, { lido: false }).lido, false);
});
t("publicadoEm preserva o original", () => {
  eq(sanitizeFeedback({ geral: "oi" }, { publicadoEm: 111 }).publicadoEm, 111);
});
t("autor só aceita mentor|ia", () => {
  eq(sanitizeFeedback({ geral: "x", autor: "root" }, null).autor, "mentor");
  eq(sanitizeFeedback({ geral: "x", autor: "ia" }, null).autor, "ia");
});
t("entrada de operação totalmente vazia é descartada", () => {
  eq(Object.keys(sanitizeFeedback({ porOperacao: { op1: { tags: [], comentario: "", recomendacao: "" } } }, null).porOperacao).length, 0);
});
t("máximo de 8 tags por operação", () => {
  const f = sanitizeFeedback({ porOperacao: { op1: { tags: Array.from({length:30},(_,i)=>"t"+i), comentario: "c" } } }, null);
  eq(f.porOperacao.op1.tags.length, 8);
});
t("tags duplicadas são deduplicadas", () => {
  const f = sanitizeFeedback({ porOperacao: { op1: { tags: ["A","A","A"], comentario: "c" } } }, null);
  eq(f.porOperacao.op1.tags, ["A"]);
});
t("porOperacao não-objeto não explode", () => { sanitizeFeedback({ porOperacao: "x" }, null); sanitizeFeedback(null, null); });

secao("sanitizeDiagnostico / sanitizeTag");
t("diagnóstico só deixa passar os campos previstos", () => {
  const d = sanitizeDiagnostico({ capitalOperacional: 100, campoInjetado: "xxx", observacoes: "ok" });
  ehFalso("campoInjetado" in d, "campo estranho passou: " + Object.keys(d));
});
t("capital negativo vira null", () => eq(sanitizeDiagnostico({ capitalOperacional: -5 }).capitalOperacional, null));
t("tag sem nome é rejeitada", () => { eq(sanitizeTag({}), null); eq(sanitizeTag({ nome: "   " }), null); });
t("categoria/polaridade fora da allowlist caem no padrão", () => {
  const t1 = sanitizeTag({ nome: "X", categoria: "hack", polaridade: "hack" });
  eq(t1.categoria, "decisao"); eq(t1.polaridade, "erro");
});

secao("chaves do Redis — sanitização de path");
// O keyspace do Redis é PLANO — ".." não navega para lugar nenhum. O que
// precisa valer é: (a) o id não pode injetar o separador ":" e escapar do
// namespace do dono, e (b) dois usuários reais nunca colidem.
t("id não consegue injetar o separador ':' nem escapar do namespace", () => {
  eq(kImg("aluno1", "x:forcehub:pt:img:victor:e1-print").split(":").length, 5);
  ehFalso(kImg("aluno1", "a/b*c").includes("/"));
});
t("usuários reais (USER_RE) nunca colidem entre si", () => {
  const reais = ["victor", "andre.gain", "maria.emilia", "cliente1", "a_b-c.d"];
  eq(new Set(reais.map(u => kImg(u, "e1-print"))).size, reais.length);
});
t("kImg é determinístico e prefixado", () => contem(kImg("aluno1", "e1-print"), "forcehub:pt:img:aluno1:"));

secao("reanalisar — preserva o humano, recalcula a máquina");
const P1 = sanitizePlano(BASE, 1);
const P2 = sanitizePlano({ motivo: "aperta o stop", vigenciaInicio: "2026-09-12", pontosStop: 70 }, 2, P1);
const ciclo = { planos: [P1, P2] };
const envios = [
  { id: "a", data: "2026-09-10", resumo: "meu texto", status: "analisado",
    operacoes: sanitizeOperacoes([{ hora: "10:00", resultado: -40, contratos: 2, setup: "Rompimento" }], 2),
    feedback: { geral: "feedback do mentor", porOperacao: { op1: { tags: ["T"], comentario: "c" } }, lido: true, replica: "minha pergunta" } },
  { id: "b", data: "2026-09-15", resumo: "outro", status: "aguardando",
    operacoes: sanitizeOperacoes([{ hora: "10:00", resultado: -40, contratos: 2, setup: "Rompimento" }], 2), feedback: null },
];
const re = reanalisar(ciclo, envios);
t("resumo, feedback, réplica e status sobrevivem", () => {
  eq(re[0].resumo, "meu texto"); eq(re[0].feedback.geral, "feedback do mentor");
  eq(re[0].feedback.replica, "minha pergunta"); eq(re[0].feedback.lido, true); eq(re[0].status, "analisado");
});
t("planoVersao é atribuído pela DATA do envio", () => { eq(re[0].planoVersao, 1); eq(re[1].planoVersao, 2); });
t("a MESMA perda vira violação só sob o plano mais apertado", () => {
  eq(re[0].violacoes.length, 0, "dia 10 sob v1 (stop 100) está ok");
  ehVerdade(re[1].violacoes.some(v => v.tipo === "sem_stop"), "dia 15 sob v2 (stop 70) estoura");
});
t("quadro é recalculado por dia com o acumulado até ali", () => {
  ehVerdade(Array.isArray(re[0].quadro) && re[0].quadro.length === 6);
  eq(re[0].quadro.find(l => l.chave === "meta_mensal").hoje, -40);
  eq(re[1].quadro.find(l => l.chave === "meta_mensal").hoje, -80);
});
t("reanalisar é idempotente", () => {
  const a = JSON.stringify(reanalisar(ciclo, envios));
  const b = JSON.stringify(reanalisar(ciclo, reanalisar(ciclo, envios)));
  eq(a === b, true);
});
t("ciclo sem planos não explode", () => { reanalisar({}, envios); reanalisar(null, null); });

await (async () => {
  secao("persistência");
  const redis = fakeRedis();
  await ta("salvarEnvios ordena por data e aplica o teto", async () => {
    const muitos = Array.from({ length: 500 }, (_, i) => ({ id: "e" + i, data: "2026-01-01", operacoes: [] }));
    const salvos = await salvarEnvios(redis, "u1", muitos);
    eq(salvos.length, 400);
  });
  await ta("índice adiciona sem duplicar e remove", async () => {
    await indiceAdd(redis, "u1"); await indiceAdd(redis, "u1"); await indiceAdd(redis, "u2");
    eq((await lerIndice(redis)).sort(), ["u1", "u2"]);
    await indiceDel(redis, "u1");
    eq(await lerIndice(redis), ["u2"]);
  });
  await ta("índice normaliza o usuário", async () => {
    await indiceAdd(redis, "  Maria.Emilia  ");
    ehVerdade((await lerIndice(redis)).includes("maria.emilia"));
  });
  await ta("lerTags semeia a biblioteca na primeira leitura", async () => {
    const r2 = fakeRedis();
    const tags = await lerTags(r2);
    ehVerdade(tags.length >= 20, "veio " + tags.length);
    ehVerdade(tags.every(t => t.nome && t.categoria && t.polaridade));
    eq((await lerTags(r2)).length, tags.length, "segunda leitura não re-semeia");
  });
  await ta("aprenderTags conta uso e guarda snippet", async () => {
    const r3 = fakeRedis(); await lerTags(r3);
    await aprenderTags(r3, { porOperacao: { op1: { tags: ["Revenge trade"], comentario: "Entrou logo após o stop." } } });
    await aprenderTags(r3, { porOperacao: { op1: { tags: ["Revenge trade"], comentario: "Entrou logo após o stop." } } });
    const t1 = (await lerTags(r3)).find(x => x.nome === "Revenge trade");
    eq(t1.usos, 2); eq(t1.snippets.length, 1); eq(t1.snippets[0].usos, 2);
  });
  await ta("aprenderTags cria tag nova que o mentor digitou", async () => {
    const r4 = fakeRedis(); await lerTags(r4);
    await aprenderTags(r4, { porOperacao: { op1: { tags: ["Tag Inédita"], comentario: "c" } } });
    ehVerdade((await lerTags(r4)).some(x => x.nome === "Tag Inédita"));
  });
  await ta("aprenderTags nunca lança (não pode derrubar a publicação)", async () => {
    const quebrado = { get: async () => { throw new Error("redis caiu"); }, set: async () => { throw new Error("x"); } };
    await aprenderTags(quebrado, { porOperacao: { op1: { tags: ["A"] } } });
  });
  await ta("visaoAluno sem ciclo devolve estrutura vazia coerente", async () => {
    const r5 = fakeRedis();
    const v = await visaoAluno(r5, "ninguem");
    eq(v.ciclo, null); eq(v.envios, []); eq(v.plano, null);
  });
  await ta("ciclo/envios gravam e leem de volta iguais", async () => {
    const r6 = fakeRedis();
    await salvarCiclo(r6, "u9", { nome: "N", status: "ativo", planos: [P1] });
    await salvarEnvios(r6, "u9", envios);
    const v = await visaoAluno(r6, "u9");
    eq(v.ciclo.nome, "N"); eq(v.envios.length, 2); eq(v.plano.versao, 1);
  });
  console.log("");
  process.exit(resumo() ? 1 : 0);
})();
