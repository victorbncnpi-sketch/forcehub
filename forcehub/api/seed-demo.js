// api/seed-demo.js — Conta(s) de teste para validar Diário, Dashboard e Turma.
//   POST /api/seed-demo { action:"seed"  }  (ou GET)  -> cria/atualiza a turma demo
//   POST /api/seed-demo { action:"delete" }           -> apaga todos os dados de teste
//
// Gera uma TURMA fictícia de alunos com perfis variados (campeão, em drawdown,
// indisciplinado, inativo, em maré de loss, etc.) para popular o Painel da Turma
// e o Painel de Atenção. Cada usuário semeado é marcado com `demoSeed: true`,
// então a limpeza remove exatamente esses (nunca toca em alunos reais).
//
// APENAS super admin. A senha de todos é "demo2026".
import { getRedis } from "./_redis";
import { getSession, getUsers, saveUsers, hashPassword, isStaff, DEFAULT_CLIENT_PERMS, SUPERADMIN } from "./_auth";

const DEMO_PASS = "demo2026";

// Perfis da turma. tailLosses força os últimos N trades a serem loss (cria
// sequência de loss / drawdown no fim); endGap = dias úteis desde o último
// registro (endGap alto => alerta de inatividade).
const PROFILES = [
  { user: "demo",              name: "Conta Demo (geral)",     valorR: 250, seed: 424242, n: 72, winRate: 0.58, gainLo: 0.5, gainHi: 2.8, lossLo: 0.4, lossHi: 1.6, bigWinP: 0.10, bigLossP: 0.08, endGap: 1,  tailLosses: 0, diarioN: 16, diarioRevenge: false, positions: 8 },
  { user: "demo.campeao",      name: "Carlos Campeão",         valorR: 300, seed: 1011,   n: 62, winRate: 0.68, gainLo: 0.8, gainHi: 3.2, lossLo: 0.4, lossHi: 1.1, bigWinP: 0.14, bigLossP: 0.04, endGap: 1,  tailLosses: 0, diarioN: 10, diarioRevenge: false, positions: 4 },
  { user: "demo.consistente",  name: "Bia Consistente",        valorR: 250, seed: 2022,   n: 54, winRate: 0.61, gainLo: 0.6, gainHi: 2.0, lossLo: 0.4, lossHi: 1.0, bigWinP: 0.06, bigLossP: 0.05, endGap: 2,  tailLosses: 0, diarioN: 8,  diarioRevenge: false, positions: 3 },
  { user: "demo.drawdown",     name: "Diego Drawdown",         valorR: 250, seed: 3033,   n: 56, winRate: 0.57, gainLo: 0.6, gainHi: 2.4, lossLo: 0.8, lossHi: 1.8, bigWinP: 0.08, bigLossP: 0.10, endGap: 1,  tailLosses: 6, tailLossLo: 1.0, tailLossHi: 2.2, diarioN: 9, diarioEndGap: 17, diarioRevenge: false, positions: 3 },
  { user: "demo.indisciplina", name: "Igor Indisciplinado",    valorR: 200, seed: 4044,   n: 46, winRate: 0.50, gainLo: 0.6, gainHi: 2.0, lossLo: 1.0, lossHi: 3.0, bigWinP: 0.05, bigLossP: 0.26, endGap: 2,  tailLosses: 0, diarioN: 12, diarioRevenge: true,  positions: 3 },
  { user: "demo.inativo",      name: "Inês Inativa",           valorR: 250, seed: 5055,   n: 28, winRate: 0.60, gainLo: 0.6, gainHi: 2.2, lossLo: 0.4, lossHi: 1.2, bigWinP: 0.08, bigLossP: 0.06, endGap: 26, tailLosses: 0, diarioN: 6,  diarioRevenge: false, positions: 0 },
  { user: "demo.mare",         name: "Lucas Maré",             valorR: 250, seed: 6066,   n: 50, winRate: 0.57, gainLo: 0.6, gainHi: 2.2, lossLo: 0.4, lossHi: 1.2, bigWinP: 0.08, bigLossP: 0.06, endGap: 1,  tailLosses: 4, tailLossLo: 0.3, tailLossHi: 0.8, diarioN: 8, diarioEndGap: 17, diarioRevenge: false, positions: 2 },
  { user: "demo.iniciante",    name: "Nina Iniciante",         valorR: 150, seed: 7077,   n: 15, winRate: 0.45, gainLo: 0.5, gainHi: 1.6, lossLo: 0.5, lossHi: 1.4, bigWinP: 0.04, bigLossP: 0.10, endGap: 3,  tailLosses: 0, diarioN: 4,  diarioRevenge: false, positions: 1 },
];

const TICKERS = [["PETR4", "Petrobras PN"], ["VALE3", "Vale ON"], ["BBAS3", "Banco do Brasil ON"], ["ITUB4", "Itaú PN"], ["MGLU3", "Magazine Luiza ON"], ["WEGE3", "WEG ON"], ["PRIO3", "PRIO ON"], ["BBDC4", "Bradesco PN"]];

const makeRng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const br = (d) => pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
const prevBiz = (d) => { do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6); };

// Datas cronológicas terminando há `endGap` dias úteis (recuando de hoje).
function genDates(rng, n, endGap) {
  const dates = [];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < endGap; i++) prevBiz(d);
  for (let i = 0; i < n; i++) { dates.push(new Date(d)); if (rng() > 0.3) prevBiz(d); }
  return dates.reverse();
}

export function genTrades(p) {
  const rng = makeRng(p.seed);
  const ativos = ["WIN", "WIN", "WIN", "WDO", "WDO", "PETR4", "VALE3", "WDO"];
  const setups = ["Rompimento", "Pullback", "Fundo/Topo duplo", "VWAP", "Suporte/Resistência", "Tendência", "Reversão à média", "Abertura"];
  const notasGain = ["Segurei o alvo", "Parcial + stop na entrada", "Deixei correr", "Plano respeitado", ""];
  const notasLoss = ["Stop respeitado", "Saí no tempo", "Contra-tendência, erro", "Mão de alface", ""];
  const dates = genDates(rng, p.n, p.endGap);
  const trades = [];
  let id = 1;
  for (let i = 0; i < p.n; i++) {
    const isTail = p.tailLosses && i >= p.n - p.tailLosses;
    const win = isTail ? false : rng() < p.winRate;
    let r;
    if (win) { r = p.gainLo + rng() * (p.gainHi - p.gainLo); if (rng() < (p.bigWinP || 0)) r = p.gainHi + rng() * 3; }
    else {
      const lo = isTail ? (p.tailLossLo ?? p.lossLo) : p.lossLo;
      const hi = isTail ? (p.tailLossHi ?? p.lossHi) : p.lossHi;
      r = -(lo + rng() * (hi - lo));
      if (!isTail && rng() < (p.bigLossP || 0)) r = -(hi + rng() * 1.5);
    }
    r = +r.toFixed(2);
    trades.push({ id: id++, data: iso(dates[i]), ativo: ativos[Math.floor(rng() * ativos.length)], direcao: rng() < 0.62 ? "COMPRA" : "VENDA", r, fin: +(r * p.valorR).toFixed(2), setup: setups[Math.floor(rng() * setups.length)], notas: win ? notasGain[Math.floor(rng() * notasGain.length)] : notasLoss[Math.floor(rng() * notasLoss.length)] });
  }
  return trades;
}

export function genDiario(p) {
  const rng = makeRng(p.seed + 7);
  const reflOk = ["Bom controle emocional hoje", "Respeitei o plano", "Disciplina ok", "Segurei o alvo com sucesso", "Operei só o planejado", ""];
  const reflBad = p.diarioRevenge
    ? ["Revenge trade após loss, fui no tilt", "Perdi o controle, fúria total", "Dobrei a mão pra recuperar, erro grave", "Mão de alface de novo", "Operei na fúria"]
    : ["Saí cedo demais", "Operei com pressa", "Poderia ter segurado mais", ""];
  const dif = p.diarioRevenge ? ["Fúria", "Revenge trade", "Descontrole", "Tilt", "Ansiedade"] : ["Ansiedade", "Mão de alface", "FOMO", "Pressa", ""];
  // diarioEndGap (quando definido) afasta o diário das datas mais recentes, para
  // que o trecho final da curva seja só os trades — preservando o drawdown /
  // sequência de loss que o perfil quer demonstrar.
  const dates = genDates(rng, p.diarioN, p.diarioEndGap ?? p.endGap);
  const diario = [];
  for (let i = 0; i < p.diarioN; i++) {
    const win = rng() < p.winRate;
    const resultado = +(win ? 80 + rng() * 650 : -(80 + rng() * (p.diarioRevenge ? 700 : 450))).toFixed(2);
    diario.push({ data: br(dates[i]), resultado, dificuldade: win ? "" : dif[Math.floor(rng() * dif.length)], reflexao: win ? reflOk[Math.floor(rng() * reflOk.length)] : reflBad[Math.floor(rng() * reflBad.length)] });
  }
  return diario;
}

export function genPositions(p) {
  const k = p.positions || 0;
  if (!k) return [];
  const rng = makeRng(p.seed + 13);
  const closePct = (pp, saida) => { const r = ((saida - pp.entrada) / pp.entrada) * 100; return pp.direcao === "VENDA" ? -r : r; };
  const dates = genDates(rng, k, p.endGap);
  const out = [];
  for (let i = 0; i < k; i++) {
    const [tk, nome] = TICKERS[Math.floor(rng() * TICKERS.length)];
    const entrada = +(10 + rng() * 55).toFixed(2);
    const direcao = rng() < 0.6 ? "COMPRA" : "VENDA";
    const win = rng() < p.winRate;
    const mov = win ? (0.02 + rng() * 0.05) : -(0.015 + rng() * 0.04);
    const saida = +(entrada * (1 + (direcao === "VENDA" ? -mov : mov))).toFixed(2);
    const stop = +(entrada * (1 + (direcao === "VENDA" ? 0.03 : -0.03))).toFixed(2);
    const alvo = +(entrada * (1 + (direcao === "VENDA" ? -0.05 : 0.05))).toFixed(2);
    out.push({ posId: i + 1, recId: 1000 + i, ticker: tk, nome, direcao, entrada, alvo, stop, qty: 1, ai: false, status: "FECHADA", dataEntrada: br(dates[i]), dataSaida: br(dates[i]), precoSaida: saida, resultado: +closePct({ entrada, direcao }, saida).toFixed(2) });
  }
  return out;
}

async function seedCohort(redis) {
  const users = await getUsers();
  const created = [];
  for (const p of PROFILES) {
    users[p.user] = {
      user: p.user, name: p.name, role: "client", expiry: null,
      perms: [...DEFAULT_CLIENT_PERMS], pass: hashPassword(DEMO_PASS),
      tradesMigrated: true, demoSeed: true, createdAt: Date.now(),
    };
    const trades = genTrades(p), diario = genDiario(p), positions = genPositions(p);
    const cap = p.valorR * 100;
    await redis.set("forcehub:trades:" + p.user, { trades, valorR: p.valorR });
    await redis.set("forcehub:conselheiro:" + p.user, { perfil: { capital: cap, contratosWIN: Math.floor(cap / 1000), contratosWDO: Math.floor(cap / 1500), preferencia: "Índice e Dólar" }, diario });
    await redis.set("forcehub:positions:" + p.user, positions);
    created.push({ user: p.user, name: p.name, trades: trades.length, diario: diario.length, positions: positions.length });
  }
  await saveUsers(users);
  return created;
}

async function cleanupCohort(redis) {
  const users = await getUsers();
  const removed = [];
  for (const k of Object.keys(users)) {
    const u = users[k];
    if (u && u.demoSeed === true && u.user !== SUPERADMIN) {
      await redis.del("forcehub:trades:" + u.user);
      await redis.del("forcehub:conselheiro:" + u.user);
      await redis.del("forcehub:positions:" + u.user);
      removed.push(u.user);
      delete users[k];
    }
  }
  await saveUsers(users);
  return removed;
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (!isStaff(sess.role)) return res.status(403).json({ ok: false, error: "Apenas a equipe pode gerar/limpar dados de teste." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const action = (req.query.action || (body && body.action) || "seed").toString();

  try {
    if (action === "delete") {
      const removed = await cleanupCohort(redis);
      return res.status(200).json({ ok: true, action: "delete", removed: removed.length, users: removed });
    }
    const created = await seedCohort(redis);
    return res.status(200).json({ ok: true, action: "seed", pass: DEMO_PASS, count: created.length, students: created });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
