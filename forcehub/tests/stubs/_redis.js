// Dublê de api/_redis.js: devolve o Redis em memória que o teste injetou.
export function getRedis() { return globalThis.__REDIS__ || null; }
