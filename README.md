# i-a-trend

Blog automatizado de automação com IA para negócios (PT-BR).

## Estrutura

```
├── src/                    # Site Astro
│   ├── content/news/       # Artigos em Markdown (preenchido pelo Worker)
│   ├── layouts/            # Layouts
│   ├── pages/              # Páginas (Home, Categoria, Notícia, RSS, Sitemap)
│   ├── components/         # Componentes (NewsCard, AdSense, Newsletter, etc.)
│   ├── styles/             # CSS
│   └── utils/              # Utilitários (data, slug)
├── worker/                 # Worker RSS (Cloudflare Workers)
│   ├── src/                # Código do Worker
│   ├── feeds.csv           # Fontes RSS brasileiras
│   ├── schema.sql          # Schema D1
│   └── wrangler.toml       # Config Worker
├── public/                 # Arquivos estáticos
├── astro.config.mjs        # Config Astro + Cloudflare
├── wrangler.toml           # Config Pages
└── package.json
```

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

### 4. Worker RSS
```bash
cd worker
npm install
npx wrangler d1 create ias-news
npx wrangler kv:namespace create IAS_CACHE
npx wrangler secret put GITHUB_TOKEN  # Token com permissão de commit no repo
npx wrangler d1 execute ias-news --file=./schema.sql
npx wrangler deploy
```

### 5. Google AdSense (manual)
- Solicitar em https://adsense.google.com com site ativo
- Colocar publisher ID em `public/ads.txt` e no componente `Layout.astro`

### 6. Cloudflare Config
- Caching → Configuration → Cache Level: **Standard** (NÃO "Cache Everything")
- Security → WAF → Firewall rules → Allow `Mediapartners-Google`

## Automatização
O Worker cron roda a cada 30 minutos, busca feeds RSS, seleciona os melhores artigos (máx 10/dia) e faz commit no GitHub como Markdown. O Cloudflare Pages rebuilda automaticamente.

## Monetização
- Google AdSense (requer aprovação manual)
- Affiliate links (Hotmart, Amazon BR, Eduzz)
- Newsletter (Beehiiv/ConvertKit)