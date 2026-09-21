// tests/loader.mjs — resolvedor para rodar os módulos de api/ no Node puro.
//
// Duas diferenças entre o runtime da Vercel e o `node` da linha de comando:
//   1. a Vercel resolve import sem extensão ("./_pt"); o Node ESM não;
//   2. os testes precisam de um Redis e de uma sessão controláveis.
// Este hook resolve as duas: acrescenta ".js" e desvia _redis/_auth para os
// dublês em tests/stubs. Nenhuma dependência externa.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./hooks.mjs", pathToFileURL("./tests/"));
