// api/personal.js — PERSONAL TRADER (acompanhamento individual de 30 dias).
// Esta é a 12ª e última função serverless do plano Hobby da Vercel, então o
// módulo inteiro entra por aqui, com sub-rotas em ?fn= (mesma ideia de
// api/market.js e api/users.js). A lógica fica nos helpers "_" (não roteados):
//   _pt-regras.js  motor de regras, projeção e Quadro (funções puras)
//   _pt.js         Redis, saneamento e reanálise
//
//   GET  /api/personal                    -> minha jornada (aluno)
//   GET  /api/personal?user=<u>           -> jornada de um aluno (mentor)
//   GET  /api/personal?fn=alunos          -> fila do dia + lista de alunos (mentor)
//   GET  /api/personal?fn=tags            -> biblioteca de tags
//   GET  /api/personal?fn=img&id=<id>     -> print de um envio
//   POST /api/personal { action, ... }    -> ver AÇÕES abaixo
//
// PRIVACIDADE: o diagnóstico da Sessão Zero (capacidade financeira) e as
// anotações do mentor NUNCA vão para o aluno. São removidos na saída sempre que
// quem lê não é da equipe — ver `paraAluno()`. É a única informação do hub com
// essa restrição, e ela é aplicada aqui, no servidor, não na tela.
import { getRedis } from "./_redis";
import { getSession, sessionCan, isStaff, getUsers } from "./_auth";
import {
  lerCiclo, salvarCiclo, lerEnvios, salvarEnvios, lerIndice, indiceAdd, indiceDel,
  lerTags, sanitizeTag, aprenderTags, sanitizePlano, sanitizeDiagnostico, sanitizeFeedback,
  sanitizeOperacoes, reanalisar, visaoAluno, garantirPermissao, kImg, kCiclo, kEnvios, salvarTags, MAX_IMG, MAX_PLANOS,
  hojeISO, uid, txt, isISO, STATUS_CICLO,
} from "./_pt";
import {
  projecao, comparaProjecao, quadroGerenciamento, planoVigenteEm,
  consolidaCiclo, alertasDoAluno, mapaDeTags, camposCalculados, avisosDoPlano, projecaoRecalibrada,
} from "./_pt-regras";

const erro = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

// Remove do payload tudo que é do mentor. Chamado em TODA resposta lida por um
// cliente — inclusive na dele mesmo.
function paraAluno(ciclo) {
  if (!ciclo) return null;
  const { diagnostico, notas, ...resto } = ciclo;
  return resto;
}

// Pacote completo de uma jornada: é o que as três telas do aluno e a ficha do
// mentor consomem. Tudo derivado é calculado aqui, nunca no navegador, para que
// os dois lados vejam exatamente os mesmos números.
async function montarJornada(redis, user, staff) {
  const { ciclo, envios, plano, real } = await visaoAluno(redis, user);
  if (!ciclo) return { ciclo: null };
  const hoje = hojeISO();
  const ultimo = envios[envios.length - 1] || null;
  const proj = projecao(plano);
  const ddEsperado = proj ? (proj.cenarios.find(c => c.chave === "base") || {}).drawdownEsperado : null;
  const alertas = alertasDoAluno({ ...ciclo, drawdownReal: real.drawdownReal, drawdownEsperado: ddEsperado }, envios, hoje);
  return {
    ciclo: staff ? ciclo : paraAluno(ciclo),
    envios, plano,
    calculados: camposCalculados(plano),
    real,
    projecao: proj,
    comparacao: comparaProjecao(plano, real, real.diasOperados),
    proximoCiclo: projecaoRecalibrada(plano, real),
    // Quadro "de hoje": se já houve envio hoje mostra o dia de hoje; senão o
    // último dia operado, deixando claro na tela a qual data ele se refere.
    quadro: ultimo ? ultimo.quadro : quadroGerenciamento(plano, {}, { acumulado: 0, diasOperados: 0 }),
    quadroData: ultimo ? ultimo.data : null,
    enviouHoje: envios.some(e => e.data === hoje),
    alertas: staff ? alertas : alertas.filter(a => a.tipo !== "aguardando"),
    tags: mapaDeTags(envios),
    hoje,
  };
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return erro(res, 503, "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN).");

  const sess = await getSession(req);
  if (!sess) return erro(res, 401, "Não autenticado.");
  const staff = isStaff(sess.role);
  if (!staff && !sessionCan(sess, "personal")) return erro(res, 403, "Sem acesso ao Personal Trader.");

  const fn = txt(req.query && req.query.fn, 24);
  // Aluno alvo: o mentor escolhe; o cliente é sempre ele mesmo (não há como
  // pedir outro — o parâmetro é simplesmente ignorado para quem não é equipe).
  const alvo = staff ? (uid(req.query.user) || sess.user) : sess.user;

  try {
    if (req.method === "GET") {
      if (fn === "tags") return res.status(200).json({ ok: true, tags: await lerTags(redis) });

      if (fn === "img") {
        const id = txt(req.query.id, 64);
        if (!id) return erro(res, 400, "Print não informado.");
        const image = await redis.get(kImg(alvo, id));
        return res.status(200).json({ ok: true, image: image || null });
      }

      // Fila do dia + lista de alunos (COMANDO 3, telas 1 e 3). Só equipe.
      if (fn === "alunos") {
        if (!staff) return erro(res, 403, "Apenas a equipe acessa o painel do mentor.");
        const [indice, users] = await Promise.all([lerIndice(redis), getUsers()]);
        const linhas = await Promise.all(indice.map(async (u) => {
          const ciclo = await lerCiclo(redis, u);
          if (!ciclo) return null;
          const envios = reanalisar(ciclo, await lerEnvios(redis, u));
          const plano = planoVigenteEm(ciclo.planos, hojeISO());
          const real = consolidaCiclo(envios, plano);
          const proj = projecao(plano);
          const base = proj ? proj.cenarios.find(c => c.chave === "base") : null;
          const ultimo = envios[envios.length - 1] || null;
          const pendentes = envios.filter(e => e.status !== "analisado");
          return {
            user: u,
            nome: ciclo.nome || (users[u] && users[u].name) || u,
            status: ciclo.status || "ativo",
            inicio: ciclo.inicio || null,
            diasPrevistos: ciclo.diasPrevistos || 30,
            diaAtual: real.diasOperados,
            plano, calculados: camposCalculados(plano),
            quadro: ultimo ? ultimo.quadro : quadroGerenciamento(plano, {}, { acumulado: 0, diasOperados: 0 }),
            quadroData: ultimo ? ultimo.data : null,
            real, comparacao: comparaProjecao(plano, real, real.diasOperados),
            alertas: alertasDoAluno({ ...ciclo, drawdownReal: real.drawdownReal, drawdownEsperado: base && base.drawdownEsperado }, envios, hojeISO()),
            ultimoEnvio: ultimo ? ultimo.data : null,
            // Fila: só o cabeçalho de cada envio pendente (a análise carrega o resto).
            pendentes: pendentes.map(e => ({
              id: e.id, data: e.data, enviadoEm: e.enviadoEm || null,
              resultado: e.dia ? e.dia.resultado : null, ops: e.dia ? e.dia.ops : 0,
              violacoes: (e.violacoes || []).length, emocional: e.emocional || null,
            })),
          };
        }));
        const alunos = linhas.filter(Boolean).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
        // Candidatos a matrícula: clientes que ainda não têm ciclo.
        const disponiveis = Object.values(users)
          .filter(u => u && u.role === "client" && !indice.includes(u.user))
          .map(u => ({ user: u.user, name: u.name || u.user }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        return res.status(200).json({ ok: true, alunos, disponiveis });
      }

      return res.status(200).json({ ok: true, ...(await montarJornada(redis, alvo, staff)) });
    }

    if (req.method !== "POST") return erro(res, 405, "Método não permitido");

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body && typeof body === "object" ? body : {};
    const action = txt(body.action, 24);
    const soStaff = () => staff ? null : erro(res, 403, "Apenas o mentor pode fazer isso.");

    // ── Sessão Zero: cria (ou atualiza) o ciclo, o diagnóstico e o Plano v1 ──
    if (action === "ciclo") {
      const r = soStaff(); if (r) return r;
      const users = await getUsers();
      if (!users[alvo]) return erro(res, 404, "Usuário não encontrado.");
      const atual = await lerCiclo(redis, alvo);
      const planos = atual ? [...atual.planos] : [];
      // Enquanto só existe a v1, a Sessão Zero continua editável; a partir da v2
      // o plano inicial vira histórico e só muda por nova versão.
      const planoBody = body.plano && typeof body.plano === "object" ? body.plano : null;
      if (planoBody) {
        if (planos.length <= 1) planos[0] = sanitizePlano(planoBody, 1, planos[0]);
        else return erro(res, 409, "O plano já tem novas versões — use 'Ajustar gerenciamento'.");
      } else if (!planos.length) {
        return erro(res, 400, "O plano inicial é obrigatório na Sessão Zero.");
      }
      const ciclo = await salvarCiclo(redis, alvo, {
        ...(atual || {}),
        user: alvo,
        nome: txt(body.nome, 80) || (atual && atual.nome) || users[alvo].name || alvo,
        contato: "contato" in body ? txt(body.contato, 80) : ((atual && atual.contato) || ""),
        status: STATUS_CICLO.has(body.status) ? body.status : ((atual && atual.status) || "ativo"),
        inicio: isISO(body.inicio) ? body.inicio : ((atual && atual.inicio) || hojeISO()),
        fim: isISO(body.fim) ? body.fim : ((atual && atual.fim) || null),
        diasPrevistos: Math.max(1, Math.min(120, Number(body.diasPrevistos) || (atual && atual.diasPrevistos) || 30)),
        diagnostico: sanitizeDiagnostico("diagnostico" in body ? body.diagnostico : (atual && atual.diagnostico)),
        notas: "notas" in body ? txt(body.notas, 4000) : ((atual && atual.notas) || ""),
        planos,
        criadoEm: (atual && atual.criadoEm) || Date.now(),
      });
      await indiceAdd(redis, alvo);
      await garantirPermissao(alvo);
      // Mudar a v1 muda o julgamento de dias já enviados — regrava reanalisado.
      const envios = await lerEnvios(redis, alvo);
      if (envios.length) await salvarEnvios(redis, alvo, reanalisar(ciclo, envios));
      return res.status(200).json({ ok: true, avisos: avisosDoPlano(planoVigenteEm(planos, hojeISO()), ciclo.diagnostico) });
    }

    // ── Ajustar gerenciamento: publica uma NOVA versão do plano ─────────────
    if (action === "plano") {
      const r = soStaff(); if (r) return r;
      const ciclo = await lerCiclo(redis, alvo);
      if (!ciclo) return erro(res, 404, "Este aluno ainda não tem ciclo.");
      if (ciclo.planos.length >= MAX_PLANOS) return erro(res, 413, "Limite de versões do plano atingido.");
      const motivo = txt(body.plano && body.plano.motivo, 400);
      if (!motivo) return erro(res, 400, "Descreva o motivo da mudança — toda versão do plano fica registrada com ele.");
      const anterior = ciclo.planos[ciclo.planos.length - 1];
      const novo = sanitizePlano(body.plano, ciclo.planos.length + 1, anterior);
      const salvo = await salvarCiclo(redis, alvo, { ...ciclo, planos: [...ciclo.planos, novo] });
      const envios = await lerEnvios(redis, alvo);
      if (envios.length) await salvarEnvios(redis, alvo, reanalisar(salvo, envios));
      return res.status(200).json({ ok: true, versao: novo.versao, avisos: avisosDoPlano(novo, ciclo.diagnostico) });
    }

    if (action === "encerrar" || action === "status") {
      const r = soStaff(); if (r) return r;
      const ciclo = await lerCiclo(redis, alvo);
      if (!ciclo) return erro(res, 404, "Este aluno ainda não tem ciclo.");
      const novo = STATUS_CICLO.has(body.status) ? body.status : "concluido";
      await salvarCiclo(redis, alvo, { ...ciclo, status: novo, fim: novo === "concluido" ? (isISO(body.fim) ? body.fim : hojeISO()) : null });
      return res.status(200).json({ ok: true, status: novo });
    }

    if (action === "notas") {
      const r = soStaff(); if (r) return r;
      const ciclo = await lerCiclo(redis, alvo);
      if (!ciclo) return erro(res, 404, "Este aluno ainda não tem ciclo.");
      await salvarCiclo(redis, alvo, { ...ciclo, notas: txt(body.notas, 4000) });
      return res.status(200).json({ ok: true });
    }

    if (action === "remover-ciclo") {
      const r = soStaff(); if (r) return r;
      const envios = await lerEnvios(redis, alvo);
      await Promise.all(envios.flatMap(e => ["relatorio", "print"].map(s => redis.del(kImg(alvo, e.id + "-" + s)))));
      await Promise.all([redis.del(kCiclo(alvo)), redis.del(kEnvios(alvo))]);
      await indiceDel(redis, alvo);
      return res.status(200).json({ ok: true });
    }

    // ── Envio do dia (aluno; o mentor também pode lançar por ele) ───────────
    if (action === "envio") {
      const ciclo = await lerCiclo(redis, alvo);
      if (!ciclo) return erro(res, 404, "Você ainda não tem um ciclo do Personal Trader. Fale com o mentor.");
      if (ciclo.status === "concluido") return erro(res, 409, "Este ciclo já foi encerrado.");
      const data = isISO(body.data) ? body.data : hojeISO();
      if (data > hojeISO()) return erro(res, 400, "Não dá para enviar um dia que ainda não aconteceu.");
      const plano = planoVigenteEm(ciclo.planos, data);
      if (!plano) return erro(res, 409, "O plano de risco ainda não foi definido na Sessão Zero.");

      const envios = await lerEnvios(redis, alvo);
      const existente = envios.find(e => e.data === data);
      // Reenviar o mesmo dia substitui as operações, mas preserva o feedback já
      // publicado (e o marca como desatualizado para o mentor rever).
      if (existente && existente.status === "analisado" && !staff) {
        return erro(res, 409, "Este dia já foi analisado. Fale com o mentor para reabrir.");
      }
      const id = existente ? existente.id : String(Date.now());
      const envio = {
        id, data,
        resumo: txt(body.resumo, 2000),
        emocional: Math.max(1, Math.min(5, Number(body.emocional) || 3)),
        origem: ["csv", "diario", "manual"].includes(body.origem) ? body.origem : "manual",
        operacoes: sanitizeOperacoes(body.operacoes, plano.contratos),
        temRelatorio: !!body.temRelatorio || !!(existente && existente.temRelatorio),
        temPrint: !!body.temPrint || !!(existente && existente.temPrint),
        status: "aguardando",
        enviadoEm: Date.now(),
        feedback: (existente && existente.feedback) || null,
      };
      if (!envio.operacoes.length && !envio.resumo) {
        return erro(res, 400, "Envie ao menos as operações do dia ou um resumo escrito.");
      }
      const lista = [...envios.filter(e => e.data !== data), envio];
      const salvos = await salvarEnvios(redis, alvo, reanalisar(ciclo, lista));
      const meu = salvos.find(e => e.data === data);
      return res.status(200).json({ ok: true, envio: meu, substituiu: !!existente });
    }

    // ── Feedback do mentor (operação -> tag -> comentário -> recomendação) ──
    if (action === "feedback") {
      const r = soStaff(); if (r) return r;
      const ciclo = await lerCiclo(redis, alvo);
      if (!ciclo) return erro(res, 404, "Este aluno ainda não tem ciclo.");
      const envios = await lerEnvios(redis, alvo);
      const i = envios.findIndex(e => e.id === txt(body.envioId, 24) || e.data === txt(body.data, 10));
      if (i < 0) return erro(res, 404, "Envio não encontrado.");
      const feedback = sanitizeFeedback(body.feedback, envios[i].feedback);
      if (!feedback.geral && !Object.keys(feedback.porOperacao).length) {
        return erro(res, 400, "Escreva o feedback do dia ou comente ao menos uma operação.");
      }
      // Publicar reabre a leitura: o aluno precisa confirmar de novo.
      envios[i] = { ...envios[i], feedback: { ...feedback, lido: false }, status: "analisado" };
      await salvarEnvios(redis, alvo, reanalisar(ciclo, envios));
      await aprenderTags(redis, feedback);
      return res.status(200).json({ ok: true });
    }

    // ── Aluno confirma a leitura e (opcionalmente) devolve 1 pergunta ───────
    if (action === "lido") {
      const ciclo = await lerCiclo(redis, alvo);
      if (!ciclo) return erro(res, 404, "Ciclo não encontrado.");
      const envios = await lerEnvios(redis, alvo);
      const i = envios.findIndex(e => e.id === txt(body.envioId, 24));
      if (i < 0 || !envios[i].feedback) return erro(res, 404, "Feedback não encontrado.");
      const replica = txt(body.replica, 800);
      envios[i] = {
        ...envios[i],
        feedback: {
          ...envios[i].feedback, lido: true,
          ...(replica ? { replica, replicaEm: Date.now() } : {}),
        },
      };
      await salvarEnvios(redis, alvo, reanalisar(ciclo, envios));
      return res.status(200).json({ ok: true });
    }

    if (action === "remover-envio") {
      const ciclo = await lerCiclo(redis, alvo);
      if (!ciclo) return erro(res, 404, "Ciclo não encontrado.");
      const envios = await lerEnvios(redis, alvo);
      const alvoEnvio = envios.find(e => e.id === txt(body.envioId, 24));
      if (!alvoEnvio) return erro(res, 404, "Envio não encontrado.");
      if (!staff && alvoEnvio.status === "analisado") return erro(res, 409, "Um dia já analisado só o mentor pode remover.");
      await Promise.all(["relatorio", "print"].map(s => redis.del(kImg(alvo, alvoEnvio.id + "-" + s))));
      await salvarEnvios(redis, alvo, reanalisar(ciclo, envios.filter(e => e.id !== alvoEnvio.id)));
      return res.status(200).json({ ok: true });
    }

    // ── Prints (chave própria por causa do tamanho) ─────────────────────────
    if (action === "img") {
      const id = txt(body.id, 64);
      if (!id) return erro(res, 400, "Print não informado.");
      const data = body.data;
      if (data == null || data === "") { await redis.del(kImg(alvo, id)); return res.status(200).json({ ok: true }); }
      if (typeof data !== "string" || data.length > MAX_IMG) return erro(res, 413, "Imagem muito grande (máx. ~900KB depois da compressão).");
      await redis.set(kImg(alvo, id), data);
      return res.status(200).json({ ok: true });
    }

    // ── Biblioteca de tags (só a equipe edita) ──────────────────────────────
    if (action === "tag") {
      const r = soStaff(); if (r) return r;
      const tags = await lerTags(redis);
      const nova = sanitizeTag(body.tag);
      if (!nova) return erro(res, 400, "Informe o nome da tag.");
      const i = tags.findIndex(t => t.nome === nova.nome);
      if (body.remover) {
        if (i < 0) return erro(res, 404, "Tag não encontrada.");
        tags.splice(i, 1);
      } else if (i >= 0) {
        tags[i] = { ...tags[i], categoria: nova.categoria, polaridade: nova.polaridade };
      } else {
        tags.push(nova);
      }
      await salvarTags(redis, tags);
      return res.status(200).json({ ok: true, tags });
    }

    return erro(res, 400, "Ação inválida.");
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
