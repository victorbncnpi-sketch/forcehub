// api/market.js — Roteador único dos endpoints de mercado (economia de funções
// no plano Hobby da Vercel: 1 função no lugar de 4). As URLs antigas continuam
// funcionando via rewrites no vercel.json, que injetam ?kind=...:
//   /api/markets      -> ?kind=markets       (índices/macro do topo)
//   /api/market-data  -> ?kind=market-data   (WIN/WDO/IBOV)
//   /api/cotacoes     -> ?kind=cotacoes       (cotações por ticker)
//   /api/tickers      -> ?kind=tickers        (autocomplete de ativos)
// A lógica de cada um vive nos helpers "_"-prefixados (não roteados).
import markets from "./_markets";
import marketData from "./_market-data";
import cotacoes from "./_cotacoes";
import tickers from "./_tickers";
import options from "./_options";

const ROUTES = { markets, "market-data": marketData, cotacoes, tickers, options };

export default async function handler(req, res) {
  const kind = String((req.query && req.query.kind) || "").trim();
  const fn = ROUTES[kind];
  if (!fn) return res.status(404).json({ ok: false, error: "Recurso de mercado desconhecido." });
  return fn(req, res);
}
