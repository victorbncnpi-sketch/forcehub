// src/produtos.jsx — PRODUTOS: a vitrine do que o Victor vende.
//
// Três visões:
//   • CLIENTE — vê os produtos e combos públicos e compra pelo link de cada um;
//   • EQUIPE  — super admin e moderadores cadastram, editam e excluem; veem
//     também os itens INTERNOS e copiam o link de qualquer item;
//   • OFERTA  — a página pública aberta pelo link (/?oferta=<token>), com ou sem
//     login. É assim que item interno chega a aluno específico ou a ganhador
//     de sorteio externo.
//
// As regras (validação, quem vê o quê, o preço "de" do combo) moram em
// api/_produtos.js. Esta tela não recalcula desconto: mostra o que vem de lá.
import { useState, useEffect, useRef } from "react";
import { api, precoDeTexto, resizeImage } from "./shared";
import { T, Logo, Button, Badge, Card, Field, Input, EmptyState, Banner, Modal, Loading, Icon, confirmDialog } from "./ui";

const BRL = (v) => v == null || !isFinite(v) ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const precoTxt = (v) => v === 0 ? "Grátis" : BRL(v);
const linkDaOferta = (token) => window.location.origin + "/?oferta=" + encodeURIComponent(token);

async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); return true; }
  catch (e) { window.prompt("Copie o link:", txt); return false; }
}

// Botão de compra: <a> com cara de botão primário (abre o checkout em outra aba).
function Comprar({ link, grande }) {
  if (!link) return null;
  return (
    <a className="fh-btn" href={link} target="_blank" rel="noopener noreferrer"
      style={{ background: T.gold, color: "#0a0a0b", border: "1px solid " + T.gold, textDecoration: "none", padding: grande ? "13px 24px" : "9px 16px", fontSize: grande ? 15 : 14 }}>
      Comprar →
    </a>
  );
}

// Corpo comum ao card da vitrine e à página de oferta.
// Imagem do item: proporção fixa e "contain" — capa quadrada, banner largo ou
// logo com fundo transparente aparecem inteiros, sem corte. Se não carregar,
// some em vez de deixar um ícone quebrado.
function Imagem({ src, alt, grande }) {
  const [falhou, setFalhou] = useState(false);
  if (!src || falhou) return null;
  return (
    <img src={src} alt={alt} loading="lazy" onError={() => setFalhou(true)}
      style={{ display: "block", width: "100%", aspectRatio: grande ? "16 / 9" : "16 / 10", objectFit: "contain", background: "#000", borderRadius: 10, border: "1px solid " + T.line }} />
  );
}

function ItemCorpo({ item, combo, staff, grande }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
      <Imagem key={item.imagem || "-"} src={item.imagem} alt={item.nome} grande={grande} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: grande ? 22 : 16, fontWeight: 800, color: T.text, lineHeight: 1.3, flex: "1 1 160px", minWidth: 0, overflowWrap: "anywhere" }}>{item.nome}</div>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {combo && <Badge tone="gold">COMBO</Badge>}
          {item.desconto > 0 && <Badge tone="green">−{item.desconto}%</Badge>}
          {staff && item.interno && <Badge tone="purple">INTERNO</Badge>}
        </span>
      </div>
      {item.descricao && <div style={{ fontSize: grande ? 14 : 13, color: T.mut, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.descricao}</div>}
      {combo && item.itens && item.itens.length > 0 && (
        <div style={{ background: T.inset, border: "1px solid " + T.line, borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, color: T.dim, letterSpacing: 0.5, marginBottom: 6 }}>INCLUI</div>
          {item.itens.map(p => (
            <div key={p.id || p.nome} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, lineHeight: 1.7 }}>
              <span style={{ color: T.text, minWidth: 0, overflowWrap: "anywhere" }}><span style={{ color: T.gold, marginRight: 6 }}>›</span>{p.nome}{staff && p.interno && <span style={{ color: T.purple, fontSize: 11, marginLeft: 6 }}>(interno)</span>}</span>
              <span style={{ color: T.dim, fontFamily: T.mono, whiteSpace: "nowrap" }}>{precoTxt(p.preco)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingTop: 4 }}>
        <div>
          {item.desconto > 0 && <div style={{ fontSize: 12, color: T.dim }}>de <s>{BRL(item.precoOriginal)}</s> por</div>}
          <div style={{ fontSize: grande ? 30 : 22, fontWeight: 800, color: T.gold, fontFamily: T.mono }}>{precoTxt(item.preco)}</div>
        </div>
        <Comprar link={item.link} grande={grande} />
      </div>
    </div>
  );
}

function AcaoBtn({ icon, label, onClick, cor }) {
  return (
    <button className="fh-btn" onClick={onClick} title={label}
      style={{ background: "transparent", border: "1px solid " + T.line, color: cor || T.mut, padding: "6px 10px", fontSize: 12, borderRadius: 8 }}>
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}

function ItemCard({ item, combo, staff, copiado, onEditar, onCopiar, onNovoLink, onExcluir }) {
  return (
    <Card style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, ...(staff && item.interno ? { borderColor: T.purple + "66", borderStyle: "dashed" } : {}) }}>
      <ItemCorpo item={item} combo={combo} staff={staff} />
      {staff && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderTop: "1px solid " + T.line, paddingTop: 12 }}>
          <AcaoBtn icon="edit" label="Editar" onClick={onEditar} />
          <AcaoBtn icon={copiado ? "check" : "copy"} label={copiado ? "Copiado!" : "Copiar link"} onClick={onCopiar} cor={copiado ? T.green : undefined} />
          <AcaoBtn icon="send" label="Novo link" onClick={onNovoLink} />
          <AcaoBtn icon="trash" label="Excluir" onClick={onExcluir} cor={T.red} />
        </div>
      )}
    </Card>
  );
}

const fmtCampo = (v) => v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ItemForm({ tipo, item, produtos, onClose, onSalvar }) {
  const combo = tipo === "combo";
  const [f, setF] = useState(() => ({
    nome: (item && item.nome) || "", descricao: (item && item.descricao) || "",
    preco: item ? fmtCampo(item.preco) : "", link: (item && item.link) || "",
    interno: !!(item && item.interno), itens: item && item.itens ? item.itens.map(x => x.id) : [],
  }));
  const [erro, setErro] = useState(null);
  const [busy, setBusy] = useState(false);
  // Imagem: undefined = mantém a atual; null = remover; data URL = nova.
  const [imagem, setImagem] = useState(undefined);
  const [imgBusy, setImgBusy] = useState(false);
  const fileRef = useRef(null);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const previa = imagem || (imagem === undefined && item && item.imagem) || null;
  const escolherImagem = async (file) => {
    if (!file) return;
    setImgBusy(true); setErro(null);
    try {
      // Comprime no navegador; se ainda passar de ~900KB, reduz mais um pouco.
      let d = await resizeImage(file, 1200, 0.82);
      if (d.length > 900 * 1024) d = await resizeImage(file, 900, 0.72);
      if (d.length > 900 * 1024) setErro("Imagem grande demais mesmo depois de comprimida — tente outra.");
      else setImagem(d);
    } catch (e) { setErro("Não consegui ler essa imagem — use JPG, PNG ou WebP."); }
    setImgBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const preco = precoDeTexto(f.preco);
  const escolhidos = produtos.filter(p => f.itens.includes(p.id));
  const soma = escolhidos.reduce((s, p) => s + (p.preco || 0), 0);
  const desconto = combo && preco != null && soma > 0 && preco < soma ? Math.round((1 - preco / soma) * 100) : 0;
  const internoNoPublico = combo && !f.interno && escolhidos.some(p => p.interno);
  const alternar = (id) => set("itens", f.itens.includes(id) ? f.itens.filter(x => x !== id) : [...f.itens, id]);

  const salvar = async () => {
    if (!f.nome.trim()) return setErro("Informe o nome.");
    if (preco == null) return setErro("Preço inválido — ex.: 497 ou 1.997,00.");
    if (f.link.trim() && !/^https?:\/\//i.test(f.link.trim())) return setErro("O link de compra precisa começar com https://.");
    if (combo && !f.itens.length) return setErro("Escolha pelo menos um produto para o combo.");
    setBusy(true); setErro(null);
    try {
      await onSalvar({ id: item && item.id, nome: f.nome, descricao: f.descricao, preco, link: f.link.trim(), interno: f.interno,
        ...(imagem !== undefined ? { imagem } : {}), ...(combo ? { itens: f.itens } : {}) });
    } catch (e) { setErro(e.message); setBusy(false); }
  };

  const titulo = (item ? "Editar " : "Novo ") + (combo ? "combo" : "produto");
  return (
    <Modal title={titulo} onClose={onClose} width={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {erro && <Banner tone="red">{erro}</Banner>}
        <Field label="Nome">
          <Input value={f.nome} onChange={e => set("nome", e.target.value)} maxLength={120} placeholder={combo ? "Ex.: Combo Day Trade Completo" : "Ex.: Curso de Price Action"} />
        </Field>
        <Field label="Descrição" hint="Opcional. Quebras de linha são mantidas.">
          <textarea className="fh-input" value={f.descricao} onChange={e => set("descricao", e.target.value)} rows={4} maxLength={2000}
            placeholder="O que a pessoa recebe, para quem é, bônus…" style={{ resize: "vertical", lineHeight: 1.5, fontFamily: T.sans }} />
        </Field>

        <div>
          <div style={{ fontSize: 11, color: T.mut, marginBottom: 6, letterSpacing: 0.4, textTransform: "uppercase" }}>Imagem</div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
            onChange={e => escolherImagem(e.target.files && e.target.files[0])} />
          {previa ? (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <img src={previa} alt="Prévia" style={{ width: 200, maxWidth: "100%", aspectRatio: "16 / 10", objectFit: "contain", background: "#000", borderRadius: 8, border: "1px solid " + T.line }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Button variant="ghost" size="sm" onClick={() => fileRef.current && fileRef.current.click()} disabled={imgBusy}>{imgBusy ? "Processando..." : "Trocar imagem"}</Button>
                <Button variant="ghost" size="sm" onClick={() => setImagem(null)} disabled={imgBusy} style={{ color: T.red }}>Remover</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => fileRef.current && fileRef.current.click()} disabled={imgBusy}>
              <Icon name="attach" size={16} /> {imgBusy ? "Processando..." : "Escolher imagem"}
            </Button>
          )}
          <div style={{ fontSize: 11, color: T.dim, marginTop: 6 }}>Opcional. JPG, PNG ou WebP — a imagem é reduzida para até 1200 px antes de enviar.</div>
        </div>

        {combo && (
          <div>
            <div style={{ fontSize: 11, color: T.mut, marginBottom: 6, letterSpacing: 0.4, textTransform: "uppercase" }}>Produtos do combo</div>
            <div style={{ border: "1px solid " + T.line, borderRadius: 10, maxHeight: 220, overflowY: "auto" }}>
              {produtos.map((p, i) => (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i ? "1px solid " + T.line : "none", cursor: "pointer", background: f.itens.includes(p.id) ? T.goldSoft : "transparent" }}>
                  <input type="checkbox" checked={f.itens.includes(p.id)} onChange={() => alternar(p.id)} style={{ accentColor: T.gold, width: 16, height: 16, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: T.text, overflowWrap: "anywhere" }}>{p.nome}{p.interno && <span style={{ color: T.purple, fontSize: 11, marginLeft: 6 }}>(interno)</span>}</span>
                  <span style={{ fontSize: 12, color: T.mut, fontFamily: T.mono, whiteSpace: "nowrap" }}>{precoTxt(p.preco)}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize: 12, color: T.dim, marginTop: 6 }}>
              {escolhidos.length} {escolhidos.length === 1 ? "produto" : "produtos"} · soma {BRL(soma)}{desconto > 0 ? " · desconto de " + desconto + "%" : ""}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <Field label={combo ? "Preço do combo (R$)" : "Preço (R$)"} hint={preco == null ? (f.preco ? "Valor não reconhecido." : "0 = grátis.") : "= " + precoTxt(preco)}>
            <Input value={f.preco} onChange={e => set("preco", e.target.value)} placeholder="497,00" inputMode="decimal" mono />
          </Field>
          <Field label="Link de compra" hint="Opcional. Hotmart, Kiwify, WhatsApp…">
            <Input value={f.link} onChange={e => set("link", e.target.value)} placeholder="https://" maxLength={500} />
          </Field>
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", background: f.interno ? T.purple + "14" : T.inset, border: "1px solid " + (f.interno ? T.purple + "66" : T.line), borderRadius: 10, padding: "11px 13px" }}>
          <input type="checkbox" checked={f.interno} onChange={e => set("interno", e.target.checked)} style={{ accentColor: T.purple, width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
          <span>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: f.interno ? T.purple : T.text }}>Item interno</span>
            <span style={{ display: "block", fontSize: 12, color: T.mut, lineHeight: 1.5, marginTop: 2 }}>Não aparece na vitrine dos clientes, só a equipe vê. Chega a quem você quiser pelo link (oferta para alunos específicos, prêmio de sorteio) — o link abre mesmo sem login.</span>
          </span>
        </label>

        {internoNoPublico && <Banner tone="gold">Este combo é público e inclui item interno: o nome e o preço desse item ficarão visíveis para os clientes dentro do combo.</Banner>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={busy || imgBusy}>{busy ? "Salvando..." : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Secao({ titulo, desc, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{titulo}</div>
        {desc && <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}>{desc}</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 290px), 1fr))", gap: 14 }}>{children}</div>
    </div>
  );
}

export default function ProdutosScreen() {
  const [data, setData] = useState(null);
  const [erro, setErro] = useState(null);
  const [form, setForm] = useState(null);       // { tipo, item }
  const [copiado, setCopiado] = useState(null); // id do item cujo link acabou de ser copiado
  const [aviso, setAviso] = useState(null);

  const carregar = async () => {
    try { setData(await api.get("/api/produtos")); setErro(null); }
    catch (e) { setErro(e.message); }
  };
  useEffect(() => { carregar(); }, []);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 3500); return () => clearTimeout(t); }, [aviso]);

  const enviar = async (body) => { const j = await api.post("/api/produtos", body); setData(j); return j; };
  const salvar = (tipo) => async (item) => {
    await enviar({ acao: "salvar", tipo, item });
    setForm(null);
    setAviso(item.id ? "Alterações salvas." : (tipo === "combo" ? "Combo criado." : "Produto criado.") + (item.interno ? " É interno: use “Copiar link” para enviar." : ""));
  };
  const copiarLink = async (it) => { await copiar(linkDaOferta(it.token)); setCopiado(it.id); setTimeout(() => setCopiado(c => c === it.id ? null : c), 2000); };
  const novoLink = async (tipo, it) => {
    const ok = await confirmDialog({ title: "Gerar um novo link?", message: "O link atual de “" + it.nome + "” deixa de funcionar. Quem já recebeu precisará do novo.", confirmLabel: "Gerar novo link" });
    if (!ok) return;
    try { await enviar({ acao: "novoLink", tipo, id: it.id }); setAviso("Novo link gerado — o anterior parou de funcionar."); }
    catch (e) { setErro(e.message); }
  };
  const excluir = async (tipo, it) => {
    const ok = await confirmDialog({ title: "Excluir " + (tipo === "combo" ? "combo" : "produto") + "?", message: "“" + it.nome + "” sai da vitrine e o link dele para de funcionar.", danger: true });
    if (!ok) return;
    try { await enviar({ acao: "excluir", tipo, id: it.id }); setErro(null); setAviso("Excluído."); }
    catch (e) { setErro(e.message); }
  };

  if (!data && !erro) return <div className="fh-page"><Loading label="Carregando produtos..." /></div>;

  const staff = !!(data && data.staff);
  const produtos = (data && data.produtos) || [];
  const combos = (data && data.combos) || [];
  const vazio = !produtos.length && !combos.length;
  const card = (tipo) => (it) => (
    <ItemCard key={it.id} item={it} combo={tipo === "combo"} staff={staff} copiado={copiado === it.id}
      onEditar={() => setForm({ tipo, item: it })} onCopiar={() => copiarLink(it)}
      onNovoLink={() => novoLink(tipo, it)} onExcluir={() => excluir(tipo, it)} />
  );

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: T.mut, maxWidth: 640, lineHeight: 1.55 }}>
          {staff
            ? <>O que está aqui aparece na vitrine dos clientes, exceto os itens <b style={{ color: T.purple }}>internos</b> — esses só a equipe vê e chegam ao cliente pelo link.</>
            : "Conheça os produtos e as promoções do Victor."}
        </div>
        {staff && (
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" onClick={() => setForm({ tipo: "produto", item: null })}>+ Produto</Button>
            <Button size="sm" variant="gold" onClick={() => setForm({ tipo: "combo", item: null })} disabled={!produtos.length} title={produtos.length ? "" : "Cadastre um produto primeiro"}>+ Combo</Button>
          </div>
        )}
      </div>

      {erro && <Banner tone="red">{erro}</Banner>}
      {aviso && <Banner tone="green">{aviso}</Banner>}

      {data && vazio && (
        <Card>
          <EmptyState icon={<Icon name="produtos" size={40} color={T.dim} />}
            title={staff ? "Nenhum produto cadastrado" : "Nenhum produto disponível no momento"}
            desc={staff ? "Cadastre o primeiro produto. Depois dá para juntar produtos em combos promocionais." : "Volte em breve para conferir as novidades."}>
            {staff && <Button onClick={() => setForm({ tipo: "produto", item: null })}>+ Cadastrar produto</Button>}
          </EmptyState>
        </Card>
      )}

      {combos.length > 0 && <Secao titulo="Combos e promoções" desc="Produtos juntos por um preço especial.">{combos.map(card("combo"))}</Secao>}
      {produtos.length > 0 && <Secao titulo="Produtos">{produtos.map(card("produto"))}</Secao>}

      {form && (
        <ItemForm tipo={form.tipo} item={form.item} produtos={produtos}
          onClose={() => setForm(null)} onSalvar={salvar(form.tipo)} />
      )}
    </div>
  );
}

// ─── Página pública da oferta (/?oferta=<token>) ──────────────────────────────
export function OfertaPublica({ token }) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const r = await fetch("/api/produtos?link=" + encodeURIComponent(token));
        const j = await r.json().catch(() => ({}));
        if (on) setSt(r.ok && j.item ? { item: j.item } : { erro: j.error || "Oferta não encontrada." });
      } catch (e) { if (on) setSt({ erro: "Não foi possível carregar a oferta agora. Tente de novo em instantes." }); }
    })();
    return () => { on = false; };
  }, [token]);

  const it = st.item;
  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 16px", gap: 24 }}>
      <div className="fh-logo-full"><Logo size={20} /></div>
      <div style={{ width: 620, maxWidth: "100%" }}>
        {st.loading ? <Loading label="Carregando oferta..." />
          : st.erro ? (
            <Card><EmptyState icon="🔗" title="Oferta indisponível" desc={st.erro} /></Card>
          ) : (
            <Card style={{ padding: 24, borderColor: T.lineGold }}>
              <div style={{ fontSize: 11, color: T.gold, letterSpacing: 1, fontWeight: 800, marginBottom: 14 }}>{it.tipo === "combo" ? "OFERTA ESPECIAL · COMBO" : "OFERTA ESPECIAL"}</div>
              <ItemCorpo item={it} combo={it.tipo === "combo"} grande />
            </Card>
          )}
      </div>
      <a href="/" style={{ color: T.mut, fontSize: 13, textDecoration: "none" }}>Acessar o FORCEHUB →</a>
    </div>
  );
}
