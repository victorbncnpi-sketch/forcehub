// src/ui.jsx — Design system do FORCE HUB AI
// Tokens de tema + componentes reutilizáveis. Mantém a identidade preto/dourado,
// mas com layout mais limpo: sans-serif para textos, monospace só para números.
import { useEffect } from "react";

export const T = {
  bg: "#0a0a0b",
  panel: "#121214",
  panel2: "#17171a",
  inset: "#0e0e10",
  line: "#26262c",
  lineGold: "#3b2f05",
  text: "#eaeaee",
  mut: "#9a9aa3",
  dim: "#5e5e68",
  gold: "#fbbf24",
  goldSoft: "#1c1605",
  green: "#22c55e",
  red: "#ef4444",
  blue: "#818cf8",
  purple: "#c4b5fd",
  sans: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace",
};

const TONES = { gold: T.gold, green: T.green, red: T.red, blue: T.blue, mut: T.mut, purple: T.purple, text: T.text };
const tone = (t) => TONES[t] || t;

export const GLOBAL_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }
body { background: ${T.bg}; color: ${T.text}; font-family: ${T.sans}; -webkit-font-smoothing: antialiased; }
button { font-family: inherit; }
input, textarea { font-family: inherit; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2a2a30; border-radius: 8px; }
::-webkit-scrollbar-thumb:hover { background: #3a3a42; }
::placeholder { color: ${T.dim}; }
@keyframes fh-pulse { 0%,100% { opacity: .3; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
@keyframes fh-spin { to { transform: rotate(360deg); } }
@keyframes fh-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.fh-shell { display: grid; grid-template-columns: 232px 1fr; grid-template-rows: 100vh; height: 100vh; overflow: hidden; }
.fh-side { display: flex; flex-direction: column; background: #101012; border-right: 1px solid ${T.line}; min-height: 0; }
.fh-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
.fh-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.fh-page { flex: 1; min-height: 0; overflow-y: auto; padding: 24px; animation: fh-fade .22s ease; }
/* Quando a página é um flex column, os filhos não devem encolher para caber:
   precisam manter a altura natural para a página ROLAR (senão SVGs colapsam e
   Cards com overflow:hidden cortam o conteúdo em vez de rolar). */
.fh-page > * { flex-shrink: 0; }
.fh-scroll-x { overflow-x: auto; }
.fh-card-hover { transition: border-color .15s, transform .15s; }
.fh-card-hover:hover { border-color: ${T.lineGold}; transform: translateY(-2px); }
.fh-btn:focus-visible, .fh-input:focus-visible, .fh-navitem:focus-visible { outline: 2px solid ${T.gold}; outline-offset: 2px; }
.fh-navitem { display: flex; align-items: center; gap: 12px; padding: 11px 13px; border-radius: 10px; cursor: pointer; color: ${T.mut}; border: 1px solid transparent; transition: all .15s; }
.fh-navitem:hover { background: ${T.panel2}; color: ${T.text}; }
.fh-navitem.active { background: ${T.goldSoft}; color: ${T.gold}; border-color: ${T.lineGold}; }
.fh-btn { cursor: pointer; border-radius: 9px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: all .15s; white-space: nowrap; }
.fh-btn:hover:not(:disabled) { filter: brightness(1.12); }
.fh-btn:disabled { opacity: .45; cursor: not-allowed; }
.fh-input { width: 100%; background: ${T.inset}; border: 1px solid ${T.line}; border-radius: 8px; padding: 11px 13px; color: ${T.text}; font-size: 14px; outline: none; transition: border-color .15s; }
.fh-input:focus { border-color: ${T.gold}; }
.fh-card { background: ${T.panel}; border: 1px solid ${T.line}; border-radius: 14px; }
.fh-news-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
@media (max-width: 960px) { .fh-news-grid { grid-template-columns: 1fr; } }

@media (max-width: 860px) {
  .fh-shell { grid-template-columns: 64px 1fr; }
  .fh-nav-label, .fh-brand-text, .fh-side-detail { display: none; }
  .fh-page { padding: 16px; }
}
@media (max-width: 720px) {
  .fh-diary { position: fixed !important; inset: 0; width: auto !important; z-index: 80; }
}
`;

export function GlobalStyle() {
  return <style>{GLOBAL_CSS}</style>;
}

export function Logo({ size = 20 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: Math.round(size * 0.45), height: Math.round(size * 0.45), borderRadius: "50%", background: T.gold, boxShadow: `0 0 ${size * 0.55}px ${T.gold}`, flexShrink: 0 }} />
      <span className="fh-brand-text" style={{ fontWeight: 800, letterSpacing: 1, fontSize: size }}>
        <span style={{ color: T.gold }}>FORCE</span><span style={{ color: T.text }}>HUB</span>
      </span>
      <span className="fh-brand-text" style={{ background: T.gold, color: "#000", fontSize: Math.round(size * 0.52), fontWeight: 800, padding: "1px 6px", borderRadius: 5 }}>AI</span>
    </div>
  );
}

const BTN_VARIANTS = {
  primary: { background: T.gold, color: "#0a0a0b", border: "1px solid " + T.gold },
  gold:    { background: T.goldSoft, color: T.gold, border: "1px solid " + T.lineGold },
  ghost:   { background: "transparent", color: T.mut, border: "1px solid " + T.line },
  success: { background: "#0c1f0c", color: T.green, border: "1px solid " + T.green },
  danger:  { background: "#1f0c0c", color: T.red, border: "1px solid " + T.red },
};
const BTN_SIZES = { sm: { padding: "7px 12px", fontSize: 13 }, md: { padding: "10px 16px", fontSize: 14 }, lg: { padding: "13px 20px", fontSize: 15 } };

export function Button({ variant = "primary", size = "md", style, children, ...rest }) {
  return (
    <button className="fh-btn" style={{ ...BTN_VARIANTS[variant] || BTN_VARIANTS.primary, ...BTN_SIZES[size], ...style }} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ tone: t = "gold", children, style }) {
  const c = tone(t);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: c, background: c + "1a", border: "1px solid " + c + "40", padding: "3px 8px", borderRadius: 6, fontFamily: T.mono, ...style }}>
      {children}
    </span>
  );
}

export function Card({ children, style, className, ...rest }) {
  return <div className={"fh-card" + (className ? " " + className : "")} style={style} {...rest}>{children}</div>;
}

export function Field({ label, hint, children, style }) {
  return (
    <label style={{ display: "block", ...style }}>
      {label && <div style={{ fontSize: 11, color: T.mut, marginBottom: 6, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>}
      {children}
      {hint && <div style={{ fontSize: 11, color: T.dim, marginTop: 5 }}>{hint}</div>}
    </label>
  );
}

export function Input({ style, mono, ...rest }) {
  return <input className="fh-input" style={{ fontFamily: mono ? T.mono : T.sans, ...style }} {...rest} />;
}

export function EmptyState({ icon, title, desc, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "56px 20px", gap: 12 }}>
      <div style={{ fontSize: 44, opacity: 0.9 }}>{icon}</div>
      <div style={{ fontSize: 16, color: T.text, fontWeight: 600 }}>{title}</div>
      {desc && <div style={{ fontSize: 14, color: T.mut, maxWidth: 440, lineHeight: 1.6 }}>{desc}</div>}
      {children && <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>{children}</div>}
    </div>
  );
}

export function Stat({ label, value, tone: t = "text", mono = true }) {
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: T.mut, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 7 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone(t), fontFamily: mono ? T.mono : T.sans }}>{value}</div>
    </Card>
  );
}

export function Banner({ tone: t = "gold", children }) {
  const c = tone(t);
  return (
    <div style={{ background: c + "14", border: "1px solid " + c + "55", borderRadius: 10, padding: "11px 16px", color: c, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
      <span>⚠</span><span>{children}</span>
    </div>
  );
}

export function Tabs({ items, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: "1px solid " + T.line }}>
      {items.map(it => {
        const active = it.key === value;
        return (
          <button key={it.key} className="fh-btn" onClick={() => onChange(it.key)}
            style={{ background: "transparent", border: "none", borderRadius: 0, borderBottom: "2px solid " + (active ? T.gold : "transparent"), color: active ? T.gold : T.mut, padding: "11px 16px", fontSize: 14, fontWeight: 600 }}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 560 }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.78)", backdropFilter: "blur(3px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, animation: "fh-fade .15s ease" }}>
      <div onClick={e => e.stopPropagation()} className="fh-card" style={{ width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", borderColor: T.lineGold }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 20px", borderBottom: "1px solid " + T.line, position: "sticky", top: 0, background: T.panel }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.gold, letterSpacing: 0.3 }}>{title}</span>
          <button className="fh-btn" onClick={onClose} style={{ background: "transparent", color: T.mut, border: "none", fontSize: 22, width: 32, height: 32 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

export function Dots() {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[0, 1, 2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: T.gold, animation: `fh-pulse .9s ${i * 0.2}s infinite` }} />)}
    </div>
  );
}

// ─── Ícones SVG (estilo linha, herdam a cor via currentColor) ─────────────────
const ICON_PATHS = {
  panorama: <><line x1="4" y1="20" x2="4" y2="4" /><line x1="4" y1="20" x2="20" y2="20" /><rect x="8" y="11" width="3.4" height="6" /><rect x="14" y="7" width="3.4" height="10" /></>,
  carteira: <><polyline points="3 16 9 10 13 14 21 6" /><polyline points="15 6 21 6 21 12" /></>,
  conselheiro: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.4" /></>,
  news: <><rect x="3" y="5" width="14" height="15" rx="2" /><path d="M17 8h4v10a2 2 0 0 1-2 2H6" /><line x1="6" y1="9" x2="13" y2="9" /><line x1="6" y1="13" x2="13" y2="13" /><line x1="6" y1="16" x2="10" y2="16" /></>,
  search: <><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></>,
  attach: <path d="M20.5 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3 3 0 0 1 4.3 4.3l-8.7 8.7a1.4 1.4 0 0 1-2-2l7.9-7.9" />,
  journal: <><path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z" /><line x1="10" y1="4" x2="10" y2="20" /></>,
  send: <><line x1="12" y1="20" x2="12" y2="5" /><polyline points="6 11 12 5 18 11" /></>,
  list: <><line x1="9" y1="7" x2="20" y2="7" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="17" x2="20" y2="17" /><circle cx="5" cy="7" r="1.1" /><circle cx="5" cy="12" r="1.1" /><circle cx="5" cy="17" r="1.1" /></>,
  positions: <><line x1="4" y1="20" x2="4" y2="4" /><line x1="4" y1="20" x2="20" y2="20" /><polyline points="7 15 11 11 14 13 19 7" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M17.5 13.5a5.5 5.5 0 0 1 3 5" /></>,
  dashboard: <><path d="M3.5 14.5a8.5 8.5 0 0 1 17 0" /><line x1="12" y1="14.5" x2="16.2" y2="9.8" /><circle cx="12" cy="14.5" r="1.3" /></>,
  cohort: <><circle cx="7" cy="8" r="2.3" /><circle cx="16" cy="7" r="2.1" /><path d="M2.5 19a4.5 4.5 0 0 1 9 0" /><path d="M12.6 19a4.6 4.6 0 0 1 8.9-1.6" /></>,
  upload: <><path d="M12 16V4" /><polyline points="7 9 12 4 17 9" /><path d="M4 16v3a1.8 1.8 0 0 0 1.8 1.8h12.4A1.8 1.8 0 0 0 20 19v-3" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
};

export function Icon({ name, size = 18, color, style }) {
  const children = ICON_PATHS[name];
  if (!children) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0, ...style }}>
      {children}
    </svg>
  );
}

export function Spinner({ size = 18 }) {
  return <span style={{ display: "inline-block", width: size, height: size, border: "2px solid " + T.line, borderTopColor: T.gold, borderRadius: "50%", animation: "fh-spin .7s linear infinite", flexShrink: 0 }} />;
}

export function Loading({ label = "Carregando..." }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "56px 20px", color: T.mut }}>
      <Spinner /><span style={{ fontSize: 14 }}>{label}</span>
    </div>
  );
}
