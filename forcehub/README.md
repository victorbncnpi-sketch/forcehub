# FORCE HUB AI

Dashboard financeiro para clientes XP — WIN · WDO · IBOV

## Deploy no Vercel

1. Faça upload desta pasta no GitHub
2. Importe no Vercel
3. **Configure as variáveis de ambiente no Vercel:**
   - `CRON_SECRET` = `forcehub2026cron`
   - `KV_REST_API_URL` = (gerado pelo Vercel KV — ver abaixo)
   - `KV_REST_API_TOKEN` = (gerado pelo Vercel KV — ver abaixo)

## Configurar Vercel KV (banco gratuito)

1. No dashboard do Vercel, vá em **Storage** → **Create Database** → **KV**
2. Nome: `forcehub-db`
3. O Vercel preenche automaticamente `KV_REST_API_URL` e `KV_REST_API_TOKEN`

## Cron Job (automático)

O sistema busca WIN, WDO e IBOV todo dia útil às **19h BRT** (22h UTC).
Configurado em `vercel.json` — não precisa fazer nada.

Para testar manualmente:
```
GET /api/fetch-market?secret=forcehub2026cron
```

## Credenciais
- usuario: `victor` / senha: `forcehub2026`
- usuario: `cliente1` / senha: `xp2026`
