import { ulid } from 'ulid';
import { fetchAndParseFeed } from './rss';
import { scrapeArticle } from './content-scraper';
import { rewriteWithAI } from './ai-rewriter';
import {
  initDatabase,
  getTodayCount,
  findDuplicatesByTitle,
  insertArticle,
  getArticlesForMarkdown,
} from './d1';
import {
  getDailyCount,
  setDailyCount,
  getLastRun,
  setLastRun,
  markUrlProcessed,
} from './kv';
import {
  pushMarkdownFile,
  generateMarkdown,
  ensureContentPath,
} from './github';
import { DAILY_LIMIT, CONTENT_PATH } from './constants';

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadFeeds(): Promise<Array<{ name: string; url: string; category: string }>> {
  const urls = [
    { name: 'Canaltech IA', url: 'https://canaltech.com.br/rss/ia/', category: 'ia-automacao' },
    { name: 'Olhar Digital IA', url: 'https://olhardigital.com.br/feed/ia/', category: 'ia-automacao' },
    { name: 'TecMundo IA', url: 'https://www.tecmundo.com.br/rss/ia/', category: 'ia-automacao' },
    { name: 'InfoMoney Tech', url: 'https://www.infomoney.com.br/feed/tecnologia/', category: 'negocios-tech' },
    { name: 'G1 Tecnologia', url: 'https://g1.globo.com/rss/g1/tecnologia/', category: 'tech-geral' },
    { name: 'StartSe', url: 'https://startse.com/feed/', category: 'startups' },
    { name: 'MIT Tech Review BR', url: 'https://mittechreview.com.br/feed/', category: 'ia-automacao' },
    { name: 'Exame Tech', url: 'https://exame.com/feed/tecnologia/', category: 'negocios-tech' },
    { name: 'B9', url: 'https://b9.com.br/feed/', category: 'marketing-tech' },
    { name: 'Computerworld', url: 'https://computerworld.com.br/feed/', category: 'tech-geral' },
    { name: 'IT Forum', url: 'https://itforum.com.br/feed/', category: 'tech-geral' },
    { name: 'NeoFeed', url: 'https://neofeed.com.br/feed/', category: 'startups' },
  ];
  return urls;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('[i-a-trend] Iniciando ciclo de agregação RSS...');

    try {
      await initDatabase(env.IAS_DB);
    } catch (e) {
      console.error('[i-a-trend] Erro init DB:', e);
    }

    const today = getDateBR();
    let dailyCount = await getDailyCount(env.IAS_CACHE, today);

    if (dailyCount >= DAILY_LIMIT) {
      console.log(`[i-a-trend] Limite diário atingido: ${dailyCount}/${DAILY_LIMIT}. Pulando ciclo.`);
      return;
    }

    const remaining = DAILY_LIMIT - dailyCount;
    console.log(`[i-a-trend] Hoje: ${dailyCount}/${DAILY_LIMIT}. Buscando até ${remaining} artigos.`);

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
      await sleep(500);
    }

    allArticles.sort((a, b) => b.score - a.score);

    let added = 0;
    const selected: typeof allArticles = [];

    for (const article of allArticles) {
      if (added >= remaining) break;

      const isDuplicate = await findDuplicatesByTitle(env.IAS_DB, article.title);
      if (isDuplicate) continue;

      let contentFull: string | undefined;

      // Scrape e rewrite com IA para artigos com boa pontuação
      if (article.score >= 15) {
        console.log(`[i-a-trend] Scraping: "${article.title.slice(0, 50)}..."`);
        const scraped = await scrapeArticle(article.sourceUrl);
        if (scraped.textContent) {
          contentFull = await rewriteWithAI(env.AI, article.title, scraped.textContent);
          if (scraped.imageUrl && !article.imageUrl) {
            (article as any).imageUrl = scraped.imageUrl;
          }
          await sleep(1000);
        }
      }

      const id = ulid();
      try {
        await insertArticle(env.IAS_DB, {
          id,
          ...article,
          tags: article.tags,
          contentFull,
        });
        selected.push({ ...article, content: contentFull || article.content });
        added++;
      } catch (e) {
        console.error(`[i-a-trend] Erro ao salvar artigo "${article.title}":`, e);
      }
    }

    console.log(`[i-a-trend] Adicionados ${added} novos artigos.`);

    for (const article of selected) {
      try {
        const markdown = generateMarkdown(article);
        const dateStr = article.publishedAt.split('T')[0];
        const filePath = `${CONTENT_PATH}/${dateStr}-${article.slug}.md`;

        const success = await pushMarkdownFile(
          env.GITHUB_TOKEN,
          env.GITHUB_REPO,
          filePath,
          markdown,
          `feat: add "${article.title}"`,
        );

        if (success) {
          console.log(`[i-a-trend] Markdown criado: ${filePath}`);
        } else {
          console.error(`[i-a-trend] Falha ao criar markdown: ${filePath}`);
        }
      } catch (e) {
        console.error(`[i-a-trend] Erro GitHub:`, e);
      }

      await sleep(1000);
    }

    dailyCount += added;
    await setDailyCount(env.IAS_CACHE, today, dailyCount);
    await setLastRun(env.IAS_CACHE);

    console.log(`[i-a-trend] Ciclo completo. Total hoje: ${dailyCount}/${DAILY_LIMIT}.`);
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

    return new Response('Worker i-a-trend ativo', { status: 200 });
  },
};