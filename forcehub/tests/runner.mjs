// Mini runner: sem dependências, para rodar em qualquer container.
let ok = 0, fail = 0, grupo = "";
const falhas = [];
export const secao = (t) => { grupo = t; console.log("\n── " + t + " " + "─".repeat(Math.max(0, 62 - t.length))); };
export function t(nome, fn) {
  try { fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { fail++; falhas.push(grupo + " › " + nome + "\n       " + e.message); console.log("  FALHA " + nome + "\n         " + e.message); }
}
export async function ta(nome, fn) {
  try { await fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { fail++; falhas.push(grupo + " › " + nome + "\n       " + e.message); console.log("  FALHA " + nome + "\n         " + e.message); }
}
export const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m ? m + ": " : "") + `esperado ${B}, veio ${A}`); };
export const ehVerdade = (v, m) => { if (!v) throw new Error(m || "esperado verdadeiro, veio " + JSON.stringify(v)); };
export const ehFalso = (v, m) => { if (v) throw new Error(m || "esperado falso, veio " + JSON.stringify(v)); };
export const contem = (s, sub, m) => { if (!String(s).includes(sub)) throw new Error((m||"") + ` esperava conter "${sub}" em "${s}"`); };
export const resumo = () => {
  console.log("\n" + "═".repeat(66));
  console.log(`  ${ok} passaram · ${fail} falharam`);
  if (fail) { console.log("\nFALHAS:"); falhas.forEach(f => console.log("  • " + f)); }
  console.log("═".repeat(66));
  return fail;
};
// Redis em memória com contagem de operações (para checar custo de leitura).
export function fakeRedis() {
  const db = new Map(); const stats = { get: 0, set: 0, del: 0 };
  return { _db: db, _stats: stats,
    get: async k => { stats.get++; return db.has(k) ? JSON.parse(db.get(k)) : null; },
    set: async (k, v) => { stats.set++; db.set(k, JSON.stringify(v)); },
    del: async k => { stats.del++; db.delete(k); } };
}
// req/res falsos no formato que a Vercel entrega.
export function chamar(handler, { method = "GET", query = {}, body = null, session = null, users = null, redis = null } = {}) {
  globalThis.__SESSION__ = session; globalThis.__USERS__ = users || {}; globalThis.__REDIS__ = redis;
  let saida = null;
  const res = { status(c) { this._c = c; return this; }, json(j) { saida = { status: this._c, body: j }; return this; }, setHeader() {} };
  return Promise.resolve(handler({ method, query, body, headers: {} }, res)).then(() => saida);
}
