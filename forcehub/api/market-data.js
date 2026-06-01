// api/market-data.js — Lê dados do KV e retorna para o frontend
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  // CORS para o frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  try {
    const { days = 5 } = req.query;
    const numDays = Math.min(parseInt(days) || 5, 30);

    // Busca histórico dos 3 ativos
    const [winHist, wdoHist, ibovHist] = await Promise.all([
      kv.lrange("history:WIN",  0, numDays - 1),
      kv.lrange("history:WDO",  0, numDays - 1),
      kv.lrange("history:IBOV", 0, numDays - 1),
    ]);

    const parse = (list) =>
      (list || []).map(item => typeof item === "string" ? JSON.parse(item) : item)
        .sort((a, b) => a.date.localeCompare(b.date)); // ordem cronológica

    return res.status(200).json({
      ok: true,
      data: {
        WIN:  parse(winHist),
        WDO:  parse(wdoHist),
        IBOV: parse(ibovHist),
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
