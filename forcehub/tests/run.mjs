// tests/run.mjs — roda todas as suítes e devolve código de saída 1 se algo falhar.
//   npm test
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const suites = readdirSync("tests").filter(f => f.endsWith(".test.mjs")).sort();
let ok = 0, falhou = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, ["--import", "./tests/loader.mjs", "tests/" + s], { encoding: "utf8" });
  const saida = (r.stdout || "") + (r.stderr || "");
  const m = /(\d+) passaram · (\d+) falharam/.exec(saida);
  if (!m) { console.log(saida); console.log(`\n✗ ${s} não completou`); falhou++; continue; }
  ok += +m[1]; falhou += +m[2];
  console.log(`${+m[2] ? "✗" : "✓"} ${s.padEnd(24)} ${m[1]} passaram · ${m[2]} falharam`);
  if (+m[2]) console.log(saida.slice(saida.indexOf("FALHAS:")));
}
console.log(`\n${falhou ? "✗" : "✓"} total: ${ok} passaram · ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
