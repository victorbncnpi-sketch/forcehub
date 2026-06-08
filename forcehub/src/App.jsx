import { useState, useEffect, useRef } from "react";
import { T, GlobalStyle, Logo, Button, Badge, Card, Field, Input, EmptyState, Stat, Banner, Tabs, Modal, Dots, Spinner, Loading, Icon } from "./ui";

// ─── Permissões (espelham api/_auth.js) ──────────────────────────────────────
// Papéis: superadmin (irrestrito) · moderator (gere clientes) · client.
// Capacidades de página: panorama · carteira (ler) · carteira_write · conselheiro.
// Capacidades administrativas derivam do papel. O backend é a fonte de verdade;
// aqui só escondemos o que o usuário não pode acessar.
const CAP_LABELS = {
  panorama: "Panorama de Mercado",
  carteira: "Carteira — ler recomendações",
  carteira_write: "Carteira — criar/editar recomendações",
  conselheiro: "O Conselheiro (IA)",
};
const PAGE_CAPS = ["panorama", "carteira", "carteira_write", "conselheiro"];
const DEFAULT_CLIENT_PERMS = ["panorama", "carteira", "conselheiro"];
const ROLE_LABEL = { superadmin: "Super admin", moderator: "Moderador", client: "Cliente" };

function can(session, cap) {
  if (!session) return false;
  if (session.role === "superadmin") return true;
  if (cap === "manage_clients") return session.role === "moderator";
  if (cap === "manage_staff") return false;
  return Array.isArray(session.perms) && session.perms.includes(cap);
}

// ─── Camada de dados (backend via /api/*) ─────────────────────────────────────
// Autenticação e cadastro de usuários agora ficam no backend (api/auth.js,
// api/users.js). As senhas nunca chegam ao frontend; a sessão é um cookie
// httpOnly e os clientes são gerenciados pelo admin no painel "Clientes".
const api = {
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

// ─── IA via proxy serverless (/api/ai) — a chave fica só no backend ───────────
async function callAI(body) {
  const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("Falha na IA (HTTP " + res.status + ")"));
  return data;
}

async function claudeSearch(prompt) {
  const data = await callAI({
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
  });
  const texts = (data.content || []).filter(b => b.type === "text");
  return texts.map(b => b.text).join("");
}

// Extrai um objeto/array JSON de um texto da IA de forma robusta:
// remove cercas de markdown, ancora numa chave conhecida, faz matching de chaves
// rastreando strings (ignora chaves dentro de aspas) e limpa vírgulas finais.
function extractJSON(text, anchors = []) {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, "");
  let start = -1;
  for (const a of anchors) { const i = t.indexOf(a); if (i >= 0) { start = i; break; } }
  if (start >= 0) { while (start > 0 && t[start] !== "{" && t[start] !== "[") start--; }
  else {
    const cands = [t.indexOf("{"), t.indexOf("[")].filter(x => x >= 0).sort((a, b) => a - b);
    start = cands.length ? cands[0] : -1;
  }
  if (start < 0) return null;
  const open = t[start], close = open === "{" ? "}" : "]";
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  const raw = Array.from(t.slice(start, end))
    .map(c => (c.charCodeAt(0) < 32 ? " " : c))
    .join("")
    .replace(/,\s*([}\]])/g, "$1");
  try { return { value: JSON.parse(raw), raw }; } catch (e) { return null; }
}

// Faz a busca com IA e tenta extrair JSON, com 1 nova tentativa se vier inválido.
async function aiSearchJSON(prompt, anchors, attempts = 2) {
  let lastErr = new Error("A IA não retornou um resultado válido. Tente novamente.");
  for (let i = 0; i < attempts; i++) {
    const text = await claudeSearch(prompt);
    const res = extractJSON(text, anchors);
    if (res) return res.value;
  }
  throw lastErr;
}

// ─── Helpers de agenda / notícias ─────────────────────────────────────────────
const FLAG = { "Brasil": "🇧🇷", "EUA": "🇺🇸", "Zona do Euro": "🇪🇺", "Reino Unido": "🇬🇧", "China": "🇨🇳", "Japão": "🇯🇵", "Canadá": "🇨🇦", "Austrália": "🇦🇺" };
const flagOf = (c) => FLAG[c] || (c === "BR" ? "🇧🇷" : c === "US" ? "🇺🇸" : "🌐");
const bulls = (n) => "🐂".repeat(Math.min(Math.max(n || 1, 1), 3));
const impactColor = (n) => (n >= 3 ? T.red : n >= 2 ? T.gold : T.dim);
const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [user, setUser] = useState(""); const [pass, setPass] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const handle = async () => {
    if (loading) return;
    setLoading(true); setError("");
    try {
      const j = await api.post("/api/auth", { action: "login", user: user.trim().toLowerCase(), pass });
      onLogin(j.user);
    } catch (e) {
      setError(e.message || "Não foi possível entrar. Tente novamente.");
      setLoading(false);
    }
  };
  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 400, maxWidth: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <Logo size={34} />
          <div style={{ fontSize: 13, color: T.gold, letterSpacing: 3, fontWeight: 700 }}>PARA CLIENTES XP</div>
          <div style={{ fontSize: 12, color: T.dim, letterSpacing: 2 }}>DE TRADER PARA TRADER</div>
        </div>
        <Card style={{ width: "100%", padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 13, color: T.mut, letterSpacing: 1, textAlign: "center", textTransform: "uppercase" }}>Acesso à plataforma</div>
          <Field label="Usuário">
            <Input value={user} onChange={e => setUser(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} placeholder="seu usuário" />
          </Field>
          <Field label="Senha">
            <Input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} placeholder="••••••••" />
          </Field>
          {error && <div style={{ fontSize: 13, color: T.red, textAlign: "center" }}>⚠ {error}</div>}
          <Button size="lg" disabled={loading} onClick={handle} style={{ width: "100%", letterSpacing: 1 }}>
            {loading ? "VERIFICANDO..." : "ENTRAR →"}
          </Button>
        </Card>
      </div>
    </div>
  );
}

// ─── Shell com navegação lateral ──────────────────────────────────────────────
const NAV = [
  { key: "panorama",    icon: "panorama",    label: "Panorama",    title: "Panorama de Mercado",   cap: "panorama" },
  { key: "carteira",    icon: "carteira",    label: "Carteira",    title: "Carteira Recomendada",  cap: "carteira" },
  { key: "conselheiro", icon: "conselheiro", label: "Conselheiro", title: "O Conselheiro",         cap: "conselheiro" },
  { key: "clientes",    icon: "users",       label: "Clientes",    title: "Gestão de Clientes",    cap: "manage_clients" },
];

// Primeira página acessível ao usuário (para o destino padrão pós-login).
function firstAllowed(session) {
  const n = NAV.find(n => can(session, n.cap));
  return n ? n.key : "panorama";
}

function Shell({ session, active, onNavigate, onLogout, children }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  const roleLabel = ROLE_LABEL[session?.role] || "Cliente";
  const roleTone = session?.role === "superadmin" ? "gold" : session?.role === "moderator" ? "blue" : null;
  const nav = NAV.filter(n => can(session, n.cap));
  const cur = NAV.find(n => n.key === active);
  return (
    <div className="fh-shell">
      <aside className="fh-side">
        <div style={{ padding: "18px 16px", borderBottom: "1px solid " + T.line }}><Logo size={17} /></div>
        <nav style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {nav.map(n => (
            <div key={n.key} className={"fh-navitem" + (active === n.key ? " active" : "")} onClick={() => onNavigate(n.key)}
              role="button" tabIndex={0} aria-current={active === n.key} title={n.label}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(n.key); } }}>
              <Icon name={n.icon} size={19} />
              <span className="fh-nav-label" style={{ fontSize: 14, fontWeight: 600 }}>{n.label}</span>
            </div>
          ))}
        </nav>
        <div style={{ padding: 14, borderTop: "1px solid " + T.line }}>
          <div className="fh-side-detail" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{session?.name}</div>
            {roleTone
              ? <Badge tone={roleTone} style={{ marginTop: 6 }}>● {roleLabel.toUpperCase()}</Badge>
              : session?.expiry && <div style={{ fontSize: 11, color: T.dim, marginTop: 4 }}>acesso até {new Date(session.expiry).toLocaleDateString("pt-BR")}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout} style={{ width: "100%" }}>Sair</Button>
        </div>
      </aside>
      <div className="fh-main">
        <header style={{ height: 57, flexShrink: 0, borderBottom: "1px solid " + T.line, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text, letterSpacing: 0.2 }}>{cur?.title}</div>
          <span style={{ fontSize: 13, color: T.dim, fontFamily: T.mono }}>{time.toLocaleTimeString("pt-BR")}</span>
        </header>
        <div className="fh-body">{children}</div>
      </div>
    </div>
  );
}

// ─── Painel de Agenda econômica (com filtros e agrupamento) ───────────────────
function AgendaPanel({ events, loading }) {
  const [excluded, setExcluded] = useState([]);
  const [impacts, setImpacts] = useState({ 3: true, 2: true, 1: true });
  const [grouped, setGrouped] = useState(false);
  const countriesAll = Array.from(new Set(events.map(e => e.country)));
  const toggleCountry = (c) => setExcluded(x => x.includes(c) ? x.filter(v => v !== c) : [...x, c]);
  const toggleImpact = (k) => setImpacts(m => ({ ...m, [k]: !m[k] }));
  const filtered = events.filter(e => impacts[e.impact] && !excluded.includes(e.country));

  const COLS = "52px 32px 1fr 70px 70px 70px";
  const chipStyle = (active, tone = T.gold) => ({ fontSize: 12, padding: "5px 10px", borderRadius: 8, border: "1px solid " + (active ? tone + "66" : T.line), background: active ? tone + "1a" : "transparent", color: active ? tone : T.mut });

  const renderRow = (n, i) => (
    <div key={i} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, alignItems: "center", padding: "10px 12px", background: T.inset, border: "1px solid " + T.line, borderLeft: "3px solid " + impactColor(n.impact), borderRadius: 10 }}>
      <div style={{ fontSize: 13, color: T.gold, fontWeight: 700, fontFamily: T.mono }}>{n.time || "—"}</div>
      <div style={{ fontSize: 19, textAlign: "center" }} title={n.country}>{flagOf(n.country)}</div>
      <div>
        <div style={{ fontSize: 13, color: T.text }}>{n.title}</div>
        <div style={{ fontSize: 10, marginTop: 2, color: impactColor(n.impact) }}>{bulls(n.impact)}</div>
      </div>
      <div style={{ textAlign: "right", fontSize: 12, color: T.mut, fontFamily: T.mono }}>{n.previous || "—"}</div>
      <div style={{ textAlign: "right", fontSize: 12, color: T.gold, fontFamily: T.mono }}>{n.forecast || "—"}</div>
      <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: n.actual ? T.green : T.dim, fontFamily: T.mono }}>{n.actual || "—"}</div>
    </div>
  );

  return (
    <Card style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid " + T.line, background: T.panel2 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Agenda econômica — hoje</div>
        <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}>{filtered.length} de {events.length} eventos · impacto 🐂 a 🐂🐂🐂</div>
      </div>

      {events.length > 0 && (
        <div style={{ padding: "12px 14px", borderBottom: "1px solid " + T.line, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {countriesAll.map(c => (
              <button key={c} className="fh-btn" onClick={() => toggleCountry(c)} style={chipStyle(!excluded.includes(c))}>{flagOf(c)} {c}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[3, 2, 1].map(k => (
                <button key={k} className="fh-btn" onClick={() => toggleImpact(k)} style={chipStyle(impacts[k], impactColor(k))}>{bulls(k)}</button>
              ))}
            </div>
            <button className="fh-btn" onClick={() => setGrouped(g => !g)} style={chipStyle(grouped)}>⊞ Agrupar por país</button>
          </div>
        </div>
      )}

      {loading ? <Loading label="Carregando agenda..." />
        : filtered.length === 0 ? <div style={{ padding: 20, textAlign: "center", fontSize: 14, color: T.dim }}>Nenhum evento com os filtros atuais.</div>
        : (
          <div className="fh-scroll-x" style={{ padding: 12 }}>
            <div style={{ minWidth: 460, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "0 12px" }}>
                {["HORA", "PAÍS", "EVENTO", "ANT.", "PREV.", "ATUAL"].map((h, k) => <div key={h} style={{ fontSize: 10, color: T.dim, letterSpacing: 0.4, textAlign: k > 2 ? "right" : "left" }}>{h}</div>)}
              </div>
              {grouped
                ? countriesAll.filter(c => !excluded.includes(c)).map(c => {
                    const evs = filtered.filter(e => e.country === c);
                    if (!evs.length) return null;
                    return (
                      <div key={c} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", marginTop: 4 }}>
                          <span style={{ fontSize: 18 }}>{flagOf(c)}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{c}</span>
                          <span style={{ fontSize: 11, color: T.dim }}>· {evs.length}</span>
                        </div>
                        {evs.map((n, i) => renderRow(n, c + i))}
                      </div>
                    );
                  })
                : filtered.map((n, i) => renderRow(n, i))}
            </div>
          </div>
        )}
    </Card>
  );
}

// ─── Painel de Notícias (resumo + manchetes) ──────────────────────────────────
function NewsPanel({ news, loading, error, refreshing, onRefresh }) {
  return (
    <Card style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderBottom: "1px solid " + T.line, background: T.panel2, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text, display: "flex", alignItems: "center", gap: 8 }}><Icon name="news" size={16} /> Mercado hoje</div>
          <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}>Resumo &amp; manchetes{news?.generatedAt ? " · " + fmtTime(news.generatedAt) : ""}</div>
        </div>
        <Button variant="gold" size="sm" onClick={onRefresh} disabled={refreshing}>{refreshing ? "⟳ Atualizando..." : "↻ Atualizar"}</Button>
      </div>

      {loading && <div style={{ padding: 24, display: "flex", justifyContent: "center" }}><Spinner /></div>}
      {error && <div style={{ padding: "14px 18px" }}><Banner tone="red">{error}</Banner></div>}

      {news?.summary && (
        <div style={{ padding: "14px 18px", borderBottom: news?.headlines?.length ? "1px solid " + T.line : "none", fontSize: 14, color: T.text, lineHeight: 1.6 }}>{news.summary}</div>
      )}
      {news?.headlines?.length > 0 && (
        <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
          {news.headlines.map((h, i) => {
            const inner = (<><span style={{ color: T.gold, marginRight: 8 }}>›</span><span style={{ color: T.text }}>{h.title}</span>{h.source && <span style={{ color: T.dim, marginLeft: 8, fontSize: 12 }}>· {h.source}</span>}</>);
            return h.url
              ? <a key={i} href={h.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, lineHeight: 1.7, textDecoration: "none", display: "block" }}>{inner}</a>
              : <div key={i} style={{ fontSize: 14, lineHeight: 1.7 }}>{inner}</div>;
          })}
        </div>
      )}
      {news && !news.summary && (!news.headlines || news.headlines.length === 0) && !loading && !error && (
        <div style={{ padding: 20, textAlign: "center", fontSize: 14, color: T.dim }}>Sem manchetes no momento.</div>
      )}
    </Card>
  );
}

// ─── Panorama de Mercado ────────────────────────────────────────────────────────
function PanoramaScreen() {
  const TICKERS = ["WIN", "WDO", "IBOV"];
  const LABELS = { WIN: "Mini Índice", WDO: "Mini Dólar", IBOV: "Ibovespa" };
  const toISO = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x.toISOString().split("T")[0]; };
  const ddmm = (iso) => { const p = String(iso).split("-"); return p.length === 3 ? p[2] + "/" + p[1] : iso; };
  const bizDays = (n) => { const out = []; const d = new Date(); d.setHours(12, 0, 0, 0); while (out.length < n) { const wd = d.getDay(); if (wd >= 1 && wd <= 5) out.unshift(toISO(d)); d.setDate(d.getDate() - 1); } return out; };
  const empty = () => bizDays(5).map(iso => ({ date: iso, label: ddmm(iso), high: "", low: "" }));
  const todayISO = toISO(new Date());
  const [rows, setRows] = useState({ WIN: empty(), WDO: empty(), IBOV: empty() });
  const [news, setNews] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [marketLoaded, setMarketLoaded] = useState(false);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [manualTickers, setManualTickers] = useState([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Pede 10 pregões e usa os últimos 5: garante 5 dias úteis mesmo com feriado na janela.
        const r = await fetch("/api/market-data?days=10");
        if (!r.ok) return;
        const j = await r.json();
        if (!active || !j.ok || !j.data) return;
        let any = false;
        const manual = [];
        setRows(prev => {
          const next = { ...prev };
          TICKERS.forEach(tk => {
            const fmtIn = (v) => v == null ? "" : (tk === "WDO" ? Number(v).toFixed(1) : String(Math.round(Number(v))));
            const bars = (j.data[tk] || []).slice(-5);
            if (bars.length) {
              any = true;
              next[tk] = bars.map(e => ({ date: e.date, label: ddmm(e.date), high: fmtIn(e.high), low: fmtIn(e.low) }));
            } else {
              manual.push(tk);
            }
          });
          return next;
        });
        if (any) setMarketLoaded(true);
        setManualTickers(manual);
      } catch (e) { /* mantém entrada manual */ }
      finally { if (active) setLoadingMarket(false); }
    })();
    return () => { active = false; };
  }, []);

  const setCell = (ticker, i, field, val) => setRows(prev => {
    const r = prev[ticker].map((row, j) => j === i ? { ...row, [field]: val } : row);
    return { ...prev, [ticker]: r };
  });
  const getAmp = (row) => {
    const h = parseFloat(String(row.high).replace(",", ".")), l = parseFloat(String(row.low).replace(",", "."));
    if (isNaN(h) || isNaN(l) || (!h && !l)) return null;
    return Math.abs(h - l);
  };
  const getAvg = (ticker) => {
    const amps = rows[ticker].map(r => getAmp(r)).filter(v => v != null && v > 0);
    if (!amps.length) return null;
    return amps.reduce((a, b) => a + b, 0) / amps.length;
  };
  const fmtV = (ticker, v) => {
    const n = parseFloat(String(v).replace(",", "."));
    if (!n || isNaN(n)) return "—";
    return ticker === "WDO" ? n.toFixed(1) : Math.round(n).toLocaleString("pt-BR");
  };
  const ampColor = (amp, avg) => {
    if (!avg || !amp) return T.gold;
    const r = amp / avg;
    return r >= 1.15 ? T.green : r <= 0.85 ? T.red : T.gold;
  };
  const loadNews = async (force) => {
    setNewsLoading(true); setNewsError(null);
    try {
      const j = await api.get("/api/news" + (force ? "?refresh=1" : ""));
      setNews({ summary: j.summary || "", events: Array.isArray(j.events) ? j.events : [], headlines: Array.isArray(j.headlines) ? j.headlines : [], generatedAt: j.generatedAt, stale: j.stale });
      if (j.ok === false && (!j.events || j.events.length === 0)) setNewsError(j.error || "Não foi possível carregar os eventos agora.");
    } catch (e) { setNewsError(e.message); }
    setNewsLoading(false);
  };
  // Carrega a agenda automaticamente ao abrir o Panorama (cache compartilhado no backend).
  useEffect(() => { loadNews(false); }, []);

  const cInput = (color) => ({ textAlign: "center", padding: "6px 4px", fontSize: 12, color, borderColor: color + "44" });

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 13, color: T.mut }}>Máxima · mínima · amplitude da semana — preenchido automaticamente e editável.</div>
        {loadingMarket
          ? <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.mut }}><Spinner size={14} /> Carregando cotações...</span>
          : marketLoaded ? <Badge tone="green">● DADOS DO MERCADO</Badge> : <Badge tone="mut">○ ENTRADA MANUAL</Badge>}
      </div>
      {!loadingMarket && manualTickers.length > 0 && (
        <div style={{ fontSize: 11, color: T.dim, marginTop: -8 }}>
          ⓘ Sem cotação automática para {manualTickers.join(", ")} — preencha manualmente.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 14 }}>
        {TICKERS.map(ticker => {
          const avg = getAvg(ticker);
          return (
            <Card key={ticker} style={{ overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid " + T.line, background: T.panel2 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: T.gold, fontFamily: T.mono }}>{ticker}</span>
                <span style={{ fontSize: 12, color: T.mut }}>{LABELS[ticker]}</span>
                <div style={{ marginLeft: "auto", textAlign: "right", lineHeight: 1.1 }}>
                  <div style={{ fontSize: 9, color: T.dim, letterSpacing: 0.5 }}>AMPL. MÉDIA</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: T.gold, fontFamily: T.mono }}>{avg != null ? fmtV(ticker, avg) : "—"}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "48px 1fr 1fr 62px", gap: 8, padding: "6px 12px", borderBottom: "1px solid " + T.line }}>
                {["DATA", "MÁX", "MÍN", "AMPL"].map((h, k) => <div key={h} style={{ fontSize: 10, color: T.dim, letterSpacing: 0.4, textAlign: k === 3 ? "right" : "left" }}>{h}</div>)}
              </div>
              {rows[ticker].map((row, i) => {
                const amp = getAmp(row);
                const ac = ampColor(amp, avg);
                const isToday = row.date === todayISO;
                return (
                  <div key={row.date || i} style={{ display: "grid", gridTemplateColumns: "48px 1fr 1fr 62px", alignItems: "center", gap: 8, padding: "5px 12px", borderBottom: i < rows[ticker].length - 1 ? "1px solid " + T.line : "none", background: isToday ? T.goldSoft : "transparent" }}>
                    <span style={{ fontSize: 12, color: isToday ? T.gold : T.mut, fontWeight: isToday ? 700 : 400, fontFamily: T.mono }}>{row.label}</span>
                    <Input mono value={row.high} onChange={e => setCell(ticker, i, "high", e.target.value)} placeholder={ticker === "WDO" ? "0.0" : "000000"} style={cInput(T.blue)} />
                    <Input mono value={row.low} onChange={e => setCell(ticker, i, "low", e.target.value)} placeholder={ticker === "WDO" ? "0.0" : "000000"} style={cInput(T.purple)} />
                    <div style={{ textAlign: "right", fontFamily: T.mono }}>
                      {amp != null ? <span style={{ fontSize: 13, fontWeight: 700, color: ac }}>{fmtV(ticker, amp)}</span> : <span style={{ color: T.dim }}>—</span>}
                    </div>
                  </div>
                );
              })}
            </Card>
          );
        })}
      </div>

      {/* Indicadores (agenda) + Notícias em duas colunas */}
      <div className="fh-news-grid">
        <AgendaPanel events={news?.events || []} loading={newsLoading && !news} />
        <NewsPanel news={news} loading={newsLoading && !news} error={newsError} refreshing={newsLoading} onRefresh={() => loadNews(true)} />
      </div>
    </div>
  );
}

// ─── Linha de posição ───────────────────────────────────────────────────────────
// Direção de uma recomendação/posição. Compat: se não houver campo `direcao`,
// deduz por alvo vs entrada (alvo abaixo da entrada = venda/short).
const tradeDir = (x) => (x.direcao === "VENDA" || (x.direcao == null && Number(x.alvo) < Number(x.entrada))) ? "VENDA" : "COMPRA";
const tradePot = (x) => { const r = ((x.alvo - x.entrada) / x.entrada) * 100; return tradeDir(x) === "VENDA" ? -r : r; };   // ganho até o alvo (%)
const tradeRisco = (x) => { const r = ((x.stop - x.entrada) / x.entrada) * 100; return tradeDir(x) === "VENDA" ? -r : r; }; // risco até o stop (%) — negativo
const closePct = (p, saida) => { const r = ((saida - p.entrada) / p.entrada) * 100; return tradeDir(p) === "VENDA" ? -r : r; };

function PosicaoRow({ p, onFechar }) {
  const [saida, setSaida] = useState("");
  const isAberta = p.status === "ABERTA";
  const venda = tradeDir(p) === "VENDA";
  const pct = p.precoSaida != null ? closePct(p, p.precoSaida).toFixed(2) : null;
  const pctColor = pct == null ? T.dim : parseFloat(pct) >= 0 ? T.green : T.red;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "84px 1fr 90px 90px 90px 90px 80px 190px", gap: 8, padding: "11px 16px", borderBottom: "1px solid " + T.line, alignItems: "center", fontFamily: T.mono }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.gold }}>{p.ticker}</div>
        <div style={{ fontSize: 10, color: venda ? T.red : T.green, fontWeight: 700 }}>{venda ? "▼ VENDA" : "▲ COMPRA"}</div>
        <div style={{ fontSize: 11, color: T.dim }}>{p.dataEntrada}</div>
      </div>
      <div style={{ fontSize: 13, color: T.mut, fontFamily: T.sans }}>{p.nome || "—"}</div>
      <div style={{ fontSize: 13, color: T.text }}>R$ {p.entrada.toFixed(2)}</div>
      <div style={{ fontSize: 13, color: T.green }}>R$ {p.alvo.toFixed(2)}</div>
      <div style={{ fontSize: 13, color: T.red }}>R$ {p.stop.toFixed(2)}</div>
      <div style={{ fontSize: 13, color: p.precoSaida ? T.gold : T.dim }}>{p.precoSaida ? "R$ " + p.precoSaida.toFixed(2) : "—"}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: pctColor }}>{pct == null ? "—" : (parseFloat(pct) >= 0 ? "+" : "") + pct + "%"}</div>
      <div>
        {isAberta ? (
          <div style={{ display: "flex", gap: 6 }}>
            <Input mono type="number" step="0.01" value={saida} onChange={e => setSaida(e.target.value)} placeholder="Saída R$" style={{ padding: "7px 9px", fontSize: 13 }} />
            <Button variant="danger" size="sm" onClick={() => { const v = parseFloat(saida); if (v) onFechar(p.posId, v); }}>Fechar</Button>
          </div>
        ) : (
          <Badge tone="mut">✓ {p.dataSaida}</Badge>
        )}
      </div>
    </div>
  );
}

// Redimensiona uma imagem no navegador (mantém proporção) e retorna um data URL
// JPEG comprimido — evita estourar o limite de payload do banco.
async function resizeImage(file, maxDim = 1280, quality = 0.78) {
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataUrl; });
  let { width, height } = img;
  if (Math.max(width, height) > maxDim) { const s = maxDim / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
  const c = document.createElement("canvas"); c.width = width; c.height = height;
  c.getContext("2d").drawImage(img, 0, 0, width, height);
  return c.toDataURL("image/jpeg", quality);
}

// Imagem (print do gráfico) de uma recomendação — carregada sob demanda.
function RecImage({ id, onOpen }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let on = true;
    (async () => { try { const j = await api.get("/api/carteira?img=" + encodeURIComponent(id)); if (on && j.image) setSrc(j.image); } catch (e) {} })();
    return () => { on = false; };
  }, [id]);
  if (!src) return null;
  return (
    <div style={{ padding: "0 16px 14px" }}>
      <img src={src} alt="Gráfico" onClick={() => onOpen && onOpen(src)} style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 8, border: "1px solid " + T.line, cursor: "zoom-in", display: "block" }} />
    </div>
  );
}

// Curva de capital: % acumulado dos trades fechados (verde no ganho, vermelho na perda).
function EquityCurve({ positions }) {
  const parse = (d) => { if (!d) return 0; const [dd, mm, yy] = String(d).split("/"); const t = new Date(`${yy}-${mm}-${dd}`).getTime(); return isNaN(t) ? 0 : t; };
  const closed = positions.filter(p => p.resultado != null).sort((a, b) => parse(a.dataSaida) - parse(b.dataSaida));
  let cum = 0;
  const pts = [{ cum: 0 }];
  closed.forEach(p => { cum += p.resultado; pts.push({ cum: +cum.toFixed(2) }); });
  const total = cum;

  if (!closed.length) {
    return (
      <Card style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid " + T.line, background: T.panel2, fontSize: 15, fontWeight: 700, color: T.text }}>Curva de capital</div>
        <div style={{ padding: 28, textAlign: "center", fontSize: 14, color: T.dim }}>A curva aparece quando você fechar a primeira posição.</div>
      </Card>
    );
  }

  const W = 1000, H = 230, padL = 14, padR = 14, padT = 16, padB = 18;
  const vals = pts.map(p => p.cum);
  let minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const m = (maxV - minV) * 0.08; minV -= m; maxV += m;
  const n = pts.length;
  const x = (i) => padL + (n === 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const line = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.cum).toFixed(1)).join(" ");
  const area = "M" + x(0).toFixed(1) + " " + y(0).toFixed(1) + " " + pts.map((p, i) => "L" + x(i).toFixed(1) + " " + y(p.cum).toFixed(1)).join(" ") + " L" + x(n - 1).toFixed(1) + " " + y(0).toFixed(1) + " Z";
  const color = total >= 0 ? T.green : T.red;
  const y0 = y(0);

  return (
    <Card style={{ overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid " + T.line, background: T.panel2, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Curva de capital</div>
        <div style={{ fontSize: 13, color: T.dim }}>{closed.length} trade{closed.length > 1 ? "s" : ""} · acumulado <span style={{ color, fontWeight: 700, fontFamily: T.mono }}>{(total >= 0 ? "+" : "") + total.toFixed(2)}%</span></div>
      </div>
      <div style={{ padding: 12 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
          <defs>
            <linearGradient id="fh-eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1={padL} y1={y0} x2={W - padR} y2={y0} stroke={T.line} strokeWidth="1" strokeDasharray="4 4" />
          <path d={area} fill="url(#fh-eq)" />
          <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(n - 1)} cy={y(pts[n - 1].cum)} r="4" fill={color} />
        </svg>
      </div>
    </Card>
  );
}

// ─── Carteira Recomendada ─────────────────────────────────────────────────────
function CarteiraScreen({ canWrite }) {
  const [acoes, setAcoes] = useState([]);
  const [posicoes, setPosicoes] = useState([]);
  const [aba, setAba] = useState("carteira");
  const [showForm, setShowForm] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [form, setForm] = useState({ ticker: "", nome: "", direcao: "COMPRA", entrada: "", alvo: "", stop: "", qty: "", obs: "", imagem: "" });
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [imgBusy, setImgBusy] = useState(false);
  const recFileRef = useRef(null);
  const idRef = useRef(1);

  const pickRecImage = async (file) => {
    if (!file) return;
    setImgBusy(true);
    try { const d = await resizeImage(file); setForm(p => ({ ...p, imagem: d })); }
    catch (e) { /* ignora arquivo inválido */ }
    finally { setImgBusy(false); if (recFileRef.current) recFileRef.current.value = ""; }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const j = await api.get("/api/carteira");
        if (!active) return;
        setAcoes(j.recomendacoes || []);
        setPosicoes(j.posicoes || []);
        const ids = [...(j.recomendacoes || []), ...(j.posicoes || [])].flatMap(x => [x.id || 0, x.posId || 0]);
        idRef.current = Math.max(0, ...ids) + 1;
      } catch (e) { if (active) setLoadError(e.message); }
      finally { if (active) setLoaded(true); }
    })();
    return () => { active = false; };
  }, []);

  const saveCarteira = async (recs, poss) => {
    try { await api.post("/api/carteira", { recomendacoes: recs, posicoes: poss }); }
    catch (e) { setLoadError("Falha ao salvar: " + e.message); }
  };

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const calcRR = (e, a, s) => {
    const ev = parseFloat(e), av = parseFloat(a), sv = parseFloat(s);
    if (!ev || !av || !sv || isNaN(ev) || isNaN(av) || isNaN(sv)) return null;
    return Math.abs((av - ev) / (ev - sv));
  };
  const addAcao = async () => {
    const e = parseFloat(form.entrada), a = parseFloat(form.alvo), s = parseFloat(form.stop);
    if (!form.ticker || !e || !a || !s) return;
    const id = idRef.current++;
    const nova = { id, ticker: form.ticker.toUpperCase(), nome: form.nome, direcao: form.direcao, entrada: e, alvo: a, stop: s, qty: parseInt(form.qty) || 1, obs: form.obs, addedAt: new Date().toLocaleDateString("pt-BR"), ai: false, hasImage: !!form.imagem };
    if (form.imagem) { try { await api.post("/api/carteira?img=" + id, { data: form.imagem }); } catch (err) { nova.hasImage = false; setLoadError("Falha ao salvar a imagem: " + err.message); } }
    const next = [...acoes, nova];
    setAcoes(next); saveCarteira(next, posicoes);
    setForm({ ticker: "", nome: "", direcao: "COMPRA", entrada: "", alvo: "", stop: "", qty: "", obs: "", imagem: "" });
    setShowForm(false);
  };
  const removeAcao = (id) => {
    const alvo = acoes.find(x => x.id === id);
    const next = acoes.filter(x => x.id !== id);
    setAcoes(next); saveCarteira(next, posicoes);
    if (alvo && alvo.hasImage) { api.post("/api/carteira?img=" + id, { data: null }).catch(() => {}); }
  };
  const addFromScan = (op) => {
    const nova = { id: idRef.current++, ticker: op.ticker, nome: op.nome, direcao: tradeDir(op), entrada: op.entrada, alvo: op.alvo, stop: op.stop, qty: 1, obs: op.setup + " | " + op.racional, addedAt: new Date().toLocaleDateString("pt-BR"), ai: true };
    const nextAcoes = [...acoes, nova];
    const nextPos = [...posicoes, { ...nova, posId: idRef.current++, status: "ABERTA", dataEntrada: new Date().toLocaleDateString("pt-BR"), resultado: null, precoSaida: null }];
    setAcoes(nextAcoes); setPosicoes(nextPos); saveCarteira(nextAcoes, nextPos);
    setAba("posicoes");
  };
  const fecharPosicao = (posId, precoSaida) => {
    const nextPos = posicoes.map(p => {
      if (p.posId !== posId) return p;
      const pct = closePct(p, precoSaida); // direção-aware (short inverte o sinal)
      return { ...p, status: "FECHADA", precoSaida, dataSaida: new Date().toLocaleDateString("pt-BR"), resultado: parseFloat(pct.toFixed(2)) };
    });
    setPosicoes(nextPos); saveCarteira(acoes, nextPos);
  };
  const scan = async () => {
    setScanning(true); setScanError(null); setScanResult(null);
    try {
      const today = new Date().toLocaleDateString("pt-BR");
      const prompt = "Voce e analista tecnico B3 swing trade. Hoje: " + today + ". Use web_search: melhores oportunidades tecnicas de swing trade na B3 hoje, tanto de COMPRA quanto de VENDA (short). RESPONDA EM PORTUGUES. Inclua oportunidades nos DOIS sentidos quando houver. Em cada item, 'direcao' = 'COMPRA' ou 'VENDA'. Para COMPRA: alvo ACIMA da entrada e stop ABAIXO. Para VENDA: alvo ABAIXO da entrada e stop ACIMA. Retorne APENAS JSON valido sem texto extra: {\"data\":\"" + today + "\",\"contexto\":\"resumo do mercado\",\"oportunidades\":[{\"ticker\":\"PETR4\",\"nome\":\"Petrobras PN\",\"direcao\":\"COMPRA\",\"entrada\":38.50,\"alvo\":40.50,\"stop\":37.20,\"setup\":\"Rompimento\",\"racional\":\"Análise\",\"prazo\":\"2-3 dias\"},{\"ticker\":\"VALE3\",\"nome\":\"Vale ON\",\"direcao\":\"VENDA\",\"entrada\":60.00,\"alvo\":57.00,\"stop\":61.50,\"setup\":\"Perda de suporte\",\"racional\":\"Análise\",\"prazo\":\"2-4 dias\"}]}";
      const parsed = await aiSearchJSON(prompt, ['"oportunidades"', '"oportunidade"', '"opportunities"']);
      const ops = parsed.oportunidades || parsed.oportunidade || parsed.opportunities || [];
      if (!ops.length) throw new Error("Nenhuma oportunidade encontrada. Tente novamente.");
      setScanResult({ data: parsed.data || today, contexto: parsed.contexto || "", oportunidades: ops });
    } catch (e) { setScanError(e.message); }
    setScanning(false);
  };
  const rrColor = (r) => r >= 3 ? T.green : r >= 2 ? "#86efac" : r >= 1 ? T.gold : T.red;
  const abertas = posicoes.filter(p => p.status === "ABERTA").length;
  const fechadas = posicoes.filter(p => p.resultado != null);
  const acumulado = fechadas.reduce((s, p) => s + p.resultado, 0);
  const resultadoTotal = fechadas.length ? (acumulado / fechadas.length) : 0;

  const tabLabel = (icon, text) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={icon} size={15} /> {text}</span>;
  // Recomendações são visíveis a quem tem leitura (cap "carteira"); os controles
  // de criar/buscar/excluir abaixo é que exigem "carteira_write".
  const tabs = [
    { key: "carteira", label: tabLabel("list", "Recomendações") },
    { key: "posicoes", label: tabLabel("positions", "Posições (" + abertas + ")") },
  ];

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <Tabs items={tabs} value={aba} onChange={setAba} />
        {canWrite && (
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="success" size="sm" onClick={scan} disabled={scanning}>{scanning ? "⟳ Buscando..." : <><Icon name="search" size={14} /> Buscar com IA</>}</Button>
            <Button size="sm" onClick={() => setShowForm(true)}>+ Nova recomendação</Button>
          </div>
        )}
      </div>

      {loadError && <Banner tone="gold">Persistência indisponível ({loadError}). Configure o banco (UPSTASH_REDIS_REST_URL/TOKEN) para salvar a carteira.</Banner>}

      {!loaded && <Loading label="Carregando carteira..." />}

      {loaded && aba === "carteira" && (
        <>
          {scanError && <Banner tone="red">{scanError}</Banner>}
          {scanResult && (
            <Card style={{ overflow: "hidden", borderColor: T.green + "55" }}>
              <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid " + T.line, background: "#0c1f0c" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.green, display: "flex", alignItems: "center", gap: 7 }}><Icon name="search" size={15} /> Oportunidades — {scanResult.data}</div>
                  {scanResult.contexto && <div style={{ fontSize: 13, color: T.mut, marginTop: 4 }}>{scanResult.contexto}</div>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setScanResult(null)}>×</Button>
              </div>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                {(scanResult.oportunidades || []).map((op, i) => {
                  const venda = tradeDir(op) === "VENDA";
                  const rr = op.entrada && op.stop ? Math.abs((op.alvo - op.entrada) / (op.entrada - op.stop)) : 0;
                  const pot = op.entrada ? tradePot(op).toFixed(1) : "0";
                  return (
                    <div key={i} style={{ background: T.inset, border: "1px solid " + T.line, borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 18, fontWeight: 800, color: T.gold, fontFamily: T.mono }}>{op.ticker}</span>
                          <span style={{ fontSize: 13, color: T.mut }}>{op.nome}</span>
                          <Badge tone={venda ? "red" : "green"}>{venda ? "▼ VENDA" : "▲ COMPRA"}</Badge>
                          {op.prazo && <Badge tone="mut">{op.prazo}</Badge>}
                        </div>
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: T.green, fontFamily: T.mono }}>+{pot}%</span>
                          <span style={{ fontSize: 14, color: rrColor(rr), fontFamily: T.mono }}>R:R 1:{rr.toFixed(1)}</span>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                        {[["ENTRADA", op.entrada ? op.entrada.toFixed(2) : "—", T.text], ["ALVO +" + pot + "%", op.alvo ? op.alvo.toFixed(2) : "—", T.green], ["STOP", op.stop ? op.stop.toFixed(2) : "—", T.red]].map(([l, v, c]) => (
                          <div key={l} style={{ background: T.panel2, borderRadius: 8, padding: "10px 14px", borderLeft: "3px solid " + c }}>
                            <div style={{ fontSize: 11, color: T.dim, marginBottom: 5 }}>{l}</div>
                            <div style={{ fontSize: 17, fontWeight: 700, color: c, fontFamily: T.mono }}>R$ {v}</div>
                          </div>
                        ))}
                      </div>
                      {(op.setup || op.racional) && <div style={{ fontSize: 13, color: T.mut, marginBottom: 12, lineHeight: 1.6 }}><span style={{ color: T.gold }}>📊 {op.setup}</span> — {op.racional}</div>}
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <Button variant="success" size="sm" onClick={() => addFromScan(op)}>✓ Validar e adicionar</Button>
                        <span style={{ fontSize: 12, color: T.dim }}>Analise como CNPI antes de recomendar</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          {acoes.length === 0 && !scanResult && (
            <EmptyState icon={<Icon name="carteira" size={40} color={T.dim} />} title="Nenhuma recomendação ainda" desc={canWrite ? "Crie uma recomendação manualmente ou busque oportunidades com IA." : "O administrador ainda não publicou recomendações."}>
              {canWrite && <>
                <Button variant="success" onClick={scan}><Icon name="search" size={14} /> Buscar com IA</Button>
                <Button onClick={() => setShowForm(true)}>+ Adicionar manualmente</Button>
              </>}
            </EmptyState>
          )}
          {acoes.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
              {acoes.map(a => {
                const venda = tradeDir(a) === "VENDA";
                const rr = Math.abs((a.alvo - a.entrada) / (a.entrada - a.stop));
                const pot = tradePot(a).toFixed(1);
                const sp = tradeRisco(a).toFixed(1);
                return (
                  <Card key={a.id} className="fh-card-hover" style={{ overflow: "hidden" }}>
                    <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: T.panel2, borderBottom: "1px solid " + T.line }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 19, fontWeight: 800, color: T.gold, fontFamily: T.mono }}>{a.ticker}</span>
                        {a.nome && <span style={{ fontSize: 13, color: T.mut }}>{a.nome}</span>}
                        {a.ai && <Badge tone="green">IA</Badge>}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Badge tone={venda ? "red" : "green"}>{venda ? "▼ VENDA" : "▲ COMPRA"}</Badge>
                        {canWrite && <Button variant="ghost" size="sm" onClick={() => removeAcao(a.id)} style={{ padding: "4px 9px" }}>✕</Button>}
                      </div>
                    </div>
                    <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      {[["ENTRADA", "R$ " + a.entrada.toFixed(2), T.text], ["ALVO +" + pot + "%", "R$ " + a.alvo.toFixed(2), T.green], ["STOP " + sp + "%", "R$ " + a.stop.toFixed(2), T.red]].map(([l, v, c]) => (
                        <div key={l} style={{ background: T.inset, borderRadius: 8, padding: "10px 12px", borderLeft: "3px solid " + c }}>
                          <div style={{ fontSize: 11, color: T.dim, marginBottom: 5 }}>{l}</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: c, fontFamily: T.mono }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "0 16px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 12, color: T.dim }}>Risco : Retorno</div>
                        <div style={{ fontSize: 26, fontWeight: 800, color: rrColor(rr), fontFamily: T.mono }}>1:{rr.toFixed(2)}</div>
                      </div>
                      <div style={{ fontSize: 12, color: T.dim, fontFamily: T.mono }}>{a.addedAt}</div>
                    </div>
                    {a.hasImage && <RecImage id={a.id} onOpen={setLightbox} />}
                    {a.obs && <div style={{ padding: "11px 16px", borderTop: "1px solid " + T.line, fontSize: 13, color: T.mut, lineHeight: 1.6 }}>💬 {a.obs}</div>}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {loaded && aba === "posicoes" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <Stat label="Abertas" value={abertas} tone="gold" />
            <Stat label="Fechadas" value={posicoes.filter(p => p.status === "FECHADA").length} tone="mut" />
            <Stat label="Rent. média" value={(resultadoTotal >= 0 ? "+" : "") + resultadoTotal.toFixed(2) + "%"} tone={resultadoTotal >= 0 ? "green" : "red"} />
            <Stat label="Acumulado" value={(acumulado >= 0 ? "+" : "") + acumulado.toFixed(2) + "%"} tone={acumulado >= 0 ? "green" : "red"} />
            <Stat label="Total ops" value={posicoes.length} tone="blue" />
          </div>

          <EquityCurve positions={posicoes} />
          {posicoes.length === 0 ? (
            <EmptyState icon={<Icon name="positions" size={40} color={T.dim} />} title="Nenhuma posição registrada" desc="Valide uma recomendação na aba Recomendações para abrir uma posição." />
          ) : (
            <Card style={{ overflow: "hidden" }}>
              <div className="fh-scroll-x">
                <div style={{ minWidth: 800 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "84px 1fr 90px 90px 90px 90px 80px 190px", gap: 8, padding: "11px 16px", background: T.panel2, borderBottom: "1px solid " + T.line }}>
                    {["TICKER", "EMPRESA", "ENTRADA", "ALVO", "STOP", "SAÍDA", "RENT.%", "FECHAR"].map(h => <div key={h} style={{ fontSize: 11, color: T.dim, letterSpacing: 0.5 }}>{h}</div>)}
                  </div>
                  {posicoes.map(p => <PosicaoRow key={p.posId} p={p} onFechar={fecharPosicao} />)}
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {showForm && (
        <Modal title="Nova ação recomendada" onClose={() => setShowForm(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
              <Field label="Ticker"><Input mono value={form.ticker} onChange={e => setF("ticker", e.target.value.toUpperCase())} placeholder="PETR4" /></Field>
              <Field label="Empresa"><Input value={form.nome} onChange={e => setF("nome", e.target.value)} placeholder="Petrobras PN" /></Field>
            </div>
            <Field label="Direção" hint="Compra: alvo acima da entrada · Venda: alvo abaixo da entrada.">
              <div style={{ display: "flex", gap: 8 }}>
                {[["COMPRA", "▲ Compra", T.green], ["VENDA", "▼ Venda", T.red]].map(([v, l, c]) => {
                  const on = form.direcao === v;
                  return <button key={v} className="fh-btn" onClick={() => setF("direcao", v)} style={{ flex: 1, padding: "9px 12px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "1px solid " + (on ? c + "88" : T.line), background: on ? c + "1a" : "transparent", color: on ? c : T.mut }}>{l}</button>;
                })}
              </div>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[["Entrada (R$)", "entrada", T.text], ["Alvo (R$)", "alvo", T.green], ["Stop (R$)", "stop", T.red]].map(([l, k, c]) => (
                <Field key={k} label={l}><Input mono type="number" step="0.01" value={form[k]} onChange={e => setF(k, e.target.value)} placeholder="0.00" style={{ color: c }} /></Field>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
              <Field label="Qtde"><Input mono type="number" min="1" value={form.qty} onChange={e => setF("qty", e.target.value)} placeholder="100" /></Field>
              <Field label="Tese / Obs"><Input value={form.obs} onChange={e => setF("obs", e.target.value)} placeholder="Rompimento de resistência..." /></Field>
            </div>
            <Field label="Print do gráfico (opcional)" hint="Anexe a screenshot do setup; ela aparece na recomendação para os clientes.">
              <input ref={recFileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={e => pickRecImage(e.target.files && e.target.files[0])} />
              {form.imagem ? (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <img src={form.imagem} alt="Prévia" style={{ maxWidth: 220, maxHeight: 140, borderRadius: 8, border: "1px solid " + T.line }} />
                  <Button variant="ghost" size="sm" onClick={() => setF("imagem", "")}>Remover imagem</Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => recFileRef.current && recFileRef.current.click()} disabled={imgBusy}>
                  <Icon name="attach" size={16} /> {imgBusy ? "Processando..." : "Anexar print"}
                </Button>
              )}
            </Field>
            {calcRR(form.entrada, form.alvo, form.stop) !== null && (
              <div style={{ background: T.inset, border: "1px solid " + T.line, borderRadius: 10, padding: "14px 18px", display: "flex", gap: 28 }}>
                <div><div style={{ fontSize: 12, color: T.dim, marginBottom: 4 }}>R:R</div><div style={{ fontSize: 24, fontWeight: 800, color: rrColor(calcRR(form.entrada, form.alvo, form.stop)), fontFamily: T.mono }}>1:{calcRR(form.entrada, form.alvo, form.stop).toFixed(2)}</div></div>
                <div><div style={{ fontSize: 12, color: T.dim, marginBottom: 4 }}>Potencial</div><div style={{ fontSize: 19, color: T.green, fontFamily: T.mono }}>{(tradePot(form) >= 0 ? "+" : "") + tradePot(form).toFixed(1)}%</div></div>
                <div><div style={{ fontSize: 12, color: T.dim, marginBottom: 4 }}>Risco</div><div style={{ fontSize: 19, color: T.red, fontFamily: T.mono }}>{tradeRisco(form).toFixed(1)}%</div></div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={addAcao}>Adicionar →</Button>
            </div>
          </div>
        </Modal>
      )}

      {lightbox && (
        <Modal title="Gráfico do ativo" onClose={() => setLightbox(null)} width={900}>
          <img src={lightbox} alt="Gráfico" style={{ width: "100%", borderRadius: 8, display: "block" }} />
        </Modal>
      )}
    </div>
  );
}

// ─── O Conselheiro ────────────────────────────────────────────────────────────
function ConselheiroScreen({ userId }) {
  const MARGEM_WIN = 1000; const MARGEM_WDO = 1500;
  const baseUrl = "/api/conselheiro?user=" + encodeURIComponent(userId || "anon");
  const CHAT_W = 820; // largura máxima da coluna do chat (centralizada)
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [perfil, setPerfil] = useState(null);
  const [diario, setDiario] = useState([]);
  const [showDiario, setShowDiario] = useState(false);
  const [pending, setPending] = useState([]); // anexos a enviar na próxima mensagem
  const [attachError, setAttachError] = useState("");
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const MAX_FILE = 3.5 * 1024 * 1024; // ~3.5MB por arquivo (limite de payload serverless)
  const ACCEPT = "image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf";

  const pickFiles = async (fileList) => {
    setAttachError("");
    const files = Array.from(fileList || []);
    for (const f of files) {
      if (f.size > MAX_FILE) { setAttachError(`"${f.name}" excede 3,5 MB.`); continue; }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        const data = String(dataUrl).split(",")[1] || "";
        const mimeType = f.type || "application/octet-stream";
        setPending(p => [...p, { name: f.name, mimeType, data, dataUrl: String(dataUrl), isImage: mimeType.startsWith("image/") }]);
      } catch (e) { setAttachError("Falha ao ler " + f.name); }
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const removePending = (i) => setPending(p => p.filter((_, j) => j !== i));
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => {
    const load = async () => {
      try {
        const j = await api.get(baseUrl);
        if (j.perfil) setPerfil(j.perfil);
        if (Array.isArray(j.diario)) setDiario(j.diario);
      } catch (e) {}
      setMsgs([{ role: "assistant", content: "Olá! Sou O Conselheiro — seu coaching de trading pessoal.\n\nEstou aqui para te ajudar a operar com disciplina, gestão de risco e consistência.\n\nPara começar: qual é o capital que você tem disponível para operar hoje?" }]);
    };
    load();
  }, []);

  const savePerfil = async (p) => { setPerfil(p); try { await api.post(baseUrl, { perfil: p }); } catch (e) {} };
  const saveDiario = async (entry) => { const novo = [...diario, entry]; setDiario(novo); try { await api.post(baseUrl, { diario: novo }); } catch (e) {} };
  const hoje = new Date().toLocaleDateString("pt-BR");
  const totalHoje = diario.filter(d => d.data === hoje).reduce((s, d) => s + d.resultado, 0);
  const totalSemana = diario.filter(d => { const dt = new Date(d.data.split("/").reverse().join("-")); const seg = new Date(); seg.setDate(seg.getDate() - seg.getDay() + 1); seg.setHours(0, 0, 0, 0); return dt >= seg; }).reduce((s, d) => s + d.resultado, 0);
  const totalMes = diario.filter(d => { const [, m, a] = d.data.split("/"); const n = new Date(); return parseInt(m) === n.getMonth() + 1 && parseInt(a) === n.getFullYear(); }).reduce((s, d) => s + d.resultado, 0);
  const pctStr = (v) => (v >= 0 ? "+R$ " : "-R$ ") + Math.abs(v).toFixed(2);
  const pctColor = (v) => v > 0 ? T.green : v < 0 ? T.red : T.mut;
  const buildSys = () => {
    const ps = perfil ? "Capital: R$ " + perfil.capital.toLocaleString("pt-BR") + " | Pref: " + perfil.preferencia + " | WIN: " + perfil.contratosWIN + " ctr | WDO: " + perfil.contratosWDO + " ctr" : "Perfil nao definido";
    const dh = diario.filter(d => d.data === hoje);
    return "Voce e O Conselheiro — coaching de trading pessoal na B3. Direto, empatico e tecnico. De trader para trader.\n\nMARGENS: WIN R$ 1.000/contrato | WDO R$ 1.500/contrato\nPERFIL: " + ps + "\nHOJE: " + (dh.length ? dh.map(d => "R$ " + (d.resultado >= 0 ? "+" : "") + d.resultado.toFixed(2)).join(", ") : "Sem resultado") + "\nBALANCO: Hoje " + pctStr(totalHoje) + " | Semana " + pctStr(totalSemana) + " | Mes " + pctStr(totalMes) + "\n\nRESPONSABILIDADES:\n1. CAPITAL: Quando informar capital, calcule contratos WIN (capital/1000) e WDO (capital/1500). Informe e pergunte preferencia.\n2. GESTAO: Sugira parciais, protecao. Alta volatilidade = parcial sem mover stop. Normal = parcial + stop na entrada.\n3. MAO DE ALFACE: Se fechar cedo/nao segurar: identifique o padrao, trabalhe autoconfianca, tecnicas (alarme no alvo, fechar tela), faca refletir.\n4. COMPORTAMENTO: Furia/revenge trading: alerte com firmeza e empatia, sugira travas da plataforma, recomende parar.\n5. AUTOCONFIANCA: Confianca vem de repeticao. Voce nao opera achismo, opera plano testado.\n6. RESULTADO (IMPORTANTE): SEMPRE que o trader relatar uma operacao ou resultado com valor (pontos, contratos ou R$), calcule o resultado financeiro em R$ (WIN: pontos x R$0,20 x contratos | WDO: pontos x R$10,00 x contratos) e REGISTRE no diario adicionando, ao FINAL da sua resposta, o JSON em uma linha: {\"action\":\"save\",\"resultado\":220,\"dificuldade\":\"\",\"reflexao\":\"\"} (resultado em R$, negativo se prejuizo; preencha dificuldade/reflexao se o trader mencionar, senao deixe vazio). No fim do dia, se ainda nao informado, pergunte o resultado e as dificuldades.\n\nANEXOS: O trader pode enviar imagens (prints de graficos, setups, trades) e PDFs (extratos, notas). Quando houver anexo, analise-o tecnicamente e relacione ao coaching.\n\nSeja proativo. Portuguese. Direto e objetivo.";
  };
  const send = async (msg) => {
    const txt = msg || input.trim();
    const attached = pending;
    if ((!txt && attached.length === 0) || loading) return;
    setInput(""); setPending([]); setAttachError("");
    const newMsgs = [...msgs, { role: "user", content: txt, files: attached }];
    setMsgs(newMsgs); setLoading(true);
    try {
      if (!perfil) {
        const nums = txt.match(/[\d.,]+/g);
        if (nums) {
          const n = parseFloat(nums[0].replace(/\./g, "").replace(",", "."));
          const capital = n * (txt.toLowerCase().includes("mil") && n < 1000 ? 1000 : 1);
          if (capital >= 100) savePerfil({ capital, contratosWIN: Math.floor(capital / MARGEM_WIN), contratosWDO: Math.floor(capital / MARGEM_WDO), preferencia: "a definir" });
        }
      }
      if (perfil && perfil.preferencia === "a definir") {
        const l = txt.toLowerCase();
        const pref = l.includes("índice") || l.includes("indice") || l.includes("win") ? "Índice (WIN)" : l.includes("dólar") || l.includes("dolar") || l.includes("wdo") ? "Dólar (WDO)" : (l.includes("dois") || l.includes("ambos") || l.includes("tudo")) ? "Índice e Dólar" : null;
        if (pref) savePerfil({ ...perfil, preferencia: pref });
      }
      // Envia os anexos apenas na mensagem atual (evita reenviar imagens a cada turno).
      const apiMessages = newMsgs.map((m, idx) => {
        const last = idx === newMsgs.length - 1;
        if (last && m.files && m.files.length) {
          const parts = [];
          if (m.content) parts.push({ type: "text", text: m.content });
          m.files.forEach(f => parts.push({ type: "file", mimeType: f.mimeType, data: f.data }));
          return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
      });
      const data = await callAI({ max_tokens: 1500, system: buildSys(), messages: apiMessages });
      const text = data.content ? data.content.map(b => b.text || "").join("") : "";
      // Detecta o JSON de salvamento de resultado (tolerante a espaços/formato).
      const saveJson = extractJSON(text, ['"action"']);
      if (saveJson && saveJson.value && saveJson.value.action === "save") {
        const e = saveJson.value;
        saveDiario({ data: hoje, resultado: e.resultado, dificuldade: e.dificuldade, reflexao: e.reflexao });
      }
      const display = text.replace(/\{[^{}]*"action"\s*:\s*"save"[\s\S]*?\}/g, "").trim();
      setMsgs(m => [...m, { role: "assistant", content: display || "Não consegui responder agora. Pode reformular sua mensagem?" }]);
    } catch (e) { setMsgs(m => [...m, { role: "assistant", content: "Erro de conexão. Tente novamente." }]); }
    setLoading(false);
  };

  return (
    <div className="fh-fade" style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ flexShrink: 0, padding: "12px 18px", borderBottom: "1px solid " + T.line, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", gap: 18 }}>
            {diario.length > 0 && [["Hoje", totalHoje], ["Semana", totalSemana], ["Mês", totalMes]].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 10, color: T.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: pctColor(v), fontFamily: T.mono }}>{pctStr(v)}</div>
              </div>
            ))}
          </div>
          <Button variant={showDiario ? "gold" : "ghost"} size="sm" onClick={() => setShowDiario(v => !v)}><Icon name="journal" size={15} /> Diário</Button>
        </div>

        {perfil && perfil.preferencia !== "a definir" && (
          <div style={{ flexShrink: 0, maxWidth: CHAT_W, width: "calc(100% - 36px)", margin: "14px auto 0", background: T.panel2, border: "1px solid " + T.line, borderRadius: 12, padding: "12px 18px", display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[["Capital", "R$ " + perfil.capital.toLocaleString("pt-BR"), T.gold], ["Preferência", perfil.preferencia, T.text], ["WIN", perfil.contratosWIN + " ctr", T.blue], ["WDO", perfil.contratosWDO + " ctr", T.purple]].map(([l, v, c]) => (
              <div key={l}>
                <div style={{ fontSize: 10, color: T.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
                <div style={{ fontSize: 15, color: c, fontWeight: 700, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
          <div style={{ maxWidth: CHAT_W, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "82%", background: m.role === "user" ? T.goldSoft : T.panel, border: "1px solid " + (m.role === "user" ? T.lineGold : T.line), borderRadius: 14, padding: "13px 16px", fontSize: 15, color: T.text, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {m.role === "assistant" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.gold }} />
                    <span style={{ fontSize: 11, color: T.gold, letterSpacing: 1, fontWeight: 700 }}>O CONSELHEIRO</span>
                  </div>
                )}
                {m.content}
                {m.files && m.files.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: m.content ? 10 : 0 }}>
                    {m.files.map((f, k) => f.isImage
                      ? <img key={k} src={f.dataUrl} alt={f.name} style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, border: "1px solid " + T.lineGold }} />
                      : <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.inset, border: "1px solid " + T.line, borderRadius: 8, padding: "6px 10px", fontSize: 12, color: T.mut }}>📄 {f.name}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && <div style={{ display: "flex" }}><div style={{ background: T.panel, border: "1px solid " + T.line, borderRadius: 14, padding: "16px 20px" }}><Dots /></div></div>}
          <div ref={endRef} />
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: 16, borderTop: "1px solid " + T.line }}>
          <div style={{ maxWidth: CHAT_W, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {attachError && <div style={{ fontSize: 12, color: T.red }}>⚠ {attachError}</div>}
          {pending.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {pending.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: T.inset, border: "1px solid " + T.line, borderRadius: 8, padding: "5px 6px", fontSize: 12, color: T.mut }}>
                  {f.isImage ? <img src={f.dataUrl} alt={f.name} style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 5 }} /> : <span style={{ fontSize: 16 }}>📄</span>}
                  <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <button className="fh-btn" onClick={() => removePending(i)} style={{ background: "transparent", border: "none", color: T.dim, fontSize: 16, padding: 0, width: 18, height: 18 }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple style={{ display: "none" }} onChange={e => pickFiles(e.target.files)} />
            <Button variant="ghost" onClick={() => fileRef.current && fileRef.current.click()} disabled={loading} title="Anexar imagem ou PDF" style={{ padding: "0 14px" }}><Icon name="attach" size={18} /></Button>
            <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Fale com O Conselheiro..." style={{ flex: 1 }} />
            <Button onClick={() => send()} disabled={loading} title="Enviar" style={{ padding: "0 18px" }}><Icon name="send" size={18} /></Button>
          </div>
          </div>
        </div>
      </div>

      {showDiario && (
        <aside className="fh-diary" style={{ width: 320, flexShrink: 0, borderLeft: "1px solid " + T.line, background: T.bg, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid " + T.line }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, color: T.gold, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}><Icon name="journal" size={15} /> Diário do trader</div>
              <Button variant="ghost" size="sm" onClick={() => setShowDiario(false)} style={{ padding: "4px 10px" }}>×</Button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["Hoje", totalHoje], ["Semana", totalSemana], ["Mês", totalMes]].map(([l, v]) => (
                <div key={l} style={{ background: T.panel, borderRadius: 8, padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: T.dim, marginBottom: 4 }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: pctColor(v), fontFamily: T.mono }}>{pctStr(v)}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            {diario.length === 0
              ? <div style={{ fontSize: 14, color: T.dim, textAlign: "center", marginTop: 30 }}>Nenhum resultado ainda</div>
              : [...diario].reverse().map((d, i) => (
                <div key={i} style={{ background: T.panel, border: "1px solid " + T.line, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: T.mut, fontFamily: T.mono }}>{d.data}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: pctColor(d.resultado), fontFamily: T.mono }}>{pctStr(d.resultado)}</span>
                  </div>
                  {d.dificuldade && <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.5 }}>⚠ {d.dificuldade}</div>}
                  {d.reflexao && <div style={{ fontSize: 12, color: T.dim, marginTop: 5, fontStyle: "italic" }}>💡 {d.reflexao}</div>}
                </div>
              ))}
          </div>
        </aside>
      )}
    </div>
  );
}

// ─── Gestão de Usuários (super admin / moderador) ─────────────────────────────
const CAP_SHORT = { panorama: "Pan", carteira: "Cart", carteira_write: "Cart✎", conselheiro: "IA" };
const roleBadge = (r) => r === "superadmin"
  ? <Badge tone="gold">SUPER</Badge>
  : r === "moderator" ? <Badge tone="blue">MODER.</Badge> : <Badge tone="mut">CLIENTE</Badge>;

function ClientesScreen({ session }) {
  const currentUser = session?.user;
  const isSuper = session?.role === "superadmin";
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // { mode, user, name, pass, role, expiry, perms, targetSuper }
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try { const j = await api.get("/api/users"); setList(j.users || []); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setFormError(""); setModal({ mode: "create", user: "", name: "", pass: "", role: "client", expiry: "", perms: [...DEFAULT_CLIENT_PERMS], targetSuper: false }); };
  const openEdit = (u) => { setFormError(""); setModal({ mode: "edit", user: u.user, name: u.name || "", pass: "", role: u.role, expiry: u.expiry ? String(u.expiry).slice(0, 10) : "", perms: Array.isArray(u.perms) ? [...u.perms] : [...DEFAULT_CLIENT_PERMS], targetSuper: u.role === "superadmin" }); };

  // Editar carteira pressupõe ler; tirar a leitura tira a edição.
  const togglePerm = (c) => setModal(m => {
    let perms = m.perms.includes(c) ? m.perms.filter(x => x !== c) : [...m.perms, c];
    if (c === "carteira_write" && perms.includes("carteira_write") && !perms.includes("carteira")) perms.push("carteira");
    if (c === "carteira" && !perms.includes("carteira")) perms = perms.filter(x => x !== "carteira_write");
    return { ...m, perms };
  });

  const save = async () => {
    if (saving) return;
    setSaving(true); setFormError("");
    try {
      const m = modal;
      const action = m.mode === "create" ? "create" : "update";
      const base = { user: m.user.trim().toLowerCase(), name: m.name.trim(), expiry: m.expiry || null, ...(m.pass ? { pass: m.pass } : {}) };
      // Papel/permissões só vão no payload quando o super admin edita um não-super.
      const adminFields = (isSuper && !m.targetSuper) ? { role: m.role, ...(m.role === "client" ? { perms: m.perms } : {}) } : {};
      await api.post("/api/users", { action, ...base, ...adminFields });
      setModal(null);
      await load();
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (u) => {
    if (!window.confirm(`Remover o acesso de "${u.name || u.user}" (${u.user})? Esta ação não pode ser desfeita.`)) return;
    try { await api.post("/api/users", { action: "delete", user: u.user }); await load(); }
    catch (e) { setError(e.message); }
  };

  const expired = (e) => { if (!e) return false; const t = new Date(); t.setHours(0, 0, 0, 0); return new Date(e) < t; };
  const fmtExp = (e) => !e ? "sem prazo" : new Date(e).toLocaleDateString("pt-BR");
  const showRoleField = isSuper && !modal?.targetSuper;
  const showPerms = showRoleField && modal?.role === "client";
  const COLS = "0.9fr 1fr 92px 1.15fr 116px 86px";

  const permCell = (u) => {
    if (u.role !== "client") return <span style={{ fontSize: 11, color: T.gold }}>acesso total</span>;
    const ps = u.perms || [];
    if (!ps.length) return <span style={{ fontSize: 11, color: T.dim }}>sem acesso</span>;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {PAGE_CAPS.filter(c => ps.includes(c)).map(c => (
          <span key={c} title={CAP_LABELS[c]} style={{ fontSize: 10, color: T.mut, background: T.inset, border: "1px solid " + T.line, borderRadius: 5, padding: "2px 6px" }}>{CAP_SHORT[c]}</span>
        ))}
      </div>
    );
  };

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, color: T.dim }}>
          {list.length} {list.length === 1 ? "usuário" : "usuários"}
          {!isSuper && <span style={{ marginLeft: 6 }}>· você gerencia apenas clientes</span>}
        </div>
        <Button size="sm" onClick={openCreate}>+ Novo {isSuper ? "usuário" : "cliente"}</Button>
      </div>

      {error && <Banner tone="red">{error}</Banner>}

      {loading ? <Loading label="Carregando usuários..." />
        : list.length === 0 ? <EmptyState icon={<Icon name="users" size={40} />} title="Nenhum usuário" desc="Cadastre o primeiro acesso clicando no botão acima." />
        : (
          <Card style={{ overflow: "hidden" }}>
            <div className="fh-scroll-x">
              <div style={{ minWidth: 700 }}>
                <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 10, padding: "12px 16px", borderBottom: "1px solid " + T.line, background: T.panel2 }}>
                  {["USUÁRIO", "NOME", "PAPEL", "PERMISSÕES", "ACESSO ATÉ", ""].map((h, i) => <div key={i} style={{ fontSize: 10, color: T.dim, letterSpacing: 0.4, textAlign: i === 5 ? "right" : "left" }}>{h}</div>)}
                </div>
                {list.map(u => (
                  <div key={u.user} style={{ display: "grid", gridTemplateColumns: COLS, gap: 10, padding: "12px 16px", borderBottom: "1px solid " + T.line, alignItems: "center" }}>
                    <div style={{ fontSize: 14, color: T.text, fontFamily: T.mono, display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis" }}>{u.user}{u.user === currentUser && <span style={{ fontSize: 10, color: T.dim }}>(você)</span>}</div>
                    <div style={{ fontSize: 14, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name || "—"}</div>
                    <div>{roleBadge(u.role)}</div>
                    <div>{permCell(u)}</div>
                    <div style={{ fontSize: 13, color: expired(u.expiry) ? T.red : T.mut, fontFamily: T.mono }}>{fmtExp(u.expiry)}{expired(u.expiry) ? " ⚠" : ""}</div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(u)} style={{ padding: "5px 10px" }}>Editar</Button>
                      {u.user !== currentUser && u.role !== "superadmin" && <Button variant="danger" size="sm" onClick={() => remove(u)} style={{ padding: "5px 9px" }} title="Remover">×</Button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

      {modal && (
        <Modal title={modal.mode === "create" ? "Novo usuário" : "Editar acesso — " + modal.user} onClose={() => setModal(null)} width={480}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Usuário (login)" hint={modal.mode === "edit" ? "O login não pode ser alterado." : "Letras minúsculas, números, ponto, hífen ou underscore."}>
              <Input value={modal.user} disabled={modal.mode === "edit"} onChange={e => setModal(m => ({ ...m, user: e.target.value }))} placeholder="ex: joao.silva" mono />
            </Field>
            <Field label="Nome">
              <Input value={modal.name} onChange={e => setModal(m => ({ ...m, name: e.target.value }))} placeholder="Nome do usuário" />
            </Field>
            <Field label={modal.mode === "create" ? "Senha" : "Nova senha"} hint={modal.mode === "edit" ? "Deixe em branco para manter a senha atual." : "Mínimo de 6 caracteres."}>
              <Input type="password" value={modal.pass} onChange={e => setModal(m => ({ ...m, pass: e.target.value }))} placeholder="••••••••" />
            </Field>
            <div style={{ display: "flex", gap: 12 }}>
              {showRoleField && (
                <Field label="Papel" style={{ flex: 1 }}>
                  <select className="fh-input" value={modal.role} onChange={e => setModal(m => ({ ...m, role: e.target.value }))} style={{ width: "100%" }}>
                    <option value="client">Cliente</option>
                    <option value="moderator">Moderador</option>
                  </select>
                </Field>
              )}
              <Field label="Acesso até (opcional)" style={{ flex: 1 }}>
                <Input type="date" value={modal.expiry} onChange={e => setModal(m => ({ ...m, expiry: e.target.value }))} />
              </Field>
            </div>

            {showPerms && (
              <Field label="Permissões de acesso" hint="Quais páginas este cliente pode acessar.">
                <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 2 }}>
                  {PAGE_CAPS.map(c => {
                    const on = modal.perms.includes(c);
                    return (
                      <label key={c} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13.5, color: on ? T.text : T.mut }}>
                        <input type="checkbox" checked={on} onChange={() => togglePerm(c)} style={{ accentColor: T.gold, width: 16, height: 16 }} />
                        {CAP_LABELS[c]}
                      </label>
                    );
                  })}
                </div>
              </Field>
            )}
            {modal.role === "moderator" && showRoleField && (
              <div style={{ fontSize: 12, color: T.dim }}>Moderadores têm acesso total às páginas e podem gerenciar clientes.</div>
            )}

            {formError && <div style={{ fontSize: 13, color: T.red }}>⚠ {formError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
              <Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : (modal.mode === "create" ? "Cadastrar →" : "Salvar")}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [active, setActive] = useState("panorama");
  const [booting, setBooting] = useState(true);
  const enter = (s) => { setSession(s); setActive(firstAllowed(s)); };

  // Restaura a sessão a partir do cookie (mantém o login após recarregar).
  useEffect(() => {
    (async () => {
      try { const j = await api.get("/api/auth"); if (j.user) enter(j.user); }
      catch (e) { /* sem sessão */ }
      finally { setBooting(false); }
    })();
  }, []);

  const logout = async () => {
    try { await api.post("/api/auth", { action: "logout" }); } catch (e) {}
    setSession(null); setActive("panorama");
  };

  // Página efetiva: nunca renderiza algo que o usuário não pode acessar.
  const current = NAV.find(n => n.key === active && can(session, n.cap)) ? active : firstAllowed(session);

  if (booting) {
    return (
      <>
        <GlobalStyle />
        <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner /></div>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <GlobalStyle />
        <LoginScreen onLogin={enter} />
      </>
    );
  }

  return (
    <>
      <GlobalStyle />
      <Shell session={session} active={current} onNavigate={setActive} onLogout={logout}>
        {current === "panorama" && <PanoramaScreen />}
        {current === "carteira" && <CarteiraScreen canWrite={can(session, "carteira_write")} />}
        {current === "conselheiro" && <ConselheiroScreen userId={session?.user} />}
        {current === "clientes" && <ClientesScreen session={session} />}
      </Shell>
    </>
  );
}
