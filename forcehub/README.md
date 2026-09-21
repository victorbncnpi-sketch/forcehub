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
- **Diário de Trades** — registro manual das próprias operações (em R-múltiplo
  ou R$), unificado com o que O Conselheiro registra para o usuário.
- **Dashboard de Performance** — estatísticas e insights inspirados em planilha
  de mentoria: acerto, payoff, expectativa, **SQN** (System Quality Number),
  drawdown, run-up, sequências, curva de capital (R e R$), resultado por mês e
  quebras por ativo/direção/dia da semana — com análise gerada por IA. Permite
  incluir ou não as posições da Carteira no cálculo. Filtros por período/ativo.
- **Estudos de Mercado** — seções expansíveis com estudos próprios. O primeiro
  compara a **amplitude diária do Mini Índice (WIN) x Ibovespa** (em pontos ou
  %), com correlação e razão entre as duas. A série do WIN é a "emendada" —
  montada a partir da lista real de contratos da Brapi, dia a dia com o contrato
  vigente na época — e é acumulada no Redis, então cresce indefinidamente.
- **Personal Trader** (mentoria de 30 dias operados) — ver seção própria abaixo.
- **Painel da Turma** (só super admin) — visão consolidada do mentor: médias da
  turma (acerto, payoff, SQN, expectativa), curva de capital média, **ranking**
  dos alunos e um **Painel de Atenção** (drawdown forte, sequência de loss,
  inatividade, indisciplina/revenge) com drill-down no dashboard de cada aluno.

## Arquitetura

| Camada | Arquivo | Função |
|--------|---------|--------|
| Frontend | `src/App.jsx` | SPA React com login, menu, as telas (Panorama, Carteira, Conselheiro, Diário de Trades, Dashboard) e o painel de Clientes |
| Autenticação | `api/auth.js` · `api/users.js` · `api/_auth.js` | Login por sessão (cookie httpOnly), senhas com hash scrypt no Redis, gestão de clientes (admin) |
| Proxy de IA | `api/ai.js` | Encaminha à IA usando a chave do backend (Gemini ou Anthropic). A chave nunca vai ao navegador |
| Cotações | `api/market-data.js` | Busca OHLC de WIN/WDO/IBOV ao vivo na Brapi |
| Carteira | `api/carteira.js` | Recomendações compartilhadas (admin publica, clientes leem) + prints de gráfico em chaves próprias. Admin encerra a call → **track record oficial** (curva de capital compartilhada) |
| Posições | `api/posicoes.js` | Posições **por usuário**: cada cliente aceita uma recomendação e acompanha o próprio resultado/curva de capital |
| Conselheiro | `api/conselheiro.js` | Persiste perfil + diário por usuário (cross-device) |
| Diário de Trades | `api/trades.js` | Operações **por usuário** (R-múltiplo + R$, com `valorR`). O Dashboard agrega isto com o diário do Conselheiro e, opcionalmente, as posições da Carteira |
| Painel da Turma | `api/cohort.js` | **Só super admin**: lê os dados de todos os clientes e devolve ao front, que agrega a turma (médias, ranking, alertas) e abre o dashboard de cada aluno |
| Estudos | `api/_estudos.js` · `api/_market-data.js` | Série histórica de amplitude (WIN x IBOV), acumulada no Redis pela cron |
| Personal Trader | `api/personal.js` · `api/_pt.js` · `api/_pt-regras.js` · `src/personal.jsx` | Ciclo de 30 dias: Sessão Zero, plano versionado, envios diários, motor de regras, feedback estruturado e relatório final |
| Banco | `api/_redis.js` | Cliente Upstash Redis compartilhado |

> As cotações são buscadas sob demanda (sem persistência). Login, carteira e
> Conselheiro usam Upstash Redis — por isso o banco passou a ser **obrigatório**
> para autenticar (sem ele, o login retorna erro de configuração).

> **Teto de 12 funções serverless (plano Hobby da Vercel).** Só arquivos em
> `api/` SEM o prefixo `_` viram função; os `_` são helpers e não contam. Hoje
> são exatamente 12 — no limite. Qualquer endpoint novo tem que entrar como
> sub-rota de um existente (`?kind=` em `api/market.js`, `?fn=` em
> `api/users.js` e `api/personal.js`), nunca como arquivo novo sem prefixo.

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

## Testes

```bash
npm test
```

Suíte própria, sem dependências (`tests/`): motor de regras, projeção,
armazenamento, saneamento de entrada, a matriz de permissões do
`/api/personal` e o leitor de CSV do Profit. Roda em segundos e não precisa de
banco nem de rede.

Dois detalhes de como ela roda, em `tests/loader.mjs`:

- A Vercel resolve `import ... from "./_pt"` sem extensão; o `node` da linha de
  comando não. Um hook de resolução acrescenta o `.js`.
- `api/_redis.js` e `api/_auth.js` são trocados por dublês em `tests/stubs/`.
  O dublê de `_auth` **reexporta** as funções de permissão do arquivo real em vez
  de copiá-las: uma cópia deixaria os testes de permissão verdes mesmo depois de
  alguém afrouxar a regra em produção.

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

**Papéis:**

- **Super admin** (`victor`) — irrestrito e **imutável**: ninguém o edita,
  rebaixa ou remove. Único que define papéis e permissões granulares.
- **Moderador** — acesso total às páginas + gestão de **clientes** (não enxerga
  nem altera outros moderadores/super admin, nem define permissões).
- **Cliente** — acesso definido por **permissões por página**.

**Permissões granulares (por página, só o super admin edita):**

| Permissão | Libera |
|-----------|--------|
| `panorama` | Ver o Panorama de Mercado |
| `carteira` | **Ler** recomendações + posições |
| `carteira_write` | **Criar/editar** recomendações de compra/venda |
| `conselheiro` | Usar O Conselheiro (IA) |
| `trades` | Usar o **Diário de Trades** e o **Dashboard de Performance** |

Cada rota do backend valida a capacidade (ex.: `POST /api/carteira` exige
`carteira_write`) e a navegação esconde o que o usuário não pode acessar.
Cliente novo nasce com `panorama + carteira (ler) + conselheiro + trades`.
Clientes antigos recebem `trades` automaticamente numa migração única.

**Cadastro:** feito na aba **Clientes** — criar, editar, definir papel,
permissões, validade de acesso, redefinir senha e remover. Sem mexer em código.

**Primeiro acesso:** na primeira leitura, o banco é semeado com um conjunto
inicial de usuários (super admin `victor` / `forcehub2026`). **Troque essa senha pelo
painel logo após o primeiro login.** As sementes ficam em `api/_auth.js`, fora
do bundle do frontend.

**Dados de teste (turma demo):** no painel **Clientes**, o super admin tem
**🧪 Turma demo** (cria 8 alunos fictícios com perfis variados — campeão, em
drawdown, indisciplinado, inativo, em maré de loss… — para validar o Dashboard
e o Painel da Turma) e **🗑 Limpar testes** (remove todos eles de uma vez). As
contas demo (senha `demo2026`) são marcadas com `demoSeed`, então a limpeza
nunca afeta usuários reais. Lógica em `api/seed-demo.js`.


## Personal Trader

Acompanhamento individual de **30 dias operados** (não dias de calendário: o
contador anda a cada envio). Duas visões no mesmo módulo, escolhidas pelo papel
de quem entra — aluno ou mentor.

**O ciclo.** A **Sessão Zero** é a reunião em que o mentor levanta a capacidade
financeira do aluno e define o plano de risco. Dali sai o **Plano v1**, que vira
o **Quadro de Gerenciamento** — seis parâmetros (pontos alvo, pontos de stop,
contratos por entrada, ganho diário, prejuízo diário, meta mensal) com as
colunas *Definido*, *Hoje* e um semáforo. O quadro fica no topo de todas as
telas do aluno e na lateral da tela de análise do mentor.

Todo dia o aluno **envia o dia** (CSV de Operações do Profit, importação do
próprio Diário de Trades do hub, ou digitando), escreve um resumo e marca o
estado emocional. O servidor detecta as **violações** automaticamente e o mentor
analisa, comentando **operação → tag → comentário → recomendação** — nunca texto
solto. O aluno confirma a leitura e pode devolver uma pergunta.

**Regras (sem IA), em `api/_pt-regras.js`.** Tudo é função pura e determinística:

- Na Sessão Zero, avisa sobre meta agressiva, payoff < 1, risco acima de 2% do
  capital e stop diário que não cabe duas operações perdedoras.
- A cada envio, gera violação de `prejuizo_diario`, `contratos_acima`,
  `fora_de_horario`, `sem_stop`, `overtrading` e `setup_nao_autorizado`.
- Alerta o mentor sobre tilt (3 perdas seguidas no dia), métrica fora da faixa
  por 3 envios, drawdown acima do projetado e 7 dias sem envio.

**Versionamento do plano.** Cada ajuste publica uma nova versão com motivo
obrigatório. A violação fica amarrada à versão vigente **na data da operação**,
nunca à atual — afrouxar o stop no dia 20 não absolve o dia 7. Qualquer mudança
de plano reanalisa os envios afetados no servidor.

**Projeção.** Faixa pessimista / base / otimista, variando **só o acerto**
(±10 p.p. sobre o alvo do plano): payoff, frequência e risco dependem da
disciplina do aluno, o acerto depende do mercado. A tela mostra o ritmo e
decompõe o desvio nas quatro variáveis (acerto, payoff, operações por dia, risco
médio), trocando uma por vez pelo valor real. Metas de **processo** vêm sempre
em primeiro plano; o resultado financeiro aparece em segundo e sempre em faixa.

**Privacidade.** O diagnóstico da Sessão Zero (capacidade financeira) e as
anotações do mentor são removidos no **servidor** de qualquer resposta lida por
um cliente — inclusive a dele mesmo.

**Acesso.** A permissão `personal` não entra no pacote padrão dos alunos: ela é
concedida junto com a matrícula, quando o mentor cria o ciclo na Sessão Zero.

**Chaves no Redis.** `forcehub:pt:alunos` (índice), `forcehub:pt:ciclo:<user>`,
`forcehub:pt:envios:<user>`, `forcehub:pt:img:<user>:<id>` (prints, um por
chave) e `forcehub:pt:tags` (biblioteca compartilhada de tags e snippets).

**Preparado para IA (fase de copiloto).** Cada envio guarda o conjunto completo
— envio + plano vigente + violações + tags + comentário por operação + feedback
geral — e cada tag acumula os snippets mais usados pelo mentor. É o par de
treino pronto para quando a IA passar a rascunhar o feedback.
