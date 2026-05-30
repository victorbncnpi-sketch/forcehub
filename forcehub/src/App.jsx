import { useState, useRef, useEffect } from "react";

// ─── Credenciais ──────────────────────────────────────────────────────────────
const USERS = [
  { user: "victor", pass: "forcehub2026" },
  { user: "cliente1", pass: "xp2026" },
];

// ─── Constantes ───────────────────────────────────────────────────────────────
const WEEKDAYS = ["Seg","Ter","Qua","Qui","Sex"];
const TICKERS  = ["WIN","WDO","IBOV"];
const TICKER_LABEL = { WIN: "Mini Índice", WDO: "Mini Dólar", IBOV: "Ibovespa" };

const fmtNum = (v) => {
  const n = parseFloat(String(v).replace(",","."));
  if (!n || isNaN(n)) return "—";
  return n >= 1000 ? Math.round(n).toLocaleString("pt-BR") : n.toFixed(3);
};

const calcAmp = (h, l) => {
  const hi = parseFloat(String(h).replace(",","."));
  const lo = parseFloat(String(l).replace(",","."));
  if (!hi || !lo || isNaN(hi) || isNaN(lo)) return null;
  const amp = hi - lo;
  return amp >= 1 ? Math.round(amp) : parseFloat(amp.toFixed(3));
};

// ─── Claude agentic search ────────────────────────────────────────────────────
async function claudeSearch(prompt) {
  let messages = [{ role: "user", content: prompt }];
  let finalText = "";
  for (let turn = 0; turn < 10; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages,
      })
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const texts = (data.content || []).filter(b => b.type === "text");
    if (texts.length) finalText = texts.map(b => b.text).join("");
    if (data.stop_reason === "end_turn") break;
    const toolUses = (data.content || []).filter(b => b.type === "tool_use");
    if (!toolUses.length) break;
    messages.push({ role: "assistant", content: data.content });
    messages.push({ role: "user", content: toolUses.map(tu => ({ type: "tool_result", tool_use_id: tu.id, content: "ok" })) });
  }
  return finalText;
}

async function fetchNews() {
  const today = new Date().toLocaleDateString("pt-BR");
  const prompt = `Hoje é ${today}. Use web_search para buscar eventos econômicos de ALTO IMPACTO (3 touros) de hoje no calendário econômico do Brasil e EUA. Busque: "calendario economico hoje brasil eua alto impacto 3 touros investing".
Retorne SOMENTE JSON sem markdown:
{"date":"${today}","news":[{"time":"09:30","country":"EUA","title":"PIB","previous":"2.1%","forecast":"1.8%","actual":""}]}`;
  const text = await claudeSearch(prompt);
  const match = text.match(/\{[\s\S]*?"news"[\s\S]*?\}/);
  if (!match) throw new Error("Não encontrado");
  return JSON.parse(match[0]);
}

// ══════════════════════════════════════════════════════════════════════════════
// TELA 1 — LOGIN
// ══════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [user, setUser]   = useState("");
  const [pass, setPass]   = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setLoading(true);
    setError("");
    setTimeout(() => {
      const found = USERS.find(u => u.user === user.trim().toLowerCase() && u.pass === pass);
      if (found) {
        onLogin(found.user);
      } else {
        setError("Usuário ou senha incorretos.");
        setLoading(false);
      }
    }, 600);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#000", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"monospace" }}>
      <div style={{ width:360, display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>

        {/* Logo */}
        <div style={{ marginBottom:40, textAlign:"center" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:8 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:"#fbbf24", boxShadow:"0 0 14px #fbbf24" }}/>
            <span style={{ fontSize:36, fontWeight:"bold", color:"#fbbf24", letterSpacing:8 }}>FORCE</span>
            <span style={{ fontSize:36, fontWeight:"bold", color:"#fff", letterSpacing:8 }}>HUB</span>
            <span style={{ background:"#fbbf24", color:"#000", fontSize:10, fontWeight:"bold", padding:"3px 7px", borderRadius:3, letterSpacing:2 }}>AI</span>
          </div>
          <div style={{ fontSize:12, color:"#555", letterSpacing:3 }}>PARA CLIENTES XP · DE TRADER PARA TRADER</div>
        </div>

        {/* Card login */}
        <div style={{ width:"100%", background:"#0a0a0a", border:"1px solid #222", borderRadius:8, padding:"32px 28px", display:"flex", flexDirection:"column", gap:20 }}>
          <div style={{ fontSize:13, color:"#777", letterSpacing:2, textAlign:"center", marginBottom:4 }}>ACESSO À PLATAFORMA</div>

          <div>
            <div style={{ fontSize:11, color:"#666", letterSpacing:2, marginBottom:6 }}>USUÁRIO</div>
            <input
              type="text" value={user} onChange={e=>setUser(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              placeholder="seu usuário"
              style={{ width:"100%", boxSizing:"border-box", background:"#111", border:"1px solid #333", borderRadius:4, padding:"12px 14px", color:"#fff", fontSize:15, fontFamily:"monospace", outline:"none" }}
            />
          </div>

          <div>
            <div style={{ fontSize:11, color:"#666", letterSpacing:2, marginBottom:6 }}>SENHA</div>
            <input
              type="password" value={pass} onChange={e=>setPass(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              placeholder="••••••••"
              style={{ width:"100%", boxSizing:"border-box", background:"#111", border:"1px solid #333", borderRadius:4, padding:"12px 14px", color:"#fff", fontSize:15, fontFamily:"monospace", outline:"none" }}
            />
          </div>

          {error && <div style={{ fontSize:10, color:"#ef4444", textAlign:"center", fontFamily:"monospace" }}>⚠ {error}</div>}

          <button
            onClick={handleLogin} disabled={loading}
            style={{ background: loading?"#1a1000":"#fbbf24", border:"none", borderRadius:4, padding:"12px", color: loading?"#555":"#000", fontSize:12, fontWeight:"bold", fontFamily:"monospace", letterSpacing:2, cursor: loading?"not-allowed":"pointer", transition:"all 0.2s", marginTop:4 }}
          >
            {loading ? "VERIFICANDO..." : "ENTRAR →"}
          </button>
        </div>

        <div style={{ marginTop:24, fontSize:9, color:"#333", letterSpacing:1 }}>FORCE HUB AI · TODOS OS DIREITOS RESERVADOS</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TELA 2 — MENU PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
function MenuScreen({ user, onNavigate, onLogout }) {
  const [time, setTime] = useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setTime(new Date()),1000); return()=>clearInterval(t); },[]);

  return (
    <div style={{ minHeight:"100vh", background:"#000", fontFamily:"monospace", display:"flex", flexDirection:"column" }}>
      {/* Top bar */}
      <div style={{ background:"#0a0a0a", borderBottom:"1px solid #1a1a00", padding:"0 24px", height:52, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:"#fbbf24", boxShadow:"0 0 8px #fbbf24" }}/>
          <span style={{ fontSize:15, fontWeight:"bold", color:"#fbbf24", letterSpacing:5 }}>FORCE</span>
          <span style={{ fontSize:15, fontWeight:"bold", color:"#fff", letterSpacing:5 }}>HUB</span>
          <span style={{ background:"#fbbf24", color:"#000", fontSize:8, fontWeight:"bold", padding:"2px 6px", borderRadius:2, letterSpacing:2 }}>AI</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ fontSize:10, color:"#555" }}>{time.toLocaleTimeString("pt-BR")}</span>
          <span style={{ fontSize:10, color:"#444" }}>Olá, <span style={{ color:"#fbbf24" }}>{user}</span></span>
          <button onClick={onLogout} style={{ background:"none", border:"1px solid #222", color:"#555", padding:"4px 10px", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>SAIR</button>
        </div>
      </div>

      {/* Menu central */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20, padding:40 }}>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:11, color:"#555", letterSpacing:4 }}>SELECIONE UMA ÁREA</div>
        </div>

        {/* Card Panorama */}
        <div
          onClick={()=>onNavigate("panorama")}
          style={{ width:380, background:"#0a0a0a", border:"1px solid #2a2000", borderRadius:8, padding:"28px 32px", cursor:"pointer", transition:"all 0.2s", display:"flex", alignItems:"center", gap:20 }}
          onMouseEnter={e=>{e.currentTarget.style.border="1px solid #fbbf24"; e.currentTarget.style.background="#0f0e00";}}
          onMouseLeave={e=>{e.currentTarget.style.border="1px solid #2a2000"; e.currentTarget.style.background="#0a0a0a";}}
        >
          <div style={{ width:60, height:60, borderRadius:8, background:"#1a1400", border:"1px solid #fbbf24", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0 }}>📊</div>
          <div>
            <div style={{ fontSize:18, fontWeight:"bold", color:"#fbbf24", letterSpacing:2, marginBottom:6 }}>PANORAMA DE MERCADO</div>
            <div style={{ fontSize:13, color:"#666", lineHeight:1.7 }}>Máx · Mín · Amplitude semanal<br/>WIN · WDO · IBOV + Notícias alto impacto</div>
          </div>
          <span style={{ marginLeft:"auto", fontSize:22, color:"#fbbf24" }}>→</span>
        </div>

        {/* Card Conselheiro */}
        <div
          onClick={()=>onNavigate("conselheiro")}
          style={{ width:380, background:"#0a0a0a", border:"1px solid #1a1a00", borderRadius:8, padding:"28px 32px", cursor:"pointer", transition:"all 0.2s", display:"flex", alignItems:"center", gap:20 }}
          onMouseEnter={e=>{e.currentTarget.style.border="1px solid #fbbf24"; e.currentTarget.style.background="#0f0e00";}}
          onMouseLeave={e=>{e.currentTarget.style.border="1px solid #1a1a00"; e.currentTarget.style.background="#0a0a0a";}}
        >
          <div style={{ width:60, height:60, borderRadius:8, background:"#1a1400", border:"1px solid #fbbf24", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0 }}>🎯</div>
          <div>
            <div style={{ fontSize:18, fontWeight:"bold", color:"#fbbf24", letterSpacing:2, marginBottom:6 }}>O CONSELHEIRO IA</div>
            <div style={{ fontSize:13, color:"#666", lineHeight:1.7 }}>Agente de trading inteligente<br/>De trader para trader · Análise e operações</div>
          </div>
          <span style={{ marginLeft:"auto", fontSize:22, color:"#fbbf24" }}>→</span>
        </div>
      </div>

      <div style={{ padding:"16px 24px", textAlign:"center", fontSize:9, color:"#222", letterSpacing:1 }}>
        FORCE HUB AI · PARA CLIENTES XP · DE TRADER PARA TRADER
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TELA 3A — PANORAMA DE MERCADO
// ══════════════════════════════════════════════════════════════════════════════
function PanoramaScreen({ onBack }) {
  const TD_KEY = "b7da33a073ea44d3b81cd24c38957647";

  // Twelve Data tickers — tenta múltiplos símbolos até encontrar o correto
  const ASSET_CANDIDATES = {
    WIN:  { candidates: ["WINM26","WIN1!","WINN26","WIN"], exchange: "BVMF", label: "Mini Índice" },
    WDO:  { candidates: ["WDON26","WDO1!","WDOM26","WDOK26","WDO"], exchange: "BVMF", label: "Mini Dólar"  },
    IBOV: { candidates: ["IBOV","^BVSP","IBOV11","BVSP"], exchange: "BVMF", label: "Ibovespa"    },
  };

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [news,    setNews]    = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError,   setNewsError]   = useState(null);
  const [time,    setTime]    = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

  const fmtPrice = (ticker, v) => {
    if (!v || isNaN(v)) return "—";
    const n = parseFloat(v);
    if (ticker === "WDO") return n.toFixed(1);
    return Math.round(n).toLocaleString("pt-BR");
  };

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const results = {};
      // Busca paralela para os 3 ativos
      await Promise.all(Object.entries(ASSET_CANDIDATES).map(async ([ticker, meta]) => {
        let json = null;
        let lastError = "";
        // Tenta cada símbolo candidato até um funcionar
        for (const sym of meta.candidates) {
          try {
            const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=7&apikey=${TD_KEY}&dp=2`;
            const res = await fetch(url, { headers: { "Accept": "application/json" } });
            if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
            const j = await res.json();
            if (j.status === "error" || !j.values?.length) { lastError = j.message || "sem dados"; continue; }
            json = j;
            break;
          } catch(e) { lastError = e.message; continue; }
        }
        if (!json) throw new Error(`${ticker}: não encontrado (${lastError})`);
        const values = [...(json.values || [])].slice(0, 5).reverse();
        results[ticker] = values.map(v => {
          const hi  = parseFloat(v.high);
          const lo  = parseFloat(v.low);
          const amp = parseFloat((hi - lo).toFixed(ticker === "WDO" ? 1 : 0));
          return {
            date:    v.datetime,
            weekday: new Date(v.datetime + "T12:00:00-03:00").toLocaleDateString("pt-BR", { weekday: "short" }).replace(".",""),
            high:  hi,
            low:   lo,
            close: parseFloat(v.close),
            amp,
          };
        });
      }));
      setData(results);
    } catch(e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const loadNews = async () => {
    setNewsLoading(true); setNewsError(null);
    try { const d = await fetchNews(); setNews(d); }
    catch(e) { setNewsError(e.message); }
    setNewsLoading(false);
  };

  const ampColor = (amp, avg) => {
    if (!avg || !amp) return "#fbbf24";
    const r = amp / avg;
    if (r >= 1.15) return "#22c55e";
    if (r <= 0.85) return "#ef4444";
    return "#fbbf24";
  };

  return (
    <div style={{ minHeight:"100vh", background:"#000", fontFamily:"monospace", color:"#fff" }}>

      {/* Top bar */}
      <div style={{ background:"#0a0a0a", borderBottom:"1px solid #2a2000", padding:"0 20px", height:52, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={onBack} style={{ background:"none", border:"1px solid #333", color:"#888", padding:"5px 12px", borderRadius:3, cursor:"pointer", fontSize:11, fontFamily:"monospace" }}>← MENU</button>
          <div style={{ width:1, height:22, background:"#222" }}/>
          <span style={{ fontSize:13, fontWeight:"bold", color:"#fbbf24", letterSpacing:4 }}>PANORAMA DE MERCADO</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={fetchAll} disabled={loading} style={{ background:loading?"#111":"#1a1400", border:`1px solid ${loading?"#333":"#fbbf24"}`, color:loading?"#444":"#fbbf24", padding:"7px 18px", borderRadius:4, cursor:loading?"not-allowed":"pointer", fontSize:10, fontFamily:"monospace", letterSpacing:1, display:"flex", alignItems:"center", gap:7 }}>
            {loading ? <><span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⟳</span> BUSCANDO...</> : <>{data ? "↻ ATUALIZAR" : "▶ CARREGAR DADOS"}</>}
          </button>
          <span style={{ fontSize:10, color:"#444" }}>{time.toLocaleTimeString("pt-BR")}</span>
        </div>
      </div>

      <div style={{ padding:20, display:"flex", flexDirection:"column", gap:16 }}>

        {/* Erro */}
        {error && !loading && (
          <div style={{ background:"#1a0000", border:"1px solid #7f1d1d", borderRadius:6, padding:"12px 16px", display:"flex", gap:10, alignItems:"center" }}>
            <span style={{ color:"#ef4444", fontSize:11 }}>⚠ {error}</span>
            <button onClick={fetchAll} style={{ background:"#2d0a0a", border:"1px solid #7f1d1d", color:"#fca5a5", padding:"4px 10px", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>TENTAR</button>
          </div>
        )}

        {/* Placeholder */}
        {!loading && !data && !error && (
          <div style={{ background:"#0a0a0a", border:"1px solid #1a1a00", borderRadius:8, padding:"40px 20px", textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:12 }}>📊</div>
            <div style={{ fontSize:13, color:"#fbbf24", marginBottom:6 }}>CLIQUE EM "CARREGAR DADOS" PARA BUSCAR</div>
            <div style={{ fontSize:11, color:"#444" }}>WIN · WDO · IBOV — últimos 5 pregões — Twelve Data</div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ background:"#0a0a0a", border:"1px solid #1a1a00", borderRadius:8, padding:"40px 20px", textAlign:"center" }}>
            <div style={{ fontSize:11, color:"#fbbf24", letterSpacing:2, marginBottom:14 }}>BUSCANDO DADOS REAIS — WIN · WDO · IBOV...</div>
            <div style={{ display:"flex", justifyContent:"center", gap:5 }}>
              {[0,1,2,3,4].map(i => <div key={i} style={{ width:4, height:24, background:"#fbbf24", borderRadius:2, animation:`bar 0.9s ${i*0.15}s ease-in-out infinite alternate` }}/>)}
            </div>
          </div>
        )}

        {/* Tabelas */}
        {!loading && data && Object.entries(ASSETS).map(([ticker, meta]) => {
          const rows = data[ticker] || [];
          const amps = rows.map(r => r.amp).filter(Boolean);
          const avg  = amps.length ? parseFloat((amps.reduce((a,b)=>a+b,0)/amps.length).toFixed(ticker==="WDO"?1:0)) : null;

          return (
            <div key={ticker} style={{ background:"#0a0a0a", border:"1px solid #1a1a00", borderRadius:8, overflow:"hidden" }}>
              {/* Header */}
              <div style={{ background:"#0f0e00", borderBottom:"1px solid #222", padding:"12px 18px", display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:18, fontWeight:"bold", color:"#fbbf24", letterSpacing:4 }}>{ticker}</span>
                <span style={{ fontSize:10, color:"#555", letterSpacing:2 }}>{meta.label.toUpperCase()}</span>
                {avg != null && (
                  <span style={{ marginLeft:"auto", fontSize:11, color:"#fbbf24" }}>
                    AMPLITUDE MÉDIA: <strong>{avg.toLocaleString("pt-BR")}</strong> pts
                  </span>
                )}
              </div>

              {/* Cabeçalho tabela */}
              <div style={{ display:"grid", gridTemplateColumns:"90px 80px 1fr 1fr 1fr", background:"#0a0a0a", borderBottom:"1px solid #111" }}>
                {["DIA","DATA","MÁXIMA","MÍNIMA","AMPLITUDE"].map(h => (
                  <div key={h} style={{ padding:"7px 12px", fontSize:9, color:"#444", letterSpacing:1 }}>{h}</div>
                ))}
              </div>

              {/* Linhas */}
              {rows.map((row, i) => {
                const ac = ampColor(row.amp, avg);
                const isLast = i === rows.length - 1;
                return (
                  <div key={i} style={{ display:"grid", gridTemplateColumns:"90px 80px 1fr 1fr 1fr", borderBottom:i<rows.length-1?"1px solid #111":"none", background:isLast?"#0f0e00":"transparent", transition:"background 0.15s" }}
                    onMouseEnter={e=>e.currentTarget.style.background="#111"}
                    onMouseLeave={e=>e.currentTarget.style.background=isLast?"#0f0e00":"transparent"}>
                    <div style={{ padding:"11px 12px", fontSize:13, color:isLast?"#fbbf24":"#888", fontWeight:isLast?"bold":"normal" }}>
                      {row.weekday.charAt(0).toUpperCase()+row.weekday.slice(1,3)}
                    </div>
                    <div style={{ padding:"11px 12px", fontSize:11, color:"#555" }}>
                      {row.date?.slice(5).replace("-","/")}
                    </div>
                    <div style={{ padding:"11px 12px", fontSize:14, color:"#818cf8", fontWeight:"bold" }}>
                      {fmtPrice(ticker, row.high)}
                    </div>
                    <div style={{ padding:"11px 12px", fontSize:14, color:"#d8b4fe" }}>
                      {fmtPrice(ticker, row.low)}
                    </div>
                    <div style={{ padding:"11px 12px", display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontSize:14, fontWeight:"bold", color:ac }}>{fmtPrice(ticker, row.amp)}</span>
                      {avg != null && <span style={{ fontSize:9, color:ac }}>{row.amp>=avg?"▲":"▼"}{Math.abs(((row.amp/avg)-1)*100).toFixed(0)}%</span>}
                    </div>
                  </div>
                );
              })}

              {/* Linha de média */}
              <div style={{ display:"grid", gridTemplateColumns:"90px 80px 1fr 1fr 1fr", background:"#0f0e00", borderTop:"1px solid #222" }}>
                <div style={{ padding:"9px 12px", fontSize:10, color:"#fbbf24", letterSpacing:1, gridColumn:"1/3" }}>MÉDIA DA SEMANA</div>
                <div style={{ padding:"9px 12px", fontSize:12, color:"#818cf8" }}>
                  {rows.length ? fmtPrice(ticker, rows.reduce((s,r)=>s+r.high,0)/rows.length) : "—"}
                </div>
                <div style={{ padding:"9px 12px", fontSize:12, color:"#d8b4fe" }}>
                  {rows.length ? fmtPrice(ticker, rows.reduce((s,r)=>s+r.low,0)/rows.length) : "—"}
                </div>
                <div style={{ padding:"9px 12px", fontSize:15, fontWeight:"bold", color:"#fbbf24" }}>
                  {avg != null ? avg.toLocaleString("pt-BR") : "—"}
                </div>
              </div>
            </div>
          );
        })}

        {/* Notícias */}
        <div style={{ background:"#0a0a0a", border:"1px solid #1a1a00", borderRadius:8, overflow:"hidden" }}>
          <div style={{ background:"#0f0e00", borderBottom:"1px solid #1a1a00", padding:"12px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:13, fontWeight:"bold", color:"#fbbf24", letterSpacing:3 }}>EVENTOS DE ALTO IMPACTO — HOJE</div>
              <div style={{ fontSize:9, color:"#444", marginTop:2, letterSpacing:1 }}>🐂🐂🐂 3 TOUROS · BRASIL & EUA · INVESTING.COM/BR</div>
            </div>
            <button onClick={loadNews} disabled={newsLoading} style={{ background:newsLoading?"#111":"#1a1400", border:`1px solid ${newsLoading?"#333":"#fbbf24"}`, color:newsLoading?"#444":"#fbbf24", padding:"7px 16px", borderRadius:4, cursor:newsLoading?"not-allowed":"pointer", fontSize:10, fontFamily:"monospace", letterSpacing:1, display:"flex", alignItems:"center", gap:6 }}>
              {newsLoading?<><span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⟳</span> BUSCANDO...</>:<>{news?"↻ ATUALIZAR":"▶ BUSCAR EVENTOS"}</>}
            </button>
          </div>

          {newsLoading && <div style={{padding:"20px 0",textAlign:"center",fontSize:10,color:"#444",letterSpacing:2}}>BUSCANDO CALENDÁRIO ECONÔMICO...</div>}
          {newsError && !newsLoading && <div style={{padding:"12px 18px",color:"#ef4444",fontSize:10}}>⚠ {newsError} <button onClick={loadNews} style={{marginLeft:8,background:"#200",border:"1px solid #7f1d1d",color:"#fca5a5",padding:"2px 8px",borderRadius:3,cursor:"pointer",fontSize:9,fontFamily:"monospace"}}>TENTAR</button></div>}
          {!newsLoading && !newsError && !news && <div style={{padding:"22px 18px",textAlign:"center",fontSize:11,color:"#333"}}>CLIQUE EM "BUSCAR EVENTOS" PARA CARREGAR O CALENDÁRIO DE HOJE</div>}

          {!newsLoading && news?.news && (
            <div style={{padding:"12px 18px",display:"flex",flexDirection:"column",gap:6}}>
              <div style={{display:"grid",gridTemplateColumns:"65px 44px 1fr 90px 90px 90px",gap:8,padding:"4px 0"}}>
                {["HORA","PAÍS","EVENTO","ANTERIOR","PREVISÃO","ATUAL"].map(h=><div key={h} style={{fontSize:9,color:"#444",letterSpacing:1}}>{h}</div>)}
              </div>
              {news.news.length===0
                ? <div style={{fontSize:11,color:"#333",padding:"10px 0"}}>Nenhum evento de alto impacto hoje.</div>
                : news.news.map((n,i)=>(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"65px 44px 1fr 90px 90px 90px",gap:8,alignItems:"center",padding:"10px 12px",background:"#111",border:"1px solid #1a1a00",borderRadius:5}}>
                    <div style={{fontSize:13,color:"#fbbf24",fontWeight:"bold"}}>{n.time}</div>
                    <div style={{fontSize:22,textAlign:"center"}}>{(n.country==="Brasil"||n.country==="BR")?"🇧🇷":"🇺🇸"}</div>
                    <div>
                      <div style={{fontSize:12,color:"#e2e8f0"}}>{n.title}</div>
                      <div style={{fontSize:10,color:"#f59e0b",marginTop:2}}>🐂🐂🐂</div>
                    </div>
                    <div style={{textAlign:"right",fontSize:12,color:"#888"}}>{n.previous||"—"}</div>
                    <div style={{textAlign:"right",fontSize:12,color:"#fbbf24"}}>{n.forecast||"—"}</div>
                    <div style={{textAlign:"right",fontSize:13,fontWeight:"bold",color:n.actual?"#22c55e":"#444"}}>{n.actual||"Aguard."}</div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConselheiroScreen({ onBack }) {
  const [msgs,  setMsgs]  = useState([{ role:"assistant", content:"Fala! Sou O Conselheiro. Tô aqui pra trocar ideia sobre mercado, analisar níveis, calcular risco e registrar operações. O que tá rolando?" }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ops,   setOps]   = useState([]);
  const [showOps, setShowOps] = useState(false);
  const [pending, setPending] = useState(null);
  const [time,  setTime]  = useState(new Date());
  const endRef = useRef(null);
  const opId   = useRef(1);
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[msgs]);
  useEffect(()=>{ const t=setInterval(()=>setTime(new Date()),1000); return()=>clearInterval(t); },[]);

  const sys = `Você é O Conselheiro — agente de trading especializado em day trade na B3. Fala de trader para trader: direto, técnico, sem enrolação. Foca em WIN (Mini Índice), WDO (Mini Dólar) e IBOV.
Operações abertas: ${ops.length?ops.map(o=>`${o.ticker} ${o.direction} E:${o.entry} S:${o.stop} A:${o.target}`).join(" | "):"Nenhuma"}
Se quiser registrar operação, retorne JSON: {"action":"reg","ticker":"WIN","direction":"COMPRA","entry":0,"stop":0,"target":0,"qty":1}
Responda em português. Seja direto e objetivo.`;

  const send = async () => {
    if (!input.trim()||loading) return;
    const txt=input.trim(); setInput("");
    const history=[...msgs,{role:"user",content:txt}];
    setMsgs(history); setLoading(true);
    try {
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:sys,messages:history.map(m=>({role:m.role,content:m.content}))})});
      const data=await res.json();
      const text=data.content?.map(b=>b.text||"").join("")||"Erro.";
      const match=text.match(/\{"action":"reg"[^}]+\}/);
      if(match) try{setPending(JSON.parse(match[0]));}catch{}
      setMsgs(m=>[...m,{role:"assistant",content:text}]);
    }catch{setMsgs(m=>[...m,{role:"assistant",content:"Erro de conexão."}]);}
    setLoading(false);
  };

  const addOp = op => setOps(p=>[...p,{...op,id:opId.current++}]);

  return (
    <div style={{ minHeight:"100vh", background:"#000", fontFamily:"monospace", display:"flex", flexDirection:"column" }}>
      {/* Top bar */}
      <div style={{ background:"#0a0a0a", borderBottom:"1px solid #1a1a00", padding:"0 20px", height:52, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={onBack} style={{ background:"none", border:"1px solid #333", color:"#888", padding:"5px 12px", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>← MENU</button>
          <div style={{ width:1, height:22, background:"#222" }}/>
          <div style={{ width:7, height:7, borderRadius:"50%", background:"#fbbf24", boxShadow:"0 0 7px #fbbf24" }}/>
          <span style={{ fontSize:11, fontWeight:"bold", color:"#fbbf24", letterSpacing:3 }}>O CONSELHEIRO</span>
          <span style={{ fontSize:9, color:"#333", letterSpacing:1 }}>DE TRADER PARA TRADER</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={()=>setShowOps(v=>!v)} style={{ background:ops.length?"#1a1400":"#111", border:`1px solid ${ops.length?"#fbbf24":"#222"}`, color:ops.length?"#fbbf24":"#444", padding:"5px 12px", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>
            OPS ({ops.length})
          </button>
          <span style={{ fontSize:10, color:"#444" }}>{time.toLocaleTimeString("pt-BR")}</span>
        </div>
      </div>

      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* Chat */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", maxWidth: showOps?650:"100%", width:"100%" }}>
          <div style={{ flex:1, overflowY:"auto", padding:20, display:"flex", flexDirection:"column", gap:12 }}>
            {msgs.map((m,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
                <div style={{ maxWidth:"80%", background:m.role==="user"?"#1a1400":"#0f0f0f", border:`1px solid ${m.role==="user"?"#fbbf2444":"#222"}`, borderRadius:8, padding:"10px 14px", fontSize:12, color:"#e2e8f0", lineHeight:1.7, whiteSpace:"pre-wrap", fontFamily:"monospace" }}>
                  {m.role==="assistant"&&<div style={{ fontSize:8, color:"#fbbf24", marginBottom:4, letterSpacing:1 }}>O CONSELHEIRO</div>}
                  {m.content}
                </div>
              </div>
            ))}
            {loading&&<div style={{display:"flex"}}><div style={{background:"#0f0f0f",border:"1px solid #222",borderRadius:8,padding:"12px 16px",display:"flex",gap:6}}>{[0,1,2].map(j=><div key={j} style={{width:5,height:5,borderRadius:"50%",background:"#fbbf24",animation:`pulse 0.9s ${j*0.25}s infinite`}}/>)}</div></div>}
            {pending&&(
              <div style={{background:"#0a1200",border:"1px solid #166534",borderRadius:8,padding:14}}>
                <div style={{fontSize:9,color:"#22c55e",marginBottom:6,letterSpacing:1}}>✓ CONFIRMAR REGISTRO DA OPERAÇÃO?</div>
                <div style={{fontSize:11,color:"#4ade80",marginBottom:10}}>{pending.ticker} · {pending.direction} · Entrada: {pending.entry} · Stop: {pending.stop} · Alvo: {pending.target} · {pending.qty}x</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{const{action,...op}=pending;addOp(op);setPending(null);}} style={{background:"#166534",border:"none",color:"#4ade80",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:10,fontFamily:"monospace"}}>CONFIRMAR</button>
                  <button onClick={()=>setPending(null)} style={{background:"#111",border:"1px solid #333",color:"#666",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:10,fontFamily:"monospace"}}>CANCELAR</button>
                </div>
              </div>
            )}
            <div ref={endRef}/>
          </div>
          {/* Input */}
          <div style={{ padding:16, borderTop:"1px solid #111", display:"flex", gap:10 }}>
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}
              placeholder="De trader para trader... (Enter para enviar)"
              style={{ flex:1, background:"#0f0f0f", border:"1px solid #222", borderRadius:6, padding:"10px 14px", color:"#fff", fontSize:12, fontFamily:"monospace", outline:"none" }}
            />
            <button onClick={send} disabled={loading} style={{ background:"#fbbf24", border:"none", color:"#000", padding:"10px 18px", borderRadius:6, cursor:"pointer", fontSize:14, fontWeight:"bold" }}>↑</button>
          </div>
        </div>

        {/* Painel de Ops */}
        {showOps && (
          <div style={{ width:320, borderLeft:"1px solid #1a1a00", background:"#0a0a0a", display:"flex", flexDirection:"column" }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid #111", fontSize:10, color:"#fbbf24", letterSpacing:2 }}>OPERAÇÕES REGISTRADAS</div>
            <div style={{ flex:1, overflowY:"auto", padding:12 }}>
              {ops.length===0
                ? <div style={{ fontSize:10, color:"#333", textAlign:"center", marginTop:40 }}>Nenhuma operação ainda</div>
                : ops.map(op=>{
                  const rr = Math.abs((op.target-op.entry)/(op.entry-op.stop));
                  return(
                    <div key={op.id} style={{ background:"#111", border:"1px solid #1a1a00", borderRadius:6, padding:"10px 12px", marginBottom:8 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                        <span style={{ fontSize:12, fontWeight:"bold", color:"#fbbf24" }}>{op.ticker}</span>
                        <span style={{ fontSize:11, color:op.direction==="COMPRA"?"#22c55e":"#ef4444" }}>{op.direction}</span>
                      </div>
                      <div style={{ fontSize:10, color:"#888", display:"flex", flexDirection:"column", gap:2 }}>
                        <div>Entrada: <span style={{color:"#e2e8f0"}}>{op.entry}</span></div>
                        <div>Stop: <span style={{color:"#ef4444"}}>{op.stop}</span> · Alvo: <span style={{color:"#22c55e"}}>{op.target}</span></div>
                        <div>R:R <span style={{color:rr>=2?"#22c55e":"#fbbf24",fontWeight:"bold"}}>1:{rr.toFixed(2)}</span> · {op.qty}x</div>
                      </div>
                      <button onClick={()=>setOps(p=>p.filter(o=>o.id!==op.id))} style={{marginTop:6,background:"none",border:"1px solid #222",color:"#444",padding:"2px 8px",borderRadius:3,cursor:"pointer",fontSize:9,fontFamily:"monospace"}}>REMOVER</button>
                    </div>
                  );
                })
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL — roteador de telas
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState("login"); // login | menu | panorama | conselheiro
  const [user,   setUser]   = useState("");

  const handleLogin  = (u)   => { setUser(u); setScreen("menu"); };
  const handleLogout = ()    => { setUser(""); setScreen("login"); };
  const navigate     = (s)   => setScreen(s);
  const goBack       = ()    => setScreen("menu");

  return (
    <>
      {screen==="login"       && <LoginScreen onLogin={handleLogin}/>}
      {screen==="menu"        && <MenuScreen user={user} onNavigate={navigate} onLogout={handleLogout}/>}
      {screen==="panorama"    && <PanoramaScreen onBack={goBack}/>}
      {screen==="conselheiro" && <ConselheiroScreen onBack={goBack}/>}

      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#000}
        ::-webkit-scrollbar-thumb{background:#222;border-radius:2px}
        input::placeholder{color:#333}
      `}</style>
    </>
  );
}
