import { ulid } from 'ulid';
import slugify from 'slugify';
import { fetchAndParseFeed } from './rss';
import { initDatabase, insertArticle, getExistingUrls } from './d1';
import {
  writeArticle, WRITER_MODEL, MIN_BODY_CHARS, MAX_BODY_CHARS, type SourceRef,
} from './ai-writer';
import { fetchSourceText } from './fetch-source';
import { generateAndStoreImage } from './image';
import { decodeEntities, significantWords, setSimilarity } from './text';
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

/**
 * Acima disto, dois titulos sao tratados como a mesma noticia e viram um so' artigo.
 *
 * 0.32 era frouxo demais: vocabulario generico ("IA", "automacao") juntava
 * assuntos sem relacao e produziu um artigo com 34 fontes, que nao e' um tema
 * e sim um saco de gatos.
 */
const SIMILARITY_THRESHOLD = 0.45;

/** Teto de fontes por tema. Um assunto real raramente passa disto. */
const MAX_ITEMS_PER_TOPIC = 6;

/**
 * Maximo de artigos por veiculo num mesmo ciclo, para o site nao virar monotema.
 *
 * Era 2. Com poucas fontes primarias ativas num dia, 2 tornava impossivel fechar
 * a cota de 5 mesmo havendo material bom. 3 mantem variedade e deixa o ciclo
 * fechar.
 */
const MAX_PER_SOURCE = 3;

/** Fontes por tema cujo texto vale a pena buscar. Alem disso e' latencia sem ganho. */
const MAX_FETCH_POR_TEMA = 3;

/**
 * Minimo de material de apoio para tentar escrever.
 *
 * Sem isto o redator volta a receber so' manchete e resumo, nao alcanca o piso
 * de 3800 caracteres e enche o texto de especulacao para chegar la'. Melhor
 * pular o tema antes de gastar uma chamada ao modelo.
 */
const MIN_REFERENCE_CHARS = 600;

/** Dois temas acima disto sao a mesma noticia com outra roupagem. */
const NEAR_DUPLICATE_THRESHOLD = 0.5;

/** Minimo de fontes para um tema virar artigo. Uma fonte so' tende a produzir parafrase. */
const MIN_SOURCES_PREFERRED = 2;

/**
 * Quantos itens entram no agrupamento.
 *
 * O agrupamento compara cada item com os temas ja' abertos, ou seja, e' O(n^2).
 * Os feeds devolvem ~2.000 itens por ciclo, o que estourava a CPU do Worker
 * antes de gerar qualquer artigo. Como so' publicamos DAILY_LIMIT temas, basta
 * agrupar os melhores por score.
 */
const MAX_ITEMS_TO_CLUSTER = 150;

/** Cota de itens por veiculo na entrada, para nenhum feed dominar o ciclo. */
const MAX_ITEMS_PER_FEED = 12;

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
  /**
   * Newsroom cujo material e' todo de IA. Dispensa o filtro de palavra-chave,
   * porque o resumo do RSS as vezes descreve o produto sem repetir o termo.
   *
   * NAO marcar veiculos de pauta ampla (Agencia Brasil, G1, InfoMoney): e'
   * justamente neles que o filtro precisa rodar.
   */
  iaGarantida?: boolean;
}

function getDateBR(): string {
  const now = new Date();
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return br.toISOString().split('T')[0];
}

function loadFeeds(): FeedConfig[] {
  return [
    // --- Fontes primarias: newsrooms e orgaos oficiais. Daqui sai o grosso do material. ---
    { name: 'OpenAI', url: 'https://openai.com/news/rss.xml', category: 'ia-automacao', tipo: 'primaria', iaGarantida: true },
    { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', category: 'ia-automacao', tipo: 'primaria', iaGarantida: true },
    { name: 'Microsoft AI', url: 'https://blogs.microsoft.com/ai/feed/', category: 'ia-automacao', tipo: 'primaria', iaGarantida: true },
    { name: 'AWS Machine Learning', url: 'https://aws.amazon.com/blogs/machine-learning/feed/', category: 'ia-automacao', tipo: 'primaria', iaGarantida: true },
    { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', category: 'ia-automacao', tipo: 'primaria', iaGarantida: true },
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
  // Palavras calculadas UMA vez por item. Normalizar dentro do laco de
  // comparacao era o que estourava a CPU.
  const prepared = items.map(item => ({ item, words: significantWords(item.title) }));

  const topics: Array<Topic & { wordSets: Set<string>[] }> = [];

  for (const { item, words } of prepared) {
    const match = topics.find(t =>
      t.items.length < MAX_ITEMS_PER_TOPIC &&
      t.wordSets.some(existing => setSimilarity(existing, words) >= SIMILARITY_THRESHOLD),
    );
    if (match) {
      match.items.push(item);
      match.wordSets.push(words);
    } else {
      topics.push({ items: [item], wordSets: [words], category: item.category, score: 0 });
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
      const parsed = await fetchAndParseFeed(feed.url, feed.name, feed.category, !feed.iaGarantida);
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

  // Cota por veiculo ANTES de ordenar por score. Sem isto um feed grande
  // (OpenAI devolve ~1.100 itens) ocupa quase todas as vagas do agrupamento e
  // o ciclo inteiro acaba sendo sobre um unico assunto.
  const porVeiculo = new Map<string, FeedItem[]>();
  for (const item of novos) {
    const lista = porVeiculo.get(item.source.name) || [];
    if (lista.length < MAX_ITEMS_PER_FEED) {
      lista.push(item);
      porVeiculo.set(item.source.name, lista);
    }
  }

  const candidatos = [...porVeiculo.values()]
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ITEMS_TO_CLUSTER);

  const topics = clusterTopics(candidatos);
  console.log(`[i-a-trend] ${novos.length} novos, ${candidatos.length} candidatos, ${topics.length} temas.`);

  // Fila por ordem de preferencia, nao por score puro. O que decide a qualidade
  // do artigo e' quanto material honesto existe para sintetizar:
  //
  //  1. varias fontes  — da' para cruzar versoes, e' sintese de verdade;
  //  2. fonte unica primaria — a origem anunciando o proprio fato (OpenAI sobre
  //     seu modelo); nao e' parafrase de terceiro;
  //  3. fonte unica de descobrimento — ultimo recurso. So' entra porque agora
  //     buscamos o texto da materia, entao ha' o que sintetizar; o risco de
  //     virar spinning fica com verbatimOverlap, no redator.
  const comCobertura = topics.filter(t => t.items.length >= MIN_SOURCES_PREFERRED);
  const fonteUnicaDeOrigem = topics.filter(
    t => t.items.length < MIN_SOURCES_PREFERRED && t.items[0].tipo === 'primaria',
  );
  const fonteUnicaDescobrimento = topics.filter(
    t => t.items.length < MIN_SOURCES_PREFERRED && t.items[0].tipo !== 'primaria',
  );

  // Folga grande de proposito. Cada tema pode cair por falta de material de apoio,
  // por repeticao, por especulacao ou por trecho copiado; com folga curta um ciclo
  // com muitas rejeicoes fecha bem abaixo da cota. Para assim que atingir DAILY_LIMIT.
  const fila = [...comCobertura, ...fonteUnicaDeOrigem, ...fonteUnicaDescobrimento]
    .slice(0, DAILY_LIMIT * 6);

  console.log(`[i-a-trend] ${fila.length} temas na fila para publicar ${DAILY_LIMIT}.`);

  let added = 0;

  // Diversidade editorial. Sem isto o ciclo publica cinco variacoes do mesmo
  // assunto: um feed grande (OpenAI devolve ~1.100 itens) domina o ranking e
  // sai um site de notas quase identicas — exatamente o padrao de baixo valor
  // que queremos evitar.
  const porFonte = new Map<string, number>();
  const publicados: Set<string>[] = [];

  for (const topic of fila) {
    if (added >= DAILY_LIMIT) break;

    const principal = topic.items[0];

    const usos = porFonte.get(principal.source.name) || 0;
    if (usos >= MAX_PER_SOURCE) {
      console.log(`[i-a-trend] Pulando tema: ja' publiquei ${usos} de ${principal.source.name}.`);
      continue;
    }

    // Dois titulos podem cair em temas distintos e ainda ser a mesma noticia.
    const palavras = significantWords(principal.title);
    if (publicados.some(p => setSimilarity(p, palavras) >= NEAR_DUPLICATE_THRESHOLD)) {
      console.log(`[i-a-trend] Pulando tema quase duplicado: "${principal.title.slice(0, 50)}"`);
      continue;
    }

    // Material de apoio buscado so' agora, para o tema que vai mesmo ser escrito.
    // Buscar para a fila inteira seriam dezenas de requisicoes por ciclo.
    const itens = await Promise.all(
      topic.items.slice(0, MAX_FETCH_POR_TEMA).map(async i => ({
        title: i.title,
        excerpt: i.excerpt,
        source: i.source,
        reference: await fetchSourceText(i.source.url),
      })),
    );

    if (!itens.some(i => i.reference.length >= MIN_REFERENCE_CHARS)) {
      console.log(`[i-a-trend] Sem material de apoio para "${principal.title.slice(0, 50)}", pulando.`);
      continue;
    }

    const escrito = await writeArticle(env.AI, { items: itens, category: topic.category });

    if (!escrito) {
      console.warn(`[i-a-trend] Tema descartado pelo redator: "${principal.title.slice(0, 60)}"`);
      continue;
    }

    const id = ulid();
    const slug = slugify(escrito.title, { lower: true, strict: true, locale: 'pt' }).slice(0, 140);

    let imageKey: string | null = null;
    try {
      imageKey = await generateAndStoreImage(
        env.AI, env.IAS_IMAGES, id, escrito.imagePrompt, escrito.tags, topic.category,
      );
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
      porFonte.set(principal.source.name, usos + 1);
      publicados.push(palavras);
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
        // Assinatura do codigo que esta' realmente no ar. Um ciclo ja' rodou
        // contra a versao anterior logo apos um deploy, e so' descobrimos isso
        // depois, medindo os artigos publicados. Confira estes valores antes de
        // disparar /run.
        writer: { minBodyChars: MIN_BODY_CHARS, maxBodyChars: MAX_BODY_CHARS, usaMaterialDeApoio: true },
      });
    }

    // Diagnostico: chama o modelo com um tema fixo e devolve a saida crua.
    if (url.pathname === '/test-ai') {
      const topic = {
        category: 'ia-automacao',
        items: [
          { title: 'OpenAI lanca novo modelo de raciocinio', excerpt: 'A empresa anunciou um modelo focado em tarefas de raciocinio complexo.', source: { name: 'OpenAI', url: 'https://openai.com/news/x' } },
          { title: 'Novo modelo da OpenAI promete melhor desempenho', excerpt: 'Analistas apontam ganhos em benchmarks de matematica e codigo.', source: { name: 'G1', url: 'https://g1.globo.com/x' } },
        ],
      };
      try {
        const raw = await env.AI.run(WRITER_MODEL, {
          messages: [{ role: 'user', content: 'Responda apenas com JSON: {"ok": true}' }],
          max_tokens: 50,
        });
        const escrito = await writeArticle(env.AI, topic as any);
        return Response.json({
          pingModelo: raw,
          artigoGerado: escrito ? { title: escrito.title, tamanhoCorpo: escrito.body.length, tags: escrito.tags } : null,
        });
      } catch (e: any) {
        return Response.json({ erro: String(e?.message || e), stack: String(e?.stack || '').slice(0, 1200) }, { status: 500 });
      }
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
      // ?sync=1 aguarda e devolve o resultado (ou o erro) na resposta. O modo
      // padrao roda em waitUntil, cujos erros nao aparecem para quem chamou.
      if (url.searchParams.has('sync')) {
        try {
          return Response.json(await runPipeline(env));
        } catch (e: any) {
          return Response.json(
            { erro: String(e?.message || e), stack: String(e?.stack || '').slice(0, 1500) },
            { status: 500 },
          );
        }
      }
      ctx.waitUntil(runPipeline(env));
      return Response.json({ status: 'running' });
    }

    return new Response('Worker i-a-trend ativo', { status: 200 });
  },
};
