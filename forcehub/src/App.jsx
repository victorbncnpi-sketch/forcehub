import { useState, useEffect, useRef } from "react";
import { T, GlobalStyle, Logo, Button, Badge, Card, Field, Input, EmptyState, Stat, Banner, Tabs, Modal, Dots } from "./ui";

// ─── USUÁRIOS — adicione clientes aqui ───────────────────────────────────────
// role: "admin" = acesso total | "client" = só visualiza carteira publicada
// expiry: "YYYY-MM-DD" — acesso expira nessa data
const USERS = [
  { user: "victor",    pass: "forcehub2026", role: "admin",  expiry: null,         name: "Victor Noronha" },
  { user: "cliente1",  pass: "xp2026c1",     role: "client", expiry: "2027-06-01", name: "Cliente 1" },
  { user: "cliente2",  pass: "xp2026c2",     role: "client", expiry: "2027-06-01", name: "Cliente 2" },
  { user: "andre.gain",    pass: "xp2026ag",     role: "client", expiry: "2027-06-01", name: "Andre Gain" },
  { user: "maria.emilia",  pass: "xp2026me",     role: "client", expiry: "2027-06-01", name: "Maria Emilia" },
];

function checkExpiry(user) {
  if (!user.expiry) return true;
  return new Date(user.expiry) >= new Date();
}

// ─── Camada de dados (backend via /api/*) ─────────────────────────────────────
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

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [user, setUser] = useState(""); const [pass, setPass] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const handle = () => {
    setLoading(true); setError("");
    setTimeout(() => {
      const found = USERS.find(u => u.user === user.trim().toLowerCase() && u.pass === pass);
      if (!found) { setError("Usuário ou senha incorretos."); setLoading(false); return; }
      if (!checkExpiry(found)) { setError("Acesso expirado. Entre em contato com Victor Noronha."); setLoading(false); return; }
      onLogin({ user: found.user, role: found.role, name: found.name, expiry: found.expiry });
    }, 500);
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
  { key: "panorama",    icon: "📊", label: "Panorama",    title: "Panorama de Mercado" },
  { key: "carteira",    icon: "📈", label: "Carteira",    title: "Carteira Recomendada" },
  { key: "conselheiro", icon: "🎯", label: "Conselheiro", title: "O Conselheiro" },
];

function Shell({ session, active, onNavigate, onLogout, children }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  const isAdmin = session?.role === "admin";
  const cur = NAV.find(n => n.key === active);
  return (
    <div className="fh-shell">
      <aside className="fh-side">
        <div style={{ padding: "18px 16px", borderBottom: "1px solid " + T.line }}><Logo size={17} /></div>
        <nav style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {NAV.map(n => (
            <div key={n.key} className={"fh-navitem" + (active === n.key ? " active" : "")} onClick={() => onNavigate(n.key)}>
              <span style={{ fontSize: 17 }}>{n.icon}</span>
              <span className="fh-nav-label" style={{ fontSize: 14, fontWeight: 600 }}>{n.label}</span>
            </div>
          ))}
        </nav>
        <div style={{ padding: 14, borderTop: "1px solid " + T.line }}>
          <div className="fh-side-detail" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{session?.name}</div>
            {isAdmin
              ? <Badge tone="gold" style={{ marginTop: 6 }}>● ADMIN</Badge>
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

// ─── Panorama de Mercado ────────────────────────────────────────────────────────
function PanoramaScreen() {
  const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex"];
  const TICKERS = ["WIN", "WDO", "IBOV"];
  const LABELS = { WIN: "Mini Índice", WDO: "Mini Dólar", IBOV: "Ibovespa" };
  const empty = () => DAYS.map(d => ({ weekday: d, high: "", low: "" }));
  const [rows, setRows] = useState({ WIN: empty(), WDO: empty(), IBOV: empty() });
  const [news, setNews] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [marketLoaded, setMarketLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/market-data?days=7");
        if (!r.ok) return;
        const j = await r.json();
        if (!active || !j.ok || !j.data) return;
        let any = false;
        setRows(prev => {
          const next = { ...prev };
          TICKERS.forEach(tk => {
            const grid = empty();
            (j.data[tk] || []).forEach(e => {
              const wd = new Date(e.date + "T12:00:00").getDay() - 1;
              if (wd >= 0 && wd <= 4) {
                any = true;
                grid[wd] = { weekday: DAYS[wd], high: e.high != null ? String(e.high) : "", low: e.low != null ? String(e.low) : "" };
              }
            });
            next[tk] = grid;
          });
          return next;
        });
        if (any) setMarketLoaded(true);
      } catch (e) { /* mantém entrada manual */ }
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
  const loadNews = async () => {
    setNewsLoading(true); setNewsError(null);
    try {
      const today = new Date().toLocaleDateString("pt-BR");
      const prompt = "Hoje e " + today + ". Use web_search: calendario economico hoje brasil eua alto impacto 3 touros investing. Liste eventos de ALTO IMPACTO (3 touros) do Brasil e EUA de hoje. Responda SOMENTE JSON sem markdown: {\"date\":\"" + today + "\",\"news\":[{\"time\":\"09:30\",\"country\":\"EUA\",\"title\":\"PIB\",\"previous\":\"2.1%\",\"forecast\":\"1.8%\",\"actual\":\"\"}]}";
      const data = await aiSearchJSON(prompt, ['"news"']);
      setNews({ date: data.date || today, news: Array.isArray(data.news) ? data.news : [] });
    } catch (e) { setNewsError(e.message); }
    setNewsLoading(false);
  };

  const numInput = (color) => ({ textAlign: "center", padding: "8px 8px", fontSize: 14, color, borderColor: color + "44" });
  const todayIdx = new Date().getDay() - 1;

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 13, color: T.mut }}>Máxima · mínima · amplitude da semana — preenchido automaticamente e editável.</div>
        {marketLoaded ? <Badge tone="green">● DADOS DO MERCADO</Badge> : <Badge tone="mut">○ ENTRADA MANUAL</Badge>}
      </div>

      {TICKERS.map(ticker => {
        const avg = getAvg(ticker);
        const avgHigh = fmtV(ticker, rows[ticker].map(r => parseFloat(String(r.high).replace(",", ".")) || 0).filter(v => v > 0).reduce((a, b, _, arr) => a + b / arr.length, 0));
        const avgLow = fmtV(ticker, rows[ticker].map(r => parseFloat(String(r.low).replace(",", ".")) || 0).filter(v => v > 0).reduce((a, b, _, arr) => a + b / arr.length, 0));
        return (
          <Card key={ticker} style={{ overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid " + T.line, background: T.panel2 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: T.gold, fontFamily: T.mono, letterSpacing: 1 }}>{ticker}</span>
              <span style={{ fontSize: 13, color: T.mut }}>{LABELS[ticker]}</span>
              {avg != null && <Badge tone="gold" style={{ marginLeft: "auto" }}>AMPL. MÉDIA {fmtV(ticker, avg)} pts</Badge>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr 1fr", padding: "9px 14px", borderBottom: "1px solid " + T.line }}>
              {["DIA", "MÁXIMA", "MÍNIMA", "AMPLITUDE"].map(h => <div key={h} style={{ fontSize: 11, color: T.dim, letterSpacing: 0.5 }}>{h}</div>)}
            </div>
            {rows[ticker].map((row, i) => {
              const amp = getAmp(row);
              const ac = ampColor(amp, avg);
              const isToday = todayIdx === i;
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr 1fr", alignItems: "center", gap: 10, padding: "7px 14px", borderBottom: "1px solid " + T.line, background: isToday ? T.goldSoft : "transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 14, color: isToday ? T.gold : T.mut, fontWeight: isToday ? 700 : 400 }}>{row.weekday}</span>
                    {isToday && <span style={{ fontSize: 9, color: T.gold }}>●</span>}
                  </div>
                  <Input mono value={row.high} onChange={e => setCell(ticker, i, "high", e.target.value)} placeholder={ticker === "WDO" ? "0.0" : "000000"} style={numInput(T.blue)} />
                  <Input mono value={row.low} onChange={e => setCell(ticker, i, "low", e.target.value)} placeholder={ticker === "WDO" ? "0.0" : "000000"} style={numInput(T.purple)} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: T.mono }}>
                    {amp != null ? (
                      <>
                        <span style={{ fontSize: 16, fontWeight: 700, color: ac }}>{fmtV(ticker, amp)}</span>
                        {avg != null && <span style={{ fontSize: 12, color: ac }}>{amp >= avg ? "▲" : "▼"}{Math.abs(((amp / avg) - 1) * 100).toFixed(0)}%</span>}
                      </>
                    ) : <span style={{ color: T.dim }}>—</span>}
                  </div>
                </div>
              );
            })}
            <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr 1fr", alignItems: "center", gap: 10, padding: "10px 14px", background: T.panel2 }}>
              <div style={{ fontSize: 12, color: T.gold, letterSpacing: 0.5 }}>MÉDIA</div>
              <div style={{ fontSize: 14, color: T.blue, fontFamily: T.mono }}>{avgHigh}</div>
              <div style={{ fontSize: 14, color: T.purple, fontFamily: T.mono }}>{avgLow}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.gold, fontFamily: T.mono }}>{avg != null ? fmtV(ticker, avg) : "—"}</div>
            </div>
          </Card>
        );
      })}

      <Card style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderBottom: "1px solid " + T.line, background: T.panel2, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Eventos de alto impacto — hoje</div>
            <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}>🐂🐂🐂 3 touros · Brasil &amp; EUA · via IA</div>
          </div>
          <Button variant="gold" size="sm" onClick={loadNews} disabled={newsLoading}>
            {newsLoading ? "⟳ Buscando..." : news ? "↻ Atualizar" : "▶ Buscar eventos"}
          </Button>
        </div>
        {newsLoading && <div style={{ padding: 24, textAlign: "center", fontSize: 14, color: T.dim }}>Buscando calendário...</div>}
        {newsError && !newsLoading && <div style={{ padding: "14px 18px" }}><Banner tone="red">{newsError}</Banner></div>}
        {!newsLoading && !newsError && !news && <div style={{ padding: 24, textAlign: "center", fontSize: 14, color: T.dim }}>Clique em "Buscar eventos" para carregar o calendário de hoje.</div>}
        {!newsLoading && news && news.news && (
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {news.news.length === 0
              ? <div style={{ fontSize: 14, color: T.dim, padding: "12px 4px" }}>Nenhum evento de alto impacto hoje.</div>
              : news.news.map((n, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "62px 40px 1fr 90px 90px 90px", gap: 10, alignItems: "center", padding: "11px 14px", background: T.inset, border: "1px solid " + T.line, borderRadius: 10 }}>
                  <div style={{ fontSize: 15, color: T.gold, fontWeight: 700, fontFamily: T.mono }}>{n.time}</div>
                  <div style={{ fontSize: 24, textAlign: "center" }}>{(n.country === "Brasil" || n.country === "BR") ? "🇧🇷" : "🇺🇸"}</div>
                  <div>
                    <div style={{ fontSize: 14, color: T.text }}>{n.title}</div>
                    <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 2 }}>🐂🐂🐂</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 13, color: T.mut, fontFamily: T.mono }}>{n.previous || "—"}</div>
                  <div style={{ textAlign: "right", fontSize: 13, color: T.gold, fontFamily: T.mono }}>{n.forecast || "—"}</div>
                  <div style={{ textAlign: "right", fontSize: 14, fontWeight: 700, color: n.actual ? T.green : T.dim, fontFamily: T.mono }}>{n.actual || "—"}</div>
                </div>
              ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Linha de posição ───────────────────────────────────────────────────────────
function PosicaoRow({ p, onFechar }) {
  const [saida, setSaida] = useState("");
  const isAberta = p.status === "ABERTA";
  const pct = p.precoSaida != null ? (((p.precoSaida - p.entrada) / p.entrada) * 100).toFixed(2) : null;
  const pctColor = pct == null ? T.dim : parseFloat(pct) >= 0 ? T.green : T.red;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "84px 1fr 90px 90px 90px 90px 80px 190px", gap: 8, padding: "11px 16px", borderBottom: "1px solid " + T.line, alignItems: "center", fontFamily: T.mono }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.gold }}>{p.ticker}</div>
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

// ─── Carteira Recomendada ─────────────────────────────────────────────────────
function CarteiraScreen({ isAdmin }) {
  const [acoes, setAcoes] = useState([]);
  const [posicoes, setPosicoes] = useState([]);
  const [aba, setAba] = useState(isAdmin ? "carteira" : "posicoes");
  const [showForm, setShowForm] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [form, setForm] = useState({ ticker: "", nome: "", entrada: "", alvo: "", stop: "", qty: "", obs: "" });
  const [loadError, setLoadError] = useState(null);
  const idRef = useRef(1);

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
  const addAcao = () => {
    const e = parseFloat(form.entrada), a = parseFloat(form.alvo), s = parseFloat(form.stop);
    if (!form.ticker || !e || !a || !s) return;
    const nova = { id: idRef.current++, ticker: form.ticker.toUpperCase(), nome: form.nome, entrada: e, alvo: a, stop: s, qty: parseInt(form.qty) || 1, obs: form.obs, addedAt: new Date().toLocaleDateString("pt-BR"), ai: false };
    const next = [...acoes, nova];
    setAcoes(next); saveCarteira(next, posicoes);
    setForm({ ticker: "", nome: "", entrada: "", alvo: "", stop: "", qty: "", obs: "" });
    setShowForm(false);
  };
  const removeAcao = (id) => {
    const next = acoes.filter(x => x.id !== id);
    setAcoes(next); saveCarteira(next, posicoes);
  };
  const addFromScan = (op) => {
    const nova = { id: idRef.current++, ticker: op.ticker, nome: op.nome, entrada: op.entrada, alvo: op.alvo, stop: op.stop, qty: 1, obs: op.setup + " | " + op.racional, addedAt: new Date().toLocaleDateString("pt-BR"), ai: true };
    const nextAcoes = [...acoes, nova];
    const nextPos = [...posicoes, { ...nova, posId: idRef.current++, status: "ABERTA", dataEntrada: new Date().toLocaleDateString("pt-BR"), resultado: null, precoSaida: null }];
    setAcoes(nextAcoes); setPosicoes(nextPos); saveCarteira(nextAcoes, nextPos);
    setAba("posicoes");
  };
  const fecharPosicao = (posId, precoSaida) => {
    const nextPos = posicoes.map(p => {
      if (p.posId !== posId) return p;
      const pct = ((precoSaida - p.entrada) / p.entrada) * 100;
      return { ...p, status: "FECHADA", precoSaida, dataSaida: new Date().toLocaleDateString("pt-BR"), resultado: parseFloat(pct.toFixed(2)) };
    });
    setPosicoes(nextPos); saveCarteira(acoes, nextPos);
  };
  const scan = async () => {
    setScanning(true); setScanError(null); setScanResult(null);
    try {
      const today = new Date().toLocaleDateString("pt-BR");
      const prompt = "Voce e analista tecnico B3 swing trade. Hoje: " + today + ". Use web_search: melhores acoes comprar B3 hoje oportunidade tecnica swing trade. RESPONDA EM PORTUGUES. Retorne APENAS JSON valido sem texto extra: {\"data\":\"" + today + "\",\"contexto\":\"resumo do mercado\",\"oportunidades\":[{\"ticker\":\"PETR4\",\"nome\":\"Petrobras PN\",\"entrada\":38.50,\"alvo\":40.50,\"stop\":37.20,\"potencial\":5.2,\"setup\":\"Rompimento\",\"racional\":\"Análise\",\"prazo\":\"2-3 dias\",\"risco\":\"Risco\"}]}";
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
  const resultadoTotal = fechadas.length ? (fechadas.reduce((s, p) => s + p.resultado, 0) / fechadas.length) : 0;

  const tabs = isAdmin
    ? [{ key: "carteira", label: "📋 Recomendações" }, { key: "posicoes", label: "📊 Posições (" + abertas + ")" }]
    : [{ key: "posicoes", label: "📊 Posições (" + abertas + ")" }];

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <Tabs items={tabs} value={aba} onChange={setAba} />
        {isAdmin && (
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="success" size="sm" onClick={scan} disabled={scanning}>{scanning ? "⟳ Buscando..." : "🔍 Buscar com IA"}</Button>
            <Button size="sm" onClick={() => setShowForm(true)}>+ Nova recomendação</Button>
          </div>
        )}
      </div>

      {loadError && <Banner tone="gold">Persistência indisponível ({loadError}). Configure o banco (UPSTASH_REDIS_REST_URL/TOKEN) para salvar a carteira.</Banner>}

      {aba === "carteira" && (
        <>
          {scanError && <Banner tone="red">{scanError}</Banner>}
          {scanResult && (
            <Card style={{ overflow: "hidden", borderColor: T.green + "55" }}>
              <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid " + T.line, background: "#0c1f0c" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.green }}>🔍 Oportunidades — {scanResult.data}</div>
                  {scanResult.contexto && <div style={{ fontSize: 13, color: T.mut, marginTop: 4 }}>{scanResult.contexto}</div>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setScanResult(null)}>×</Button>
              </div>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                {(scanResult.oportunidades || []).map((op, i) => {
                  const rr = op.entrada && op.stop ? Math.abs((op.alvo - op.entrada) / (op.entrada - op.stop)) : 0;
                  const pot = op.entrada ? (((op.alvo - op.entrada) / op.entrada) * 100).toFixed(1) : "0";
                  return (
                    <div key={i} style={{ background: T.inset, border: "1px solid " + T.line, borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 18, fontWeight: 800, color: T.gold, fontFamily: T.mono }}>{op.ticker}</span>
                          <span style={{ fontSize: 13, color: T.mut }}>{op.nome}</span>
                          {op.prazo && <Badge tone="green">{op.prazo}</Badge>}
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
            <EmptyState icon="📈" title="Nenhuma recomendação ainda" desc={isAdmin ? "Crie uma recomendação manualmente ou busque oportunidades com IA." : "O administrador ainda não publicou recomendações."}>
              {isAdmin && <>
                <Button variant="success" onClick={scan}>🔍 Buscar com IA</Button>
                <Button onClick={() => setShowForm(true)}>+ Adicionar manualmente</Button>
              </>}
            </EmptyState>
          )}
          {acoes.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
              {acoes.map(a => {
                const rr = Math.abs((a.alvo - a.entrada) / (a.entrada - a.stop));
                const pot = (((a.alvo - a.entrada) / a.entrada) * 100).toFixed(1);
                const sp = (((a.stop - a.entrada) / a.entrada) * 100).toFixed(1);
                return (
                  <Card key={a.id} style={{ overflow: "hidden" }}>
                    <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: T.panel2, borderBottom: "1px solid " + T.line }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 19, fontWeight: 800, color: T.gold, fontFamily: T.mono }}>{a.ticker}</span>
                        {a.nome && <span style={{ fontSize: 13, color: T.mut }}>{a.nome}</span>}
                        {a.ai && <Badge tone="green">IA</Badge>}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Badge tone={a.alvo > a.entrada ? "green" : "red"}>{a.alvo > a.entrada ? "▲ COMPRA" : "▼ VENDA"}</Badge>
                        {isAdmin && <Button variant="ghost" size="sm" onClick={() => removeAcao(a.id)} style={{ padding: "4px 9px" }}>✕</Button>}
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
                    {a.obs && <div style={{ padding: "11px 16px", borderTop: "1px solid " + T.line, fontSize: 13, color: T.mut, lineHeight: 1.6 }}>💬 {a.obs}</div>}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {aba === "posicoes" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Stat label="Abertas" value={abertas} tone="gold" />
            <Stat label="Fechadas" value={posicoes.filter(p => p.status === "FECHADA").length} tone="mut" />
            <Stat label="Rent. média" value={(resultadoTotal >= 0 ? "+" : "") + resultadoTotal.toFixed(2) + "%"} tone={resultadoTotal >= 0 ? "green" : "red"} />
            <Stat label="Total ops" value={posicoes.length} tone="blue" />
          </div>
          {posicoes.length === 0 ? (
            <EmptyState icon="📊" title="Nenhuma posição registrada" desc="Valide uma recomendação na aba Recomendações para abrir uma posição." />
          ) : (
            <Card style={{ overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "84px 1fr 90px 90px 90px 90px 80px 190px", gap: 8, padding: "11px 16px", background: T.panel2, borderBottom: "1px solid " + T.line }}>
                {["TICKER", "EMPRESA", "ENTRADA", "ALVO", "STOP", "SAÍDA", "RENT.%", "FECHAR"].map(h => <div key={h} style={{ fontSize: 11, color: T.dim, letterSpacing: 0.5 }}>{h}</div>)}
              </div>
              {posicoes.map(p => <PosicaoRow key={p.posId} p={p} onFechar={fecharPosicao} />)}
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[["Entrada (R$)", "entrada", T.text], ["Alvo (R$)", "alvo", T.green], ["Stop (R$)", "stop", T.red]].map(([l, k, c]) => (
                <Field key={k} label={l}><Input mono type="number" step="0.01" value={form[k]} onChange={e => setF(k, e.target.value)} placeholder="0.00" style={{ color: c }} /></Field>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
              <Field label="Qtde"><Input mono type="number" min="1" value={form.qty} onChange={e => setF("qty", e.target.value)} placeholder="100" /></Field>
              <Field label="Tese / Obs"><Input value={form.obs} onChange={e => setF("obs", e.target.value)} placeholder="Rompimento de resistência..." /></Field>
            </div>
            {calcRR(form.entrada, form.alvo, form.stop) !== null && (
              <div style={{ background: T.inset, border: "1px solid " + T.line, borderRadius: 10, padding: "14px 18px", display: "flex", gap: 28 }}>
                <div><div style={{ fontSize: 12, color: T.dim, marginBottom: 4 }}>R:R</div><div style={{ fontSize: 24, fontWeight: 800, color: rrColor(calcRR(form.entrada, form.alvo, form.stop)), fontFamily: T.mono }}>1:{calcRR(form.entrada, form.alvo, form.stop).toFixed(2)}</div></div>
                <div><div style={{ fontSize: 12, color: T.dim, marginBottom: 4 }}>Potencial</div><div style={{ fontSize: 19, color: T.green, fontFamily: T.mono }}>+{(((parseFloat(form.alvo) - parseFloat(form.entrada)) / parseFloat(form.entrada)) * 100).toFixed(1)}%</div></div>
                <div><div style={{ fontSize: 12, color: T.dim, marginBottom: 4 }}>Risco</div><div style={{ fontSize: 19, color: T.red, fontFamily: T.mono }}>{(((parseFloat(form.stop) - parseFloat(form.entrada)) / parseFloat(form.entrada)) * 100).toFixed(1)}%</div></div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={addAcao}>Adicionar →</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── O Conselheiro ────────────────────────────────────────────────────────────
function ConselheiroScreen({ userId }) {
  const MARGEM_WIN = 1000; const MARGEM_WDO = 1500;
  const baseUrl = "/api/conselheiro?user=" + encodeURIComponent(userId || "anon");
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [perfil, setPerfil] = useState(null);
  const [diario, setDiario] = useState([]);
  const [showDiario, setShowDiario] = useState(false);
  const endRef = useRef(null);
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
    return "Voce e O Conselheiro — coaching de trading pessoal na B3. Direto, empatico e tecnico. De trader para trader.\n\nMARGENS: WIN R$ 1.000/contrato | WDO R$ 1.500/contrato\nPERFIL: " + ps + "\nHOJE: " + (dh.length ? dh.map(d => "R$ " + (d.resultado >= 0 ? "+" : "") + d.resultado.toFixed(2)).join(", ") : "Sem resultado") + "\nBALANCO: Hoje " + pctStr(totalHoje) + " | Semana " + pctStr(totalSemana) + " | Mes " + pctStr(totalMes) + "\n\nRESPONSABILIDADES:\n1. CAPITAL: Quando informar capital, calcule contratos WIN (capital/1000) e WDO (capital/1500). Informe e pergunte preferencia.\n2. GESTAO: Sugira parciais, protecao. Alta volatilidade = parcial sem mover stop. Normal = parcial + stop na entrada.\n3. MAO DE ALFACE: Se fechar cedo/nao segurar: identifique o padrao, trabalhe autoconfianca, tecnicas (alarme no alvo, fechar tela), faca refletir.\n4. COMPORTAMENTO: Furia/revenge trading: alerte com firmeza e empatia, sugira travas da plataforma, recomende parar.\n5. AUTOCONFIANCA: Confianca vem de repeticao. Voce nao opera achismo, opera plano testado.\n6. RESULTADO: Final do dia pergunte resultado e dificuldades. Analise comportamental. Retorne JSON: {\"action\":\"save\",\"resultado\":500,\"dificuldade\":\"TEXTO\",\"reflexao\":\"TEXTO\"}\n\nSeja proativo. Portuguese. Direto e objetivo.";
  };
  const send = async (msg) => {
    const txt = msg || input.trim();
    if (!txt || loading) return;
    setInput("");
    const newMsgs = [...msgs, { role: "user", content: txt }];
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
      const data = await callAI({ max_tokens: 1500, system: buildSys(), messages: newMsgs.map(m => ({ role: m.role, content: m.content })) });
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
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
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
          <Button variant={showDiario ? "gold" : "ghost"} size="sm" onClick={() => setShowDiario(v => !v)}>📓 Diário</Button>
        </div>

        {perfil && perfil.preferencia !== "a definir" && (
          <div style={{ flexShrink: 0, margin: "14px 18px 0", background: T.panel2, border: "1px solid " + T.line, borderRadius: 12, padding: "12px 18px", display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[["Capital", "R$ " + perfil.capital.toLocaleString("pt-BR"), T.gold], ["Preferência", perfil.preferencia, T.text], ["WIN", perfil.contratosWIN + " ctr", T.blue], ["WDO", perfil.contratosWDO + " ctr", T.purple]].map(([l, v, c]) => (
              <div key={l}>
                <div style={{ fontSize: 10, color: T.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
                <div style={{ fontSize: 15, color: c, fontWeight: 700, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
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
              </div>
            </div>
          ))}
          {loading && <div style={{ display: "flex" }}><div style={{ background: T.panel, border: "1px solid " + T.line, borderRadius: 14, padding: "16px 20px" }}><Dots /></div></div>}
          <div ref={endRef} />
        </div>

        <div style={{ flexShrink: 0, padding: 16, borderTop: "1px solid " + T.line, display: "flex", gap: 10 }}>
          <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Fale com O Conselheiro..." style={{ flex: 1 }} />
          <Button onClick={() => send()} disabled={loading} style={{ fontSize: 18, padding: "0 18px" }}>↑</Button>
        </div>
      </div>

      {showDiario && (
        <aside style={{ width: 320, flexShrink: 0, borderLeft: "1px solid " + T.line, background: T.bg, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid " + T.line }}>
            <div style={{ fontSize: 14, color: T.gold, fontWeight: 700, marginBottom: 12 }}>📓 Diário do trader</div>
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

// ─── App ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [active, setActive] = useState("panorama");
  const isAdmin = session?.role === "admin";

  if (!session) {
    return (
      <>
        <GlobalStyle />
        <LoginScreen onLogin={s => { setSession(s); setActive("panorama"); }} />
      </>
    );
  }

  return (
    <>
      <GlobalStyle />
      <Shell session={session} active={active} onNavigate={setActive} onLogout={() => setSession(null)}>
        {active === "panorama" && <PanoramaScreen />}
        {active === "carteira" && <CarteiraScreen isAdmin={isAdmin} />}
        {active === "conselheiro" && <ConselheiroScreen userId={session?.user} />}
      </Shell>
    </>
  );
}
