import { ulid } from 'ulid';
import slugify from 'slugify';
import { fetchAndParseFeed } from './rss';
import { initDatabase, insertArticle, getExistingUrls } from './d1';
import { writeArticle, type SourceRef } from './ai-writer';
import { generateAndStoreImage } from './image';
import { decodeEntities, titleSimilarity } from './text';
import { getDailyCount, getLastRun, setLastRun } from './kv';

/**
 * Quantos artigos publicar por execucao. O cron roda 1x/dia.
 *
 * Antes existia um DAILY_LIMIT que nunca era aplicado no laco: o worker rodava
 * a cada 30 min e publicava tudo o que encontrasse, dezenas por dia. Esse volume
 * so' e' possivel copiando, e e' exatamente o que o Google classifica como
 * scaled content abuse. O limite agora e' aplicado de verdade, abaixo.
 */
const DAILY_LIMIT = 5;

/** Acima disto, dois titulos sao tratados como a mesma noticia e viram um so' artigo. */
const SIMILARITY_THRESHOLD = 0.32;

/** Minimo de fontes para um tema virar artigo. Uma fonte so' tende a produzir parafrase. */
const MIN_SOURCES_PREFERRED = 2;

interface Env {
  IAS_DB: D1Database;
  IAS_CACHE: KVNamespace;
  IAS_IMAGES: R2Bucket;
  AI: any;
}

interface FeedConfig {
  name: string;
  url: string;
  category: string;
  /**
   * 'descobrimento' = so' para saber o que esta' acontecendo (veiculos comerciais).
   * 'primaria'      = fonte de origem (newsroom, orgao oficial, pesquisa).
   */
  tipo: 'descobrimento' | 'primaria';
}

function getDateBR(): string {
  const now = new Date();
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return br.toISOString().split('T')[0];
}

function loadFeeds(): FeedConfig[] {
  return [
    // --- Fontes primarias: newsrooms e orgaos oficiais. Daqui sai o grosso do material. ---
    { name: 'OpenAI', url: 'https://openai.com/news/rss.xml', category: 'ia-automacao', tipo: 'primaria' },
    { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', category: 'ia-automacao', tipo: 'primaria' },
    { name: 'Microsoft AI', url: 'https://blogs.microsoft.com/ai/feed/', category: 'ia-automacao', tipo: 'primaria' },
    { name: 'AWS Machine Learning', url: 'https://aws.amazon.com/blogs/machine-learning/feed/', category: 'ia-automacao', tipo: 'primaria' },
    { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', category: 'ia-automacao', tipo: 'primaria' },
    // Agencia Brasil e' Creative Commons BY: texto e foto reutilizaveis com credito.
    { name: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml', category: 'negocios-tech', tipo: 'primaria' },
    { name: 'Agência Gov', url: 'https://agenciagov.ebc.com.br/rss.xml', category: 'negocios-tech', tipo: 'primaria' },

    // --- Descobrimento: veiculos comerciais. So' manchete + resumo publico do RSS. ---
    { name: 'G1 Tecnologia', url: 'https://g1.globo.com/rss/g1/tecnologia/', category: 'tech-geral', tipo: 'descobrimento' },
    { name: 'MIT Tech Review BR', url: 'https://mittechreview.com.br/feed/', category: 'ia-automacao', tipo: 'descobrimento' },
    { name: 'IT Forum', url: 'https://itforum.com.br/feed/', category: 'tech-geral', tipo: 'descobrimento' },
    { name: 'NeoFeed', url: 'https://neofeed.com.br/feed/', category: 'startups', tipo: 'descobrimento' },
    { name: 'Computerworld', url: 'https://computerworld.com.br/feed/', category: 'tech-geral', tipo: 'descobrimento' },
    { name: 'InfoMoney Tech', url: 'https://www.infomoney.com.br/feed/', category: 'negocios-tech', tipo: 'descobrimento' },
    { name: 'Meio&Mensagem', url: 'https://www.meioemensagem.com.br/rss/', category: 'marketing-tech', tipo: 'descobrimento' },
    { name: 'Canaltech IA', url: 'https://canaltech.com.br/rss/ia/', category: 'ia-automacao', tipo: 'descobrimento' },
  ];
}

interface FeedItem {
  title: string;
  excerpt: string;
  source: SourceRef;
  category: string;
  publishedAt: string;
  tipo: 'descobrimento' | 'primaria';
  score: number;
}

interface Topic {
  items: FeedItem[];
  category: string;
  score: number;
}

/**
 * Agrupa manchetes que falam da mesma noticia.
 *
 * O filtro anterior comparava slug exato, por isso "prometem alterar como voce
 * joga" e "prometem mudar como voce joga" entraram como dois artigos separados.
 */
function clusterTopics(items: FeedItem[]): Topic[] {
  const topics: Topic[] = [];

  for (const item of items) {
    const match = topics.find(t =>
      t.items.some(existing => titleSimilarity(existing.title, item.title) >= SIMILARITY_THRESHOLD),
    );
    if (match) {
      match.items.push(item);
    } else {
      topics.push({ items: [item], category: item.category, score: 0 });
    }
  }

  for (const t of topics) {
    // Mais veiculos falando do mesmo assunto = mais relevante e mais material
    // para uma sintese que nao seja parafrase de um so' texto.
    const cobertura = t.items.length;
    const temPrimaria = t.items.some(i => i.tipo === 'primaria') ? 1 : 0;
    const base = t.items.reduce((acc, i) => acc + i.score, 0) / t.items.length;
    t.score = base + cobertura * 12 + temPrimaria * 20;
    // A categoria do tema e' a da fonte primaria, se houver.
    t.category = (t.items.find(i => i.tipo === 'primaria') || t.items[0]).category;
  }

  return topics.sort((a, b) => b.score - a.score);
}

async function runPipeline(env: Env): Promise<{ added: number; message: string }> {
  console.log('[i-a-trend] Iniciando ciclo de publicacao...');

  try {
    await initDatabase(env.IAS_DB);
  } catch (e) {
    console.error('[i-a-trend] Erro init DB:', e);
  }

  const feeds = loadFeeds();
  const all: FeedItem[] = [];

  for (const feed of feeds) {
    try {
      const parsed = await fetchAndParseFeed(feed.url, feed.name, feed.category);
      for (const a of parsed) {
        all.push({
          title: decodeEntities(a.title),
          excerpt: decodeEntities(a.excerpt || ''),
          source: { name: feed.name, url: a.sourceUrl },
          category: a.category,
          publishedAt: a.publishedAt,
          tipo: feed.tipo,
          score: a.score,
        });
      }
    } catch (e) {
      console.error(`[i-a-trend] Falha no feed ${feed.name}:`, e);
    }
  }

  console.log(`[i-a-trend] ${all.length} itens coletados de ${feeds.length} feeds.`);
  if (all.length === 0) return { added: 0, message: 'Nenhum item coletado.' };

  // Nao reprocessar o que ja' virou artigo.
  let jaUsadas = new Set<string>();
  try {
    jaUsadas = await getExistingUrls(env.IAS_DB);
  } catch (e) {
    console.error('[i-a-trend] Erro ao ler URLs existentes:', e);
  }
  const novos = all.filter(i => !jaUsadas.has(i.source.url));

  const topics = clusterTopics(novos);
  console.log(`[i-a-trend] ${novos.length} itens novos em ${topics.length} temas.`);

  // Prioriza temas com cobertura de mais de uma fonte; se nao houver o bastante,
  // completa com os melhores restantes.
  const comCobertura = topics.filter(t => t.items.length >= MIN_SOURCES_PREFERRED);
  const restantes = topics.filter(t => t.items.length < MIN_SOURCES_PREFERRED);
  const selecionados = [...comCobertura, ...restantes].slice(0, DAILY_LIMIT);

  console.log(`[i-a-trend] ${selecionados.length} temas selecionados (limite ${DAILY_LIMIT}).`);

  let added = 0;

  for (const topic of selecionados) {
    const principal = topic.items[0];

    const escrito = await writeArticle(env.AI, {
      items: topic.items.map(i => ({ title: i.title, excerpt: i.excerpt, source: i.source })),
      category: topic.category,
    });

    if (!escrito) {
      console.warn(`[i-a-trend] Tema descartado pelo redator: "${principal.title.slice(0, 60)}"`);
      continue;
    }

    const id = ulid();
    const slug = slugify(escrito.title, { lower: true, strict: true, locale: 'pt' }).slice(0, 140);

    let imageKey: string | null = null;
    try {
      imageKey = await generateAndStoreImage(env.AI, env.IAS_IMAGES, id, escrito.tags, topic.category);
    } catch (e) {
      console.error('[i-a-trend] Erro na ilustracao, publicando sem capa:', e);
    }

    try {
      await insertArticle(env.IAS_DB, {
        id,
        title: escrito.title,
        slug,
        excerpt: escrito.excerpt,
        content: escrito.body,
        contentFull: escrito.body,
        sourceUrl: principal.source.url,
        sourceName: principal.source.name,
        sources: escrito.sources,
        category: topic.category,
        publishedAt: new Date().toISOString(),
        imageKey,
        tags: escrito.tags,
      });
      added++;
      console.log(`[i-a-trend] Publicado: ${escrito.title}`);
    } catch (e) {
      console.error(`[i-a-trend] Erro ao salvar "${escrito.title}":`, e);
    }
  }

  await setLastRun(env.IAS_CACHE);
  console.log(`[i-a-trend] Ciclo concluido. ${added} artigos publicados.`);
  return { added, message: `${added} artigos publicados.` };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runPipeline(env);
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        dailyLimit: DAILY_LIMIT,
        dailyCount: await getDailyCount(env.IAS_CACHE, getDateBR()),
        date: getDateBR(),
        lastRun: await getLastRun(env.IAS_CACHE),
      });
    }

    if (url.pathname === '/debug') {
      const results: any[] = [];
      for (const feed of loadFeeds()) {
        try {
          const articles = await fetchAndParseFeed(feed.url, feed.name, feed.category);
          results.push({ name: feed.name, tipo: feed.tipo, itens: articles.length });
        } catch (e: any) {
          results.push({ name: feed.name, tipo: feed.tipo, erro: e.message });
        }
      }
      return Response.json(results);
    }

    if (url.pathname === '/run') {
      ctx.waitUntil(runPipeline(env));
      return Response.json({ status: 'running' });
    }

    return new Response('Worker i-a-trend ativo', { status: 200 });
  },
};
