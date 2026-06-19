import slugify from 'slugify';
import { IA_KEYWORDS, CATEGORY_WEIGHTS } from './constants';

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
  while ((m = re.exec(text)) !== null) results.push(m[1].trim());
  return results;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function extractImageFromItem(itemXml: string): string | null {
  const mediaMatch = /<media:content\s[^>]*url="([^"]+)"/i.exec(itemXml);
  if (mediaMatch) return mediaMatch[1];
  const enclosureMatch = /<enclosure\s[^>]*url="([^"]+)"[^>]*type="image/i.exec(itemXml);
  if (enclosureMatch) return enclosureMatch[1];
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

export async function fetchAndParseFeed(url: string, sourceName: string, feedCategory: string): Promise<ParsedArticle[]> {
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
      const title = stripHtml(extractTag(itemXml, 'title'));
      const link = extractTag(itemXml, 'link');
      if (!title || !link) continue;

      const slug = slugify(title, { lower: true, strict: true, locale: 'pt' }).slice(0, 140);
      const description = stripHtml(extractTag(itemXml, 'description') || extractTag(itemXml, 'content:encoded') || '');
      const excerpt = description.replace(/\s+/g, ' ').trim().slice(0, 250);
      const content = description.slice(0, 2000);

      const category = classifyCategory(title, description, feedCategory);
      const imageUrl = extractImageFromItem(itemXml);

      const pubDateStr = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'dc:date');
      const publishedAt = pubDateStr ? new Date(pubDateStr).toISOString() : new Date().toISOString();

      const categories = extractAllTags(itemXml, 'category').map(c => c.toLowerCase().trim()).filter(Boolean);

      const aiRelevant = IA_KEYWORDS.some(kw =>
        title.toLowerCase().includes(kw) || description.toLowerCase().includes(kw)
      );
      if (!aiRelevant && feedCategory === 'tech-geral') continue;

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
