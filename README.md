# i-a-trend

Blog automatizado de automação com IA para negócios (PT-BR).

## Estrutura

```
├── src/                    # Site Astro (SSR, output: 'server')
│   ├── layouts/            # Layouts
│   ├── pages/              # Páginas (Home, Categoria, Notícia, RSS, Sitemap)
│   │   └── img/[...key].ts # Serve as ilustrações do R2 (bucket fica privado)
│   ├── components/         # Componentes (NewsCard, AdSense, Newsletter, etc.)
│   ├── styles/             # CSS
│   └── utils/              # Utilitários (d1, data, slug)
├── worker/                 # Worker de ingestão (Cloudflare Workers)
│   ├── src/                # Código do Worker (feeds fixos em loadFeeds(), src/index.ts)
│   ├── schema.sql          # Schema D1
│   └── wrangler.toml       # Config Worker
├── public/                 # Arquivos estáticos
├── astro.config.mjs        # Config Astro + Cloudflare
├── wrangler.toml           # Config do site (bindings D1/R2/assets)
└── package.json
```

As duas partes só se comunicam pelo D1: o worker escreve na tabela `articles`,
o site lê. Não há build do site disparado por conteúdo novo — como o Astro roda
em SSR, um artigo inserido aparece na próxima requisição.

## Deploy (passo a passo)

### 1. GitHub
```bash
# Crie o repo no GitHub e:
git remote add origin https://github.com/businesbrazilbr-boop/i-a-trend.git
git add .
git commit -m "init: blog i-a-trend"
git push -u origin main
```

### 2. Cloudflare Pages
1. Dashboard → Workers & Pages → Create → Pages → Connect to Git
2. Selecione `businesbrazilbr-boop/i-a-trend`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add custom domain: `i-a-trend.com`

### 3. DNS (se já estiver no Cloudflare)
- CNAME `www` → `i-a-trend.pages.dev`
- A `@` → `192.0.2.1`
- SSL/TLS: Full (Strict)

### 4. Worker de ingestão
```bash
cd worker
npm install
npx wrangler d1 create ias-news
npx wrangler kv namespace create IAS_CACHE
npx wrangler r2 bucket create ias-images
npx wrangler d1 execute ias-news --remote --file=./schema.sql
npx wrangler deploy
```

Não há secrets a configurar: o worker usa apenas bindings (`IAS_DB`, `IAS_CACHE`,
`IAS_IMAGES`, `AI`), todos declarados em `worker/wrangler.toml`. Copie para lá os
IDs devolvidos pelos comandos `create`.

O mesmo banco D1 e o mesmo bucket R2 precisam estar declarados no `wrangler.toml`
da raiz, que é o do site — é assim que as páginas leem os artigos e servem as imagens.

Rotas do worker, úteis para operar sem esperar o cron:

| Rota | O que faz |
|---|---|
| `GET /health` | Limite diário, quantos saíram hoje e quando foi a última execução |
| `GET /run` | Dispara o pipeline em background |
| `GET /run?sync=1` | Roda e devolve o resultado (ou o erro) na resposta |
| `GET /debug` | Quantos itens cada feed devolveu |
| `GET /test-ai` | Chama o modelo com um tema fixo e devolve a saída crua |

### 5. Google AdSense (manual)
- Solicitar em https://adsense.google.com com site ativo
- Colocar publisher ID em `public/ads.txt` e no componente `Layout.astro`

### 6. Cloudflare Config
- Caching → Configuration → Cache Level: **Standard** (NÃO "Cache Everything")
- Security → WAF → Firewall rules → Allow `Mediapartners-Google`

## Automatização

O worker busca os feeds RSS (lista fixa em `loadFeeds()`, em `worker/src/index.ts`),
agrupa as manchetes que falam da mesma notícia, e para cada tema selecionado gera
com Workers AI um texto próprio e uma ilustração própria. O artigo é inserido na
tabela `articles` do D1 e a imagem vai para o bucket R2 `ias-images`; o site lê o
D1 a cada requisição e serve as imagens em `/img/<key>`.

O limite é de 5 artigos por execução, definido na constante `DAILY_LIMIT` em
`worker/src/index.ts` — não é variável de ambiente.

**O cron está desligado de propósito** (`crons = []` em `worker/wrangler.toml`).
O trigger antigo rodava a cada 30 minutos e republicava matéria de terceiros em
massa. Antes de ativar (`crons = ["0 9 * * *"]`), rode o pipeline à mão com
`GET /run` e revise os primeiros artigos gerados.

## Monetização
- Google AdSense (requer aprovação manual)
- Affiliate links (Hotmart, Amazon BR, Eduzz)
- Newsletter (Beehiiv/ConvertKit)