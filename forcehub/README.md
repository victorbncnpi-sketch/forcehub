# FORCE HUB AI

Dashboard financeiro para clientes XP — WIN · WDO · IBOV

Aplicação React (Create React App) + funções serverless na Vercel.
**Stack 100% gratuita** — sem cartão de crédito (IA via Gemini, cotações via
Brapi e persistência/autenticação via Upstash Redis, todos no plano grátis).

## Funcionalidades

- **Panorama de Mercado** — máx/mín/amplitude semanal de WIN, WDO e IBOV
  (buscado ao vivo na Brapi; edição manual sempre disponível) + calendário de
  eventos de alto impacto via IA.
- **Carteira Recomendada** — recomendações de swing trade (entrada/alvo/stop,
  R:R), busca de oportunidades com IA e acompanhamento de posições.
- **O Conselheiro** — coaching de trading com IA, perfil e diário de
  resultados (persistidos no Upstash Redis, por usuário, cross-device).

## Arquitetura

| Camada | Arquivo | Função |
|--------|---------|--------|
| Frontend | `src/App.jsx` | SPA React com login, menu, as 3 telas e o painel de Clientes |
| Autenticação | `api/auth.js` · `api/users.js` · `api/_auth.js` | Login por sessão (cookie httpOnly), senhas com hash scrypt no Redis, gestão de clientes (admin) |
| Proxy de IA | `api/ai.js` | Encaminha à IA usando a chave do backend (Gemini ou Anthropic). A chave nunca vai ao navegador |
| Cotações | `api/market-data.js` | Busca OHLC de WIN/WDO/IBOV ao vivo na Brapi |
| Carteira | `api/carteira.js` | Persiste recomendações + posições (compartilhadas: admin publica, clientes leem) |
| Conselheiro | `api/conselheiro.js` | Persiste perfil + diário por usuário (cross-device) |
| Banco | `api/_redis.js` | Cliente Upstash Redis compartilhado |

> As cotações são buscadas sob demanda (sem persistência). Login, carteira e
> Conselheiro usam Upstash Redis — por isso o banco passou a ser **obrigatório**
> para autenticar (sem ele, o login retorna erro de configuração).

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
| `UPSTASH_REDIS_REST_URL` | **sim** (login + dados) | Vercel → Storage → Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | **sim** (login + dados) | Vercel → Storage → Upstash |
| `ANTHROPIC_API_KEY` | opcional | alternativa paga ao Gemini |
| `GEMINI_MODEL` | opcional | padrão `gemini-2.5-flash` |

### Criar o banco (Upstash Redis, grátis)

No Vercel: **Storage → Create Database → Marketplace → Upstash (Redis)**. Ao
conectar ao projeto, as variáveis `UPSTASH_REDIS_REST_URL` e
`UPSTASH_REDIS_REST_TOKEN` são injetadas automaticamente.

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

## Autenticação e usuários

Login real no **backend**: as senhas nunca chegam ao navegador — são guardadas
com hash **scrypt** (nativo do Node, sem dependências) no Upstash Redis. A
sessão é um **cookie httpOnly** com validade de 7 dias, então o login persiste
ao recarregar a página. As rotas de escrita são protegidas: só o admin edita a
carteira; cada cliente só acessa o próprio perfil/diário.

| Rota | Função |
|------|--------|
| `api/auth.js` | login / logout / sessão atual (`GET` restaura a sessão) |
| `api/users.js` | gestão de clientes (somente admin) |
| `api/_auth.js` | hash de senha, cookies e sessões (utilitário) |

**Cadastro de clientes:** feito pelo admin na própria interface (aba
**Clientes**) — criar, editar, definir validade de acesso, redefinir senha e
remover. Nenhuma alteração de código é necessária.

**Primeiro acesso:** na primeira leitura, o banco é semeado com um conjunto
inicial de usuários (admin `victor` / `forcehub2026`). **Troque essa senha pelo
painel logo após o primeiro login.** As sementes ficam em `api/_auth.js`, fora
do bundle do frontend.

