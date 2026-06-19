import { ulid } from 'ulid';
import { fetchAndParseFeed } from './rss';
import {
  initDatabase,
  insertArticle,
} from './d1';

async function fetchFullContent(url: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`, {
      headers: { 'User-Agent': 'i-a-trend/1.0' },
      timeout: 15000,
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    return text.slice(0, 8000);
  } catch {
    return null;
  }
}
import {
  getDailyCount,
  setDailyCount,
  getLastRun,
  setLastRun,
  getArticlesDate,
  setArticlesDate,
} from './kv';

interface Env {
  IAS_DB: D1Database;
  IAS_CACHE: KVNamespace;
  AI: any;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
}

function getDateBR(): string {
  const now = new Date();
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return br.toISOString().split('T')[0];
}

async function loadFeeds(): Promise<Array<{ name: string; url: string; category: string }>> {
  const urls = [
    { name: 'G1 Tecnologia', url: 'https://g1.globo.com/rss/g1/tecnologia/', category: 'tech-geral' },
    { name: 'MIT Tech Review BR', url: 'https://mittechreview.com.br/feed/', category: 'ia-automacao' },
    { name: 'IT Forum', url: 'https://itforum.com.br/feed/', category: 'tech-geral' },
    { name: 'NeoFeed', url: 'https://neofeed.com.br/feed/', category: 'startups' },
    { name: 'Computerworld', url: 'https://computerworld.com.br/feed/', category: 'tech-geral' },
    { name: 'Valor Econômico Tech', url: 'https://valor.globo.com/rss/tecnologia/', category: 'negocios-tech' },
    { name: 'InfoMoney Tech', url: 'https://www.infomoney.com.br/feed/', category: 'negocios-tech' },
    { name: 'Meio&Mensagem', url: 'https://www.meioemensagem.com.br/rss/', category: 'marketing-tech' },
    { name: 'Proxxxima', url: 'https://proxxima.com.br/feed/', category: 'marketing-tech' },
  ];
  return urls;
}

async function runPipeline(env: Env, force: boolean): Promise<{ added: number; message: string }> {
  console.log('[i-a-trend] Iniciando ciclo de agregação RSS...');

  try {
    await initDatabase(env.IAS_DB);
  } catch (e) {
    console.error('[i-a-trend] Erro init DB:', e);
  }

  const today = getDateBR();
  const articlesDate = await getArticlesDate(env.IAS_CACHE);

  // Se mudou o dia, limpa artigos antigos e começa do zero
  if (articlesDate !== today) {
    console.log(`[i-a-trend] Novo dia (${today}). Limpando artigos antigos...`);
    try {
      await env.IAS_DB.prepare('DELETE FROM articles').run();
    } catch (e) {
      console.error('[i-a-trend] Erro ao limpar artigos:', e);
    }
    await setArticlesDate(env.IAS_CACHE, today);
  }

  const feeds = await loadFeeds();
  const allArticles: Array<{
    title: string;
    slug: string;
    excerpt: string;
    sourceUrl: string;
    sourceName: string;
    category: string;
    publishedAt: string;
    imageUrl: string | null;
    tags: string[];
    score: number;
    content: string;
  }> = [];

  for (const feed of feeds) {
    console.log(`[i-a-trend] Buscando feed: ${feed.name}`);
    const articles = await fetchAndParseFeed(feed.url, feed.name, feed.category);
    allArticles.push(...articles);
  }

  allArticles.sort((a, b) => b.score - a.score);

  // Pega os slugs já existentes para evitar duplicatas
  let existingSlugs = new Set<string>();
  try {
    const existing = await env.IAS_DB.prepare('SELECT slug FROM articles').all<{ slug: string }>();
    existingSlugs = new Set(existing.results?.map(r => r.slug) || []);
  } catch (e) {
    console.error('[i-a-trend] Erro ao buscar slugs existentes:', e);
  }

  // Filtra duplicatas
  const uniqueArticles = allArticles.filter(a => !existingSlugs.has(a.slug));
  console.log(`[i-a-trend] ${uniqueArticles.length} artigos únicos para processar`);

  // Processa em lotes de 3 em paralelo (evita timeout 30s)
  const BATCH_SIZE = 3;
  let added = 0;

  for (let i = 0; i < uniqueArticles.length; i += BATCH_SIZE) {
    const batch = uniqueArticles.slice(i, i + BATCH_SIZE);
    
    // Processa scraping em paralelo no lote
    await Promise.all(batch.map(async (article) => {
      if (article.sourceUrl) {
        try {
          console.log(`[i-a-trend] Scraping: ${article.title.slice(0, 50)}...`);
          const full = await fetchFullContent(article.sourceUrl);
          if (full) article.contentFull = full;
        } catch (e) {
          console.error(`[i-a-trend] Erro scraping ${article.title}:`, e);
        }
      }
    }));

    // Salva lote
    for (const article of batch) {
      const id = ulid();
      try {
        await insertArticle(env.IAS_DB, {
          id,
          ...article,
          tags: article.tags,
          contentFull: article.contentFull || undefined,
        });
        added++;
      } catch (e) {
        console.error(`[i-a-trend] Erro ao salvar "${article.title}":`, e);
      }
    }
    
    console.log(`[i-a-trend] Lote ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(uniqueArticles.length/BATCH_SIZE)} concluído (${added} total)`);
  }

  console.log(`[i-a-trend] Adicionados ${added} novos artigos.`);
  await setLastRun(env.IAS_CACHE);

  console.log(`[i-a-trend] Ciclo completo. Total hoje: ${added}.`);
  return { added, message: `${added} artigos adicionados.` };
}

async function seedArticles(env: Env): Promise<Response> {
  const seedData = [
    { category: 'negocios-tech', title: 'Como grandes empresas brasileiras estão usando IA para reduzir custos operacionais', source: 'Exame', url: 'https://exame.com/tecnologia/ia-empresas-custos/', tags: ['ia', 'negocios', 'automacao'] },
    { category: 'negocios-tech', title: 'IA generativa nas finanças: bancos brasileiros testam LLMs para análise de risco', source: 'InfoMoney', url: 'https://www.infomoney.com.br/mercados/ia-bancos-analise-risco/', tags: ['ia', 'fintech', 'bancos'] },
    { category: 'startups', title: 'Rodada de R$ 50M: startup brasileira de IA para agronegócio atrai fundos globais', source: 'NeoFeed', url: 'https://neofeed.com.br/startup-ia-agro-investimento/', tags: ['ia', 'startup', 'investimento', 'agrotech'] },
    { category: 'startups', title: 'Scale-up de IA conversacional brasileira expande para LatAm após aporte de R$ 30M', source: 'StartSe', url: 'https://startse.com/startup-ia-conversacional-latam/', tags: ['ia', 'scaleup', 'latam', 'conversacional'] },
    { category: 'marketing-tech', title: 'IA criativa: agências brasileiras usam Midjourney e DALL-E para campanhas 3x mais rápidas', source: 'B9', url: 'https://b9.com.br/ia-criativa-agencias-campanhas/', tags: ['ia', 'marketing', 'criativo', 'midjourney'] },
    { category: 'marketing-tech', title: 'Anúncios inteligentes: como varejistas usam IA preditiva para reduzir CAC em 40%', source: 'Meio&Mensagem', url: 'https://meioemensagem.com.br/marketing/ia-preditiva-cac/', tags: ['ia', 'ads', 'varejo', 'preditiva'] },
    { category: 'tech-geral', title: 'Brasil sobe no ranking global de pesquisa em IA, impulsionado por universidades e startups', source: 'Computerworld', url: 'https://computerworld.com.br/brasil-ranking-pesquisa-ia/', tags: ['ia', 'pesquisa', 'brasil', 'universidades'] },
    { category: 'tech-geral', title: 'Regulamentação da IA no Brasil: PL 2338 avança no Senado com foco em transparência', source: 'IT Forum', url: 'https://itforum.com.br/regulamentacao-ia-brasil-pl2338/', tags: ['ia', 'regulacao', 'senado', 'legislacao'] },
  ];

  let added = 0;
  const now = new Date().toISOString();

  for (const article of seedData) {
    const id = ulid();
    const slug = article.title.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 140);

    try {
      await env.IAS_DB.prepare(`
        INSERT INTO articles (id, title, slug, excerpt, content, content_full, source_url, source_name, category, published_at, image_url, tags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        article.title,
        slug,
        article.title.slice(0, 250),
        article.title,
        article.title,
        article.url,
        article.source,
        article.category,
        now,
        null,
        JSON.stringify(article.tags),
        now
      ).run();
      added++;
    } catch (e) {
      console.error(`[seed] Erro: ${article.title}`, e);
    }
  }

  return new Response(JSON.stringify({ added, message: `${added} artigos seed inseridos` }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await runPipeline(env, false);
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        dailyCount: await getDailyCount(env.IAS_CACHE, getDateBR()),
        date: getDateBR(),
        lastRun: await getLastRun(env.IAS_CACHE),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/debug') {
      const feeds = await loadFeeds();
      const results: any[] = [];
      for (const feed of feeds) {
        try {
          const articles = await fetchAndParseFeed(feed.url, feed.name, feed.category);
          results.push({ name: feed.name, url: feed.url, articles: articles.length, titles: articles.map(a => a.title).slice(0, 3) });
        } catch (e: any) {
          results.push({ name: feed.name, url: feed.url, error: e.message });
        }
      }
      return new Response(JSON.stringify(results, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/run') {
      const force = url.searchParams.has('force');
      ctx.waitUntil(runPipeline(env, force));
      return new Response(JSON.stringify({ status: 'running', force }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/seed') {
      return seedArticles(env);
    }

    return new Response('Worker i-a-trend ativo', { status: 200 });
  },
};