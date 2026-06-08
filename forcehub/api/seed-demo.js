// api/seed-demo.js — Cria/atualiza a conta de teste "demo" com dados fictícios
// diversos (trades, diário do Conselheiro e posições da carteira) para validar
// o Diário de Trades e o Dashboard. APENAS super admin. Idempotente: cada
// chamada regrava os dados da conta demo (não toca em nenhum outro usuário).
import { getRedis } from "./_redis";
import { getSession, getUsers, saveUsers, hashPassword, DEFAULT_CLIENT_PERMS } from "./_auth";

const DEMO = "demo";
const DEMO_PASS = "demo2026";
const VALOR_R = 250; // valor de 1R em R$

// PRNG determinístico — a mesma seed gera sempre o mesmo conjunto de dados.
const makeRng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const br = (d) => pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
const nextBizDay = (d) => { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); };

// ~72 operações ao longo de ~4 meses, mix de ativos/direções/setups.
function genTrades() {
  const rng = makeRng(424242);
  const ativos = ["WIN", "WIN", "WIN", "WDO", "WDO", "PETR4", "VALE3", "WDO"];
  const setups = ["Rompimento", "Pullback", "Fundo/Topo duplo", "VWAP", "Suporte/Resistência", "Tendência", "Reversão à média", "Abertura"];
  const notasGain = ["Segurei o alvo", "Parcial + stop na entrada", "Deixei correr", "Plano respeitado", ""];
  const notasLoss = ["Stop respeitado", "Saí no tempo", "Contra-tendência, erro", "Mão de alface", ""];
  const trades = [];
  let id = 1;
  const cur = new Date(2026, 1, 2); // 02/02/2026
  for (let i = 0; i < 72; i++) {
    if (i === 0 || rng() > 0.32) nextBizDay(cur); // ~32% de chance de 2ª operação no mesmo dia
    const win = rng() < 0.58;
    let r;
    if (win) { r = 0.5 + rng() * 2.3; if (rng() < 0.10) r = 3 + rng() * 4.5; }
    else { r = -(0.4 + rng() * 1.2); if (rng() < 0.08) r = -(2 + rng() * 1.8); }
    r = +r.toFixed(2);
    trades.push({ id: id++, data: iso(cur), ativo: pick(rng, ativos), direcao: rng() < 0.62 ? "COMPRA" : "VENDA", r, fin: +(r * VALOR_R).toFixed(2), setup: pick(rng, setups), notas: win ? pick(rng, notasGain) : pick(rng, notasLoss) });
  }
  return trades;
}

// ~16 lançamentos no formato do Conselheiro (resultado em R$, data DD/MM/AAAA).
function genDiario() {
  const rng = makeRng(909090);
  const refl = ["Bom controle emocional hoje", "Saí cedo demais", "Respeitei o plano", "Operei com pressa", "Disciplina ok", "Revenge trade após loss, preciso evitar", "Segurei o alvo com sucesso", ""];
  const dif = ["Ansiedade", "Mão de alface", "FOMO", "Pressa", "", ""];
  const diario = [];
  const cur = new Date(2026, 4, 4); // maio/2026
  for (let i = 0; i < 16; i++) {
    nextBizDay(cur);
    const win = rng() < 0.6;
    const resultado = +(win ? 100 + rng() * 700 : -(80 + rng() * 500)).toFixed(2);
    diario.push({ data: br(cur), resultado, dificuldade: win ? "" : pick(rng, dif), reflexao: pick(rng, refl) });
  }
  return diario;
}

// Posições da carteira: 6 fechadas (ganhos e perdas) + 2 abertas.
function genPositions() {
  const closePct = (p, saida) => { const r = ((saida - p.entrada) / p.entrada) * 100; return p.direcao === "VENDA" ? -r : r; };
  const base = [
    { ticker: "PETR4", nome: "Petrobras PN", direcao: "COMPRA", entrada: 38.50, alvo: 41.00, stop: 37.20, dE: "05/03/2026", dS: "13/03/2026", saida: 40.40 },
    { ticker: "VALE3", nome: "Vale ON", direcao: "COMPRA", entrada: 61.20, alvo: 65.00, stop: 59.50, dE: "06/03/2026", dS: "12/03/2026", saida: 59.50 },
    { ticker: "BBAS3", nome: "Banco do Brasil ON", direcao: "COMPRA", entrada: 27.80, alvo: 29.50, stop: 27.00, dE: "18/03/2026", dS: "27/03/2026", saida: 29.10 },
    { ticker: "ITUB4", nome: "Itaú PN", direcao: "VENDA", entrada: 34.10, alvo: 32.00, stop: 35.20, dE: "02/04/2026", dS: "09/04/2026", saida: 32.50 },
    { ticker: "MGLU3", nome: "Magazine Luiza ON", direcao: "VENDA", entrada: 12.40, alvo: 10.80, stop: 13.10, dE: "14/04/2026", dS: "21/04/2026", saida: 13.10 },
    { ticker: "WEGE3", nome: "WEG ON", direcao: "COMPRA", entrada: 52.00, alvo: 55.50, stop: 50.80, dE: "05/05/2026", dS: "15/05/2026", saida: 55.10 },
  ];
  let posId = 1;
  const closed = base.map(p => ({ posId: posId++, recId: 1000 + posId, ticker: p.ticker, nome: p.nome, direcao: p.direcao, entrada: p.entrada, alvo: p.alvo, stop: p.stop, qty: 1, ai: false, status: "FECHADA", dataEntrada: p.dE, dataSaida: p.dS, precoSaida: p.saida, resultado: +closePct(p, p.saida).toFixed(2) }));
  const open = [
    { posId: posId++, recId: 2001, ticker: "PRIO3", nome: "PRIO ON", direcao: "COMPRA", entrada: 44.20, alvo: 48.00, stop: 42.50, qty: 1, ai: false, status: "ABERTA", dataEntrada: "20/05/2026", dataSaida: null, precoSaida: null, resultado: null },
    { posId: posId++, recId: 2002, ticker: "WDO", nome: "Mini Dólar", direcao: "VENDA", entrada: 5320, alvo: 5260, stop: 5355, qty: 1, ai: false, status: "ABERTA", dataEntrada: "22/05/2026", dataSaida: null, precoSaida: null, resultado: null },
  ];
  return [...closed, ...open];
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) return res.status(503).json({ ok: false, error: "Banco não configurado (defina UPSTASH_REDIS_REST_URL/TOKEN)." });

  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "Não autenticado." });
  if (sess.role !== "superadmin") return res.status(403).json({ ok: false, error: "Apenas o super admin pode gerar a conta demo." });
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ ok: false, error: "Método não permitido" });

  try {
    const users = await getUsers();
    users[DEMO] = {
      user: DEMO, name: "Conta Demo (teste)", role: "client", expiry: null,
      perms: [...DEFAULT_CLIENT_PERMS], pass: hashPassword(DEMO_PASS),
      tradesMigrated: true, createdAt: Date.now(),
    };
    await saveUsers(users);

    const trades = genTrades();
    const diario = genDiario();
    const positions = genPositions();
    await redis.set("forcehub:trades:" + DEMO, { trades, valorR: VALOR_R });
    await redis.set("forcehub:conselheiro:" + DEMO, { perfil: { capital: 50000, contratosWIN: 50, contratosWDO: 33, preferencia: "Índice e Dólar" }, diario });
    await redis.set("forcehub:positions:" + DEMO, positions);

    return res.status(200).json({ ok: true, user: DEMO, pass: DEMO_PASS, valorR: VALOR_R, trades: trades.length, diario: diario.length, positions: positions.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
