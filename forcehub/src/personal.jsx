// src/personal.jsx — PERSONAL TRADER: acompanhamento individual de 30 dias.
//
// Duas visões no mesmo módulo, escolhidas pelo papel de quem entra:
//   • ALUNO  — envia o dia, lê o feedback, acompanha projeção x real;
//   • MENTOR — fila do dia, tela de análise, lista/ficha dos alunos, Sessão Zero.
//
// Tudo que é número vem calculado de /api/personal (motor em api/_pt-regras.js).
// Esta tela NÃO recalcula violação, semáforo nem projeção: se o aluno e o mentor
// vissem contas feitas em lugares diferentes, uma hora elas divergiriam — e o
// produto inteiro é uma conversa sobre esses números.
import { useState, useEffect, useMemo, useRef } from "react";
import { api, resizeImage, parseProfitCsv } from "./shared";
import { T, Button, Badge, Card, Field, Input, EmptyState, Stat, Banner, Disclaimer, Tabs, Modal, Spinner, Loading, Icon, confirmDialog } from "./ui";

// ─── Formatação ──────────────────────────────────────────────────────────────
const BRL = (v) => v == null || !isFinite(v) ? "—" : (v < 0 ? "−R$ " : "R$ ") + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BRLc = (v) => v == null || !isFinite(v) ? "—" : (v < 0 ? "−R$ " : "R$ ") + Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const PCT = (v, casas = 1) => v == null || !isFinite(v) ? "—" : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%";
const NUM = (v, casas = 2) => v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const PTS = (v) => v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("pt-BR");
const dmy = (iso) => { const p = String(iso || "").split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (iso || "—"); };
const dm = (iso) => { const p = String(iso || "").split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : (iso || "—"); };
const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const sinal = (v) => v == null ? T.mut : v > 0 ? T.green : v < 0 ? T.red : T.mut;

// Semáforo do Quadro de Gerenciamento. "fora" é o vermelho — fora da faixa
// combinada, que nem sempre é quebra de regra (ver api/_pt-regras.js).
const COR_NIVEL = { ok: T.green, atencao: T.gold, fora: T.red, neutro: T.dim };
const LABEL_NIVEL = { ok: "No plano", atencao: "Atenção", fora: "Fora da faixa", neutro: "Sem dado" };
const EMOCIONAL = [
  { v: 1, icone: "😖", label: "Muito ruim" }, { v: 2, icone: "😕", label: "Ruim" },
  { v: 3, icone: "😐", label: "Neutro" }, { v: 4, icone: "🙂", label: "Bom" }, { v: 5, icone: "😄", label: "Muito bom" },
];
const emocionalDe = (v) => EMOCIONAL.find(e => e.v === v) || null;

const CATEGORIAS = [
  { k: "decisao", label: "Decisão" }, { k: "execucao", label: "Execução" },
  { k: "gestao", label: "Gestão" }, { k: "emocional", label: "Emocional" },
];

// ─── Peças compartilhadas ────────────────────────────────────────────────────

function Semaforo({ nivel, size = 10 }) {
  const c = COR_NIVEL[nivel] || T.dim;
  return <span title={LABEL_NIVEL[nivel] || ""} aria-label={LABEL_NIVEL[nivel] || ""}
    style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: c, boxShadow: nivel === "neutro" ? "none" : `0 0 ${size}px ${c}66`, flexShrink: 0 }} />;
}

// Quadro de Gerenciamento — as 6 linhas do plano, com o que foi Definido, o que
// aconteceu (Hoje) e o semáforo. Fica no topo de TODAS as telas do aluno e na
// lateral da análise do mentor: é a régua da mentoria inteira.
function QuadroGerenciamento({ linhas, data, compacto }) {
  if (!linhas || !linhas.length) return null;
  return (
    <Card style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "11px 16px", borderBottom: "1px solid " + T.line, background: T.panel2, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Quadro de Gerenciamento</span>
        <span style={{ fontSize: 11.5, color: T.dim }}>{data ? `coluna "Hoje" — pregão de ${dmy(data)}` : "ainda sem envio"}</span>
      </div>
      <div className="fh-scroll-x">
        <div style={{ minWidth: compacto ? 286 : 460 }}>
          <div style={{ display: "grid", gridTemplateColumns: compacto ? "1fr 72px 76px 16px" : "1.6fr 1fr 1fr 24px", gap: 8, padding: compacto ? "8px 12px" : "8px 16px", fontSize: 10, color: T.dim, letterSpacing: 0.4, borderBottom: "1px solid " + T.line }}>
            <div>PARÂMETRO</div><div style={{ textAlign: "right" }}>DEFINIDO</div><div style={{ textAlign: "right" }}>HOJE</div><div />
          </div>
          {linhas.map(l => (
            <div key={l.chave} title={l.nota}
              style={{ display: "grid", gridTemplateColumns: compacto ? "1fr 72px 76px 16px" : "1.6fr 1fr 1fr 24px", gap: 8, padding: compacto ? "9px 12px" : "10px 16px", borderBottom: "1px solid " + T.line, alignItems: "center" }}>
              <div style={{ fontSize: compacto ? 12 : 13, color: T.mut }}>{compacto ? l.label.replace(/\s*\(.*\)/, "") : l.label}</div>
              <div style={{ textAlign: "right", fontSize: compacto ? 12 : 13, fontFamily: T.mono, color: T.text }}>{l.definidoTxt}</div>
              <div style={{ textAlign: "right", fontSize: compacto ? 12 : 13, fontFamily: T.mono, color: COR_NIVEL[l.status] === T.dim ? T.dim : COR_NIVEL[l.status], fontWeight: 600 }}>{l.hojeTxt}</div>
              <div style={{ display: "flex", justifyContent: "center" }}><Semaforo nivel={l.status} /></div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Barra "Dia X de 30". Conta DIAS OPERADOS (envios), não dias de calendário —
// o produto é "30 dias operados", então feriado e dia sem operar não consomem
// o ciclo.
function BarraCiclo({ diaAtual, diasPrevistos, status }) {
  const total = diasPrevistos || 30;
  const pct = Math.min(100, Math.round(((diaAtual || 0) / total) * 100));
  const rotulo = { ativo: null, pausado: ["gold", "Pausado"], concluido: ["green", "Concluído"] }[status];
  return (
    <Card style={{ padding: "13px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
          Dia <span style={{ fontFamily: T.mono, color: T.gold }}>{diaAtual || 0}</span> de {total}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {rotulo && <Badge tone={rotulo[0]}>{rotulo[1]}</Badge>}
          <span style={{ fontSize: 12, color: T.dim }}>{Math.max(0, total - (diaAtual || 0))} dias restantes</span>
        </span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: T.inset, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: T.gold, borderRadius: 4, transition: "width .3s" }} />
      </div>
    </Card>
  );
}

function Alertas({ itens, titulo = "Alertas" }) {
  if (!itens || !itens.length) return null;
  return (
    <Card style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: T.dim, letterSpacing: 0.4, textTransform: "uppercase" }}>{titulo}</div>
      {itens.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, color: T.mut }}>
          <span style={{ color: a.tom === "red" ? T.red : a.tom === "blue" ? T.blue : T.gold, display: "flex", marginTop: 1 }}><Icon name="alert" size={14} /></span>
          <span>{a.texto}</span>
        </div>
      ))}
    </Card>
  );
}

// Print de um envio — carregado sob demanda (a imagem mora em chave própria no
// Redis justamente para não viajar junto com o resto).
function PtPrint({ user, id, alt, onOpen }) {
  const [src, setSrc] = useState(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true; setSrc(null); setErro(false);
    (async () => {
      try {
        const q = "/api/personal?fn=img&id=" + encodeURIComponent(id) + (user ? "&user=" + encodeURIComponent(user) : "");
        const j = await api.get(q);
        if (vivo) { if (j.image) setSrc(j.image); else setErro(true); }
      } catch (e) { if (vivo) setErro(true); }
    })();
    return () => { vivo = false; };
  }, [user, id]);
  if (erro) return <div style={{ fontSize: 12.5, color: T.dim, padding: 12, textAlign: "center" }}>Sem {alt.toLowerCase()}.</div>;
  if (!src) return <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spinner /></div>;
  return <img src={src} alt={alt} onClick={() => onOpen && onOpen(src)}
    style={{ width: "100%", borderRadius: 8, border: "1px solid " + T.line, cursor: onOpen ? "zoom-in" : "default", display: "block" }} />;
}

const TIPO_LABEL = {
  prejuizo_diario: "Prejuízo diário", contratos_acima: "Contratos acima",
  fora_de_horario: "Fora de horário", sem_stop: "Stop não respeitado",
  overtrading: "Overtrading", setup_nao_autorizado: "Setup não autorizado",
};

function Violacoes({ itens }) {
  if (!itens || !itens.length) {
    return <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.green, padding: "10px 0" }}><Icon name="check" size={15} /> Nenhuma violação de gerenciamento neste dia.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {itens.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "#1f0c0c", border: "1px solid " + T.red + "55", borderRadius: 8, padding: "9px 12px" }}>
          <Badge tone="red" style={{ flexShrink: 0 }}>{TIPO_LABEL[v.tipo] || v.tipo}</Badge>
          <span style={{ fontSize: 12.5, color: T.mut, lineHeight: 1.5 }}>{v.texto}</span>
        </div>
      ))}
    </div>
  );
}

// Tabela de operações do dia. Recebe o feedback já publicado para mostrar as
// tags e o comentário embaixo de cada linha (é assim que o aluno lê: operação
// -> tag -> comentário -> recomendação, nunca um texto solto no fim).
function Operacoes({ operacoes, feedback, children }) {
  if (!operacoes || !operacoes.length) {
    return <div style={{ fontSize: 13, color: T.dim, padding: "14px 0" }}>Nenhuma operação registrada neste dia.</div>;
  }
  const porOp = (feedback && feedback.porOperacao) || {};
  return (
    <div className="fh-scroll-x">
      <div style={{ minWidth: 640 }}>
        <div style={{ display: "grid", gridTemplateColumns: "58px 1fr 74px 60px 80px 86px 24px", gap: 8, padding: "8px 12px", fontSize: 10, color: T.dim, letterSpacing: 0.4, borderBottom: "1px solid " + T.line }}>
          <div>HORA</div><div>SETUP</div><div>DIREÇÃO</div><div style={{ textAlign: "right" }}>CTR</div><div style={{ textAlign: "right" }}>PONTOS</div><div style={{ textAlign: "right" }}>R$</div><div />
        </div>
        {operacoes.map(o => {
          const fo = porOp[o.id];
          return (
            <div key={o.id} style={{ borderBottom: "1px solid " + T.line, background: o.dentroDoPlano ? "transparent" : "#1f0c0c55" }}>
              <div style={{ display: "grid", gridTemplateColumns: "58px 1fr 74px 60px 80px 86px 24px", gap: 8, padding: "9px 12px", alignItems: "center", fontFamily: T.mono, fontSize: 12.5 }}>
                <div style={{ color: T.dim }}>{o.hora || "—"}</div>
                <div style={{ fontFamily: T.sans, color: T.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.setup || <span style={{ color: T.dim }}>sem setup</span>}</div>
                <div style={{ color: o.direcao === "VENDA" ? T.red : o.direcao === "COMPRA" ? T.green : T.dim, fontSize: 11 }}>{o.direcao || "—"}</div>
                <div style={{ textAlign: "right", color: T.mut }}>{o.contratos}</div>
                <div style={{ textAlign: "right", color: sinal(o.pontos) }}>{o.pontos == null ? "—" : (o.pontos > 0 ? "+" : "") + PTS(o.pontos)}</div>
                <div style={{ textAlign: "right", color: sinal(o.resultado), fontWeight: 700 }}>{BRL(o.resultado)}</div>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  {!o.dentroDoPlano && <span title={(o.violacoes || []).map(v => TIPO_LABEL[v] || v).join(", ")} style={{ color: T.red, display: "flex" }}><Icon name="alert" size={14} /></span>}
                </div>
              </div>
              {fo && (
                <div style={{ padding: "0 12px 11px 70px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {!!(fo.tags || []).length && <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{fo.tags.map(t => <Badge key={t} tone="purple">{t}</Badge>)}</div>}
                  {fo.comentario && <div style={{ fontSize: 12.5, color: T.mut, lineHeight: 1.6 }}>{fo.comentario}</div>}
                  {fo.recomendacao && <div style={{ fontSize: 12.5, color: T.gold, lineHeight: 1.6 }}>→ {fo.recomendacao}</div>}
                </div>
              )}
            </div>
          );
        })}
        {children}
      </div>
    </div>
  );
}

// ─── Projetado x Real ────────────────────────────────────────────────────────
// Faixa da projeção (pessimista a otimista) + linha do realizado, no MESMO eixo
// de R$ acumulado. Um eixo só: duas escalas fariam qualquer atraso parecer
// desempenho, que é exatamente o que esta tela existe para não deixar acontecer.
function CurvaProjecao({ projecao, curvaReal }) {
  const [hover, setHover] = useState(null);
  if (!projecao || !projecao.cenarios) return null;
  const W = 1000, H = 300, padL = 62, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const dias = projecao.dias;
  const pess = projecao.cenarios.find(c => c.chave === "pessimista").curva;
  const base = projecao.cenarios.find(c => c.chave === "base").curva;
  const otim = projecao.cenarios.find(c => c.chave === "otimista").curva;
  const real = Array.isArray(curvaReal) ? curvaReal : [0];
  // O eixo X vai até o maior dos dois: o aluno pode operar mais dias do que o
  // plano previu, e a linha real não pode vazar para fora do painel.
  const nX = Math.max(dias, real.length - 1);

  const todos = [...pess, ...base, ...otim, ...real, 0];
  let min = Math.min(...todos), max = Math.max(...todos);
  if (max === min) { max = min + 1; }
  const folga = (max - min) * 0.08;
  min -= folga; max += folga;
  const x = (i) => padL + (i / Math.max(1, nX)) * plotW;
  const y = (v) => padT + (1 - (v - min) / (max - min)) * plotH;
  const linha = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${linha(otim)} L${x(dias).toFixed(1)},${y(pess[pess.length - 1]).toFixed(1)} ${pess.slice().reverse().map((v, k) => `L${x(dias - k).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} Z`;

  // 5 marcas no eixo Y, arredondadas para um passo legível.
  const passo = (() => {
    const bruto = (max - min) / 4;
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(bruto, 1e-6))));
    const r = bruto / p;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
  })();
  const marcas = [];
  for (let v = Math.ceil(min / passo) * passo; v <= max; v += passo) marcas.push(v);

  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((vx - padL) / plotW) * nX);
    setHover(i >= 0 && i <= nX ? i : null);
  };

  return (
    <Card style={{ overflow: "hidden" }}>
      <div style={{ padding: "13px 18px", borderBottom: "1px solid " + T.line, background: T.panel2, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Projetado x Realizado</span>
        <span style={{ display: "flex", gap: 14, fontSize: 12, color: T.mut, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 18, height: 3, background: T.s1, borderRadius: 2 }} />Realizado</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 18, height: 0, borderTop: "2px dashed " + T.s2 }} />Projeção (base)</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 18, height: 10, background: T.s2 + "2e", border: "1px solid " + T.s2 + "55", borderRadius: 2 }} />Faixa pessimista–otimista</span>
        </span>
      </div>
      <div style={{ padding: 14 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
          onMouseMove={mover} onMouseLeave={() => setHover(null)} role="img"
          aria-label="Curva de resultado acumulado: faixa projetada e linha realizada, em reais.">
          {marcas.map((v, i) => (
            <g key={i}>
              <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={Math.abs(v) < 1e-9 ? T.line : T.line} strokeWidth={Math.abs(v) < 1e-9 ? 1.4 : 0.8} strokeDasharray={Math.abs(v) < 1e-9 ? "" : "3 5"} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={T.dim} fontFamily={T.mono}>{BRLc(v)}</text>
            </g>
          ))}
          <path d={area} fill={T.s2} opacity="0.16" />
          <path d={linha(base)} fill="none" stroke={T.s2} strokeWidth="2" strokeDasharray="6 5" />
          <path d={linha(real)} fill="none" stroke={T.s1} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
          {real.length > 1 && <circle cx={x(real.length - 1)} cy={y(real[real.length - 1])} r="4" fill={T.s1} />}
          {[0, Math.round(nX / 2), nX].map(d => (
            <text key={d} x={x(d)} y={H - 9} textAnchor={d === 0 ? "start" : d === nX ? "end" : "middle"} fontSize="11" fill={T.dim} fontFamily={T.mono}>dia {d}</text>
          ))}
          {hover != null && (
            <g>
              <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + plotH} stroke={T.gold} strokeWidth="1" opacity=".55" />
              {hover < real.length && <circle cx={x(hover)} cy={y(real[hover])} r="4.5" fill={T.s1} stroke={T.bg} strokeWidth="1.5" />}
              {hover < base.length && <circle cx={x(hover)} cy={y(base[hover])} r="4" fill={T.s2} stroke={T.bg} strokeWidth="1.5" />}
            </g>
          )}
        </svg>
        {hover != null && (
          <div style={{ display: "flex", gap: 18, justifyContent: "center", fontSize: 12.5, color: T.mut, fontFamily: T.mono, paddingTop: 8, flexWrap: "wrap" }}>
            <span>dia {hover}</span>
            <span style={{ color: T.s1 }}>realizado {hover < real.length ? BRL(real[hover]) : "—"}</span>
            <span style={{ color: T.s2 }}>projetado {hover < base.length ? BRL(base[hover]) : "fim do ciclo"}</span>
            {hover < pess.length && <span style={{ color: T.dim }}>faixa {BRLc(pess[hover])} a {BRLc(otim[hover])}</span>}
          </div>
        )}
      </div>
    </Card>
  );
}

// Decomposição do desvio: planejado x real em cada uma das quatro variáveis,
// com o impacto em R$ que só ela explica. Os impactos não somam o desvio total
// (as variáveis interagem) — por isso destacamos "o que mais pesou", não uma
// contabilidade fechada.
function Decomposicao({ comparacao }) {
  if (!comparacao) return null;
  const c = comparacao;
  const RITMO = {
    adiantado: ["green", "Adiantado"], no_ritmo: ["gold", "No ritmo"],
    atrasado: ["red", "Atrasado"], sem_dados: ["mut", "Sem dados"],
  }[c.ritmo] || ["mut", "—"];
  const fmt = (v, tipo) => v == null ? "—" : tipo === "pct" ? PCT(v) : tipo === "brl" ? BRL(v) : NUM(v);
  return (
    <Card style={{ overflow: "hidden" }}>
      <div style={{ padding: "13px 18px", borderBottom: "1px solid " + T.line, background: T.panel2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>O que explica o desvio</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Badge tone={RITMO[0]}>{RITMO[1]}</Badge>
          <span style={{ fontSize: 12.5, color: T.mut, fontFamily: T.mono }}>{c.desvio >= 0 ? "+" : ""}{BRL(c.desvio)}{c.desvioPct != null && ` (${c.desvioPct >= 0 ? "+" : ""}${c.desvioPct.toFixed(0)}%)`}</span>
        </span>
      </div>
      {c.principal && (
        <div style={{ padding: "12px 18px", borderBottom: "1px solid " + T.line, fontSize: 13, color: T.mut, lineHeight: 1.6 }}>
          O que mais pesou até aqui foi <b style={{ color: T.gold }}>{c.principal.label.toLowerCase()}</b>.
        </div>
      )}
      <div className="fh-scroll-x">
        <div style={{ minWidth: 460 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 8, padding: "8px 18px", fontSize: 10, color: T.dim, letterSpacing: 0.4, borderBottom: "1px solid " + T.line }}>
            <div>VARIÁVEL</div><div style={{ textAlign: "right" }}>PLANEJADO</div><div style={{ textAlign: "right" }}>REAL</div><div style={{ textAlign: "right" }}>IMPACTO</div>
          </div>
          {c.variaveis.map(v => (
            <div key={v.chave} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 8, padding: "10px 18px", borderBottom: "1px solid " + T.line, alignItems: "center", fontSize: 13 }}>
              <div style={{ color: c.principal && c.principal.chave === v.chave ? T.gold : T.mut, fontWeight: c.principal && c.principal.chave === v.chave ? 700 : 400 }}>{v.label}</div>
              <div style={{ textAlign: "right", fontFamily: T.mono, color: T.dim }}>{fmt(v.planejado, v.fmt)}</div>
              <div style={{ textAlign: "right", fontFamily: T.mono, color: T.text }}>{fmt(v.real, v.fmt)}</div>
              <div style={{ textAlign: "right", fontFamily: T.mono, color: sinal(v.delta) }}>{v.delta == null ? "—" : (v.delta > 0 ? "+" : "") + BRL(v.delta)}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: "10px 18px", fontSize: 11.5, color: T.dim, lineHeight: 1.6 }}>
        Impacto = quanto o resultado projetado mudaria se APENAS aquela variável fosse a real. Os quatro não somam o desvio total porque interagem entre si.
      </div>
    </Card>
  );
}

// Metas de PROCESSO em destaque; resultado financeiro em segundo plano e sempre
// em faixa. Hierarquia obrigatória do COMANDO 2: processo é o que o aluno
// controla; forçar o número no fim do mês é exatamente o que queremos evitar.
function MetasProcesso({ real, projecao }) {
  const base = projecao && projecao.cenarios ? projecao.cenarios.find(c => c.chave === "base") : null;
  const pess = projecao && projecao.cenarios ? projecao.cenarios.find(c => c.chave === "pessimista") : null;
  const otim = projecao && projecao.cenarios ? projecao.cenarios.find(c => c.chave === "otimista") : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12 }}>
        <Stat label="Aderência ao plano" value={real.aderencia == null ? "—" : real.aderencia.toFixed(0) + "%"}
          tone={real.aderencia == null ? "mut" : real.aderencia >= 90 ? "green" : real.aderencia >= 70 ? "gold" : "red"} />
        <Stat label="Violações no ciclo" value={String(real.violacoes || 0)} tone={real.violacoes ? "red" : "green"} />
        <Stat label="Dias sem violação" value={String(real.sequenciaLimpa || 0)} tone={real.sequenciaLimpa >= 3 ? "green" : "gold"} />
        <Stat label="Dias operados" value={String(real.diasOperados || 0)} tone="gold" />
      </div>
      <Card style={{ padding: "13px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: T.dim, letterSpacing: 0.4, textTransform: "uppercase" }}>Resultado do ciclo</div>
          <div style={{ fontSize: 19, fontWeight: 700, fontFamily: T.mono, color: sinal(real.resultado), marginTop: 4 }}>{BRL(real.resultado)}</div>
        </div>
        {base && (
          <div style={{ textAlign: "right", fontSize: 12, color: T.dim, lineHeight: 1.7 }}>
            <div>projeção ao fim do ciclo</div>
            <div style={{ fontFamily: T.mono, color: T.mut }}>{BRLc(pess.resultadoProjetado)} a {BRLc(otim.resultadoProjetado)}</div>
            <div style={{ fontFamily: T.mono, color: T.dim }}>base {BRLc(base.resultadoProjetado)}</div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── VISÃO DO ALUNO ──────────────────────────────────────────────────────────

// Tela 1 — Enviar o dia. A meta é preencher em ~20 segundos: as operações vêm
// prontas (CSV do Profit ou do Diário de Trades que o aluno já usa no hub) e só
// o resumo e o estado emocional são digitados. Quanto mais longo o formulário,
// menos dias enviados — e sem envio não existe mentoria.
const FONTES = [
  { k: "csv", label: "CSV do Profit", dica: "Relatório de Operações exportado do Profit (.csv)." },
  { k: "diario", label: "Meu Diário de Trades", dica: "Puxa as operações que você já lançou no Diário." },
  { k: "manual", label: "Digitar", dica: "Lançar as operações uma a uma." },
];

function EnviarDia({ plano, jornada, onEnviado }) {
  const [data, setData] = useState(hojeISO());
  const [fonte, setFonte] = useState("csv");
  const [ops, setOps] = useState([]);
  const [resumo, setResumo] = useState("");
  const [emocional, setEmocional] = useState(3);
  const [imgs, setImgs] = useState({ relatorio: null, print: null });
  const [msg, setMsg] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const jaEnviado = (jornada.envios || []).find(e => e.data === data);

  const setOp = (i, k, v) => setOps(a => a.map((o, j) => j === i ? { ...o, [k]: v } : o));
  const addOp = () => setOps(a => [...a, { id: "m" + Date.now() + a.length, hora: "", direcao: "COMPRA", contratos: plano ? plano.contratos : 1, resultado: "", setup: "" }]);

  const lerCsv = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    if (file.size > 5 * 1024 * 1024) { setMsg({ tom: "red", txt: "Arquivo muito grande (máx. 5 MB)." }); return; }
    try {
      const buf = await file.arrayBuffer();
      let texto;
      // Mesma detecção do Diário: Profit exporta ora em UTF-8, ora em latin-1.
      try { texto = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch (e2) { texto = new TextDecoder("windows-1252").decode(buf); }
      const res = parseProfitCsv(texto, null);
      if (res.error) { setMsg({ tom: "red", txt: res.error }); return; }
      const doDia = res.trades.filter(t => t.data === data);
      if (!doDia.length) {
        const datas = [...new Set(res.trades.map(t => t.data))].sort();
        setMsg({ tom: "gold", txt: `O arquivo não tem operações em ${dmy(data)}. Ele cobre ${datas.length ? dmy(datas[0]) + " a " + dmy(datas[datas.length - 1]) : "nenhuma data"} — ajuste a data do envio.` });
        return;
      }
      setOps(doDia.map((t, i) => ({
        id: "c" + i, hora: t.hora || "", ativo: t.ativo, direcao: t.direcao,
        contratos: t.qtd || (plano ? plano.contratos : 1), resultado: t.fin, setup: "", ext: t.ext,
      })));
      setMsg(res.abertas
        ? { tom: "gold", txt: `${doDia.length} operação(ões) lidas de ${dmy(data)}. ${res.abertas} posição(ões) ainda aberta(s) no arquivo ficaram de fora — se for deste dia, exporte de novo depois de zerar.` }
        : { tom: "green", txt: `${doDia.length} operação(ões) lidas de ${dmy(data)}.` });
    } catch (err) { setMsg({ tom: "red", txt: "Falha ao ler o arquivo: " + err.message }); }
  };

  const puxarDiario = async () => {
    setMsg(null);
    try {
      const j = await api.get("/api/trades");
      const doDia = (j.trades || []).filter(t => t.data === data && typeof t.fin === "number");
      if (!doDia.length) { setMsg({ tom: "gold", txt: `Nenhuma operação com resultado em R$ no seu Diário em ${dmy(data)}.` }); return; }
      setOps(doDia.map((t, i) => ({
        id: "d" + i, hora: t.hora || "", ativo: t.ativo, direcao: t.direcao,
        contratos: t.qtd || (plano ? plano.contratos : 1), resultado: t.fin, setup: t.setup || "",
      })));
      // Operação antiga do Diário pode não ter horário — e sem ele a regra de
      // horário permitido fica cega. Melhor avisar do que passar batido.
      const semHora = doDia.filter(t => !t.hora).length;
      setMsg(semHora
        ? { tom: "gold", txt: `${doDia.length} operação(ões) trazidas do Diário — ${semHora} sem horário. Preencha a hora para o gerenciamento conferir a faixa permitida.` }
        : { tom: "green", txt: `${doDia.length} operação(ões) trazidas do Diário.` });
    } catch (e) { setMsg({ tom: "red", txt: e.message }); }
  };

  const escolherImg = async (slot, e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 1400, 0.72);
      setImgs(s => ({ ...s, [slot]: dataUrl }));
    } catch (err) { setMsg({ tom: "red", txt: "Não consegui ler a imagem." }); }
  };

  const enviar = async () => {
    if (enviando) return;
    const limpas = ops
      .map(o => ({ ...o, resultado: o.resultado === "" || o.resultado == null ? null : Number(o.resultado), contratos: Number(o.contratos) || null }))
      .filter(o => o.resultado != null && isFinite(o.resultado));
    if (!limpas.length && !resumo.trim()) { setMsg({ tom: "red", txt: "Envie ao menos as operações do dia ou escreva um resumo." }); return; }
    if (jaEnviado && jaEnviado.status === "analisado") {
      setMsg({ tom: "gold", txt: `O dia ${dmy(data)} já foi analisado pelo mentor. Para corrigi-lo, peça a ele para reabrir.` });
      return;
    }
    if (jaEnviado && !(await confirmDialog({
      title: `Reenviar o dia ${dmy(data)}?`,
      message: "As operações deste dia serão substituídas pelas novas, e o resumo também.",
      confirmLabel: "Reenviar",
    }))) return;
    setEnviando(true); setMsg(null);
    try {
      const j = await api.post("/api/personal", {
        action: "envio", data, resumo, emocional, origem: fonte,
        operacoes: limpas, temRelatorio: !!imgs.relatorio, temPrint: !!imgs.print,
      });
      // Os prints vão depois, já com o id do envio — cada imagem mora numa chave
      // própria no banco (elas são grandes demais para viajar com o resto).
      const id = j.envio && j.envio.id;
      if (id) {
        for (const [slot, chave] of [["relatorio", "relatorio"], ["print", "print"]]) {
          if (!imgs[slot]) continue;
          try { await api.post("/api/personal", { action: "img", id: id + "-" + chave, data: imgs[slot] }); }
          catch (e) { setMsg({ tom: "gold", txt: "O dia foi enviado, mas um dos prints não subiu: " + e.message }); }
        }
      }
      setOps([]); setResumo(""); setImgs({ relatorio: null, print: null });
      await onEnviado();
      setMsg(m => m || { tom: "green", txt: "Dia enviado. O mentor recebe na fila dele e você é avisado aqui quando o feedback sair." });
    } catch (e) { setMsg({ tom: "red", txt: e.message }); }
    finally { setEnviando(false); }
  };

  const total = ops.reduce((s, o) => s + (Number(o.resultado) || 0), 0);
  const fonteAtual = FONTES.find(f => f.k === fonte);
  const chip = (ativo) => ({ padding: "7px 13px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, border: "1px solid " + (ativo ? T.lineGold : T.line), background: ativo ? T.goldSoft : "transparent", color: ativo ? T.gold : T.mut });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Dia operado" style={{ width: 170 }}>
            <Input type="date" value={data} max={hojeISO()} onChange={e => { setData(e.target.value); setOps([]); setMsg(null); }} />
          </Field>
          {jaEnviado && (
            <Badge tone={jaEnviado.status === "analisado" ? "green" : "gold"} style={{ marginBottom: 11 }}>
              {jaEnviado.status === "analisado" ? "Já analisado" : "Já enviado — aguardando análise"}
            </Badge>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, color: T.mut, marginBottom: 8, letterSpacing: 0.4, textTransform: "uppercase" }}>Operações do dia</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
            {FONTES.map(f => <button key={f.k} className="fh-btn" style={chip(fonte === f.k)} onClick={() => { setFonte(f.k); setMsg(null); }}>{f.label}</button>)}
          </div>
          <div style={{ fontSize: 12, color: T.dim, marginBottom: 10 }}>{fonteAtual.dica}</div>
          {fonte === "csv" && (
            <label className="fh-btn" style={{ display: "inline-flex", padding: "10px 16px", fontSize: 14, borderRadius: 9, border: "1px dashed " + T.line, color: T.mut, cursor: "pointer", gap: 8 }}>
              <Icon name="upload" size={16} /> Escolher arquivo .csv
              <input type="file" accept=".csv,text/csv" onChange={lerCsv} style={{ display: "none" }} />
            </label>
          )}
          {fonte === "diario" && <Button variant="ghost" size="sm" onClick={puxarDiario}>Puxar operações de {dmy(data)}</Button>}
          {fonte === "manual" && <Button variant="ghost" size="sm" onClick={addOp}>+ Adicionar operação</Button>}
        </div>

        {msg && <Banner tone={msg.tom}>{msg.txt}</Banner>}

        {!!ops.length && (
          <div style={{ border: "1px solid " + T.line, borderRadius: 10, overflow: "hidden" }}>
            <div className="fh-scroll-x">
              <div style={{ minWidth: 560 }}>
                <div style={{ display: "grid", gridTemplateColumns: "72px 90px 62px 100px 1fr 30px", gap: 8, padding: "8px 12px", fontSize: 10, color: T.dim, letterSpacing: 0.4, borderBottom: "1px solid " + T.line, background: T.panel2 }}>
                  <div>HORA</div><div>DIREÇÃO</div><div>CTR</div><div>RESULTADO R$</div><div>SETUP</div><div />
                </div>
                {ops.map((o, i) => (
                  <div key={o.id} style={{ display: "grid", gridTemplateColumns: "72px 90px 62px 100px 1fr 30px", gap: 8, padding: "7px 12px", borderBottom: "1px solid " + T.line, alignItems: "center" }}>
                    <Input value={o.hora || ""} placeholder="09:30" onChange={e => setOp(i, "hora", e.target.value)} mono style={{ padding: "6px 8px", fontSize: 12 }} />
                    <select className="fh-input" value={o.direcao || ""} onChange={e => setOp(i, "direcao", e.target.value || null)} style={{ padding: "6px 8px", fontSize: 12 }}>
                      <option value="">—</option><option value="COMPRA">Compra</option><option value="VENDA">Venda</option>
                    </select>
                    <Input type="number" value={o.contratos ?? ""} onChange={e => setOp(i, "contratos", e.target.value)} mono style={{ padding: "6px 8px", fontSize: 12 }} />
                    <Input type="number" step="0.01" value={o.resultado ?? ""} onChange={e => setOp(i, "resultado", e.target.value)} mono style={{ padding: "6px 8px", fontSize: 12, color: sinal(Number(o.resultado)) }} />
                    {plano && plano.setups && plano.setups.length ? (
                      <select className="fh-input" value={o.setup || ""} onChange={e => setOp(i, "setup", e.target.value)} style={{ padding: "6px 8px", fontSize: 12 }}>
                        <option value="">— setup —</option>
                        {plano.setups.map(s => <option key={s} value={s}>{s}</option>)}
                        <option value="Outro">Outro (fora do plano)</option>
                      </select>
                    ) : <Input value={o.setup || ""} placeholder="setup" onChange={e => setOp(i, "setup", e.target.value)} style={{ padding: "6px 8px", fontSize: 12 }} />}
                    <button className="fh-btn" onClick={() => setOps(a => a.filter((_, j) => j !== i))} title="Remover"
                      style={{ background: "transparent", border: "none", color: T.dim, padding: 0 }}><Icon name="trash" size={14} /></button>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", fontSize: 13 }}>
                  <span style={{ color: T.dim }}>{ops.length} operação(ões)</span>
                  <span style={{ fontFamily: T.mono, fontWeight: 700, color: sinal(total) }}>{BRL(total)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <Field label="Como foi o dia?" hint="Uma ou duas frases. É o que o mentor lê antes de olhar os números.">
          <textarea className="fh-input" rows={3} value={resumo} maxLength={2000} onChange={e => setResumo(e.target.value)}
            placeholder="Ex.: entrei cedo no rompimento, stopei, e depois forcei uma entrada para recuperar." style={{ resize: "vertical", lineHeight: 1.6 }} />
        </Field>

        <div>
          <div style={{ fontSize: 11, color: T.mut, marginBottom: 8, letterSpacing: 0.4, textTransform: "uppercase" }}>Estado emocional</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {EMOCIONAL.map(x => (
              <button key={x.v} className="fh-btn" onClick={() => setEmocional(x.v)} title={x.label}
                style={{ ...chip(emocional === x.v), display: "flex", flexDirection: "column", gap: 3, padding: "8px 14px", lineHeight: 1.2 }}>
                <span style={{ fontSize: 19 }}>{x.icone}</span>
                <span style={{ fontSize: 10.5 }}>{x.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
          {[["relatorio", "Print do relatório"], ["print", "Print de performance"]].map(([slot, label]) => (
            <label key={slot} className="fh-btn" style={{ display: "flex", padding: "10px 14px", fontSize: 13, borderRadius: 9, border: "1px dashed " + (imgs[slot] ? T.lineGold : T.line), background: imgs[slot] ? T.goldSoft : "transparent", color: imgs[slot] ? T.gold : T.mut, cursor: "pointer", gap: 8 }}>
              <Icon name={imgs[slot] ? "check" : "attach"} size={15} />
              {imgs[slot] ? label + " anexado" : label + " (opcional)"}
              <input type="file" accept="image/*" onChange={e => escolherImg(slot, e)} style={{ display: "none" }} />
            </label>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button onClick={enviar} disabled={enviando}>{enviando ? <><Spinner size={14} /> Enviando...</> : "Enviar para análise"}</Button>
        </div>
      </Card>
    </div>
  );
}

// Um dia com feedback publicado. Fica no nível do módulo de propósito: definido
// dentro de FeedbackTab, cada tecla digitada no campo de réplica remontaria a
// subárvore inteira e o input perderia o foco.
function BlocoFeedback({ e, destaque, replica, setReplica, salvando, onLido, onZoom, user }) {
  return (
    <Card style={{ overflow: "hidden", borderColor: destaque && !e.feedback.lido ? T.lineGold : T.line }}>
      <div style={{ padding: "13px 18px", borderBottom: "1px solid " + T.line, background: T.panel2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{dmy(e.data)}</span>
          <span style={{ fontFamily: T.mono, fontSize: 13, color: sinal(e.dia.resultado) }}>{BRL(e.dia.resultado)}</span>
          {!!(e.violacoes || []).length && <Badge tone="red">{e.violacoes.length} violação(ões)</Badge>}
        </span>
        {!e.feedback.lido ? <Badge tone="gold">● NOVO</Badge> : <span style={{ fontSize: 11.5, color: T.dim }}>lido</span>}
      </div>
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        {e.feedback.geral && (
          <div>
            <div style={{ fontSize: 11, color: T.dim, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 7 }}>Leitura do dia</div>
            <div style={{ fontSize: 14, color: T.text, lineHeight: 1.75, whiteSpace: "pre-line" }}>{e.feedback.geral}</div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 11, color: T.dim, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 7 }}>Operação por operação</div>
          <Operacoes operacoes={e.operacoes} feedback={e.feedback} />
        </div>
        <Violacoes itens={e.violacoes} />
        {(e.temRelatorio || e.temPrint) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {e.temRelatorio && <PtPrint user={user} id={e.id + "-relatorio"} alt="Relatório" onOpen={onZoom} />}
            {e.temPrint && <PtPrint user={user} id={e.id + "-print"} alt="Performance" onOpen={onZoom} />}
          </div>
        )}
        {e.feedback.replica && (
          <div style={{ background: T.inset, border: "1px solid " + T.line, borderRadius: 9, padding: "11px 14px" }}>
            <div style={{ fontSize: 11, color: T.dim, marginBottom: 5 }}>Sua pergunta</div>
            <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.6 }}>{e.feedback.replica}</div>
          </div>
        )}
        {!e.feedback.lido && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid " + T.line, paddingTop: 14 }}>
            <Field label="Ficou alguma dúvida? (1 pergunta)" hint="O mentor responde na análise do próximo dia.">
              <Input value={replica} maxLength={800} onChange={ev => setReplica(ev.target.value)} placeholder="Ex.: naquela entrada das 10h, o que você teria feito?" />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Button size="sm" disabled={salvando} onClick={() => onLido(e, !!replica.trim())}>
                {salvando ? <Spinner size={13} /> : "Li e entendi"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// Tela 2 — Feedback. O dia mais recente em destaque; o histórico abaixo,
// filtrável por tag. O "Li e entendi" existe porque o mentor precisa saber que
// a análise chegou — é o fechamento do ciclo diário.
function FeedbackTab({ jornada, onMudou }) {
  const [filtro, setFiltro] = useState("");
  const [replica, setReplica] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [zoom, setZoom] = useState(null);
  const analisados = (jornada.envios || []).filter(e => e.feedback).slice().reverse();
  const [abertoId, setAbertoId] = useState(null);

  const todasTags = useMemo(() => {
    const s = new Set();
    analisados.forEach(e => Object.values(e.feedback.porOperacao || {}).forEach(fo => (fo.tags || []).forEach(t => s.add(t))));
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [analisados]);

  const lista = filtro
    ? analisados.filter(e => Object.values(e.feedback.porOperacao || {}).some(fo => (fo.tags || []).includes(filtro)))
    : analisados;

  if (!analisados.length) {
    return <EmptyState icon="💬" title="Nenhum feedback ainda"
      desc="Assim que o mentor analisar um dia enviado, a análise aparece aqui — com o comentário de cada operação e a leitura do dia." />;
  }

  const ultimo = lista[0];
  const marcarLido = async (envio, comReplica) => {
    setSalvando(true);
    try {
      await api.post("/api/personal", { action: "lido", envioId: envio.id, ...(comReplica ? { replica } : {}) });
      setReplica("");
      await onMudou();
    } catch (e) { /* o botão volta ao normal; o aluno tenta de novo */ }
    finally { setSalvando(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {zoom && <Modal title="Print" width={900} onClose={() => setZoom(null)}><img src={zoom} alt="Print" style={{ width: "100%", borderRadius: 8 }} /></Modal>}
      {!!todasTags.length && (
        <Card style={{ padding: "12px 16px", display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: T.dim, letterSpacing: 0.4, textTransform: "uppercase", marginRight: 4 }}>Filtrar por tag</span>
          <button className="fh-btn" onClick={() => setFiltro("")} style={{ padding: "5px 11px", borderRadius: 7, fontSize: 12, border: "1px solid " + (filtro ? T.line : T.lineGold), background: filtro ? "transparent" : T.goldSoft, color: filtro ? T.mut : T.gold }}>Todas</button>
          {todasTags.map(t => (
            <button key={t} className="fh-btn" onClick={() => setFiltro(f => f === t ? "" : t)}
              style={{ padding: "5px 11px", borderRadius: 7, fontSize: 12, border: "1px solid " + (filtro === t ? T.lineGold : T.line), background: filtro === t ? T.goldSoft : "transparent", color: filtro === t ? T.gold : T.mut }}>{t}</button>
          ))}
        </Card>
      )}
      {!lista.length
        ? <EmptyState icon="🔍" title="Nenhum dia com essa tag" desc="Tente outra tag ou volte para todas." />
        : <>
          <BlocoFeedback e={ultimo} destaque replica={replica} setReplica={setReplica} salvando={salvando} onLido={marcarLido} onZoom={setZoom} />
          {lista.length > 1 && (
            <>
              <div style={{ fontSize: 11, color: T.dim, letterSpacing: 0.5, textTransform: "uppercase", marginTop: 4 }}>Feedbacks anteriores</div>
              {lista.slice(1).map(e => (
                <Card key={e.id} style={{ overflow: "hidden" }}>
                  <button className="fh-btn" onClick={() => setAbertoId(id => id === e.id ? null : e.id)}
                    style={{ width: "100%", background: "transparent", border: "none", borderRadius: 0, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ color: abertoId === e.id ? T.gold : T.dim, transform: abertoId === e.id ? "none" : "rotate(-90deg)", transition: "transform .18s", display: "flex" }}><Icon name="chevron" size={15} /></span>
                      <span style={{ fontSize: 14, color: T.text, fontWeight: 600 }}>{dmy(e.data)}</span>
                      {!e.feedback.lido && <Badge tone="gold">novo</Badge>}
                    </span>
                    <span style={{ fontFamily: T.mono, fontSize: 13, color: sinal(e.dia.resultado) }}>{BRL(e.dia.resultado)}</span>
                  </button>
                  {abertoId === e.id && <div style={{ borderTop: "1px solid " + T.line }}><BlocoFeedback e={e} replica={replica} setReplica={setReplica} salvando={salvando} onLido={marcarLido} onZoom={setZoom} /></div>}
                </Card>
              ))}
            </>
          )}
        </>}
    </div>
  );
}

// Tela 3 — Projeção x Real. Ordem deliberada: primeiro as metas de PROCESSO
// (aderência, violações, dias limpos), depois o dinheiro. A curva vem em faixa,
// nunca como número único — projeção é ferramenta de decisão, não promessa.
function ProjecaoTab({ jornada }) {
  const { real, projecao, comparacao, envios } = jornada;
  const [tabela, setTabela] = useState(false);
  if (!projecao) {
    return <EmptyState icon="📐" title="Projeção indisponível"
      desc="O plano precisa de pontos de alvo e stop, contratos, valor do ponto, operações por dia, acerto alvo e dias previstos para gerar a faixa de projeção. Fale com o mentor." />;
  }
  const base = projecao.cenarios.find(c => c.chave === "base");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <MetasProcesso real={real} projecao={projecao} />
      <CurvaProjecao projecao={projecao} curvaReal={real.curva} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="ghost" size="sm" onClick={() => setTabela(v => !v)}>{tabela ? "Ocultar tabela" : "Ver como tabela"}</Button>
      </div>
      {tabela && (
        <Card style={{ overflow: "hidden" }}>
          <div className="fh-scroll-x">
            <div style={{ minWidth: 520 }}>
              <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr 1fr", gap: 8, padding: "8px 16px", fontSize: 10, color: T.dim, letterSpacing: 0.4, borderBottom: "1px solid " + T.line }}>
                <div>DIA</div><div>DATA</div><div style={{ textAlign: "right" }}>RESULTADO</div><div style={{ textAlign: "right" }}>ACUMULADO</div><div style={{ textAlign: "right" }}>PROJETADO</div>
              </div>
              {envios.map((e, i) => (
                <div key={e.id} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr 1fr", gap: 8, padding: "9px 16px", borderBottom: "1px solid " + T.line, fontSize: 12.5, fontFamily: T.mono }}>
                  <div style={{ color: T.dim }}>{i + 1}</div>
                  <div style={{ color: T.mut }}>{dmy(e.data)}</div>
                  <div style={{ textAlign: "right", color: sinal(e.dia.resultado) }}>{BRL(e.dia.resultado)}</div>
                  <div style={{ textAlign: "right", color: sinal(real.curva[i + 1]) }}>{BRL(real.curva[i + 1])}</div>
                  <div style={{ textAlign: "right", color: T.dim }}>{BRL(base.curva[Math.min(i + 1, base.curva.length - 1)])}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
      <Decomposicao comparacao={comparacao} />
      <Card style={{ overflow: "hidden" }}>
        <div style={{ padding: "13px 18px", borderBottom: "1px solid " + T.line, background: T.panel2, fontSize: 15, fontWeight: 700, color: T.text }}>Cenários da projeção</div>
        <div className="fh-scroll-x">
          <div style={{ minWidth: 560 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 1fr 1fr", gap: 8, padding: "8px 18px", fontSize: 10, color: T.dim, letterSpacing: 0.4, borderBottom: "1px solid " + T.line }}>
              <div>CENÁRIO</div><div style={{ textAlign: "right" }}>ACERTO</div><div style={{ textAlign: "right" }}>EXPECT.</div><div style={{ textAlign: "right" }}>AO FIM DO CICLO</div><div style={{ textAlign: "right" }}>DRAWDOWN EST.</div>
            </div>
            {projecao.cenarios.map(c => (
              <div key={c.chave} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 1fr 1fr", gap: 8, padding: "10px 18px", borderBottom: "1px solid " + T.line, alignItems: "center", fontSize: 13 }}>
                <div style={{ color: c.chave === "base" ? T.gold : T.mut, fontWeight: c.chave === "base" ? 700 : 400 }}>{c.label}</div>
                <div style={{ textAlign: "right", fontFamily: T.mono, color: T.mut }}>{PCT(c.winRateAlvo, 0)}</div>
                <div style={{ textAlign: "right", fontFamily: T.mono, color: sinal(c.expectativaEmR) }}>{NUM(c.expectativaEmR)}R</div>
                <div style={{ textAlign: "right", fontFamily: T.mono, color: sinal(c.resultadoProjetado) }}>{BRL(c.resultadoProjetado)}</div>
                <div style={{ textAlign: "right", fontFamily: T.mono, color: T.red }}>−{BRLc(c.drawdownEsperado)}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: "11px 18px", fontSize: 11.5, color: T.dim, lineHeight: 1.6 }}>
          Só o acerto varia entre os cenários (±10 p.p. sobre o alvo do plano): payoff, frequência e risco dependem da sua disciplina, o acerto depende do mercado.
          O drawdown é uma estimativa da maior sequência de perdas provável, não um limite.
        </div>
      </Card>
      <Disclaimer title="Como ler esta tela">
        A meta que vale é a de <b>processo</b> — aderência ao plano, violações e dias sem violação. O resultado financeiro é consequência e aparece sempre em faixa.
        Projeção não é promessa de retorno: é a régua para decidir o que ajustar.
      </Disclaimer>
    </div>
  );
}

function PersonalAluno({ session }) {
  const [jornada, setJornada] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("enviar");

  const carregar = async () => {
    try { const j = await api.get("/api/personal"); setJornada(j); setErro(""); }
    catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  if (carregando) return <div style={{ padding: 40 }}><Loading label="Carregando sua jornada..." /></div>;
  if (erro) return <div className="fh-page"><Banner tone="red">{erro}</Banner></div>;
  if (!jornada || !jornada.ciclo) {
    return (
      <div className="fh-page">
        <EmptyState icon="🎯" title="Seu Personal Trader ainda não começou"
          desc="O ciclo de 30 dias começa na Sessão Zero, a reunião em que o mentor avalia sua capacidade financeira e define o plano de risco. Fale com o mentor para agendar." />
      </div>
    );
  }
  const novos = (jornada.envios || []).filter(e => e.feedback && !e.feedback.lido).length;
  const abas = [
    { key: "enviar", label: jornada.enviouHoje ? "Enviar o dia ✓" : "Enviar o dia" },
    { key: "feedback", label: novos ? `Feedback (${novos})` : "Feedback" },
    { key: "projecao", label: "Projeção x Real" },
  ];

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <BarraCiclo diaAtual={jornada.real.diasOperados} diasPrevistos={jornada.ciclo.diasPrevistos} status={jornada.ciclo.status} />
      <QuadroGerenciamento linhas={jornada.quadro} data={jornada.quadroData} />
      <Alertas itens={jornada.alertas} titulo="Atenção" />
      {jornada.ciclo.status === "concluido" && <RelatorioFinal jornada={jornada} />}
      <Tabs items={abas} value={aba} onChange={setAba} />
      {aba === "enviar" && <EnviarDia plano={jornada.plano} jornada={jornada} onEnviado={carregar} />}
      {aba === "feedback" && <FeedbackTab jornada={jornada} onMudou={carregar} />}
      {aba === "projecao" && <ProjecaoTab jornada={jornada} />}
    </div>
  );
}

// ─── COMANDO 5 — Relatório final do ciclo ────────────────────────────────────
// Seis seções na ordem do documento. É o que comprova a evolução ao aluno e o
// que abre a conversa do próximo ciclo, então ele precisa sair da tela: o botão
// imprime só este bloco (e "Salvar como PDF" do navegador vira o arquivo).
// A identidade preto/dourado é preservada no papel via print-color-adjust.
const CSS_IMPRESSAO = `
@media print {
  body.fh-print * { visibility: hidden !important; }
  body.fh-print #fh-relatorio, body.fh-print #fh-relatorio * { visibility: visible !important; }
  body.fh-print #fh-relatorio { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 !important; }
  body.fh-print .fh-no-print { display: none !important; }
  body.fh-print, body.fh-print #fh-relatorio * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  @page { margin: 12mm; }
}`;

function SecaoRel({ n, titulo, children }) {
  return (
    <Card style={{ overflow: "hidden", breakInside: "avoid" }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid " + T.line, background: T.panel2, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", background: T.goldSoft, border: "1px solid " + T.lineGold, color: T.gold, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, flexShrink: 0 }}>{n}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{titulo}</span>
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </Card>
  );
}

function RelatorioFinal({ jornada, nomeAluno }) {
  const { ciclo, envios, plano, real, projecao, comparacao, proximoCiclo, tags } = jornada;
  const nome = nomeAluno || ciclo.nome || "";

  const imprimir = () => {
    document.body.classList.add("fh-print");
    const limpar = () => { document.body.classList.remove("fh-print"); window.removeEventListener("afterprint", limpar); };
    window.addEventListener("afterprint", limpar);
    window.print();
    setTimeout(limpar, 1500); // rede de segurança: alguns navegadores não disparam afterprint
  };

  // Efeito de cada versão do plano: média de resultado por dia enquanto ela
  // valia. É o que responde "o ajuste funcionou?" sem depender de impressão.
  const porVersao = (ciclo.planos || []).map(p => {
    const dela = envios.filter(e => e.planoVersao === p.versao);
    const soma = dela.reduce((s, e) => s + (e.dia.resultado || 0), 0);
    const viol = dela.reduce((s, e) => s + (e.violacoes || []).length, 0);
    return { plano: p, dias: dela.length, media: dela.length ? soma / dela.length : null, violacoesDia: dela.length ? viol / dela.length : null };
  });

  const violTipos = Object.entries(real.violacoesPorTipo || {}).sort((a, b) => b[1] - a[1]);
  const maxViol = violTipos.length ? violTipos[0][1] : 0;

  return (
    <>
      <style>{CSS_IMPRESSAO}</style>
      <div id="fh-relatorio" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card style={{ padding: 20, borderColor: T.lineGold, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: T.gold, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>Personal Trader · Relatório de fechamento</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text, marginTop: 6 }}>{nome}</div>
            <div style={{ fontSize: 12.5, color: T.dim, marginTop: 5, fontFamily: T.mono }}>
              {ciclo.inicio ? dmy(ciclo.inicio) : "—"} a {ciclo.fim ? dmy(ciclo.fim) : dmy(hojeISO())} · {real.diasOperados} dias operados · {real.ops} operações
            </div>
          </div>
          <Button className="fh-no-print" variant="gold" size="sm" onClick={imprimir} style={{ flexShrink: 0 }}>Imprimir / Salvar em PDF</Button>
        </Card>

        <SecaoRel n={1} titulo="Resumo do ciclo">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <Stat label="Dias operados" value={String(real.diasOperados)} tone="gold" />
            <Stat label="Operações" value={String(real.ops)} tone="mut" />
            <Stat label="Resultado final" value={BRL(real.resultado)} tone={real.resultado >= 0 ? "green" : "red"} />
            <Stat label="Acerto" value={PCT(real.winRate, 0)} tone="mut" />
            <Stat label="Payoff" value={NUM(real.payoff)} tone={real.payoff >= 1 ? "green" : "red"} />
            <Stat label="Drawdown máximo" value={"−" + BRLc(real.drawdownReal)} tone="red" />
          </div>
          {real.melhorDia && real.piorDia && (
            <div style={{ marginTop: 14, fontSize: 13, color: T.mut, lineHeight: 1.8 }}>
              Melhor dia: <b style={{ color: T.green, fontFamily: T.mono }}>{BRL(real.melhorDia.dia.resultado)}</b> em {dmy(real.melhorDia.data)} ·
              pior dia: <b style={{ color: T.red, fontFamily: T.mono }}>{BRL(real.piorDia.dia.resultado)}</b> em {dmy(real.piorDia.data)}.
            </div>
          )}
        </SecaoRel>

        <SecaoRel n={2} titulo="Projetado x Realizado">
          {projecao ? <>
            <CurvaProjecao projecao={projecao} curvaReal={real.curva} />
            <div style={{ marginTop: 14 }}><Decomposicao comparacao={comparacao} /></div>
          </> : <div style={{ fontSize: 13, color: T.dim }}>O plano do ciclo não tinha os campos necessários para gerar a projeção.</div>}
        </SecaoRel>

        <SecaoRel n={3} titulo="Aderência ao plano">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
            <Stat label="Operações no plano" value={real.aderencia == null ? "—" : real.aderencia.toFixed(0) + "%"} tone={real.aderencia >= 90 ? "green" : real.aderencia >= 70 ? "gold" : "red"} />
            <Stat label="Violações" value={String(real.violacoes)} tone={real.violacoes ? "red" : "green"} />
            <Stat label="Dias com violação" value={`${real.diasComViolacao} de ${real.diasOperados}`} tone={real.diasComViolacao ? "gold" : "green"} />
            <Stat label="Sequência limpa final" value={String(real.sequenciaLimpa) + " dias"} tone={real.sequenciaLimpa >= 3 ? "green" : "mut"} />
          </div>
          {violTipos.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {violTipos.map(([tipo, n]) => (
                <div key={tipo} style={{ display: "grid", gridTemplateColumns: "180px 1fr 40px", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, color: T.mut }}>{TIPO_LABEL[tipo] || tipo}</span>
                  <span style={{ height: 8, borderRadius: 4, background: T.inset, overflow: "hidden" }}>
                    <span style={{ display: "block", width: ((n / maxViol) * 100) + "%", height: "100%", background: T.red, borderRadius: 4 }} />
                  </span>
                  <span style={{ fontSize: 12.5, fontFamily: T.mono, color: T.text, textAlign: "right" }}>{n}</span>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 13, color: T.green }}>Ciclo inteiro sem nenhuma violação de gerenciamento.</div>}
          <div style={{ marginTop: 16, display: "flex", gap: 3, flexWrap: "wrap", alignItems: "flex-end" }}>
            {envios.map(e => {
              const v = (e.violacoes || []).length;
              return <span key={e.id} title={`${dmy(e.data)} — ${v} violação(ões)`}
                style={{ width: 13, height: 13, borderRadius: 3, background: v === 0 ? T.green : v <= 2 ? T.gold : T.red, opacity: 0.85 }} />;
            })}
          </div>
          <div style={{ fontSize: 11.5, color: T.dim, marginTop: 7 }}>Evolução dia a dia: verde = sem violação, amarelo = até 2, vermelho = 3 ou mais.</div>
        </SecaoRel>

        <SecaoRel n={4} titulo="Mapa de erros e acertos">
          {tags && tags.length ? (
            <div className="fh-scroll-x">
              <div style={{ minWidth: 460 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 80px 80px 90px", gap: 8, padding: "8px 0", fontSize: 10, color: T.dim, letterSpacing: 0.4, borderBottom: "1px solid " + T.line }}>
                  <div>TAG</div><div style={{ textAlign: "right" }}>TOTAL</div><div style={{ textAlign: "right" }}>1ª METADE</div><div style={{ textAlign: "right" }}>2ª METADE</div><div style={{ textAlign: "right" }}>TENDÊNCIA</div>
                </div>
                {tags.map(t => (
                  <div key={t.tag} style={{ display: "grid", gridTemplateColumns: "1fr 70px 80px 80px 90px", gap: 8, padding: "9px 0", borderBottom: "1px solid " + T.line, alignItems: "center", fontSize: 13 }}>
                    <div style={{ color: T.mut }}>{t.tag}</div>
                    <div style={{ textAlign: "right", fontFamily: T.mono, color: T.text }}>{t.total}</div>
                    <div style={{ textAlign: "right", fontFamily: T.mono, color: T.dim }}>{t.primeira}</div>
                    <div style={{ textAlign: "right", fontFamily: T.mono, color: T.dim }}>{t.segunda}</div>
                    <div style={{ textAlign: "right" }}>
                      <Badge tone={t.tendencia === "caiu" ? "green" : t.tendencia === "subiu" ? "red" : "mut"}>
                        {t.tendencia === "caiu" ? "↓ caiu" : t.tendencia === "subiu" ? "↑ subiu" : "= estável"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : <div style={{ fontSize: 13, color: T.dim }}>Nenhuma tag aplicada no ciclo.</div>}
        </SecaoRel>

        <SecaoRel n={5} titulo="Histórico do gerenciamento">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {porVersao.map(({ plano: p, dias, media, violacoesDia }) => (
              <div key={p.versao} style={{ border: "1px solid " + T.line, borderRadius: 10, padding: "12px 15px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <Badge tone="gold">v{p.versao}</Badge>
                    <span style={{ fontSize: 12.5, color: T.dim, fontFamily: T.mono }}>a partir de {dmy(p.vigenciaInicio)}</span>
                  </span>
                  <span style={{ fontSize: 12.5, color: T.dim, fontFamily: T.mono }}>
                    {dias} dia(s) · média {media == null ? "—" : BRL(media)}/dia · {violacoesDia == null ? "—" : NUM(violacoesDia, 1)} violação/dia
                  </span>
                </div>
                <div style={{ fontSize: 13, color: T.mut, marginTop: 8, lineHeight: 1.6 }}>{p.motivo}</div>
                <div style={{ fontSize: 12, color: T.dim, marginTop: 8, fontFamily: T.mono }}>
                  alvo {PTS(p.pontosAlvo)} · stop {PTS(p.pontosStop)} · {p.contratos} contrato(s) · ganho {BRLc(p.ganhoDiarioAlvo)} · limite {BRLc(p.prejuizoDiarioLimite)}
                </div>
              </div>
            ))}
          </div>
        </SecaoRel>

        <SecaoRel n={6} titulo="Projeção do próximo ciclo (recalibrada)">
          {proximoCiclo ? <>
            <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.7, marginBottom: 14 }}>
              Refeita com os números que você entregou neste ciclo: acerto de <b style={{ color: T.text }}>{PCT(real.winRate, 0)}</b>,
              alvo médio de <b style={{ color: T.text }}>{PTS(proximoCiclo.plano.pontosAlvo)} pts</b>, stop médio de <b style={{ color: T.text }}>{PTS(proximoCiclo.plano.pontosStop)} pts</b> e
              <b style={{ color: T.text }}> {proximoCiclo.plano.operacoesDia}</b> operação(ões) por dia. O risco por operação continua sendo decisão do mentor.
            </div>
            <div className="fh-scroll-x">
              <div style={{ minWidth: 460 }}>
                {proximoCiclo.cenarios.map(c => (
                  <div key={c.chave} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 1fr", gap: 8, padding: "10px 0", borderBottom: "1px solid " + T.line, alignItems: "center", fontSize: 13 }}>
                    <div style={{ color: c.chave === "base" ? T.gold : T.mut, fontWeight: c.chave === "base" ? 700 : 400 }}>{c.label}</div>
                    <div style={{ textAlign: "right", fontFamily: T.mono, color: T.dim }}>{PCT(c.winRateAlvo, 0)}</div>
                    <div style={{ textAlign: "right", fontFamily: T.mono, color: sinal(c.expectativaEmR) }}>{NUM(c.expectativaEmR)}R</div>
                    <div style={{ textAlign: "right", fontFamily: T.mono, color: sinal(c.resultadoProjetado) }}>{BRL(c.resultadoProjetado)}</div>
                  </div>
                ))}
              </div>
            </div>
          </> : <div style={{ fontSize: 13, color: T.dim }}>Faltam operações suficientes para recalibrar a projeção.</div>}
        </SecaoRel>

        <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7, padding: "0 4px 8px" }}>
          Victor Noronha Consultoria e Análise · Conteúdo educacional de gestão de risco e execução. Resultados passados não garantem resultados futuros;
          a projeção é uma ferramenta de decisão apresentada em faixa, não promessa de retorno.
        </div>
      </div>
    </>
  );
}

// ─── PAINEL DO MENTOR ────────────────────────────────────────────────────────

// Espelho de camposCalculados/avisosDoPlano de api/_pt-regras.js, só para o
// formulário reagir enquanto o mentor digita na reunião. O servidor recalcula e
// revalida tudo ao salvar — aqui é feedback imediato, não autoridade.
// Se mudar a regra lá, mude aqui (são as mesmas quatro contas e quatro avisos).
function calcLocal(p) {
  const n = (v) => { const x = Number(v); return isFinite(x) && x > 0 ? x : null; };
  const alvo = n(p.pontosAlvo), stop = n(p.pontosStop), ctr = n(p.contratos), vp = n(p.valorPonto);
  const risco = (stop && ctr && vp) ? stop * ctr * vp : null;
  const dias = n(p.diasPrevistosOperando), meta = n(p.metaMensal), limite = n(p.prejuizoDiarioLimite);
  return {
    payoff: (alvo && stop) ? alvo / stop : null,
    riscoPorOperacao: risco,
    ganhoPorOperacao: (alvo && ctr && vp) ? alvo * ctr * vp : null,
    maxOperacoesPerdedorasDia: (risco && limite) ? Math.floor(limite / risco) : null,
    ganhoDiarioNecessario: (meta && dias) ? meta / dias : null,
  };
}
function avisosLocal(p, diag) {
  const c = calcLocal(p);
  const out = [];
  const alvoDia = Number(p.ganhoDiarioAlvo);
  if (c.ganhoDiarioNecessario != null && alvoDia > 0 && c.ganhoDiarioNecessario > alvoDia)
    out.push({ tom: "red", texto: `Meta agressiva para o risco definido: a meta mensal exige ${BRL(c.ganhoDiarioNecessario)} por dia, mas o ganho diário alvo é ${BRL(alvoDia)}.` });
  if (c.payoff != null && c.payoff < 1)
    out.push({ tom: "red", texto: `Relação risco/retorno desfavorável: payoff ${c.payoff.toFixed(2)}. Exige acerto acima de ${(100 / (1 + c.payoff)).toFixed(0)}% só para empatar.` });
  const cap = Number(diag && diag.capitalOperacional);
  if (cap > 0 && c.riscoPorOperacao) {
    const pct = (c.riscoPorOperacao / cap) * 100;
    if (pct > 2) out.push({ tom: "red", texto: `Risco elevado para o capital: ${BRL(c.riscoPorOperacao)} por operação, ${pct.toFixed(1)}% do capital operacional (referência: até 2%).` });
  }
  if (c.maxOperacoesPerdedorasDia != null && c.maxOperacoesPerdedorasDia < 2)
    out.push({ tom: "gold", texto: `Stop diário muito apertado: cabe ${c.maxOperacoesPerdedorasDia} operação perdedora. O aluno encerra o dia no primeiro erro.` });
  return out;
}

const PLANO_VAZIO = {
  ativo: "WIN", valorPonto: 0.2, pontosAlvo: "", pontosStop: "", contratos: "",
  ganhoDiarioAlvo: "", prejuizoDiarioLimite: "", metaMensal: "", diasPrevistosOperando: 20,
  horaInicio: "09:15", horaFim: "17:00", setups: [], operacoesDia: 4, winRateAlvo: 50, motivo: "",
};

// Formulário do plano de risco — o mesmo nas duas portas de entrada: Sessão
// Zero (v1) e "Ajustar gerenciamento" (v2+). Os campos calculados aparecem ao
// vivo porque é isso que faz a reunião render: o mentor mexe num número e já vê
// o payoff, o risco e quantos stops cabem no dia.
function FormPlano({ plano, setPlano, diagnostico, novaVersao }) {
  const [setup, setSetup] = useState("");
  const c = calcLocal(plano);
  const avisos = avisosLocal(plano, diagnostico);
  const campo = (k) => ({ value: plano[k] ?? "", onChange: e => setPlano(p => ({ ...p, [k]: e.target.value })) });
  const addSetup = () => {
    const s = setup.trim();
    if (!s) return;
    setPlano(p => ({ ...p, setups: [...new Set([...(p.setups || []), s])].slice(0, 20) }));
    setSetup("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {novaVersao && (
        <Field label="Motivo da mudança (obrigatório)" hint="Fica registrado na versão do plano e aparece no relatório final. É o que permite avaliar se o ajuste funcionou.">
          <textarea className="fh-input" rows={2} maxLength={400} {...campo("motivo")}
            placeholder="Ex.: reduzir o stop após três dias seguidos batendo o limite diário." style={{ resize: "vertical", lineHeight: 1.6 }} />
        </Field>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <Field label="Ativo"><Input {...campo("ativo")} placeholder="WIN" /></Field>
        <Field label="Valor do ponto (R$)" hint="WIN: 0,20"><Input type="number" step="0.01" mono {...campo("valorPonto")} /></Field>
        <Field label="Pontos alvo"><Input type="number" mono {...campo("pontosAlvo")} /></Field>
        <Field label="Pontos de stop"><Input type="number" mono {...campo("pontosStop")} /></Field>
        <Field label="Contratos por entrada"><Input type="number" mono {...campo("contratos")} /></Field>
        <Field label="Operações por dia" hint="Frequência prevista"><Input type="number" mono {...campo("operacoesDia")} /></Field>
        <Field label="Ganho diário alvo (R$)"><Input type="number" step="0.01" mono {...campo("ganhoDiarioAlvo")} /></Field>
        <Field label="Prejuízo diário limite (R$)"><Input type="number" step="0.01" mono {...campo("prejuizoDiarioLimite")} /></Field>
        <Field label="Meta mensal (R$)"><Input type="number" step="0.01" mono {...campo("metaMensal")} /></Field>
        <Field label="Dias previstos operando"><Input type="number" mono {...campo("diasPrevistosOperando")} /></Field>
        <Field label="Acerto alvo (%)" hint="Centro da faixa da projeção"><Input type="number" mono {...campo("winRateAlvo")} /></Field>
        <Field label="Horário permitido">
          <div style={{ display: "flex", gap: 8 }}>
            <Input type="time" mono {...campo("horaInicio")} /><Input type="time" mono {...campo("horaFim")} />
          </div>
        </Field>
      </div>

      <Field label="Setups autorizados" hint="Operação com setup fora desta lista vira violação. Deixe vazio para não checar.">
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={setup} onChange={e => setSetup(e.target.value)} placeholder="Ex.: Rompimento de topo"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSetup(); } }} />
          <Button variant="ghost" size="sm" onClick={addSetup}>Adicionar</Button>
        </div>
      </Field>
      {!!(plano.setups || []).length && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: -8 }}>
          {plano.setups.map(s => (
            <button key={s} className="fh-btn" onClick={() => setPlano(p => ({ ...p, setups: p.setups.filter(x => x !== s) }))}
              style={{ padding: "4px 10px", borderRadius: 7, fontSize: 12, border: "1px solid " + T.lineGold, background: T.goldSoft, color: T.gold }}>
              {s} ×
            </button>
          ))}
        </div>
      )}

      <Card style={{ padding: "14px 16px", background: T.inset }}>
        <div style={{ fontSize: 11, color: T.dim, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 10 }}>Campos calculados</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 12 }}>
          {[
            ["Payoff", c.payoff == null ? "—" : c.payoff.toFixed(2), c.payoff >= 1 ? T.green : T.red],
            ["Risco por operação", BRL(c.riscoPorOperacao), T.text],
            ["Ganho por operação", BRL(c.ganhoPorOperacao), T.text],
            ["Stops que cabem no dia", c.maxOperacoesPerdedorasDia == null ? "—" : String(c.maxOperacoesPerdedorasDia), c.maxOperacoesPerdedorasDia >= 2 ? T.text : T.gold],
            ["Ganho diário necessário", BRL(c.ganhoDiarioNecessario), T.text],
          ].map(([l, v, cor]) => (
            <div key={l}>
              <div style={{ fontSize: 10.5, color: T.dim, marginBottom: 4 }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: T.mono, color: cor }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {avisos.map((a, i) => <Banner key={i} tone={a.tom}>{a.texto}</Banner>)}
    </div>
  );
}

// Tela 5 — Sessão Zero: o formulário guiado que o mentor preenche junto com o
// aluno. Diagnóstico da capacidade financeira + Quadro de Gerenciamento; o
// sistema calcula os derivados, valida a coerência e gera o Plano v1.
function SessaoZero({ alvo, disponiveis, onPronto, onCancelar }) {
  const editando = !!alvo;
  const [user, setUser] = useState(alvo ? alvo.user : "");
  const [nome, setNome] = useState(alvo ? alvo.nome : "");
  const [contato, setContato] = useState(alvo ? (alvo.ciclo && alvo.ciclo.contato) || "" : "");
  const [inicio, setInicio] = useState(alvo ? alvo.inicio || hojeISO() : hojeISO());
  const [diasPrevistos, setDias] = useState(alvo ? alvo.diasPrevistos || 30 : 30);
  const [diag, setDiag] = useState(() => (alvo && alvo.ciclo && alvo.ciclo.diagnostico) || { outraRenda: false });
  const [plano, setPlano] = useState(() => {
    const p = alvo && alvo.plano;
    return p ? { ...p, winRateAlvo: Math.round((p.winRateAlvo || 0.5) * 100), motivo: "" } : { ...PLANO_VAZIO };
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const dcampo = (k) => ({ value: diag[k] ?? "", onChange: e => setDiag(d => ({ ...d, [k]: e.target.value })) });

  const salvar = async () => {
    if (salvando) return;
    if (!user) { setErro("Escolha o aluno."); return; }
    if (!plano.pontosAlvo || !plano.pontosStop || !plano.contratos) { setErro("Pontos de alvo, de stop e contratos por entrada são obrigatórios."); return; }
    setSalvando(true); setErro("");
    try {
      await api.post("/api/personal?user=" + encodeURIComponent(user), {
        action: "ciclo", nome, contato, inicio, diasPrevistos: Number(diasPrevistos) || 30,
        diagnostico: { ...diag, outraRenda: !!diag.outraRenda },
        plano: { ...plano, vigenciaInicio: inicio, winRateAlvo: Number(plano.winRateAlvo) },
      });
      await onPronto(user);
    } catch (e) { setErro(e.message); }
    finally { setSalvando(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.gold }}>1. Quem é o aluno</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <Field label="Aluno">
            {editando ? <Input value={user} disabled /> : (
              <select className="fh-input" value={user} onChange={e => { setUser(e.target.value); const d = disponiveis.find(x => x.user === e.target.value); if (d && !nome) setNome(d.name); }}>
                <option value="">— escolher —</option>
                {disponiveis.map(d => <option key={d.user} value={d.user}>{d.name} ({d.user})</option>)}
              </select>
            )}
          </Field>
          <Field label="Nome no acompanhamento"><Input value={nome} onChange={e => setNome(e.target.value)} /></Field>
          <Field label="Contato" hint="WhatsApp ou e-mail"><Input value={contato} onChange={e => setContato(e.target.value)} /></Field>
          <Field label="Início do ciclo"><Input type="date" value={inicio} onChange={e => setInicio(e.target.value)} /></Field>
          <Field label="Dias operados no ciclo"><Input type="number" mono value={diasPrevistos} onChange={e => setDias(e.target.value)} /></Field>
        </div>
      </Card>

      <Card style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.gold }}>2. Diagnóstico — capacidade financeira</div>
          <div style={{ fontSize: 12.5, color: T.dim, marginTop: 5 }}>Visível só para a equipe. O aluno nunca vê esta seção.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <Field label="Capital operacional (R$)" hint="O que ele pode colocar em risco"><Input type="number" step="0.01" mono {...dcampo("capitalOperacional")} /></Field>
          <Field label="Capital total (R$)"><Input type="number" step="0.01" mono {...dcampo("capitalTotal")} /></Field>
          <Field label="Aporte mensal (R$)"><Input type="number" step="0.01" mono {...dcampo("aporteMensal")} /></Field>
          <Field label="Tempo de experiência"><Input {...dcampo("experiencia")} placeholder="Ex.: 2 anos" /></Field>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, color: T.mut, cursor: "pointer" }}>
          <input type="checkbox" checked={!!diag.outraRenda} onChange={e => setDiag(d => ({ ...d, outraRenda: e.target.checked }))} />
          Tem outra fonte de renda
        </label>
        <Field label="Resultado histórico">
          <textarea className="fh-input" rows={2} maxLength={1200} {...dcampo("resultadoHistorico")} style={{ resize: "vertical", lineHeight: 1.6 }} />
        </Field>
        <Field label="Observações do mentor">
          <textarea className="fh-input" rows={3} maxLength={2000} {...dcampo("observacoes")} style={{ resize: "vertical", lineHeight: 1.6 }} />
        </Field>
      </Card>

      <Card style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.gold }}>3. Plano de risco {editando ? "(v1)" : ""}</div>
          <div style={{ fontSize: 12.5, color: T.dim, marginTop: 5 }}>Vira o Quadro de Gerenciamento que o aluno vê no topo de todas as telas.</div>
        </div>
        <FormPlano plano={plano} setPlano={setPlano} diagnostico={diag} />
      </Card>

      {erro && <Banner tone="red">{erro}</Banner>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={onCancelar}>Cancelar</Button>
        <Button onClick={salvar} disabled={salvando}>{salvando ? <Spinner size={14} /> : editando ? "Salvar Sessão Zero" : "Criar ciclo e Plano v1"}</Button>
      </div>
    </div>
  );
}

// Tela 2 — Análise. É aqui que o produto escala ou morre: a meta é fechar um
// aluno em ~5 minutos. Por isso tudo que o mentor precisa está numa tela só —
// os três painéis (performance, relatório, resumo), o Quadro com as violações
// já marcadas, as tags a um clique (ou a uma tecla) e os snippets que ele mesmo
// já escreveu antes. Nada de rolar para procurar informação.
function TelaAnalise({ aluno, envio, tags, onVoltar, onPublicado, onAjustarPlano }) {
  const [fb, setFb] = useState(() => ({
    geral: (envio.feedback && envio.feedback.geral) || "",
    porOperacao: JSON.parse(JSON.stringify((envio.feedback && envio.feedback.porOperacao) || {})),
  }));
  const [selId, setSelId] = useState((envio.operacoes[0] || {}).id || null);
  const [categoria, setCategoria] = useState("decisao");
  const [zoom, setZoom] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const geralRef = useRef(null);

  const ops = envio.operacoes || [];
  const doOp = (id) => fb.porOperacao[id] || { tags: [], comentario: "", recomendacao: "" };
  const setOpFb = (id, patch) => setFb(f => ({ ...f, porOperacao: { ...f.porOperacao, [id]: { ...doOp(id), ...patch } } }));
  const toggleTag = (id, nome) => {
    const atual = doOp(id).tags || [];
    setOpFb(id, { tags: atual.includes(nome) ? atual.filter(t => t !== nome) : [...atual, nome] });
  };

  const daCategoria = (tags || []).filter(t => t.categoria === categoria);
  // Snippets sugeridos: os comentários que o mentor mais usou com as tags já
  // marcadas nesta operação. É o que transforma a biblioteca em velocidade.
  const sugestoes = useMemo(() => {
    const marcadas = new Set(doOp(selId).tags || []);
    const out = [];
    (tags || []).forEach(t => { if (marcadas.has(t.nome)) (t.snippets || []).forEach(s => out.push(s)); });
    return out.sort((a, b) => b.usos - a.usos).slice(0, 5);
  }, [tags, selId, fb]);

  const publicar = async () => {
    if (salvando) return;
    setSalvando(true); setErro("");
    try {
      await api.post("/api/personal?user=" + encodeURIComponent(aluno.user), { action: "feedback", envioId: envio.id, feedback: fb });
      await onPublicado();
    } catch (e) { setErro(e.message); }
    finally { setSalvando(false); }
  };

  // Atalhos: 1–9 marcam as tags da categoria aberta, J/K (ou setas) andam pelas
  // operações, G foca o feedback do dia, Ctrl+Enter publica. Nunca disparam
  // enquanto o cursor está num campo de texto.
  useEffect(() => {
    const onKey = (e) => {
      const alvo = e.target && e.target.tagName;
      const digitando = alvo === "INPUT" || alvo === "TEXTAREA" || alvo === "SELECT";
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); publicar(); return; }
      if (digitando) return;
      if (/^[1-9]$/.test(e.key)) {
        const t = daCategoria[Number(e.key) - 1];
        if (t && selId) { e.preventDefault(); toggleTag(selId, t.nome); }
        return;
      }
      const i = ops.findIndex(o => o.id === selId);
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setSelId(ops[Math.min(ops.length - 1, i + 1)] ? ops[Math.min(ops.length - 1, i + 1)].id : selId); }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setSelId(ops[Math.max(0, i - 1)] ? ops[Math.max(0, i - 1)].id : selId); }
      if (e.key === "g") { e.preventDefault(); geralRef.current && geralRef.current.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [daCategoria, selId, ops, fb]);

  const emo = emocionalDe(envio.emocional);
  const chip = (ativo, cor) => ({ padding: "5px 11px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "1px solid " + (ativo ? (cor || T.lineGold) : T.line), background: ativo ? (cor ? cor + "22" : T.goldSoft) : "transparent", color: ativo ? (cor || T.gold) : T.mut });

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {zoom && <Modal title="Print" width={980} onClose={() => setZoom(null)}><img src={zoom} alt="Print" style={{ width: "100%", borderRadius: 8 }} /></Modal>}

      <Card style={{ padding: "13px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
          <Button variant="ghost" size="sm" onClick={onVoltar}>← Fila</Button>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{aluno.nome}</span>
          <span style={{ fontSize: 13, color: T.dim, fontFamily: T.mono }}>{dmy(envio.data)} · plano v{envio.planoVersao}</span>
          <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 700, color: sinal(envio.dia.resultado) }}>{BRL(envio.dia.resultado)}</span>
          {emo && <span title={"Estado emocional: " + emo.label} style={{ fontSize: 17 }}>{emo.icone}</span>}
          {!!(envio.violacoes || []).length && <Badge tone="red">{envio.violacoes.length} violação(ões)</Badge>}
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <Button variant="ghost" size="sm" onClick={onAjustarPlano}>Ajustar gerenciamento</Button>
          <Button size="sm" onClick={publicar} disabled={salvando}>{salvando ? <Spinner size={13} /> : "Publicar feedback"}</Button>
        </div>
      </Card>
      {erro && <Banner tone="red">{erro}</Banner>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 330px", gap: 14, alignItems: "start" }} className="fh-analise">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {/* Os três painéis do COMANDO 3 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
            <Card style={{ overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.line, background: T.panel2, fontSize: 12, fontWeight: 700, color: T.mut }}>Print de performance</div>
              <div style={{ padding: 10 }}>{envio.temPrint ? <PtPrint user={aluno.user} id={envio.id + "-print"} alt="Performance" onOpen={setZoom} /> : <div style={{ fontSize: 12.5, color: T.dim, padding: 14, textAlign: "center" }}>Não anexado.</div>}</div>
            </Card>
            <Card style={{ overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.line, background: T.panel2, fontSize: 12, fontWeight: 700, color: T.mut }}>Relatório de operações</div>
              <div style={{ padding: 10 }}>{envio.temRelatorio ? <PtPrint user={aluno.user} id={envio.id + "-relatorio"} alt="Relatório" onOpen={setZoom} /> : <div style={{ fontSize: 12.5, color: T.dim, padding: 14, textAlign: "center" }}>Não anexado — as operações vieram estruturadas ({envio.origem}).</div>}</div>
            </Card>
            <Card style={{ overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.line, background: T.panel2, fontSize: 12, fontWeight: 700, color: T.mut }}>Resumo do aluno</div>
              <div style={{ padding: 14, fontSize: 13, color: envio.resumo ? T.text : T.dim, lineHeight: 1.7, whiteSpace: "pre-line" }}>{envio.resumo || "Sem resumo escrito."}</div>
            </Card>
          </div>

          {/* Operações: clicar seleciona; a seleção recebe as tags e o comentário */}
          <Card style={{ overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid " + T.line, background: T.panel2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Operações do dia</span>
              <span style={{ fontSize: 11.5, color: T.dim }}>J / K para navegar · 1–9 para marcar tags · G para o feedback do dia · Ctrl+Enter publica</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 70px 46px 78px 84px 26px", gap: 8, padding: "7px 16px", fontSize: 10, color: T.dim, letterSpacing: 0.4, borderBottom: "1px solid " + T.line }}>
              <div>HORA</div><div>SETUP</div><div>DIREÇÃO</div><div style={{ textAlign: "right" }}>CTR</div><div style={{ textAlign: "right" }}>PONTOS</div><div style={{ textAlign: "right" }}>R$</div><div />
            </div>
            {ops.map(o => {
              const sel = o.id === selId;
              const f = doOp(o.id);
              return (
                <div key={o.id} style={{ borderBottom: "1px solid " + T.line, background: sel ? T.goldSoft : o.dentroDoPlano ? "transparent" : "#1f0c0c55" }}>
                  <div role="button" tabIndex={0} onClick={() => setSelId(o.id)} onKeyDown={e => { if (e.key === "Enter") setSelId(o.id); }}
                    style={{ display: "grid", gridTemplateColumns: "56px 1fr 70px 46px 78px 84px 26px", gap: 8, padding: "9px 16px", alignItems: "center", fontFamily: T.mono, fontSize: 12.5, cursor: "pointer" }}>
                    <div style={{ color: sel ? T.gold : T.dim }}>{o.hora || "—"}</div>
                    <div style={{ fontFamily: T.sans, color: T.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.setup || <span style={{ color: T.dim }}>sem setup</span>}</div>
                    <div style={{ color: o.direcao === "VENDA" ? T.red : o.direcao === "COMPRA" ? T.green : T.dim, fontSize: 11 }}>{o.direcao || "—"}</div>
                    <div style={{ textAlign: "right", color: T.mut }}>{o.contratos}</div>
                    <div style={{ textAlign: "right", color: sinal(o.pontos) }}>{o.pontos == null ? "—" : (o.pontos > 0 ? "+" : "") + PTS(o.pontos)}</div>
                    <div style={{ textAlign: "right", color: sinal(o.resultado), fontWeight: 700 }}>{BRL(o.resultado)}</div>
                    <div style={{ display: "flex", justifyContent: "center", gap: 3 }}>
                      {!o.dentroDoPlano && <span title={(o.violacoes || []).map(v => TIPO_LABEL[v] || v).join(", ")} style={{ color: T.red, display: "flex" }}><Icon name="alert" size={14} /></span>}
                      {!!(f.tags || []).length && <span style={{ color: T.purple, fontSize: 11 }}>{f.tags.length}</span>}
                    </div>
                  </div>
                  {sel && (
                    <div style={{ padding: "4px 16px 14px", display: "flex", flexDirection: "column", gap: 11, borderTop: "1px dashed " + T.line }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", paddingTop: 10 }}>
                        {CATEGORIAS.map(c => <button key={c.k} className="fh-btn" onClick={() => setCategoria(c.k)} style={chip(categoria === c.k)}>{c.label}</button>)}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {daCategoria.map((t, i) => {
                          const on = (f.tags || []).includes(t.nome);
                          const cor = t.polaridade === "acerto" ? T.green : T.red;
                          return (
                            <button key={t.nome} className="fh-btn" onClick={() => toggleTag(o.id, t.nome)} style={chip(on, cor)}>
                              {i < 9 && <span style={{ fontFamily: T.mono, fontSize: 10, opacity: .6, marginRight: 4 }}>{i + 1}</span>}{t.nome}
                            </button>
                          );
                        })}
                        {!daCategoria.length && <span style={{ fontSize: 12, color: T.dim }}>Nenhuma tag nesta categoria ainda.</span>}
                      </div>
                      {!!(f.tags || []).filter(t => !daCategoria.some(d => d.nome === t)).length && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: T.dim }}>outras:</span>
                          {f.tags.filter(t => !daCategoria.some(d => d.nome === t)).map(t => (
                            <button key={t} className="fh-btn" onClick={() => toggleTag(o.id, t)} style={chip(true, T.purple)}>{t} ×</button>
                          ))}
                        </div>
                      )}
                      {!!sugestoes.length && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: T.dim }}>já usou:</span>
                          {sugestoes.map((s, i) => (
                            <button key={i} className="fh-btn" title={s.texto}
                              onClick={() => setOpFb(o.id, { comentario: (f.comentario ? f.comentario.trim() + " " : "") + s.texto })}
                              style={{ ...chip(false), maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                              {s.texto}
                            </button>
                          ))}
                        </div>
                      )}
                      <textarea className="fh-input" rows={2} maxLength={1200} value={f.comentario || ""} placeholder="O que aconteceu nesta operação"
                        onChange={e => setOpFb(o.id, { comentario: e.target.value })} style={{ resize: "vertical", lineHeight: 1.6, fontSize: 13 }} />
                      <Input value={f.recomendacao || ""} maxLength={600} placeholder="Recomendação: o que fazer da próxima vez"
                        onChange={e => setOpFb(o.id, { recomendacao: e.target.value })} style={{ fontSize: 13 }} />
                    </div>
                  )}
                </div>
              );
            })}
            {!ops.length && <div style={{ padding: 20, fontSize: 13, color: T.dim, textAlign: "center" }}>Este envio não tem operações — só o resumo escrito.</div>}
          </Card>

          <Card style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, color: T.mut, letterSpacing: 0.4, textTransform: "uppercase" }}>Feedback geral do dia</div>
            <textarea ref={geralRef} className="fh-input" rows={5} maxLength={4000} value={fb.geral} onChange={e => setFb(f => ({ ...f, geral: e.target.value }))}
              placeholder="A leitura do dia: o que sustentou o resultado, o que precisa mudar e o foco de amanhã." style={{ resize: "vertical", lineHeight: 1.7 }} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button onClick={publicar} disabled={salvando}>{salvando ? <><Spinner size={14} /> Publicando...</> : "Publicar feedback"}</Button>
            </div>
          </Card>
        </div>

        {/* Lateral: o plano vigente e o que ele acusou neste dia */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 0 }}>
          <QuadroGerenciamento linhas={envio.quadro} data={envio.data} compacto />
          <Card style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: T.dim, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 10 }}>Violações detectadas</div>
            <Violacoes itens={envio.violacoes} />
          </Card>
        </div>
      </div>
    </div>
  );
}

// Modal de nova versão do plano. Motivo obrigatório: sem ele o histórico vira
// uma lista de números sem história, e a seção 5 do relatório final perde o
// sentido ("o ajuste funcionou?" só se responde sabendo por que foi feito).
function AjustarPlano({ aluno, jornada, onFechar, onSalvo }) {
  const [plano, setPlano] = useState(() => {
    const p = jornada.plano || {};
    return { ...p, winRateAlvo: Math.round((p.winRateAlvo || 0.5) * 100), motivo: "", vigenciaInicio: hojeISO() };
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const salvar = async () => {
    if (salvando) return;
    if (!String(plano.motivo || "").trim()) { setErro("Descreva o motivo da mudança."); return; }
    setSalvando(true); setErro("");
    try {
      await api.post("/api/personal?user=" + encodeURIComponent(aluno.user), {
        action: "plano", plano: { ...plano, winRateAlvo: Number(plano.winRateAlvo) },
      });
      await onSalvo();
      onFechar();
    } catch (e) { setErro(e.message); }
    finally { setSalvando(false); }
  };
  return (
    <Modal title={`Ajustar gerenciamento — ${aluno.nome} (nova versão v${(jornada.ciclo.planos || []).length + 1})`} width={760} onClose={onFechar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Disclaimer title="O que muda" icon="ℹ️">
          A versão nova passa a valer de <b>{dmy(plano.vigenciaInicio)}</b> em diante. Os dias já enviados continuam julgados pelo plano que valia na data deles —
          exceto os que caírem dentro da nova vigência, que são reavaliados automaticamente.
        </Disclaimer>
        <Field label="Válida a partir de">
          <Input type="date" value={plano.vigenciaInicio} onChange={e => setPlano(p => ({ ...p, vigenciaInicio: e.target.value }))} style={{ maxWidth: 200 }} />
        </Field>
        <FormPlano plano={plano} setPlano={setPlano} diagnostico={jornada.ciclo.diagnostico} novaVersao />
        {erro && <Banner tone="red">{erro}</Banner>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? <Spinner size={14} /> : "Publicar nova versão"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// Tela 4 — Ficha do aluno: tudo que o mentor precisa antes de uma conversa.
function FichaAluno({ aluno, jornada, onVoltar, onRecarregar, onEditarZero, onAjustar }) {
  const [notas, setNotas] = useState(jornada.ciclo.notas || "");
  const [salvandoNotas, setSalvandoNotas] = useState(false);
  const [aba, setAba] = useState("resumo");
  const d = jornada.ciclo.diagnostico || {};
  const c = jornada.calculados || {};

  const salvarNotas = async () => {
    setSalvandoNotas(true);
    try { await api.post("/api/personal?user=" + encodeURIComponent(aluno.user), { action: "notas", notas }); }
    catch (e) { /* silencioso: a nota fica no campo e o mentor tenta de novo */ }
    finally { setSalvandoNotas(false); }
  };

  const mudarStatus = async (status) => {
    const rotulo = { concluido: "Encerrar o ciclo", pausado: "Pausar o ciclo", ativo: "Reativar o ciclo" }[status];
    if (!(await confirmDialog({
      title: rotulo + "?",
      message: status === "concluido"
        ? "O aluno passa a ver o relatório final e não consegue mais enviar dias. Você pode reativar depois."
        : status === "pausado" ? "O aluno continua vendo tudo, mas os alertas de ausência param." : "O ciclo volta a aceitar envios.",
      confirmLabel: rotulo,
    }))) return;
    await api.post("/api/personal?user=" + encodeURIComponent(aluno.user), { action: "status", status });
    await onRecarregar();
  };

  const removerCiclo = async () => {
    if (!(await confirmDialog({
      title: `Apagar o ciclo de ${aluno.nome}?`,
      message: "Apaga o plano, o diagnóstico, todos os envios, feedbacks e prints deste acompanhamento. Não dá para desfazer. O acesso do aluno à página continua.",
      confirmLabel: "Apagar ciclo", tone: "danger",
    }))) return;
    await api.post("/api/personal?user=" + encodeURIComponent(aluno.user), { action: "remover-ciclo" });
    await onRecarregar();
    onVoltar();
  };

  const abas = [{ key: "resumo", label: "Resumo" }, { key: "diagnostico", label: "Diagnóstico" }, { key: "planos", label: `Planos (${(jornada.ciclo.planos || []).length})` }, { key: "relatorio", label: "Relatório final" }];

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: "13px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button variant="ghost" size="sm" onClick={onVoltar}>← Alunos</Button>
          <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{aluno.nome}</span>
          <span style={{ fontSize: 12.5, color: T.dim, fontFamily: T.mono }}>{aluno.user}</span>
          <Badge tone={jornada.ciclo.status === "ativo" ? "green" : jornada.ciclo.status === "pausado" ? "gold" : "blue"}>{jornada.ciclo.status}</Badge>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="ghost" size="sm" onClick={onEditarZero}>Sessão Zero</Button>
          <Button variant="ghost" size="sm" onClick={onAjustar}>Ajustar gerenciamento</Button>
          {jornada.ciclo.status !== "concluido"
            ? <Button variant="gold" size="sm" onClick={() => mudarStatus("concluido")}>Encerrar ciclo</Button>
            : <Button variant="gold" size="sm" onClick={() => mudarStatus("ativo")}>Reativar</Button>}
          {jornada.ciclo.status === "ativo" && <Button variant="ghost" size="sm" onClick={() => mudarStatus("pausado")}>Pausar</Button>}
          <Button variant="danger" size="sm" onClick={removerCiclo}>Apagar ciclo</Button>
        </div>
      </Card>

      <BarraCiclo diaAtual={jornada.real.diasOperados} diasPrevistos={jornada.ciclo.diasPrevistos} status={jornada.ciclo.status} />
      <Alertas itens={jornada.alertas} />
      <Tabs items={abas} value={aba} onChange={setAba} />

      {aba === "resumo" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <QuadroGerenciamento linhas={jornada.quadro} data={jornada.quadroData} />
          <MetasProcesso real={jornada.real} projecao={jornada.projecao} />
          {jornada.projecao && <CurvaProjecao projecao={jornada.projecao} curvaReal={jornada.real.curva} />}
          <Decomposicao comparacao={jornada.comparacao} />
          <Card style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, color: T.mut, letterSpacing: 0.4, textTransform: "uppercase" }}>Anotações privadas do mentor</div>
            <textarea className="fh-input" rows={4} maxLength={4000} value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="O que não entra no feedback. O aluno nunca vê." style={{ resize: "vertical", lineHeight: 1.6 }} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="ghost" size="sm" onClick={salvarNotas} disabled={salvandoNotas}>{salvandoNotas ? <Spinner size={13} /> : "Salvar anotações"}</Button>
            </div>
          </Card>
          {!!(jornada.tags || []).length && (
            <Card style={{ overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", borderBottom: "1px solid " + T.line, background: T.panel2, fontSize: 14, fontWeight: 700, color: T.text }}>Evolução das tags no ciclo</div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 9 }}>
                {jornada.tags.map(t => (
                  <div key={t.tag} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13 }}>
                    <span style={{ color: T.mut }}>{t.tag}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: T.mono, fontSize: 12 }}>
                      <span style={{ color: T.dim }}>{t.primeira} → {t.segunda}</span>
                      <Badge tone={t.tendencia === "caiu" ? "green" : t.tendencia === "subiu" ? "red" : "mut"}>{t.tendencia === "caiu" ? "↓" : t.tendencia === "subiu" ? "↑" : "="}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {aba === "diagnostico" && (
        <Card style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          <Disclaimer title="Informação restrita" icon="🔒">A capacidade financeira do aluno é visível só para a equipe — o servidor remove esta seção de qualquer resposta lida por ele.</Disclaimer>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            {[["Capital operacional", BRL(d.capitalOperacional)], ["Capital total", BRL(d.capitalTotal)], ["Aporte mensal", BRL(d.aporteMensal)],
              ["Outra fonte de renda", d.outraRenda ? "Sim" : "Não"], ["Experiência", d.experiencia || "—"],
              ["Risco/operação x capital", d.capitalOperacional && c.riscoPorOperacao ? ((c.riscoPorOperacao / d.capitalOperacional) * 100).toFixed(2) + "%" : "—"]].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 10.5, color: T.dim, marginBottom: 4, letterSpacing: 0.4, textTransform: "uppercase" }}>{l}</div>
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: T.mono, color: T.text }}>{v}</div>
              </div>
            ))}
          </div>
          {d.resultadoHistorico && <Field label="Resultado histórico"><div style={{ fontSize: 13, color: T.mut, lineHeight: 1.7, whiteSpace: "pre-line" }}>{d.resultadoHistorico}</div></Field>}
          {d.observacoes && <Field label="Observações do mentor"><div style={{ fontSize: 13, color: T.mut, lineHeight: 1.7, whiteSpace: "pre-line" }}>{d.observacoes}</div></Field>}
        </Card>
      )}

      {aba === "planos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[...(jornada.ciclo.planos || [])].reverse().map(p => (
            <Card key={p.versao} style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <Badge tone={p.versao === (jornada.plano || {}).versao ? "gold" : "mut"}>v{p.versao}{p.versao === (jornada.plano || {}).versao ? " · vigente" : ""}</Badge>
                  <span style={{ fontSize: 12.5, color: T.dim, fontFamily: T.mono }}>desde {dmy(p.vigenciaInicio)}</span>
                </span>
                <span style={{ fontSize: 12, color: T.dim, fontFamily: T.mono }}>{jornada.envios.filter(e => e.planoVersao === p.versao).length} dia(s) sob esta versão</span>
              </div>
              <div style={{ fontSize: 13, color: T.mut, marginTop: 9, lineHeight: 1.6 }}>{p.motivo}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 12, fontSize: 12, fontFamily: T.mono, color: T.dim }}>
                <span>alvo {PTS(p.pontosAlvo)} pts</span><span>stop {PTS(p.pontosStop)} pts</span><span>{p.contratos} contrato(s)</span>
                <span>ganho {BRLc(p.ganhoDiarioAlvo)}</span><span>limite {BRLc(p.prejuizoDiarioLimite)}</span><span>meta {BRLc(p.metaMensal)}</span>
                <span>{p.horaInicio || "—"}–{p.horaFim || "—"}</span><span>{p.operacoesDia} op/dia</span><span>acerto {PCT(p.winRateAlvo, 0)}</span>
              </div>
              {!!(p.setups || []).length && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>{p.setups.map(s => <Badge key={s} tone="mut">{s}</Badge>)}</div>}
            </Card>
          ))}
        </div>
      )}

      {aba === "relatorio" && <RelatorioFinal jornada={jornada} nomeAluno={aluno.nome} />}
    </div>
  );
}

// Semáforo de risco do aluno na lista: o pior nível do Quadro dele. É o que o
// mentor varre em dois segundos para decidir com quem falar primeiro.
const piorNivel = (quadro) => {
  const ordem = { fora: 3, atencao: 2, ok: 1, neutro: 0 };
  return (quadro || []).reduce((pior, l) => (ordem[l.status] || 0) > (ordem[pior] || 0) ? l.status : pior, "neutro");
};

function PersonalMentor({ session }) {
  const [dados, setDados] = useState(null);
  const [tags, setTags] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("fila");
  const [vista, setVista] = useState(null);       // { tipo, user, envioId }
  const [jornada, setJornada] = useState(null);
  const [ajustando, setAjustando] = useState(false);

  const carregar = async () => {
    try {
      const [j, t] = await Promise.all([api.get("/api/personal?fn=alunos"), api.get("/api/personal?fn=tags")]);
      setDados(j); setTags(t.tags || []); setErro("");
    } catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  // Abre um aluno: a lista traz só o cabeçalho de cada envio (a fila tem que ser
  // barata); a jornada completa só é buscada quando o mentor entra de fato.
  const abrir = async (user, tipo, envioId) => {
    setJornada(null);
    setVista({ tipo, user, envioId });
    try { setJornada(await api.get("/api/personal?user=" + encodeURIComponent(user))); }
    catch (e) { setErro(e.message); setVista(null); }
  };
  const recarregarTudo = async () => {
    await carregar();
    if (vista) { try { setJornada(await api.get("/api/personal?user=" + encodeURIComponent(vista.user))); } catch (e) {} }
  };
  const fechar = () => { setVista(null); setJornada(null); };

  if (carregando) return <div style={{ padding: 40 }}><Loading label="Carregando os alunos..." /></div>;
  if (erro && !dados) return <div className="fh-page"><Banner tone="red">{erro}</Banner></div>;

  const alunos = (dados && dados.alunos) || [];
  const disponiveis = (dados && dados.disponiveis) || [];
  const alunoDe = (u) => alunos.find(a => a.user === u);

  // ── Drill-downs ──
  if (vista && vista.tipo === "zero") {
    return (
      <div className="fh-page">
        <SessaoZero alvo={vista.user ? { ...alunoDe(vista.user), ciclo: jornada && jornada.ciclo } : null} disponiveis={disponiveis}
          onPronto={async (u) => { await carregar(); await abrir(u, "ficha"); }} onCancelar={fechar} />
      </div>
    );
  }
  if (vista && !jornada) return <div style={{ padding: 40 }}><Loading label="Abrindo o aluno..." /></div>;
  if (vista && vista.tipo === "analise") {
    if (!alunoDe(vista.user)) { fechar(); return null; }
    const envio = (jornada.envios || []).find(e => e.id === vista.envioId);
    if (!envio) { fechar(); return null; }
    return <>
      {ajustando && <AjustarPlano aluno={alunoDe(vista.user)} jornada={jornada} onFechar={() => setAjustando(false)} onSalvo={recarregarTudo} />}
      <TelaAnalise aluno={alunoDe(vista.user)} envio={envio} tags={tags} onVoltar={fechar}
        onPublicado={async () => { await recarregarTudo(); fechar(); }} onAjustarPlano={() => setAjustando(true)} />
    </>;
  }
  if (vista && vista.tipo === "ficha") {
    if (!alunoDe(vista.user)) { fechar(); return null; }   // ciclo apagado enquanto a ficha estava aberta
    return <>
      {ajustando && <AjustarPlano aluno={alunoDe(vista.user)} jornada={jornada} onFechar={() => setAjustando(false)} onSalvo={recarregarTudo} />}
      <FichaAluno aluno={alunoDe(vista.user)} jornada={jornada} onVoltar={fechar} onRecarregar={recarregarTudo}
        onEditarZero={() => setVista({ tipo: "zero", user: vista.user })} onAjustar={() => setAjustando(true)} />
    </>;
  }

  // ── Tela 1: fila do dia (tudo que espera análise, mais antigo primeiro) ──
  const fila = alunos.flatMap(a => (a.pendentes || []).map(p => ({ ...p, aluno: a })))
    .sort((x, y) => (x.enviadoEm || 0) - (y.enviadoEm || 0));
  const semEnvio = alunos.filter(a => a.status === "ativo" && a.alertas.some(al => al.tipo === "sem_envio"));

  const abas = [
    { key: "fila", label: fila.length ? `Fila do dia (${fila.length})` : "Fila do dia" },
    { key: "alunos", label: `Alunos (${alunos.length})` },
  ];

  return (
    <div className="fh-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ padding: "13px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: T.dim }}>
          <b style={{ color: T.text }}>{alunos.filter(a => a.status === "ativo").length}</b> em acompanhamento ·
          <b style={{ color: T.gold }}> {fila.length}</b> aguardando análise
          {semEnvio.length > 0 && <> · <b style={{ color: T.red }}>{semEnvio.length}</b> sem enviar há 7+ dias</>}
        </div>
        <Button size="sm" onClick={() => setVista({ tipo: "zero", user: null })} disabled={!disponiveis.length}
          title={disponiveis.length ? "" : "Todos os clientes já têm ciclo. Crie a conta em Clientes primeiro."}>
          + Nova Sessão Zero
        </Button>
      </Card>

      <Tabs items={abas} value={aba} onChange={setAba} />

      {aba === "fila" && (fila.length === 0 ? (
        <EmptyState icon="✅" title="Fila vazia" desc="Nenhum envio aguardando análise. Quando um aluno mandar o dia, ele aparece aqui." />
      ) : (
        <Card style={{ overflow: "hidden" }}>
          {fila.map(p => (
            <div key={p.aluno.user + p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid " + T.line, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
                <Semaforo nivel={piorNivel(p.aluno.quadro)} size={11} />
                <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{p.aluno.nome}</span>
                <span style={{ fontSize: 12.5, color: T.dim, fontFamily: T.mono }}>{dmy(p.data)}</span>
                <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: sinal(p.resultado) }}>{BRL(p.resultado)}</span>
                <span style={{ fontSize: 12, color: T.dim }}>{p.ops} op.</span>
                {!!p.violacoes && <Badge tone="red">{p.violacoes} violação(ões)</Badge>}
                {emocionalDe(p.emocional) && <span title={emocionalDe(p.emocional).label} style={{ fontSize: 16 }}>{emocionalDe(p.emocional).icone}</span>}
              </div>
              <Button size="sm" onClick={() => abrir(p.aluno.user, "analise", p.id)}>Analisar →</Button>
            </div>
          ))}
        </Card>
      ))}

      {aba === "alunos" && (alunos.length === 0 ? (
        <EmptyState icon="🎯" title="Nenhum aluno no Personal Trader"
          desc="Comece pela Sessão Zero: ela cria o ciclo, o diagnóstico e o Plano v1, e já libera a página para o aluno.">
          <Button size="sm" onClick={() => setVista({ tipo: "zero", user: null })} disabled={!disponiveis.length}>+ Nova Sessão Zero</Button>
        </EmptyState>
      ) : (
        <Card style={{ overflow: "hidden" }}>
          <div className="fh-scroll-x">
            <div style={{ minWidth: 860 }}>
              <div style={{ display: "grid", gridTemplateColumns: "16px 1fr 88px 130px 110px 110px 92px", gap: 10, padding: "9px 18px", fontSize: 10, color: T.dim, letterSpacing: 0.4, borderBottom: "1px solid " + T.line }}>
                <div /><div>ALUNO</div><div>CICLO</div><div>QUADRO</div><div style={{ textAlign: "right" }}>RESULTADO</div><div style={{ textAlign: "right" }}>DESVIO</div><div style={{ textAlign: "right" }}>ÚLT. ENVIO</div>
              </div>
              {alunos.map(a => (
                <div key={a.user} role="button" tabIndex={0} className="fh-navitem" onClick={() => abrir(a.user, "ficha")}
                  onKeyDown={e => { if (e.key === "Enter") abrir(a.user, "ficha"); }}
                  style={{ display: "grid", gridTemplateColumns: "16px 1fr 88px 130px 110px 110px 92px", gap: 10, padding: "12px 18px", borderBottom: "1px solid " + T.line, alignItems: "center", borderRadius: 0, cursor: "pointer" }}>
                  <Semaforo nivel={piorNivel(a.quadro)} size={11} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: T.text, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {a.nome}
                      {a.status !== "ativo" && <Badge tone={a.status === "pausado" ? "gold" : "blue"}>{a.status}</Badge>}
                      {!!(a.pendentes || []).length && <Badge tone="gold">{a.pendentes.length} na fila</Badge>}
                    </div>
                    {!!a.alertas.filter(x => x.tipo !== "aguardando").length && (
                      <div style={{ fontSize: 11.5, color: T.red, marginTop: 3 }}>⚠ {a.alertas.filter(x => x.tipo !== "aguardando")[0].texto}</div>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: T.mut, fontFamily: T.mono }}>{a.diaAtual}/{a.diasPrevistos}</div>
                  {/* O Quadro em linha: um ponto por parâmetro, na ordem do plano */}
                  <div style={{ display: "flex", gap: 5 }} title={(a.quadro || []).map(l => `${l.label}: ${LABEL_NIVEL[l.status]}`).join("\n")}>
                    {(a.quadro || []).map(l => <Semaforo key={l.chave} nivel={l.status} size={9} />)}
                  </div>
                  <div style={{ textAlign: "right", fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: sinal(a.real.resultado) }}>{BRL(a.real.resultado)}</div>
                  <div style={{ textAlign: "right", fontFamily: T.mono, fontSize: 12.5, color: a.comparacao ? sinal(a.comparacao.desvio) : T.dim }}>
                    {a.comparacao ? (a.comparacao.desvio >= 0 ? "+" : "") + BRLc(a.comparacao.desvio) : "—"}
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: T.dim, fontFamily: T.mono }}>{a.ultimoEnvio ? dm(a.ultimoEnvio) : "—"}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Entrada do módulo ───────────────────────────────────────────────────────
// Equipe vê o painel do mentor; cliente vê a própria jornada. Não há alternância
// manual: o papel decide, como no resto do hub.
export default function PersonalScreen({ session }) {
  const staff = session && (session.role === "superadmin" || session.role === "moderator");
  return staff ? <PersonalMentor session={session} /> : <PersonalAluno session={session} />;
}
