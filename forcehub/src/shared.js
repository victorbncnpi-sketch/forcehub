// src/shared.js — Utilidades compartilhadas entre as telas do hub.
// Ficam aqui as peças que mais de uma tela usa e que não são componentes: o
// cliente HTTP do backend, a compressão de imagem no navegador e o leitor do
// CSV de operações do Profit. Antes viviam dentro de App.jsx; foram extraídas
// quando o Personal Trader passou a precisar das mesmas três coisas — manter
// duas cópias do parser do Profit seria pedir para as duas divergirem.

// ─── Camada de dados (backend via /api/*) ─────────────────────────────────────
// Autenticação e cadastro de usuários agora ficam no backend (api/auth.js,
// api/users.js). As senhas nunca chegam ao frontend; a sessão é um cookie
// httpOnly e os clientes são gerenciados pelo admin no painel "Clientes".
export const api = {
  get: async (path) => {
    const r = await fetch(path);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  },
  post: async (path, body) => {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  },
};

// Redimensiona uma imagem no navegador (mantém proporção) e retorna um data URL
// JPEG comprimido — evita estourar o limite de payload do banco.
export async function resizeImage(file, maxDim = 1280, quality = 0.78) {
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataUrl; });
  let { width, height } = img;
  if (Math.max(width, height) > maxDim) { const s = maxDim / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
  const c = document.createElement("canvas"); c.width = width; c.height = height;
  c.getContext("2d").drawImage(img, 0, 0, width, height);
  return c.toDataURL("image/jpeg", quality);
}

// ─── Filtro de período por mês ────────────────────────────────────────────────
// Os filtros de período (30 dias, 90 dias, Tudo...) ganharam um seletor de mês.
// O mês vive no MESMO estado do período, como chave "AAAA-MM": assim escolher
// um mês desmarca o chip e clicar num chip sai do mês, sem dois filtros
// brigando entre si. `ehMes` é o que separa um caso do outro.
export const NOMES_MES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const ehMes = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v == null ? "" : v));
// "2026-09" -> "Setembro de 2026"
export const rotuloMes = (ym) => ehMes(ym) ? NOMES_MES[+ym.slice(5, 7) - 1] + " de " + ym.slice(0, 4) : "";
// Meses presentes nos dados, sem repetir, do mais recente para o mais antigo —
// o seletor só oferece mês que tem o que mostrar.
export const mesesDe = (yms) => Array.from(new Set((yms || []).filter(ehMes))).sort().reverse();

// ─── Importação de CSV do Profit (Nelogica) ───────────────────────────────────
// O relatório "Operações" do Profit vem em latin-1 (windows-1252), separado por
// ";", com um preâmbulo (Conta/Titular/datas) antes da grade. Números em formato
// BR (1.234,50) e datas dd/mm/aaaa hh:mm:ss. Mapeamos colunas por nome (tolerante
// a acento), com fallback para a ordem fixa do layout do Profit.
export const deburr = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
// "1.234,50" / "-150,00" / "0" -> número (ponto = milhar, vírgula = decimal).
export function brNum(s) {
  const t = String(s == null ? "" : s).trim().replace(/\./g, "").replace(",", ".");
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}
// "05/01/2026 10:47:58" -> { data:"2026-01-05", hora:"10:47:58" }
export function brDateTime(s) {
  const m = String(s == null ? "" : s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/);
  if (!m) return null;
  return { data: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4] || "" };
}
// WING26 -> WIN ; WDOG26 -> WDO ; PETR4 -> PETR4 (corta só o vencimento de futuro).
export const rootAtivo = (s) => String(s || "").trim().toUpperCase().replace(/[FGHJKMNQUVXZ]\d{2}$/, "") || null;

// Lê o texto já decodificado e devolve { trades, invalid, abertas, error }. Cada trade
// guarda `ext` = chave única (contrato+data+hora+resultado) p/ deduplicar.
export function parseProfitCsv(text, valorR) {
  const lines = String(text || "").split(/\r?\n/);
  let hi = -1;
  for (let i = 0; i < lines.length && i < 50; i++) {
    const c = lines[i].split(";");
    // >= 4 colunas, não 8: o layout do Profit é configurável e um aluno que
    // exporta só o essencial (Ativo, Abertura, Lado, Qtd, Res. Operação) tinha
    // o arquivo recusado com "cabeçalho não reconhecido". O preâmbulo do Profit
    // tem 1-2 colunas e nenhuma célula dele é exatamente "Ativo", então baixar
    // o piso não cria falso positivo — e se a coluna de R$ faltar, o erro logo
    // abaixo é específico em vez de genérico.
    // "Ativo" em QUALQUER coluna, não só na primeira: o Relatório de Performance
    // abre com "Subconta" (Subconta;Ativo;Abertura;...) e era recusado inteiro.
    // As demais colunas já são achadas por nome, então a posição não importa.
    if (c.length >= 4 && c.some(x => deburr(x) === "ativo")) { hi = i; break; }
  }
  if (hi < 0) return { error: "Cabeçalho não reconhecido — confirme que é o relatório de Operações exportado do Profit (.csv)." };

  const raw = lines[hi].split(";");
  const head = raw.map(deburr);
  const find = (pred) => head.findIndex(pred);
  const iAtivo = Math.max(0, find(h => h === "ativo"));
  const iAbert = (() => { const k = find(h => h === "abertura" || h.startsWith("abertura") || h.startsWith("data")); return k >= 0 ? k : 1; })();

  // Resultado em R$: tenta vários nomes por prioridade, SEMPRE excluindo colunas
  // de pontos/percentual ("%", "pts", "ponto"). Sem fallback de índice fixo —
  // o layout do Profit é configurável, então adivinhar índice causava confusão
  // entre o financeiro e os pontos.
  const moneyOk = (h) => !h.includes("%") && !h.includes("pts") && !h.includes("ponto");
  const moneyTries = [
    h => h === "res. operacao",
    h => h.startsWith("res. operacao") && moneyOk(h),
    h => h === "res. da operacao" || h === "resultado operacao" || h === "resultado da operacao",
    h => h === "res. intervalo bruto",
    h => h.startsWith("res. intervalo") && moneyOk(h),
    h => /(^|\s)(resultado|res\. financeiro|res\. liquido|lucro)/.test(h) && moneyOk(h),
  ];
  let iRes = -1;
  for (const p of moneyTries) { iRes = find(p); if (iRes >= 0) break; }
  if (iRes < 0) return { error: 'Não encontrei a coluna de resultado em R$ (ex.: "Res. Operação"). Confira se ela está incluída na exportação do Profit — não exporte apenas a coluna de pontos/%.' };
  const resCol = (raw[iRes] || head[iRes] || "").trim();

  // Lado: coluna "Lado" ou, na falta dela, extrai C/V de uma coluna "Qtd"
  // combinada (alguns layouts trazem "6 C" / "3 V" num único campo).
  const iLado = find(h => h === "lado");
  const iQtd = find(h => h.startsWith("qtd") || h === "quantidade");
  // Quantidade de contratos: coluna "Qtd" pode vir só com o número ou combinada
  // com o lado ("6 C"). Usada pelo Personal Trader para comparar com o plano.
  const qtdOf = (c) => { if (iQtd < 0) return null; const m = String(c[iQtd] || "").match(/(\d+)/); return m ? parseInt(m[1], 10) : null; };
  const sideOf = (c) => {
    if (iLado >= 0) { const v = (c[iLado] || "").trim().toUpperCase(); if (v.startsWith("C")) return "COMPRA"; if (v.startsWith("V")) return "VENDA"; }
    if (iQtd >= 0) { const m = (c[iQtd] || "").trim().toUpperCase().match(/([CV])\s*$/); if (m) return m[1] === "C" ? "COMPRA" : "VENDA"; }
    return null;
  };

  // Posição em aberto: o Profit lista a operação ainda não zerada com
  // "Fechamento" vazio (" - ") e o resultado marcado a mercado. Importá-la
  // gravaria um número provisório — e como o `ext` inclui o resultado, a mesma
  // operação reimportada depois de fechada entraria de novo, em dobro. Fica de
  // fora e é contada à parte, para a prévia avisar. Só o marcador "-" do Profit
  // conta como aberta: célula vazia ou layout sem "Fechamento" seguem como antes
  // (na dúvida, importar é melhor que sumir com uma operação fechada).
  const iFech = find(h => h === "fechamento" || h.startsWith("fechamento"));

  const trades = [];
  let invalid = 0, abertas = 0;
  for (let i = hi + 1; i < lines.length; i++) {
    if (!lines[i] || !lines[i].trim()) continue;
    const c = lines[i].split(";");
    if (c.length <= iRes || c.length <= iAbert) { invalid++; continue; }
    const dt = brDateTime(c[iAbert]);
    const fin = brNum(c[iRes]);
    const contrato = (c[iAtivo] || "").trim().toUpperCase();
    if (!dt || fin == null || !contrato) { invalid++; continue; }
    if (iFech >= 0 && /^-+$/.test(String(c[iFech] || "").trim())) { abertas++; continue; }
    trades.push({
      data: dt.data, hora: (dt.hora || "").slice(0, 5), qtd: qtdOf(c),
      ativo: rootAtivo(contrato), direcao: sideOf(c),
      r: null, fin, setup: "", notas: contrato,
      ext: `profit:${contrato}:${dt.data} ${dt.hora}:${fin}`,
    });
  }
  return { trades, invalid, abertas, resCol };
}
