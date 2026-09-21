// Hook de resolução usado só pelos testes (ver tests/loader.mjs).
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const RAIZ = process.cwd();
// api/_redis e api/_auth são trocados por dublês: os testes precisam controlar
// o banco e a sessão. Qualquer outro módulo é o de produção, de verdade.
const DUBLES = { "_redis": "/tests/stubs/_redis.js", "_auth": "/tests/stubs/_auth.js" };

export function resolve(especificador, contexto, proximo) {
  if (especificador.startsWith(".")) {
    const nome = especificador.split("/").pop();
    if (DUBLES[nome] && (contexto.parentURL || "").includes("/api/")) {
      return { url: pathToFileURL(RAIZ + DUBLES[nome]).href, shortCircuit: true };
    }
    // A Vercel resolve import sem extensão; o Node ESM não. Acrescenta ".js".
    if (!/\.[mc]?jsx?$/.test(especificador)) {
      const alvo = new URL(especificador + ".js", contexto.parentURL);
      if (existsSync(alvo)) return { url: alvo.href, shortCircuit: true };
    }
  }
  return proximo(especificador, contexto);
}
