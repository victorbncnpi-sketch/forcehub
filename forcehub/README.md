# FORCE HUB AI

Dashboard financeiro para clientes XP — WIN · WDO · IBOV

Aplicação React (Create React App) + funções serverless na Vercel.
**Stack 100% gratuita** — não exige banco de dados nem cartão de crédito.

## Funcionalidades

- **Panorama de Mercado** — máx/mín/amplitude semanal de WIN, WDO e IBOV
  (buscado ao vivo na Brapi; edição manual sempre disponível) + calendário de
  eventos de alto impacto via IA.
- **Carteira Recomendada** — recomendações de swing trade (entrada/alvo/stop,
  R:R), busca de oportunidades com IA e acompanhamento de posições.
- **O Conselheiro** — coaching de trading com IA, perfil e diário de
  resultados (persistidos no navegador via `localStorage`).

## Arquitetura

| Camada | Arquivo | Função |
|--------|---------|--------|
| Frontend | `src/App.jsx` | SPA React com login, menu e as 3 telas |
| Proxy de IA | `api/ai.js` | Encaminha à IA usando a chave do backend (Gemini ou Anthropic). A chave nunca vai ao navegador |
| Cotações | `api/market-data.js` | Busca OHLC de WIN/WDO/IBOV ao vivo na Brapi |

> Não há banco de dados: as cotações são buscadas sob demanda e o histórico do
> Conselheiro fica no `localStorage` do navegador.

## Deploy no Vercel

1. Faça upload desta pasta no GitHub e importe no Vercel.
2. Em **Settings → Root Directory**, aponte para a pasta `forcehub` (onde estão
   `package.json` e `vercel.json`). **Sem isso o build falha.**
3. Configure as **variáveis de ambiente** (ver abaixo) e faça o deploy.

## Variáveis de ambiente

Veja `.env.example`. Configure no painel do Vercel (e em `.env.local` para dev):

| Variável | Obrigatória | Onde obter (grátis) |
|----------|-------------|---------------------|
| `GEMINI_API_KEY` | para IA | https://aistudio.google.com/apikey (sem cartão) |
| `BRAPI_TOKEN` | para cotações | https://brapi.dev |
| `ANTHROPIC_API_KEY` | opcional | alternativa paga ao Gemini |
| `GEMINI_MODEL` | opcional | padrão `gemini-2.5-flash` |

> Sem `GEMINI_API_KEY` (nem `ANTHROPIC_API_KEY`), as telas de IA exibem aviso de
> indisponibilidade — o restante da aplicação continua funcionando.
> Sem `BRAPI_TOKEN`, o Panorama cai para entrada manual.

## Desenvolvimento local

```bash
npm install
npm start      # http://localhost:3000
npm run build  # build de produção
```

> As rotas `/api/*` rodam no ambiente da Vercel. Para testá-las localmente use
> `vercel dev`.

## Usuários (protótipo)

Definidos em `src/App.jsx` (array `USERS`). **Atenção:** autenticação é apenas
no cliente — adequada para protótipo, não para produção. Exemplos:

- admin: `victor` / `forcehub2026`
- cliente: `cliente1` / `xp2026c1`
