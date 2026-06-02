# FORCE HUB AI

Dashboard financeiro para clientes XP — WIN · WDO · IBOV

Aplicação React (Create React App) + funções serverless na Vercel.

## Funcionalidades

- **Panorama de Mercado** — máx/mín/amplitude semanal de WIN, WDO e IBOV
  (pré-preenchido pelo backend quando o Vercel KV está configurado; edição
  manual sempre disponível) + calendário de eventos de alto impacto via IA.
- **Carteira Recomendada** — recomendações de swing trade (entrada/alvo/stop,
  R:R), busca de oportunidades com IA e acompanhamento de posições.
- **O Conselheiro** — coaching de trading com IA, perfil e diário de
  resultados (persistidos localmente no navegador via `localStorage`).

## Arquitetura

| Camada | Arquivo | Função |
|--------|---------|--------|
| Frontend | `src/App.jsx` | SPA React com login, menu e as 3 telas |
| Proxy de IA | `api/ai.js` | Encaminha chamadas à Anthropic usando `ANTHROPIC_API_KEY` (a chave nunca vai ao navegador) |
| Cron de cotações | `api/fetch-market.js` | Busca WIN/WDO/IBOV na Brapi e grava no Vercel KV |
| Leitura de mercado | `api/market-data.js` | Lê o histórico do KV para o Panorama |

## Deploy no Vercel

1. Faça upload desta pasta no GitHub e importe no Vercel.
2. Em **Settings → Root Directory**, aponte para a pasta `forcehub` (onde
   estão `package.json` e `vercel.json`).
3. Configure as **variáveis de ambiente** (ver abaixo).

## Variáveis de ambiente

Veja `.env.example`. Configure no painel do Vercel (e em `.env.local` para dev):

| Variável | Usada por | Descrição |
|----------|-----------|-----------|
| `ANTHROPIC_API_KEY` | `/api/ai` | Chave da API Anthropic (IA: Conselheiro, scan, notícias) |
| `BRAPI_TOKEN` | `/api/fetch-market` | Token da Brapi para cotações |
| `CRON_SECRET` | `/api/fetch-market` | Protege o endpoint do cron |
| `KV_REST_API_URL` | KV | Gerado ao criar o banco KV |
| `KV_REST_API_TOKEN` | KV | Gerado ao criar o banco KV |

> Sem `ANTHROPIC_API_KEY`, as telas de IA exibem aviso de indisponibilidade —
> o restante da aplicação continua funcionando normalmente.

## Configurar Vercel KV (banco gratuito)

1. No dashboard do Vercel: **Storage → Create Database → KV**.
2. Nome: `forcehub-db`.
3. O Vercel preenche automaticamente `KV_REST_API_URL` e `KV_REST_API_TOKEN`.

## Cron Job (automático)

Busca WIN, WDO e IBOV todo dia útil às **19h BRT** (22h UTC), configurado em
`vercel.json`. Teste manual:

```
GET /api/fetch-market?secret=SEU_CRON_SECRET
```

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
