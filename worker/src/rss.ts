import slugify from 'slugify';
import { IA_KEYWORDS, CATEGORY_WEIGHTS } from './constants';
import { decodeEntities, stripAccents } from './text';

interface ParsedArticle {
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
  contentFull?: string;
}

function extractTag(text: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(text);
  return m ? m[1].trim() : '';
}

function extractAllTags(text: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'ig');
  const results: string[] = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim();
    const cleaned = raw
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/\]\]>/g, '')
      .trim();
    if (cleaned) results.push(cleaned);
  }
  return results;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/\]\]>/g, '')
    .trim();
}

function cleanExcerpt(text: string): string {
  return text
    .replace(/The post[\s\S]*?appeared first on[\s\S]*?\./gi, '')
    .replace(/The article[\s\S]*?appeared first on[\s\S]*?\./gi, '')
    .replace(/Originally published at[\s\S]*?\./gi, '')
    .replace(/\[\s*Fonte[\s\S]*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractImageFromItem(itemXml: string): string | null {
  const mediaMatch = /<media:content\s[^>]*url="([^"]+)"/i.exec(itemXml);
  if (mediaMatch) return mediaMatch[1];
  const enclosureMatch = /<enclosure\s[^>]*url="([^"]+)"[^>]*type="image/i.exec(itemXml);
  if (enclosureMatch) return enclosureMatch[1];
  return null;
}

/** Escapa um termo e tira o acento, para entrar numa regex de palavra inteira. */
function paraRegex(termo: string): string {
  return stripAccents(termo.toLowerCase()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Palavras-chave de IA com fronteira de palavra, sobre texto sem acento.
 *
 * IA_KEYWORDS nao tem "ia" sozinho, e em portugues e' de longe a forma mais
 * comum de escrever o assunto ("empresas adotam IA"). Por substring nao dava
 * para acrescentar — "ia" cabe dentro de notícia, agência, economia —, mas com
 * fronteira de palavra e' seguro, e sem isso o filtro derrubaria materia boa
 * dos feeds de descobrimento.
 */
const RELEVANCIA_IA = new RegExp(`\\b(${[...IA_KEYWORDS, 'ia'].map(paraRegex).join('|')})\\b`);

function temPalavraChaveIA(texto: string): boolean {
  return RELEVANCIA_IA.test(stripAccents(texto.toLowerCase()));
}

/**
 * Escolhe a categoria pelo texto, caindo na do feed quando nada casa.
 *
 * As palavras eram comparadas como SUBSTRING, e a lista de 'ia-automacao'
 * comecava por 'ia'. Em portugues "ia" aparece dentro de notícia, agência,
 * tecnologia, família, experiência, economia, dia... ou seja, qualquer texto
 * pontuava altissimo nessa categoria e o site inteiro saiu marcado como
 * "IA & Automação", inclusive materias de apostas e de taxa de juros.
 *
 * Agora a comparacao e' por palavra inteira sobre o texto sem acentos.
 */
function classifyCategory(title: string, content: string, feedCategory: string): string {
  const text = stripAccents(`${title} ${content}`.toLowerCase());
  const categoryKeywords: Record<string, string[]> = {
    'ia-automacao': ['ia', 'inteligência artificial', 'machine learning', 'deep learning', 'ia generativa', 'chatgpt', 'gpt', 'llm', 'automação', 'rpa', 'copilot', 'neural', 'nlp', 'chatbot', 'assistente virtual', 'computer vision'],
    'negocios-tech': ['fintech', 'banco digital', 'investimento', 'cripto', 'blockchain', 'pagamento', 'pix', 'cartão', 'crédito', 'finanças', 'corporativo', 'b2b', 'erp', 'sap'],
    'marketing-tech': ['marketing', 'mídia', 'anúncio', 'seo', 'social media', 'influencer', 'conteúdo', 'crm', 'sales', 'vendas', 'público', 'audiência'],
    'startups': ['startup', 'scale-up', 'venture capital', 'investimento', 'série a', 'série b', 'aceleradora', 'inovação', 'disruptivo', 'unicórnio'],
  };

  let bestCategory = feedCategory || 'tech-geral';
  let maxScore = 0;

  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      const matches = text.match(new RegExp(`\\b${paraRegex(kw)}\\b`, 'g'));
      if (matches) score += matches.length;
    }
    if (score > maxScore) { maxScore = score; bestCategory = cat; }
  }

  return bestCategory;
}

function calculateScore(item: { title: string; excerpt: string; category: string; publishedAt: string }): number {
  const text = `${item.title} ${item.excerpt}`.toLowerCase();
  let score = 0;
  for (const kw of IA_KEYWORDS) {
    const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    if (matches) score += matches.length * 10;
  }
  score += CATEGORY_WEIGHTS[item.category] || 1;
  const age = Date.now() - new Date(item.publishedAt).getTime();
  const hoursAge = age / 3600000;
  if (hoursAge < 6) score += 20;
  else if (hoursAge < 12) score += 10;
  else if (hoursAge < 24) score += 5;
  return score;
}

/**
 * @param exigeIA Descarta itens sem nenhuma palavra-chave de IA. Passe false
 *   apenas para newsrooms cujo material e' todo do tema (OpenAI, DeepMind...),
 *   onde o resumo do RSS as vezes nem repete o termo.
 */
export async function fetchAndParseFeed(
  url: string,
  sourceName: string,
  feedCategory: string,
  exigeIA = true,
): Promise<ParsedArticle[]> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'i-a-trend/1.0 (RSS Aggregator; +https://i-a-trend.com)',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml',
      },
    });
    if (!resp.ok) {
      console.error(`[rss] ${sourceName}: HTTP ${resp.status}`);
      return [];
    }

    const xml = await resp.text();
    const items = extractAllTags(xml, 'item');
    if (items.length === 0) {
      console.error(`[rss] ${sourceName}: Nenhum item encontrado`);
      return [];
    }

    const articles: ParsedArticle[] = [];

    for (const itemXml of items) {
      // decodeEntities ANTES do slugify: sem isso, um titulo com &#8216;...&#8217;
      // gerava slugs como "e8216carro-voadore8217-da-embraer".
      const title = decodeEntities(stripHtml(extractTag(itemXml, 'title')));
      const link = extractTag(itemXml, 'link');
      if (!title || !link) continue;

      const slug = slugify(title, { lower: true, strict: true, locale: 'pt' }).slice(0, 140);
      const description = decodeEntities(stripHtml(extractTag(itemXml, 'description') || extractTag(itemXml, 'content:encoded') || ''));
      const excerpt = cleanExcerpt(description).slice(0, 300);
      const content = cleanExcerpt(description).slice(0, 3000);

      const category = classifyCategory(title, description, feedCategory);
      const imageUrl = extractImageFromItem(itemXml);

      const pubDateStr = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'dc:date');
      const publishedAt = pubDateStr ? new Date(pubDateStr).toISOString() : new Date().toISOString();

      const categories = extractAllTags(itemXml, 'category').map(c => c.toLowerCase().trim()).filter(Boolean);

      const aiRelevant = temPalavraChaveIA(`${title} ${description}`);
      // O filtro so' valia para feeds 'tech-geral'. Agencia Brasil entra como
      // 'negocios-tech', entao o feed de economia geral passava inteiro: dai
      // sairam "Perdas com bets atingem R$ 62,5 bilhoes" e "Taxa Basica de Juros
      // e Reavaliada", que nao sao noticia de IA. Sem material do tema, o redator
      // inventa um angulo de IA por cima do fato — especulacao, nao analise.
      if (exigeIA && !aiRelevant) continue;

      const article: ParsedArticle = {
        title, slug, excerpt,
        sourceUrl: link, sourceName, category,
        publishedAt, imageUrl,
        tags: categories,
        score: 0, content,
      };

      article.score = calculateScore(article);
      articles.push(article);
    }

    console.error(`[rss] ${sourceName}: ${articles.length} artigos`);
    return articles;
  } catch (error: any) {
    console.error(`[rss] Erro ${sourceName}:`, error.message);
    return [];
  }
}
