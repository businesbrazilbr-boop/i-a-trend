import Parser from 'rss-parser';
import slugify from 'slugify';
import { IA_KEYWORDS, CATEGORY_WEIGHTS } from './constants';

interface FeedItem {
  title: string;
  link: string;
  content: string;
  contentSnippet: string;
  isoDate: string | null;
  categories: string[];
  imageUrl: string | null;
}

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
}

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'i-a-trend/1.0 (RSS Aggregator; +https://i-a-trend.com)',
    'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml',
  },
  customFields: {
    item: [
      ['media:content', 'media'],
      ['media:thumbnail', 'thumbnail'],
      ['enclosure', 'enclosure'],
    ],
  },
});

function extractImage(item: any): string | null {
  if (item.media?.$) return item.media.$.url;
  if (item.thumbnail?.$) return item.thumbnail.$.url;
  if (item.enclosure?.$.type?.startsWith('image')) return item.enclosure.$.url;
  if (item['media:content']?.$.url) return item['media:content'].$.url;
  return null;
}

function classifyCategory(title: string, content: string, feedCategory: string): string {
  const text = `${title} ${content}`.toLowerCase();

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
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = text.match(regex);
      if (matches) score += matches.length;
    }
    if (score > maxScore) {
      maxScore = score;
      bestCategory = cat;
    }
  }

  return bestCategory;
}

function calculateScore(item: ParsedArticle): number {
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

export async function fetchAndParseFeed(url: string, sourceName: string, feedCategory: string): Promise<ParsedArticle[]> {
  try {
    const feed = await parser.parseURL(url);
    const articles: ParsedArticle[] = [];

    for (const item of feed.items || []) {
      if (!item.title || !item.link) continue;

      const title = item.title.trim();
      const slug = slugify(title, { lower: true, strict: true, locale: 'pt' });
      const contentSnippet = (item.contentSnippet || '')
        .replace(/\s+/g, ' ')
        .trim();
      const excerpt = contentSnippet.slice(0, 250);
      const content = item.content || contentSnippet;

      const category = classifyCategory(title, contentSnippet, feedCategory);
      const imageUrl = extractImage(item);

      const isoDate = item.isoDate
        ? new Date(item.isoDate).toISOString()
        : new Date().toISOString();

      const itemTags = (item.categories || [])
        .map(c => c.toLowerCase().trim())
        .filter(Boolean);

      const aiRelevant = IA_KEYWORDS.some(kw =>
        title.toLowerCase().includes(kw) || contentSnippet.toLowerCase().includes(kw)
      );

      if (!aiRelevant && feedCategory === 'tech-geral') continue;

      const article: ParsedArticle = {
        title,
        slug: slug.slice(0, 140),
        excerpt,
        sourceUrl: item.link,
        sourceName,
        category,
        publishedAt: isoDate,
        imageUrl,
        tags: itemTags,
        score: 0,
        content: content.slice(0, 2000),
      };

      article.score = calculateScore(article);
      articles.push(article);
    }

    return articles;
  } catch (error) {
    console.error(`Erro ao buscar feed ${sourceName}:`, error);
    return [];
  }
}