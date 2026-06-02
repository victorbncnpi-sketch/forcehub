import { useState, useEffect, useRef } from "react";

// ─── USUÁRIOS — adicione clientes aqui ───────────────────────────────────────
// role: "admin" = acesso total | "client" = só visualiza carteira publicada
// expiry: "YYYY-MM-DD" — acesso expira nessa data
const USERS = [
  { user: "victor",    pass: "forcehub2026", role: "admin",  expiry: null,         name: "Victor Noronha" },
  { user: "cliente1",  pass: "xp2026c1",     role: "client", expiry: "2027-06-01", name: "Cliente 1" },
  { user: "cliente2",  pass: "xp2026c2",     role: "client", expiry: "2027-06-01", name: "Cliente 2" },
  // Adicione novos clientes abaixo:
  // { user: "nome.sobrenome", pass: "senha123", role: "client", expiry: "2027-06-01", name: "Nome Completo" },
  { user: "andre.gain",    pass: "xp2026ag",     role: "client", expiry: "2027-06-01", name: "Andre Gain" },
  { user: "maria.emilia",  pass: "xp2026me",     role: "client", expiry: "2027-06-01", name: "Maria Emilia" },
];

function checkExpiry(user) {
  if (!user.expiry) return true; // admin sem expiração
  return new Date(user.expiry) >= new Date();
}

// ─── Persistência local (substitui o window.storage do ambiente de Artifacts) ─
const storage = {
  get: (key) => {
    try { const v = localStorage.getItem(key); return v == null ? null : { value: v }; }
    catch (e) { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, value); } catch (e) {}
  },
};

// ─── Chamada de IA via proxy serverless (/api/ai) ─────────────────────────────
// A chave da Anthropic NUNCA fica no frontend — fica no backend (ANTHROPIC_API_KEY).
async function callAI(body) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("Falha na IA (HTTP " + res.status + ")"));
  return data;
}

// Busca com web_search (calendário econômico, oportunidades). O web_search é uma
// server tool: a Anthropic executa a busca e devolve o texto final num único turno.
async function claudeSearch(prompt) {
  const data = await callAI({
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
  });
  const texts = (data.content || []).filter(b => b.type === "text");
  return texts.map(b => b.text).join("");
}

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
    }, 600);
  };
  const inp = { width: "100%", boxSizing: "border-box", background: "#111", border: "1px solid #333", borderRadius: 4, padding: "14px 16px", color: "#fff", fontSize: 18, fontFamily: "monospace", outline: "none" };
  return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>
      <div style={{ width: 420, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ marginBottom: 40, textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#fbbf24", boxShadow: "0 0 14px #fbbf24" }} />
            <span style={{ fontSize: 44, fontWeight: "bold", color: "#fbbf24", letterSpacing: 8 }}>FORCE</span>
            <span style={{ fontSize: 44, fontWeight: "bold", color: "#fff", letterSpacing: 8 }}>HUB</span>
            <span style={{ background: "#fbbf24", color: "#000", fontSize: 14, fontWeight: "bold", padding: "4px 8px", borderRadius: 3 }}>AI</span>
          </div>
          <div style={{ fontSize: 20, color: "#fbbf24", letterSpacing: 3, marginBottom: 6, fontWeight: "bold" }}>PARA CLIENTES XP</div>
          <div style={{ fontSize: 16, color: "#666", letterSpacing: 2 }}>DE TRADER PARA TRADER</div>
        </div>
        <div style={{ width: "100%", background: "#0a0a0a", border: "1px solid #222", borderRadius: 8, padding: "36px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 16, color: "#666", letterSpacing: 2, textAlign: "center" }}>ACESSO À PLATAFORMA</div>
          <div>
            <div style={{ fontSize: 14, color: "#555", letterSpacing: 2, marginBottom: 8 }}>USUÁRIO</div>
            <input type="text" value={user} onChange={e => setUser(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} placeholder="seu usuário" style={inp} />
          </div>
          <div>
            <div style={{ fontSize: 14, color: "#555", letterSpacing: 2, marginBottom: 8 }}>SENHA</div>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} placeholder="••••••••" style={inp} />
          </div>
          {error && <div style={{ fontSize: 14, color: "#ef4444", textAlign: "center" }}>⚠ {error}</div>}
          <button onClick={handle} disabled={loading} style={{ background: loading ? "#1a1000" : "#fbbf24", border: "none", borderRadius: 4, padding: 16, color: loading ? "#555" : "#000", fontSize: 16, fontWeight: "bold", fontFamily: "monospace", letterSpacing: 2, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "VERIFICANDO..." : "ENTRAR →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuScreen({ session, onNavigate, onLogout }) {
  const user = session?.user;
  const name = session?.name || user;
  const isAdmin = session?.role === "admin";
  const expiry = session?.expiry;
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  const Card = ({ icon, title, desc, nav }) => (
    <div onClick={() => onNavigate(nav)}
      style={{ width: 420, background: "#0a0a0a", border: "1px solid #2a2000", borderRadius: 8, padding: "28px 32px", cursor: "pointer", display: "flex", alignItems: "center", gap: 20, transition: "all 0.2s" }}
      onMouseEnter={e => { e.currentTarget.style.border = "1px solid #fbbf24"; e.currentTarget.style.background = "#0f0e00"; }}
      onMouseLeave={e => { e.currentTarget.style.border = "1px solid #2a2000"; e.currentTarget.style.background = "#0a0a0a"; }}>
      <div style={{ width: 64, height: 64, borderRadius: 8, background: "#1a1400", border: "1px solid #fbbf24", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 20, fontWeight: "bold", color: "#fbbf24", letterSpacing: 2, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 14, color: "#666", lineHeight: 1.6 }}>{desc}</div>
      </div>
      <span style={{ fontSize: 24, color: "#fbbf24" }}>→</span>
    </div>
  );
  return (
    <div style={{ minHeight: "100vh", background: "#000", fontFamily: "monospace", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#0a0a0a", borderBottom: "1px solid #1a1a00", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#fbbf24", boxShadow: "0 0 8px #fbbf24" }} />
          <span style={{ fontSize: 18, fontWeight: "bold", color: "#fbbf24", letterSpacing: 5 }}>FORCE</span>
          <span style={{ fontSize: 18, fontWeight: "bold", color: "#fff", letterSpacing: 5 }}>HUB</span>
          <span style={{ background: "#fbbf24", color: "#000", fontSize: 11, fontWeight: "bold", padding: "2px 7px", borderRadius: 2 }}>AI</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 14, color: "#555" }}>{time.toLocaleTimeString("pt-BR")}</span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: 14, color: "#444" }}>Olá, <span style={{ color: "#fbbf24" }}>{name}</span></span>
            {!isAdmin && expiry && <span style={{ fontSize: 11, color: "#555" }}>Acesso até {new Date(expiry).toLocaleDateString("pt-BR")}</span>}
            {isAdmin && <span style={{ fontSize: 11, color: "#fbbf24" }}>● ADMIN</span>}
          </div>
          <button onClick={onLogout} style={{ background: "none", border: "1px solid #222", color: "#555", padding: "5px 12px", borderRadius: 3, cursor: "pointer", fontSize: 13, fontFamily: "monospace" }}>SAIR</button>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 40 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 14 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#fbbf24", boxShadow: "0 0 14px #fbbf24" }} />
            <span style={{ fontSize: 48, fontWeight: "bold", color: "#fbbf24", letterSpacing: 8 }}>FORCE</span>
            <span style={{ fontSize: 48, fontWeight: "bold", color: "#fff", letterSpacing: 8 }}>HUB</span>
            <span style={{ background: "#fbbf24", color: "#000", fontSize: 14, fontWeight: "bold", padding: "5px 10px", borderRadius: 3 }}>AI</span>
          </div>
          <div style={{ fontSize: 22, color: "#fbbf24", letterSpacing: 4, marginBottom: 8, fontWeight: "bold" }}>PARA CLIENTES XP</div>
          <div style={{ fontSize: 17, color: "#888", letterSpacing: 3 }}>DE TRADER PARA TRADER</div>
        </div>
        <Card icon="📊" title="PANORAMA DE MERCADO" desc={"Máx · Mín · Amplitude semanal\nWIN · WDO · IBOV + Notícias alto impacto"} nav="panorama" />
        <Card icon="📈" title="CARTEIRA RECOMENDADA" desc={"Ações selecionadas · Entrada · Alvo · Stop\nBusca de oportunidades com IA · Posições abertas"} nav="carteira" />
        <Card icon="🎯" title="O CONSELHEIRO" desc={"Coaching de trading pessoal\nDe trader para trader · Diário de resultados"} nav="conselheiro" />
      </div>
    </div>
  );
}

function PanoramaScreen({ onBack }) {
  const DAYS = ["Seg","Ter","Qua","Qui","Sex"];
  const TICKERS = ["WIN","WDO","IBOV"];
  const LABELS = { WIN: "Mini Índice", WDO: "Mini Dólar", IBOV: "Ibovespa" };
  const empty = () => DAYS.map(d => ({ weekday: d, high: "", low: "" }));
  const [rows, setRows] = useState({ WIN: empty(), WDO: empty(), IBOV: empty() });
  const [news, setNews] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [marketLoaded, setMarketLoaded] = useState(false);
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

  // Pré-preenche a grade com os dados salvos no backend (Vercel KV). A edição
  // manual continua disponível; se o backend não estiver configurado, ignora.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/market-data?days=7");
        if (!r.ok) return;
        const j = await r.json();
        if (!active || !j.ok || !j.data) return;
        setRows(prev => {
          const next = { ...prev };
          TICKERS.forEach(tk => {
            const grid = empty();
            (j.data[tk] || []).forEach(e => {
              const wd = new Date(e.date + "T12:00:00").getDay() - 1;
              if (wd >= 0 && wd <= 4) {
                grid[wd] = {
                  weekday: DAYS[wd],
                  high: e.high != null ? String(e.high) : "",
                  low: e.low != null ? String(e.low) : "",
                };
              }
            });
            next[tk] = grid;
          });
          return next;
        });
        setMarketLoaded(true);
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
    if (!avg || !amp) return "#fbbf24";
    const r = amp / avg;
    return r >= 1.15 ? "#22c55e" : r <= 0.85 ? "#ef4444" : "#fbbf24";
  };
  const loadNews = async () => {
    setNewsLoading(true); setNewsError(null);
    try {
      const today = new Date().toLocaleDateString("pt-BR");
      const prompt = "Hoje e " + today + ". Use web_search: calendario economico hoje brasil eua alto impacto 3 touros investing. Liste eventos de ALTO IMPACTO (3 touros) do Brasil e EUA de hoje. Responda SOMENTE JSON sem markdown: {\"date\":\"" + today + "\",\"news\":[{\"time\":\"09:30\",\"country\":\"EUA\",\"title\":\"PIB\",\"previous\":\"2.1%\",\"forecast\":\"1.8%\",\"actual\":\"\"}]}";
      const text = await claudeSearch(prompt);
      // Extrai JSON de forma robusta por contagem de chaves
      const idx = text.indexOf('"news"');
      if (idx < 0) throw new Error("Calendário não encontrado");
      let si = idx;
      while (si > 0 && text[si] !== "{") si--;
      let depth = 0, ei = si;
      for (let i = si; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") { depth--; if (depth === 0) { ei = i + 1; break; } }
      }
      // Limpa caracteres problemáticos antes de parsear
      const raw = Array.from(text.slice(si, ei))
        .map(c => (c.charCodeAt(0) < 32 ? " " : c)) // remove caracteres de controle
        .join("")
        .replace(/,\s*([}\]])/g, "$1");           // trailing commas
      setNews(JSON.parse(raw));
    } catch (e) { setNewsError(e.message); }
    setNewsLoading(false);
  };
  const inpS = (color) => ({ width: "100%", boxSizing: "border-box", background: "#111", border: "1px solid " + color + "55", borderRadius: 3, padding: "8px 10px", color: color, fontSize: 16, fontFamily: "monospace", outline: "none", textAlign: "center" });

  return (
    <div style={{ minHeight: "100vh", background: "#000", fontFamily: "monospace", color: "#fff" }}>
      <div style={{ background: "#0a0a0a", borderBottom: "1px solid #2a2000", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onBack} style={{ background: "none", border: "1px solid #333", color: "#888", padding: "6px 14px", borderRadius: 3, cursor: "pointer", fontSize: 14, fontFamily: "monospace" }}>← MENU</button>
          <div style={{ width: 1, height: 24, background: "#222" }} />
          <span style={{ fontSize: 20, fontWeight: "bold", color: "#fbbf24", letterSpacing: 4 }}>PANORAMA DE MERCADO</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {marketLoaded
            ? <span style={{ fontSize: 12, color: "#22c55e", letterSpacing: 1 }}>● DADOS DO MERCADO</span>
            : <span style={{ fontSize: 12, color: "#555", letterSpacing: 1 }}>○ ENTRADA MANUAL</span>}
          <span style={{ fontSize: 14, color: "#444" }}>{time.toLocaleTimeString("pt-BR")}</span>
        </div>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        {TICKERS.map(ticker => {
          const avg = getAvg(ticker);
          const todayIdx = new Date().getDay() - 1;
          return (
            <div key={ticker} style={{ background: "#0a0a0a", border: "1px solid #1a1a00", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ background: "#0f0e00", borderBottom: "1px solid #222", padding: "14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 22, fontWeight: "bold", color: "#fbbf24", letterSpacing: 4 }}>{ticker}</span>
                <span style={{ fontSize: 14, color: "#555", letterSpacing: 2 }}>{LABELS[ticker].toUpperCase()}</span>
                {avg != null && <span style={{ marginLeft: "auto", fontSize: 15, color: "#fbbf24" }}>AMPLITUDE MÉDIA: <strong>{fmtV(ticker, avg)}</strong> pts</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr 1fr", background: "#0a0a0a", borderBottom: "1px solid #111" }}>
                {["DIA","MÁXIMA","MÍNIMA","AMPLITUDE"].map(h => <div key={h} style={{ padding: "10px 14px", fontSize: 13, color: "#555", letterSpacing: 1 }}>{h}</div>)}
              </div>
              {rows[ticker].map((row, i) => {
                const amp = getAmp(row);
                const ac = ampColor(amp, avg);
                const isToday = todayIdx === i && todayIdx >= 0 && todayIdx <= 4;
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr 1fr", borderBottom: i < 4 ? "1px solid #111" : "none", background: isToday ? "#0f0e00" : "transparent" }}>
                    <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 16, color: isToday ? "#fbbf24" : "#666", fontWeight: isToday ? "bold" : "normal" }}>{row.weekday}</span>
                      {isToday && <span style={{ fontSize: 10, color: "#fbbf24" }}>●</span>}
                    </div>
                    <div style={{ padding: "8px 10px" }}><input type="text" value={row.high} onChange={e => setCell(ticker, i, "high", e.target.value)} placeholder={ticker === "WDO" ? "0.0" : "000000"} style={inpS("#818cf8")} /></div>
                    <div style={{ padding: "8px 10px" }}><input type="text" value={row.low} onChange={e => setCell(ticker, i, "low", e.target.value)} placeholder={ticker === "WDO" ? "0.0" : "000000"} style={inpS("#d8b4fe")} /></div>
                    <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                      {amp != null ? (
                        <>
                          <span style={{ fontSize: 18, fontWeight: "bold", color: ac }}>{fmtV(ticker, amp)}</span>
                          {avg != null && <span style={{ fontSize: 13, color: ac }}>{amp >= avg ? "▲" : "▼"}{Math.abs(((amp / avg) - 1) * 100).toFixed(0)}%</span>}
                        </>
                      ) : <span style={{ color: "#333", fontSize: 16 }}>—</span>}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr 1fr", background: "#0f0e00", borderTop: "1px solid #222" }}>
                <div style={{ padding: "10px 14px", fontSize: 14, color: "#fbbf24", letterSpacing: 1 }}>MÉDIA</div>
                <div style={{ padding: "10px 14px", fontSize: 16, color: "#818cf8" }}>{fmtV(ticker, rows[ticker].map(r => parseFloat(String(r.high).replace(",",".")) || 0).filter(v=>v>0).reduce((a,b,_,arr)=>a+b/arr.length,0))}</div>
                <div style={{ padding: "10px 14px", fontSize: 16, color: "#d8b4fe" }}>{fmtV(ticker, rows[ticker].map(r => parseFloat(String(r.low).replace(",",".")) || 0).filter(v=>v>0).reduce((a,b,_,arr)=>a+b/arr.length,0))}</div>
                <div style={{ padding: "10px 14px", fontSize: 20, fontWeight: "bold", color: "#fbbf24" }}>{avg != null ? fmtV(ticker, avg) : "—"}</div>
              </div>
            </div>
          );
        })}
        <div style={{ background: "#0a0a0a", border: "1px solid #1a1a00", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ background: "#0f0e00", borderBottom: "1px solid #1a1a00", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: "bold", color: "#fbbf24", letterSpacing: 3 }}>EVENTOS DE ALTO IMPACTO — HOJE</div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>🐂🐂🐂 3 TOUROS · BRASIL & EUA · INVESTING.COM/BR</div>
            </div>
            <button onClick={loadNews} disabled={newsLoading} style={{ background: newsLoading ? "#111" : "#1a1400", border: "1px solid " + (newsLoading ? "#333" : "#fbbf24"), color: newsLoading ? "#444" : "#fbbf24", padding: "10px 20px", borderRadius: 4, cursor: newsLoading ? "not-allowed" : "pointer", fontSize: 14, fontFamily: "monospace" }}>
              {newsLoading ? "⟳ BUSCANDO..." : news ? "↻ ATUALIZAR" : "▶ BUSCAR EVENTOS"}
            </button>
          </div>
          {newsLoading && <div style={{ padding: 24, textAlign: "center", fontSize: 14, color: "#444" }}>BUSCANDO CALENDÁRIO...</div>}
          {newsError && !newsLoading && <div style={{ padding: "14px 20px", color: "#ef4444", fontSize: 14 }}>⚠ {newsError}</div>}
          {!newsLoading && !newsError && !news && <div style={{ padding: 24, textAlign: "center", fontSize: 14, color: "#333" }}>CLIQUE EM "BUSCAR EVENTOS" PARA CARREGAR O CALENDÁRIO DE HOJE</div>}
          {!newsLoading && news && news.news && (
            <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
              {news.news.length === 0
                ? <div style={{ fontSize: 14, color: "#333", padding: "12px 0" }}>Nenhum evento de alto impacto hoje.</div>
                : news.news.map((n, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "75px 50px 1fr 100px 100px 100px", gap: 10, alignItems: "center", padding: "12px 14px", background: "#111", border: "1px solid #1a1a00", borderRadius: 6 }}>
                    <div style={{ fontSize: 17, color: "#fbbf24", fontWeight: "bold" }}>{n.time}</div>
                    <div style={{ fontSize: 28, textAlign: "center" }}>{(n.country === "Brasil" || n.country === "BR") ? "🇧🇷" : "🇺🇸"}</div>
                    <div>
                      <div style={{ fontSize: 15, color: "#e2e8f0" }}>{n.title}</div>
                      <div style={{ fontSize: 13, color: "#f59e0b", marginTop: 3 }}>🐂🐂🐂</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 15, color: "#888" }}>{n.previous || "—"}</div>
                    <div style={{ textAlign: "right", fontSize: 15, color: "#fbbf24" }}>{n.forecast || "—"}</div>
                    <div style={{ textAlign: "right", fontSize: 16, fontWeight: "bold", color: n.actual ? "#22c55e" : "#444" }}>{n.actual || "Aguard."}</div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PosicaoRow({ p, onFechar }) {
  const [saida, setSaida] = useState("");
  const isAberta = p.status === "ABERTA";
  // Resultado em %
  const pct = p.precoSaida != null
    ? (((p.precoSaida - p.entrada) / p.entrada) * 100).toFixed(2)
    : null;
  const pctColor = pct == null ? "#444" : parseFloat(pct) >= 0 ? "#22c55e" : "#ef4444";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 95px 95px 95px 95px 90px 180px", gap: 6, padding: "12px 16px", borderBottom: "1px solid #111", alignItems: "center" }}
      onMouseEnter={e => e.currentTarget.style.background = "#0f0e00"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <div>
        <div style={{ fontSize: 16, fontWeight: "bold", color: "#fbbf24" }}>{p.ticker}</div>
        <div style={{ fontSize: 11, color: "#555" }}>{p.dataEntrada}</div>
      </div>
      <div style={{ fontSize: 13, color: "#888" }}>{p.nome || "—"}</div>
      <div style={{ fontSize: 14, color: "#e2e8f0" }}>R$ {p.entrada.toFixed(2)}</div>
      <div style={{ fontSize: 14, color: "#22c55e" }}>R$ {p.alvo.toFixed(2)}</div>
      <div style={{ fontSize: 14, color: "#ef4444" }}>R$ {p.stop.toFixed(2)}</div>
      <div style={{ fontSize: 14, color: p.precoSaida ? "#fbbf24" : "#444" }}>{p.precoSaida ? "R$ " + p.precoSaida.toFixed(2) : "—"}</div>
      <div style={{ fontSize: 16, fontWeight: "bold", color: pctColor }}>
        {pct == null ? "—" : (parseFloat(pct) >= 0 ? "+" : "") + pct + "%"}
      </div>
      <div>
        {isAberta ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input type="number" step="0.01" value={saida} onChange={e => setSaida(e.target.value)} placeholder="Saída R$" style={{ background: "#111", border: "1px solid #333", borderRadius: 3, padding: "6px 8px", color: "#fff", fontSize: 13, fontFamily: "monospace", outline: "none", width: "100%", flex: 1 }} />
            <button onClick={() => { const v = parseFloat(saida); if (v) onFechar(p.posId, v); }} style={{ background: "#1a0000", border: "1px solid #ef4444", color: "#ef4444", padding: "6px 10px", borderRadius: 3, cursor: "pointer", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>FECHAR</button>
          </div>
        ) : (
          <span style={{ background: "#111", border: "1px solid #333", color: "#555", padding: "5px 10px", borderRadius: 3, fontSize: 12 }}>✓ {p.dataSaida}</span>
        )}
      </div>
    </div>
  );
}

function CarteiraScreen({ onBack, isAdmin }) {
  const [acoes, setAcoes] = useState([]);
  const [posicoes, setPosicoes] = useState([]);
  const [aba, setAba] = useState(isAdmin ? "carteira" : "posicoes");
  const [showForm, setShowForm] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [form, setForm] = useState({ ticker: "", nome: "", entrada: "", alvo: "", stop: "", qty: "", obs: "" });
  const [time, setTime] = useState(new Date());
  const idRef = useRef(1);
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

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
    setAcoes(prev => [...prev, nova]);
    setForm({ ticker: "", nome: "", entrada: "", alvo: "", stop: "", qty: "", obs: "" });
    setShowForm(false);
  };
  const addFromScan = (op) => {
    const nova = { id: idRef.current++, ticker: op.ticker, nome: op.nome, entrada: op.entrada, alvo: op.alvo, stop: op.stop, qty: 1, obs: op.setup + " | " + op.racional, addedAt: new Date().toLocaleDateString("pt-BR"), ai: true };
    setAcoes(prev => [...prev, nova]);
    setPosicoes(prev => [...prev, { ...nova, posId: idRef.current++, status: "ABERTA", dataEntrada: new Date().toLocaleDateString("pt-BR"), resultado: null, precoSaida: null }]);
    setAba("posicoes");
  };
  const fecharPosicao = (posId, precoSaida) => {
    setPosicoes(prev => prev.map(p => {
      if (p.posId !== posId) return p;
      const pct = ((precoSaida - p.entrada) / p.entrada) * 100;
      return { ...p, status: "FECHADA", precoSaida, dataSaida: new Date().toLocaleDateString("pt-BR"), resultado: parseFloat(pct.toFixed(2)) };
    }));
  };
  const scan = async () => {
    setScanning(true); setScanError(null); setScanResult(null);
    try {
      const today = new Date().toLocaleDateString("pt-BR");
      const prompt = "Voce e analista tecnico B3 swing trade. Hoje: " + today + ". Use web_search: melhores acoes comprar B3 hoje oportunidade tecnica swing trade. RESPONDA EM PORTUGUES. Retorne APENAS JSON valido sem texto extra: {\"data\":\"" + today + "\",\"contexto\":\"resumo do mercado\",\"oportunidades\":[{\"ticker\":\"PETR4\",\"nome\":\"Petrobras PN\",\"entrada\":38.50,\"alvo\":40.50,\"stop\":37.20,\"potencial\":5.2,\"setup\":\"Rompimento\",\"racional\":\"Análise\",\"prazo\":\"2-3 dias\",\"risco\":\"Risco\"}]}";
      const text = await claudeSearch(prompt);
      const findJSON = (t) => {
        for (const pat of ['"oportunidades"', '"oportunidade"', '"opportunities"']) {
          const pi = t.indexOf(pat);
          if (pi < 0) continue;
          let si = pi;
          while (si > 0 && t[si] !== "{") si--;
          let depth = 0, ei = si;
          for (let i = si; i < t.length; i++) {
            if (t[i] === "{") depth++;
            else if (t[i] === "}") { depth--; if (depth === 0) { ei = i + 1; break; } }
          }
          try { return JSON.parse(t.slice(si, ei)); } catch(e) {}
        }
        return null;
      };
      const parsed = findJSON(text);
      if (!parsed) throw new Error("Nenhuma oportunidade encontrada. Tente novamente.");
      const ops = parsed.oportunidades || parsed.oportunidade || parsed.opportunities || [];
      setScanResult({ data: parsed.data || today, contexto: parsed.contexto || "", oportunidades: ops });
    } catch (e) { setScanError(e.message); }
    setScanning(false);
  };
  const rrColor = (r) => r >= 3 ? "#22c55e" : r >= 2 ? "#86efac" : r >= 1 ? "#fbbf24" : "#ef4444";
  const inpS = { background: "#111", border: "1px solid #333", borderRadius: 4, padding: "10px 14px", color: "#fff", fontSize: 16, fontFamily: "monospace", outline: "none", width: "100%", boxSizing: "border-box" };
  const lblS = { fontSize: 13, color: "#666", fontFamily: "monospace", letterSpacing: 1, marginBottom: 7, display: "block" };
  const abertas = posicoes.filter(p => p.status === "ABERTA").length;
  const fechadas = posicoes.filter(p => p.resultado != null);
  const resultadoTotal = fechadas.length ? (fechadas.reduce((s, p) => s + p.resultado, 0) / fechadas.length) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#000", fontFamily: "monospace", color: "#fff" }}>
      <div style={{ background: "#0a0a0a", borderBottom: "1px solid #2a2000", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onBack} style={{ background: "none", border: "1px solid #333", color: "#888", padding: "6px 14px", borderRadius: 3, cursor: "pointer", fontSize: 14, fontFamily: "monospace" }}>← MENU</button>
          <div style={{ width: 1, height: 24, background: "#222" }} />
          <span style={{ fontSize: 20, fontWeight: "bold", color: "#fbbf24", letterSpacing: 4 }}>CARTEIRA RECOMENDADA</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {isAdmin && (
            <>
              <button onClick={scan} disabled={scanning} style={{ background: scanning ? "#111" : "#0a1a08", border: "1px solid " + (scanning ? "#333" : "#22c55e"), color: scanning ? "#444" : "#22c55e", padding: "8px 18px", borderRadius: 4, cursor: scanning ? "not-allowed" : "pointer", fontSize: 14, fontFamily: "monospace" }}>
                {scanning ? "⟳ BUSCANDO..." : "🔍 BUSCAR IA"}
              </button>
              <button onClick={() => setShowForm(true)} style={{ background: "#1a1400", border: "1px solid #fbbf24", color: "#fbbf24", padding: "8px 18px", borderRadius: 4, cursor: "pointer", fontSize: 14, fontFamily: "monospace" }}>+ ADICIONAR</button>
            </>
          )}
          <span style={{ fontSize: 14, color: "#444" }}>{time.toLocaleTimeString("pt-BR")}</span>
        </div>
      </div>

      <div style={{ padding: "0 20px" }}>
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1a1a00", marginTop: 16 }}>
          {(isAdmin ? [["carteira", "📋 RECOMENDAÇÕES"], ["posicoes", "📊 POSIÇÕES (" + abertas + " abertas)"]] : [["posicoes", "📊 POSIÇÕES (" + abertas + " abertas)"]]).map(([key, label]) => (
            <button key={key} onClick={() => setAba(key)} style={{ background: aba === key ? "#1a1400" : "none", border: "none", borderBottom: aba === key ? "3px solid #fbbf24" : "3px solid transparent", color: aba === key ? "#fbbf24" : "#555", padding: "12px 24px", cursor: "pointer", fontSize: 16, fontFamily: "monospace", letterSpacing: 1 }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

        {aba === "carteira" && (
          <>
            {scanError && <div style={{ background: "#1a0000", border: "1px solid #7f1d1d", borderRadius: 6, padding: "12px 18px", color: "#ef4444", fontSize: 15 }}>⚠ {scanError}</div>}
            {scanResult && (
              <div style={{ background: "#0a0a0a", border: "1px solid #22c55e44", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ background: "#051205", padding: "14px 18px", borderBottom: "1px solid #1a2a1a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 17, color: "#22c55e", fontWeight: "bold", letterSpacing: 2 }}>🔍 OPORTUNIDADES — {scanResult.data}</div>
                    {scanResult.contexto && <div style={{ fontSize: 14, color: "#555", marginTop: 5 }}>{scanResult.contexto}</div>}
                  </div>
                  <button onClick={() => setScanResult(null)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 20 }}>×</button>
                </div>
                <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                  {(scanResult.oportunidades || []).map((op, i) => {
                    const rr = op.entrada && op.stop ? Math.abs((op.alvo - op.entrada) / (op.entrada - op.stop)) : 0;
                    const pot = op.entrada ? (((op.alvo - op.entrada) / op.entrada) * 100).toFixed(1) : "0";
                    return (
                      <div key={i} style={{ background: "#111", border: "1px solid #1a2a1a", borderRadius: 6, padding: "14px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                            <span style={{ fontSize: 20, fontWeight: "bold", color: "#fbbf24" }}>{op.ticker}</span>
                            <span style={{ fontSize: 14, color: "#666" }}>{op.nome}</span>
                            <span style={{ background: "#0a2a0a", border: "1px solid #22c55e44", color: "#22c55e", fontSize: 13, padding: "3px 10px", borderRadius: 3 }}>{op.prazo}</span>
                          </div>
                          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                            <span style={{ fontSize: 17, fontWeight: "bold", color: "#22c55e" }}>+{pot}%</span>
                            <span style={{ fontSize: 15, color: rrColor(rr) }}>R:R 1:{rr.toFixed(1)}</span>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                          {[["ENTRADA", op.entrada ? op.entrada.toFixed(2) : "—", "#e2e8f0"], ["ALVO +"+pot+"%", op.alvo ? op.alvo.toFixed(2) : "—", "#22c55e"], ["STOP", op.stop ? op.stop.toFixed(2) : "—", "#ef4444"]].map(([l, v, c]) => (
                            <div key={l} style={{ background: "#1a1a1a", borderRadius: 5, padding: "10px 14px", borderLeft: "3px solid " + c }}>
                              <div style={{ fontSize: 13, color: "#555", marginBottom: 5 }}>{l}</div>
                              <div style={{ fontSize: 18, fontWeight: "bold", color: c }}>R$ {v}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 14, color: "#777", marginBottom: 10, lineHeight: 1.7 }}>
                          <span style={{ color: "#fbbf24" }}>📊 {op.setup}</span> — {op.racional}
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <button onClick={() => addFromScan(op)} style={{ background: "#0a1a08", border: "1px solid #22c55e", color: "#22c55e", padding: "8px 18px", borderRadius: 4, cursor: "pointer", fontSize: 14, fontFamily: "monospace" }}>✓ VALIDAR E ADICIONAR</button>
                          <span style={{ fontSize: 13, color: "#333" }}>Analise como CNPI antes de recomendar</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {acoes.length === 0 && !scanResult && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", gap: 18 }}>
                <div style={{ fontSize: 52 }}>📈</div>
                <div style={{ fontSize: 17, color: "#444" }}>NENHUMA RECOMENDAÇÃO AINDA</div>
                {isAdmin && (
                  <div style={{ display: "flex", gap: 12 }}>
                    <button onClick={scan} style={{ background: "#0a1a08", border: "1px solid #22c55e", color: "#22c55e", padding: "12px 24px", borderRadius: 4, cursor: "pointer", fontSize: 15, fontFamily: "monospace" }}>🔍 BUSCAR COM IA</button>
                    <button onClick={() => setShowForm(true)} style={{ background: "#1a1400", border: "1px solid #fbbf24", color: "#fbbf24", padding: "12px 24px", borderRadius: 4, cursor: "pointer", fontSize: 15, fontFamily: "monospace" }}>+ ADICIONAR MANUALMENTE</button>
                  </div>
                )}
              </div>
            )}
            {acoes.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14 }}>
                {acoes.map(a => {
                  const rr = Math.abs((a.alvo - a.entrada) / (a.entrada - a.stop));
                  const pot = (((a.alvo - a.entrada) / a.entrada) * 100).toFixed(1);
                  const sp = (((a.stop - a.entrada) / a.entrada) * 100).toFixed(1);
                  return (
                    <div key={a.id} style={{ background: "#0a0a0a", border: "1px solid #1a1a00", borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ background: "#0f0e00", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ fontSize: 22, fontWeight: "bold", color: "#fbbf24", letterSpacing: 3 }}>{a.ticker}</span>
                          {a.nome && <span style={{ fontSize: 14, color: "#666" }}>{a.nome}</span>}
                          {a.ai && <span style={{ fontSize: 12, background: "#0a2a0a", color: "#22c55e", padding: "2px 7px", borderRadius: 2 }}>IA</span>}
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 16, fontWeight: "bold", color: a.alvo > a.entrada ? "#22c55e" : "#ef4444" }}>{a.alvo > a.entrada ? "▲ COMPRA" : "▼ VENDA"}</span>
                          {isAdmin && <button onClick={() => setAcoes(p => p.filter(x => x.id !== a.id))} style={{ background: "none", border: "1px solid #222", color: "#444", cursor: "pointer", padding: "3px 8px", borderRadius: 3, fontSize: 14, fontFamily: "monospace" }}>✕</button>}
                        </div>
                      </div>
                      <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                        {[["ENTRADA","R$ "+a.entrada.toFixed(2),"#e2e8f0","#555"],["ALVO +"+pot+"%","R$ "+a.alvo.toFixed(2),"#22c55e","#22c55e"],["STOP "+sp+"%","R$ "+a.stop.toFixed(2),"#ef4444","#ef4444"]].map(([l,v,c,bc]) => (
                          <div key={l} style={{ background: "#111", borderRadius: 5, padding: "12px 14px", borderLeft: "3px solid " + bc }}>
                            <div style={{ fontSize: 12, color: "#555", marginBottom: 5 }}>{l}</div>
                            <div style={{ fontSize: 18, fontWeight: "bold", color: c }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ padding: "0 18px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 13, color: "#555" }}>R:R</div>
                          <div style={{ fontSize: 30, fontWeight: "bold", color: rrColor(rr) }}>1:{rr.toFixed(2)}</div>
                        </div>
                        <div style={{ fontSize: 13, color: "#444" }}>{a.addedAt}</div>
                      </div>
                      {a.obs && <div style={{ padding: "12px 18px", borderTop: "1px solid #111", fontSize: 13, color: "#555", lineHeight: 1.6 }}>💬 {a.obs}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {aba === "posicoes" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
              {[["ABERTAS", abertas, "#fbbf24"], ["FECHADAS", posicoes.filter(p => p.status === "FECHADA").length, "#888"], ["RENT. MÉDIA", (resultadoTotal >= 0 ? "+" : "") + resultadoTotal.toFixed(2) + "%", resultadoTotal >= 0 ? "#22c55e" : "#ef4444"], ["TOTAL OPS", posicoes.length, "#818cf8"]].map(([l, v, c]) => (
                <div key={l} style={{ background: "#0a0a0a", border: "1px solid #1a1a00", borderRadius: 8, padding: "16px 20px" }}>
                  <div style={{ fontSize: 13, color: "#444", letterSpacing: 1, marginBottom: 8 }}>{l}</div>
                  <div style={{ fontSize: 26, fontWeight: "bold", color: c }}>{v}</div>
                </div>
              ))}
            </div>
            {posicoes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#444", fontSize: 17 }}>
                <div style={{ fontSize: 52, marginBottom: 14 }}>📊</div>
                <div>NENHUMA POSIÇÃO REGISTRADA</div>
                <div style={{ fontSize: 15, color: "#333", marginTop: 10 }}>Valide uma recomendação na aba Recomendações</div>
              </div>
            ) : (
              <div style={{ background: "#0a0a0a", border: "1px solid #1a1a00", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 95px 95px 95px 95px 90px 180px", gap: 6, background: "#0f0e00", borderBottom: "1px solid #222", padding: "12px 16px" }}>
                  {["TICKER","EMPRESA","ENTRADA","ALVO","STOP","SAÍDA","RENT.%","FECHAR POSIÇÃO"].map(h => (
                    <div key={h} style={{ fontSize: 12, color: "#555", letterSpacing: 1 }}>{h}</div>
                  ))}
                </div>
                {posicoes.map(p => <PosicaoRow key={p.posId} p={p} onFechar={fecharPosicao} />)}
              </div>
            )}
          </>
        )}
      </div>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#0a0a0a", border: "1px solid #fbbf24", borderRadius: 8, width: 540, overflow: "hidden" }}>
            <div style={{ background: "#0f0e00", padding: "16px 22px", borderBottom: "1px solid #222", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 17, color: "#fbbf24", letterSpacing: 2 }}>NOVA AÇÃO RECOMENDADA</span>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 22 }}>×</button>
            </div>
            <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                <div><label style={lblS}>TICKER</label><input value={form.ticker} onChange={e => setF("ticker", e.target.value.toUpperCase())} placeholder="PETR4" style={inpS} /></div>
                <div><label style={lblS}>EMPRESA</label><input value={form.nome} onChange={e => setF("nome", e.target.value)} placeholder="Petrobras PN" style={inpS} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[["ENTRADA (R$)", "entrada", "#e2e8f0"], ["ALVO (R$)", "alvo", "#22c55e"], ["STOP (R$)", "stop", "#ef4444"]].map(([l, k, c]) => (
                  <div key={k}><label style={lblS}>{l}</label><input type="number" step="0.01" value={form[k]} onChange={e => setF(k, e.target.value)} placeholder="0.00" style={{ ...inpS, color: c }} /></div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
                <div><label style={lblS}>QTDE</label><input type="number" min="1" value={form.qty} onChange={e => setF("qty", e.target.value)} placeholder="100" style={inpS} /></div>
                <div><label style={lblS}>TESE / OBS</label><input value={form.obs} onChange={e => setF("obs", e.target.value)} placeholder="Rompimento de resistência..." style={inpS} /></div>
              </div>
              {calcRR(form.entrada, form.alvo, form.stop) !== null && (
                <div style={{ background: "#111", border: "1px solid #222", borderRadius: 6, padding: "14px 18px", display: "flex", gap: 28 }}>
                  <div><div style={{ fontSize: 13, color: "#555", marginBottom: 5 }}>R:R</div><div style={{ fontSize: 26, fontWeight: "bold", color: rrColor(calcRR(form.entrada, form.alvo, form.stop)) }}>1:{calcRR(form.entrada, form.alvo, form.stop).toFixed(2)}</div></div>
                  <div><div style={{ fontSize: 13, color: "#555", marginBottom: 5 }}>POTENCIAL</div><div style={{ fontSize: 20, color: "#22c55e" }}>+{(((parseFloat(form.alvo) - parseFloat(form.entrada)) / parseFloat(form.entrada)) * 100).toFixed(1)}%</div></div>
                  <div><div style={{ fontSize: 13, color: "#555", marginBottom: 5 }}>RISCO</div><div style={{ fontSize: 20, color: "#ef4444" }}>{(((parseFloat(form.stop) - parseFloat(form.entrada)) / parseFloat(form.entrada)) * 100).toFixed(1)}%</div></div>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setShowForm(false)} style={{ padding: "10px 20px", borderRadius: 4, cursor: "pointer", fontSize: 14, fontFamily: "monospace", background: "#111", border: "1px solid #333", color: "#555" }}>CANCELAR</button>
                <button onClick={addAcao} style={{ padding: "10px 24px", borderRadius: 4, cursor: "pointer", fontSize: 14, fontFamily: "monospace", background: "#1a1400", border: "1px solid #fbbf24", color: "#fbbf24", fontWeight: "bold" }}>ADICIONAR →</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConselheiroScreen({ onBack, userId }) {
  const MARGEM_WIN = 1000; const MARGEM_WDO = 1500;
  const KEYS = { diario: "diario_" + userId, perfil: "perfil_" + userId };
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [perfil, setPerfil] = useState(null);
  const [diario, setDiario] = useState([]);
  const [showDiario, setShowDiario] = useState(false);
  const [time, setTime] = useState(new Date());
  const endRef = useRef(null);
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => {
    const load = async () => {
      try {
        const p = await storage.get(KEYS.perfil);
        const d = await storage.get(KEYS.diario);
        if (p) setPerfil(JSON.parse(p.value));
        if (d) setDiario(JSON.parse(d.value));
      } catch(e) {}
      setMsgs([{ role: "assistant", content: "Olá! Sou O Conselheiro — seu coaching de trading pessoal.\n\nEstou aqui para te ajudar a operar com disciplina, gestão de risco e consistência.\n\nPara começar: qual é o capital que você tem disponível para operar hoje?" }]);
    };
    load();
  }, []);
  const savePerfil = async (p) => { try { await storage.set(KEYS.perfil, JSON.stringify(p)); } catch(e) {} setPerfil(p); };
  const saveDiario = async (entry) => { const novo = [...diario, entry]; try { await storage.set(KEYS.diario, JSON.stringify(novo)); } catch(e) {} setDiario(novo); };
  const hoje = new Date().toLocaleDateString("pt-BR");
  const totalHoje = diario.filter(d => d.data === hoje).reduce((s, d) => s + d.resultado, 0);
  const totalSemana = diario.filter(d => { const dt = new Date(d.data.split("/").reverse().join("-")); const seg = new Date(); seg.setDate(seg.getDate() - seg.getDay() + 1); seg.setHours(0,0,0,0); return dt >= seg; }).reduce((s, d) => s + d.resultado, 0);
  const totalMes = diario.filter(d => { const [,m,a] = d.data.split("/"); const n = new Date(); return parseInt(m) === n.getMonth()+1 && parseInt(a) === n.getFullYear(); }).reduce((s, d) => s + d.resultado, 0);
  const pctStr = (v) => (v >= 0 ? "+R$ " : "-R$ ") + Math.abs(v).toFixed(2);
  const pctColor = (v) => v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "#888";
  const buildSys = () => {
    const ps = perfil ? "Capital: R$ " + perfil.capital.toLocaleString("pt-BR") + " | Pref: " + perfil.preferencia + " | WIN: " + perfil.contratosWIN + " ctr | WDO: " + perfil.contratosWDO + " ctr" : "Perfil nao definido";
    const dh = diario.filter(d => d.data === hoje);
    return "Voce e O Conselheiro — coaching de trading pessoal na B3. Direto, empatico e tecnico. De trader para trader.\n\nMARGENS: WIN R$ 1.000/contrato | WDO R$ 1.500/contrato\nPERFIL: " + ps + "\nHOJE: " + (dh.length ? dh.map(d => "R$ " + (d.resultado>=0?"+":"") + d.resultado.toFixed(2)).join(", ") : "Sem resultado") + "\nBALANCO: Hoje " + pctStr(totalHoje) + " | Semana " + pctStr(totalSemana) + " | Mes " + pctStr(totalMes) + "\n\nRESPONSABILIDADES:\n1. CAPITAL: Quando informar capital, calcule contratos WIN (capital/1000) e WDO (capital/1500). Informe e pergunte preferencia.\n2. GESTAO: Sugira parciais, protecao. Alta volatilidade = parcial sem mover stop. Normal = parcial + stop na entrada.\n3. MAO DE ALFACE: Se fechar cedo/nao segurar: identifique o padrao, trabalhe autoconfianca, tecnicas (alarme no alvo, fechar tela), faca refletir.\n4. COMPORTAMENTO: Furia/revenge trading: alerte com firmeza e empatia, sugira travas da plataforma, recomende parar.\n5. AUTOCONFIANCA: Confianca vem de repeticao. Voce nao opera achismo, opera plano testado.\n6. RESULTADO: Final do dia pergunte resultado e dificuldades. Analise comportamental. Retorne JSON: {\"action\":\"save\",\"resultado\":500,\"dificuldade\":\"TEXTO\",\"reflexao\":\"TEXTO\"}\n\nSeja proativo. Portuguese. Direto e objetivo.";
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
          const n = parseFloat(nums[0].replace(/\./g,"").replace(",","."));
          const capital = n * (txt.toLowerCase().includes("mil") && n < 1000 ? 1000 : 1);
          if (capital >= 100) savePerfil({ capital, contratosWIN: Math.floor(capital/MARGEM_WIN), contratosWDO: Math.floor(capital/MARGEM_WDO), preferencia: "a definir" });
        }
      }
      if (perfil && perfil.preferencia === "a definir") {
        const l = txt.toLowerCase();
        const pref = l.includes("índice")||l.includes("indice")||l.includes("win") ? "Índice (WIN)" : l.includes("dólar")||l.includes("dolar")||l.includes("wdo") ? "Dólar (WDO)" : (l.includes("dois")||l.includes("ambos")||l.includes("tudo")) ? "Índice e Dólar" : null;
        if (pref) savePerfil({ ...perfil, preferencia: pref });
      }
      const data = await callAI({ max_tokens: 1500, system: buildSys(), messages: newMsgs.map(m => ({ role: m.role, content: m.content })) });
      const text = data.content ? data.content.map(b => b.text || "").join("") : "Erro.";
      const jm = text.match(/\{"action":"save"[^}]+\}/);
      if (jm) { try { const e = JSON.parse(jm[0]); saveDiario({ data: hoje, resultado: e.resultado, dificuldade: e.dificuldade, reflexao: e.reflexao }); } catch(e) {} }
      setMsgs(m => [...m, { role: "assistant", content: text.replace(/\{"action":"save"[^}]+\}/g, "").trim() }]);
    } catch(e) { setMsgs(m => [...m, { role: "assistant", content: "Erro de conexão. Tente novamente." }]); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#000", fontFamily: "monospace", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#0a0a0a", borderBottom: "1px solid #2a2000", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onBack} style={{ background: "none", border: "1px solid #333", color: "#888", padding: "6px 14px", borderRadius: 3, cursor: "pointer", fontSize: 14, fontFamily: "monospace" }}>← MENU</button>
          <div style={{ width: 1, height: 24, background: "#222" }} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#fbbf24", boxShadow: "0 0 8px #fbbf24", display: "inline-block" }} />
              <span style={{ fontSize: 20, fontWeight: "bold", color: "#fbbf24", letterSpacing: 2 }}>O CONSELHEIRO</span>
            </div>
            <div style={{ fontSize: 13, color: "#666", letterSpacing: 1, marginTop: 2 }}>seu coaching</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {diario.length > 0 && (
            <div style={{ display: "flex", gap: 20 }}>
              {[["HOJE", totalHoje], ["SEMANA", totalSemana], ["MÊS", totalMes]].map(([l, v]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ color: "#333", fontSize: 11 }}>{l}</div>
                  <div style={{ color: pctColor(v), fontWeight: "bold", fontSize: 15 }}>{pctStr(v)}</div>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setShowDiario(v => !v)} style={{ background: showDiario ? "#1a1400" : "#111", border: "1px solid " + (showDiario ? "#fbbf24" : "#333"), color: showDiario ? "#fbbf24" : "#666", padding: "7px 16px", borderRadius: 3, cursor: "pointer", fontSize: 14, fontFamily: "monospace" }}>📓 DIÁRIO</button>
          <span style={{ fontSize: 14, color: "#444" }}>{time.toLocaleTimeString("pt-BR")}</span>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {perfil && perfil.preferencia !== "a definir" && (
            <div style={{ margin: "14px 18px 0", background: "#0f0e00", border: "1px solid #2a2000", borderRadius: 6, padding: "12px 18px", display: "flex", gap: 28 }}>
              {[["CAPITAL","R$ "+perfil.capital.toLocaleString("pt-BR"),"#fbbf24"],["PREFERÊNCIA",perfil.preferencia,"#e2e8f0"],["WIN",perfil.contratosWIN+" contratos","#818cf8"],["WDO",perfil.contratosWDO+" contratos","#d8b4fe"]].map(([l,v,c]) => (
                <div key={l}>
                  <div style={{ fontSize: 11, color: "#555", letterSpacing: 1 }}>{l}</div>
                  <div style={{ fontSize: 16, color: c, fontWeight: "bold", marginTop: 3 }}>{v}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "80%", background: m.role === "user" ? "#1a1400" : "#0f0f0f", border: "1px solid " + (m.role === "user" ? "#fbbf2444" : "#1a1a00"), borderRadius: 8, padding: "14px 18px", fontSize: 16, color: "#e2e8f0", lineHeight: 1.9, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                  {m.role === "assistant" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fbbf24" }} />
                      <span style={{ fontSize: 12, color: "#fbbf24", letterSpacing: 2 }}>O CONSELHEIRO · seu coaching</span>
                    </div>
                  )}
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex" }}>
                <div style={{ background: "#0f0f0f", border: "1px solid #1a1a00", borderRadius: 8, padding: "16px 20px", display: "flex", gap: 7 }}>
                  {[0,1,2].map(j => <div key={j} style={{ width: 7, height: 7, borderRadius: "50%", background: "#fbbf24", animation: "pulse 0.9s " + (j * 0.25) + "s infinite" }} />)}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div style={{ padding: 18, borderTop: "1px solid #111", display: "flex", gap: 12 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Fale com O Conselheiro..." style={{ flex: 1, background: "#0f0f0f", border: "1px solid #222", borderRadius: 6, padding: "14px 18px", color: "#fff", fontSize: 16, fontFamily: "monospace", outline: "none" }} />
            <button onClick={() => send()} disabled={loading} style={{ background: "#fbbf24", border: "none", color: "#000", padding: "14px 22px", borderRadius: 6, cursor: "pointer", fontSize: 20, fontWeight: "bold" }}>↑</button>
          </div>
        </div>
        {showDiario && (
          <div style={{ width: 320, borderLeft: "1px solid #1a1a00", background: "#0a0a0a", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #111" }}>
              <div style={{ fontSize: 16, color: "#fbbf24", letterSpacing: 2, marginBottom: 12 }}>📓 DIÁRIO DO TRADER</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[["HOJE", totalHoje], ["SEMANA", totalSemana], ["MÊS", totalMes]].map(([l, v]) => (
                  <div key={l} style={{ background: "#111", borderRadius: 4, padding: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: "#444", marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 16, fontWeight: "bold", color: pctColor(v) }}>{pctStr(v)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {diario.length === 0
                ? <div style={{ fontSize: 14, color: "#333", textAlign: "center", marginTop: 30 }}>Nenhum resultado ainda</div>
                : [...diario].reverse().map((d, i) => (
                  <div key={i} style={{ background: "#111", border: "1px solid #1a1a00", borderRadius: 6, padding: "12px 14px", marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 14, color: "#666" }}>{d.data}</span>
                      <span style={{ fontSize: 16, fontWeight: "bold", color: pctColor(d.resultado) }}>{pctStr(d.resultado)}</span>
                    </div>
                    {d.dificuldade && <div style={{ fontSize: 14, color: "#888", lineHeight: 1.6 }}>⚠ {d.dificuldade}</div>}
                    {d.reflexao && <div style={{ fontSize: 13, color: "#555", marginTop: 5, fontStyle: "italic" }}>💡 {d.reflexao}</div>}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("login");
  const [session, setSession] = useState(null); // { user, role, name, expiry }
  const isAdmin = session?.role === "admin";
  return (
    <>
      {screen === "login" && <LoginScreen onLogin={s => { setSession(s); setScreen("menu"); }} />}
      {screen === "menu" && <MenuScreen session={session} onNavigate={s => setScreen(s)} onLogout={() => { setSession(null); setScreen("login"); }} />}
      {screen === "panorama" && <PanoramaScreen onBack={() => setScreen("menu")} />}
      {screen === "carteira" && <CarteiraScreen onBack={() => setScreen("menu")} isAdmin={isAdmin} />}
      {screen === "conselheiro" && <ConselheiroScreen onBack={() => setScreen("menu")} userId={session?.user} />}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #000; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 3px; }
        input::placeholder { color: #444; }
      `}</style>
    </>
  );
}
