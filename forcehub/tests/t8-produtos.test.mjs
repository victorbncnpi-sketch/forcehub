import { secao, t, ta, eq, ehVerdade, ehFalso, contem, resumo, fakeRedis, chamar } from "./runner.mjs";
import handler, { precoValido, linkValido, validarProduto, validarCombo, imagemValida, TOKEN_RE, MAX_IMG } from "../api/_produtos";
import usersHandler from "../api/users";
import { precoDeTexto } from "../src/shared";
import { readFileSync, readdirSync } from "node:fs";

const VICTOR = { user: "victor", name: "Victor", role: "superadmin", perms: [] };
const MOD = { user: "mod1", name: "Mod", role: "moderator", perms: [] };
const CLI = { user: "cliente1", name: "Cliente 1", role: "client", perms: ["panorama", "produtos"] };
const SEM = { user: "cliente2", name: "Cliente 2", role: "client", perms: ["panorama"] };

secao("produtos — validação");
t("preço: de 0 a 1 milhão, 2 casas; o resto é recusado", () => {
  eq(precoValido(0), 0); eq(precoValido(497), 497); eq(precoValido(97.999), 98); eq(precoValido("97.9"), 97.9);
  for (const v of [-1, NaN, Infinity, 1e7, true, "", null, undefined, "abc"]) eq(precoValido(v), null, String(v));
});
t("link: vazio vale; preenchido só http(s) — javascript: nunca vira href", () => {
  eq(linkValido(""), ""); eq(linkValido(null), "");
  eq(linkValido(" https://pay.hotmart.com/X123 "), "https://pay.hotmart.com/X123");
  eq(linkValido("http://wa.me/5511999999999"), "http://wa.me/5511999999999");
  for (const v of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,oi", "ftp://x.com", "https://a b.com", "https://x.com/\"onmouseover=1", "www.site.com", "https://" + "a".repeat(600)]) eq(linkValido(v), null, v);
});
t("produto: nome obrigatório, texto aparado, quebra de linha mantida", () => {
  ehVerdade(validarProduto({ preco: 1 }).erro);
  ehVerdade(validarProduto({ nome: "  ", preco: 1 }).erro);
  ehVerdade(validarProduto({ nome: "X", preco: -1 }).erro);
  ehVerdade(validarProduto({ nome: "X", preco: 1, link: "javascript:x" }).erro);
  eq(validarProduto({ nome: "  Curso\u0007 ", descricao: " linha 1\nlinha 2\r ", preco: "10", interno: "sim" }).campos,
    { nome: "Curso", descricao: "linha 1\nlinha 2", preco: 10, link: "", interno: true });
});
t("combo: pelo menos um produto, só os que existem, sem repetição", () => {
  const ps = [{ id: "p_1" }, { id: "p_2" }];
  ehVerdade(validarCombo({ nome: "C", preco: 1, itens: [] }, ps).erro);
  ehVerdade(validarCombo({ nome: "C", preco: 1 }, ps).erro);
  contem(validarCombo({ nome: "C", preco: 1, itens: ["p_1", "p_x"] }, ps).erro, "não existe");
  eq(validarCombo({ nome: "C", preco: 1, itens: ["p_2", "p_1", "p_2"] }, ps).campos.itens, ["p_2", "p_1"]);
});
t("preço digitado no formato brasileiro (formulário)", () => {
  eq(precoDeTexto("497"), 497); eq(precoDeTexto("97,90"), 97.9); eq(precoDeTexto("1.997,00"), 1997);
  eq(precoDeTexto("R$ 1.997"), 1997); eq(precoDeTexto("97.90"), 97.9, "ponto decimal com 2 casas");
  eq(precoDeTexto("1.234"), 1234, "grupo de 3 é milhar"); eq(precoDeTexto("0"), 0);
  for (const v of ["", "-5", "abc", "12,345", null]) eq(precoDeTexto(v), null, String(v));
});

// ─── Ambiente com a vitrine montada pela equipe ───────────────────────────────
const post = (ctx, session, body) => chamar(handler, { method: "POST", session, redis: ctx.redis, body });
const get = (ctx, session, query = {}) => chamar(handler, { method: "GET", session, redis: ctx.redis, query });
async function vitrine() {
  const ctx = { redis: fakeRedis() };
  const cria = async (tipo, item) => { const r = await post(ctx, VICTOR, { acao: "salvar", tipo, item }); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body.id; };
  ctx.p1 = await cria("produto", { nome: "Curso Price Action", descricao: "Do zero ao avançado.", preco: 497, link: "https://pay.example.com/pa" });
  ctx.p2 = await cria("produto", { nome: "Mentoria VIP", preco: 297, link: "https://pay.example.com/vip", interno: true });
  ctx.c1 = await cria("combo", { nome: "Combo Completo", preco: 597, link: "https://pay.example.com/combo", itens: [ctx.p1, ctx.p2] });
  ctx.c2 = await cria("combo", { nome: "Prêmio do Sorteio", preco: 0, itens: [ctx.p1], interno: true });
  const staff = (await get(ctx, VICTOR)).body;
  ctx.tok = Object.fromEntries([...staff.produtos, ...staff.combos].map(x => [x.id, x.token]));
  return ctx;
}

await (async () => {

secao("produtos — quem vê o quê");
await ta("sem sessão = 401; cliente sem o cap 'produtos' = 403", async () => {
  const ctx = await vitrine();
  eq((await get(ctx, null)).status, 401);
  eq((await get(ctx, SEM)).status, 403);
});
await ta("cliente vê só os itens públicos", async () => {
  const ctx = await vitrine();
  const r = await get(ctx, CLI);
  eq(r.status, 200);
  ehFalso(r.body.staff);
  eq(r.body.produtos.map(p => p.nome), ["Curso Price Action"]);
  eq(r.body.combos.map(c => c.nome), ["Combo Completo"]);
});
await ta("para o cliente não vai token, flag interno nem autoria", async () => {
  const ctx = await vitrine();
  const txt = JSON.stringify((await get(ctx, CLI)).body);
  for (const k of ['"token"', '"interno"', '"autor"', ctx.tok[ctx.p1], ctx.tok[ctx.c2]]) ehFalso(txt.includes(k), "vazou " + k);
});
await ta("combo traz o 'de' (soma dos produtos) e o desconto, calculados na leitura", async () => {
  const ctx = await vitrine();
  const c = (await get(ctx, CLI)).body.combos[0];
  eq(c.precoOriginal, 794);
  eq(c.desconto, 25);
  eq(c.itens.map(p => p.nome), ["Curso Price Action", "Mentoria VIP"], "combo público mostra o produto interno que ele inclui");
});
await ta("staff vê tudo, com token e marca de interno", async () => {
  const ctx = await vitrine();
  for (const s of [VICTOR, MOD]) {
    const r = (await get(ctx, s)).body;
    ehVerdade(r.staff);
    eq(r.produtos.length, 2); eq(r.combos.length, 2);
    eq(r.produtos.find(p => p.id === ctx.p2).interno, true);
    ehVerdade(TOKEN_RE.test(r.combos.find(c => c.id === ctx.c2).token));
  }
});
await ta("cliente não cadastra, não edita, não exclui", async () => {
  const ctx = await vitrine();
  for (const body of [{ acao: "salvar", tipo: "produto", item: { nome: "X", preco: 1 } }, { acao: "excluir", tipo: "produto", id: ctx.p1 }, { acao: "novoLink", tipo: "combo", id: ctx.c2 }]) {
    eq((await post(ctx, CLI, body)).status, 403);
  }
  eq((await get(ctx, VICTOR)).body.produtos.length, 2);
});

secao("produtos — link de compartilhamento (público)");
await ta("link de item interno abre SEM login", async () => {
  const ctx = await vitrine();
  const r = await get(ctx, null, { link: ctx.tok[ctx.c2] });
  eq(r.status, 200);
  eq(r.body.item, { tipo: "combo", nome: "Prêmio do Sorteio", descricao: "", preco: 0, link: "", imagem: null, precoOriginal: 497, desconto: 100,
    itens: [{ nome: "Curso Price Action", descricao: "Do zero ao avançado.", preco: 497 }] });
});
await ta("link de produto devolve só o produto, sem token nem marcações", async () => {
  const ctx = await vitrine();
  const r = await get(ctx, null, { link: ctx.tok[ctx.p2] });
  eq(r.body.item, { tipo: "produto", nome: "Mentoria VIP", descricao: "", preco: 297, link: "https://pay.example.com/vip", imagem: null });
});
await ta("token inválido ou desconhecido = 404", async () => {
  const ctx = await vitrine();
  for (const link of ["", "curto", "../../etc", "a".repeat(16), "x".repeat(60)]) eq((await get(ctx, null, { link })).status, 404, link);
});
await ta("'novo link' mata o anterior", async () => {
  const ctx = await vitrine();
  const velho = ctx.tok[ctx.c2];
  eq((await post(ctx, MOD, { acao: "novoLink", tipo: "combo", id: ctx.c2 })).status, 200);
  const novo = (await get(ctx, VICTOR)).body.combos.find(c => c.id === ctx.c2).token;
  ehVerdade(novo && novo !== velho);
  eq((await get(ctx, null, { link: velho })).status, 404);
  eq((await get(ctx, null, { link: novo })).status, 200);
});
await ta("passa pelo roteador /api/users?fn=produtos (rewrite /api/produtos)", async () => {
  const ctx = await vitrine();
  const r = await chamar(usersHandler, { method: "GET", query: { fn: "produtos", link: ctx.tok[ctx.p1] }, redis: ctx.redis });
  eq(r.status, 200);
  eq(r.body.item.nome, "Curso Price Action");
  eq((await chamar(usersHandler, { method: "GET", query: { fn: "produtos" }, session: CLI, redis: ctx.redis })).body.produtos.length, 1);
});

await ta("produtos saem do mais caro para o mais barato (empate: ordem de cadastro)", async () => {
  const ctx = await vitrine();                    // já tem 497 e 297 (interno)
  for (const [nome, preco] of [["Planilha", 97.9], ["Mentoria em grupo", 1297], ["Ebook", 0], ["Planilha Pro", 97.9]]) {
    eq((await post(ctx, VICTOR, { acao: "salvar", tipo: "produto", item: { nome, preco } })).status, 200);
  }
  eq((await get(ctx, VICTOR)).body.produtos.map(p => p.preco), [1297, 497, 297, 97.9, 97.9, 0]);
  eq((await get(ctx, VICTOR)).body.produtos.slice(3, 5).map(p => p.nome), ["Planilha", "Planilha Pro"]);
  eq((await get(ctx, CLI)).body.produtos.map(p => p.nome), ["Mentoria em grupo", "Curso Price Action", "Planilha", "Planilha Pro", "Ebook"], "cliente: mesma ordem, sem o interno");
  const doc = await ctx.redis.get("forcehub:produtos");
  eq(doc.produtos[0].nome, "Curso Price Action", "ordenar não reescreve o banco");
});

secao("produtos — edição e exclusão");
await ta("editar mantém id e link; o preço novo muda o 'de' do combo", async () => {
  const ctx = await vitrine();
  const r = await post(ctx, MOD, { acao: "salvar", tipo: "produto", item: { id: ctx.p1, nome: "Curso Price Action 2.0", preco: 597, link: "https://pay.example.com/pa" } });
  eq(r.status, 200);
  const p = r.body.produtos.find(x => x.id === ctx.p1);
  eq(p.nome, "Curso Price Action 2.0");
  eq(p.token, ctx.tok[ctx.p1], "editar não troca o link");
  eq(p.autor, "Mod");
  eq(r.body.combos.find(c => c.id === ctx.c1).precoOriginal, 894);
});
await ta("produto dentro de combo não é excluído (409, cita o combo)", async () => {
  const ctx = await vitrine();
  const r = await post(ctx, VICTOR, { acao: "excluir", tipo: "produto", id: ctx.p2 });
  eq(r.status, 409);
  contem(r.body.error, "Combo Completo");
  eq((await get(ctx, VICTOR)).body.produtos.length, 2);
});
await ta("tirando do combo, a exclusão passa e o link morre", async () => {
  const ctx = await vitrine();
  eq((await post(ctx, VICTOR, { acao: "excluir", tipo: "combo", id: ctx.c1 })).status, 200);
  eq((await post(ctx, VICTOR, { acao: "excluir", tipo: "produto", id: ctx.p2 })).status, 200);
  eq((await get(ctx, null, { link: ctx.tok[ctx.p2] })).status, 404);
});
await ta("item inexistente = 404; tipo ou ação inválidos = 400", async () => {
  const ctx = await vitrine();
  eq((await post(ctx, VICTOR, { acao: "salvar", tipo: "produto", item: { id: "p_nao", nome: "X", preco: 1 } })).status, 404);
  eq((await post(ctx, VICTOR, { acao: "excluir", tipo: "combo", id: "c_nao" })).status, 404);
  eq((await post(ctx, VICTOR, { acao: "salvar", tipo: "curso", item: { nome: "X", preco: 1 } })).status, 400);
  eq((await post(ctx, VICTOR, { acao: "apagarTudo", tipo: "produto", id: ctx.p1 })).status, 400);
});
await ta("link com javascript: é recusado no cadastro", async () => {
  const ctx = await vitrine();
  const r = await post(ctx, VICTOR, { acao: "salvar", tipo: "produto", item: { nome: "X", preco: 1, link: "javascript:alert(document.cookie)" } });
  eq(r.status, 400);
  contem(r.body.error, "https://");
});

secao("produtos — imagem");
// JPEG mínimo de verdade (cabeçalho FFD8) em base64.
const JPG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).toString("base64");
const PNG = "data:image/png;base64," + Buffer.from("png-falso").toString("base64");
const comImagem = async () => {
  const ctx = await vitrine();
  for (const [tipo, id] of [["produto", ctx.p1], ["produto", ctx.p2], ["combo", ctx.c2]]) {
    const atual = (await get(ctx, VICTOR)).body[tipo === "produto" ? "produtos" : "combos"].find(x => x.id === id);
    const r = await post(ctx, VICTOR, { acao: "salvar", tipo, item: { ...atual, itens: (atual.itens || []).map(x => x.id), imagem: JPG } });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  }
  return ctx;
};
const img = (ctx, session, id, extra = {}) => chamar(handler, { method: "GET", session, redis: ctx.redis, query: { img: id, v: "1", ...extra } });
t("aceita só JPG/PNG/WebP em base64, até o limite; SVG nunca", () => {
  ehVerdade(imagemValida(JPG)); ehVerdade(imagemValida(PNG));
  ehVerdade(imagemValida("data:image/webp;base64,UklGRg=="));
  for (const v of ["data:image/svg+xml;base64,PHN2Zz4=", "https://x.com/a.jpg", "data:text/html;base64,PGI+", "data:image/jpeg;base64,não-é-base64!", "", null, 42,
    "data:image/jpeg;base64," + "A".repeat(MAX_IMG)]) ehFalso(imagemValida(v), String(v).slice(0, 40));
});
await ta("salvar com imagem: grava fora da vitrine e devolve a URL versionada", async () => {
  const ctx = await comImagem();
  const p = (await get(ctx, CLI)).body.produtos.find(x => x.id === ctx.p1);
  ehVerdade(/^\/api\/produtos\?img=p_[0-9a-f]+&v=\d+$/.test(p.imagem), p.imagem);
  eq(await ctx.redis.get("forcehub:produtos:img:" + ctx.p1), JPG);
  ehFalso(JSON.stringify(await ctx.redis.get("forcehub:produtos")).includes("base64"), "a imagem não pode morar no doc da vitrine");
});
await ta("a imagem sai como arquivo, com tipo certo e cache só no navegador", async () => {
  const ctx = await comImagem();
  const r = await img(ctx, CLI, ctx.p1);
  eq(r.status, 200);
  eq(r.headers["content-type"], "image/jpeg");
  contem(r.headers["cache-control"], "private");
  eq(r.headers["x-content-type-options"], "nosniff");
  eq([...r.raw.subarray(0, 2)], [0xff, 0xd8]);
});
await ta("item interno: cliente não vê a imagem; equipe vê; o link da oferta vê sem login", async () => {
  const ctx = await comImagem();
  eq((await img(ctx, CLI, ctx.p2)).status, 404);
  eq((await img(ctx, null, ctx.p2)).status, 404, "sem sessão e sem link");
  eq((await img(ctx, MOD, ctx.p2)).status, 200);
  const oferta = await img(ctx, null, ctx.c2, { link: ctx.tok[ctx.c2] });
  eq(oferta.status, 200);
  eq(oferta.headers["content-type"], "image/jpeg", "com ?link= tem que vir a IMAGEM, não o JSON da oferta");
  eq((await img(ctx, null, ctx.c2, { link: ctx.tok[ctx.p1] })).status, 404, "token de outro item não abre esta imagem");
  eq((await img(ctx, SEM, ctx.p1)).status, 404, "cliente sem o cap");
});
await ta("a página de oferta recebe a URL da imagem com o token", async () => {
  const ctx = await comImagem();
  const it = (await get(ctx, null, { link: ctx.tok[ctx.c2] })).body.item;
  ehVerdade(it.imagem.endsWith("&link=" + ctx.tok[ctx.c2]), it.imagem);
});
await ta("editar sem mandar imagem mantém; null remove; trocar muda a versão", async () => {
  const ctx = await comImagem();
  const atual = () => get(ctx, VICTOR).then(r => r.body.produtos.find(x => x.id === ctx.p1));
  const a = await atual();
  await post(ctx, VICTOR, { acao: "salvar", tipo: "produto", item: { id: ctx.p1, nome: "Novo nome", preco: 497 } });
  eq((await atual()).imagem, a.imagem, "sem o campo, mantém");
  await new Promise(r => setTimeout(r, 5));
  await post(ctx, VICTOR, { acao: "salvar", tipo: "produto", item: { id: ctx.p1, nome: "Novo nome", preco: 497, imagem: PNG } });
  const b = await atual();
  ehVerdade(b.imagem && b.imagem !== a.imagem, "trocar precisa mudar o v= (senão o navegador mostra a velha do cache)");
  await post(ctx, VICTOR, { acao: "salvar", tipo: "produto", item: { id: ctx.p1, nome: "Novo nome", preco: 497, imagem: null } });
  eq((await atual()).imagem, null);
  eq(await ctx.redis.get("forcehub:produtos:img:" + ctx.p1), null, "a chave da imagem é apagada");
  eq((await img(ctx, VICTOR, ctx.p1)).status, 404);
});
await ta("imagem inválida é recusada e não grava nada", async () => {
  const ctx = await vitrine();
  const r = await post(ctx, VICTOR, { acao: "salvar", tipo: "produto", item: { nome: "X", preco: 1, imagem: "data:image/svg+xml;base64,PHN2Zz4=" } });
  eq(r.status, 400);
  eq((await get(ctx, VICTOR)).body.produtos.length, 2);
});
await ta("excluir o item apaga a imagem junto", async () => {
  const ctx = await comImagem();
  eq((await post(ctx, VICTOR, { acao: "excluir", tipo: "combo", id: ctx.c2 })).status, 200);
  eq(await ctx.redis.get("forcehub:produtos:img:" + ctx.c2), null);
});
t("o formulário comprime a imagem no navegador antes de enviar", () => {
  const src = readFileSync("src/produtos.jsx", "utf8");
  contem(src, "resizeImage(file, 1200, 0.82)");
  contem(src, 'accept="image/png,image/jpeg,image/webp"');
});

secao("produtos — permissão, menu e página pública");
await ta("clientes antigos ganham 'produtos' uma vez; se o admin tirar, não volta", async () => {
  const { getUsers } = await import("../api/_auth.js");
  const redis = fakeRedis();
  globalThis.__REDIS__ = redis;
  await redis.set("forcehub:users", { ana: { user: "ana", role: "client", perms: ["panorama"], tradesMigrated: true, portfolioMigrated: true, estudosMigrated: true } });
  ehVerdade((await getUsers()).ana.perms.includes("produtos"));
  const m = await redis.get("forcehub:users");
  m.ana.perms = ["panorama"];
  await redis.set("forcehub:users", m);
  ehFalso((await getUsers()).ana.perms.includes("produtos"), "a concessão é única");
});
t("caps do frontend espelham os do backend", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const auth = readFileSync("api/_auth.js", "utf8");
  const arr = (src, nome) => (src.match(new RegExp(nome + " = (\\[[^\\]]*\\])")) || [])[1];
  eq(arr(app, "PAGE_CAPS"), arr(auth, "PAGE_CAPS"));
  eq(arr(app, "DEFAULT_CLIENT_PERMS"), arr(auth, "DEFAULT_CLIENT_PERMS"));
  contem(arr(auth, "DEFAULT_CLIENT_PERMS"), '"produtos"');
  contem(app, 'produtos: "Produtos (vitrine)"');
});
t("menu tem 'Produtos' e a tela está ligada", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  ehVerdade(/\{ key: "produtos",.*label: "Produtos".*cap: "produtos" \}/.test(app));
  contem(app, '{current === "produtos" && <ProdutosScreen');
});
t("o link de oferta abre antes do login (página pública)", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const raiz = app.slice(app.indexOf("export default function App"));
  const oferta = raiz.indexOf("if (ofertaToken)");
  ehVerdade(oferta > 0 && oferta < raiz.indexOf("if (booting)") && oferta < raiz.indexOf("if (!session)"));
  contem(readFileSync("src/produtos.jsx", "utf8"), '"/api/produtos?link="');
});
t("rewrite /api/produtos e continua no teto de 12 funções", () => {
  const v = JSON.parse(readFileSync("vercel.json", "utf8"));
  ehVerdade(v.rewrites.some(r => r.source === "/api/produtos" && r.destination === "/api/users?fn=produtos"));
  eq(readdirSync("api").filter(f => f.endsWith(".js") && !f.startsWith("_")).length, 12);
});

})();
console.log("");
process.exit(resumo() ? 1 : 0);
