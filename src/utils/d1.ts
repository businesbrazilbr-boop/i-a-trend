export interface ArticleData {
  title: string;
  slug: string;
  excerpt: string;
  sourceUrl: string;
  sourceName: string;
  category: string;
  publishedAt: string;
  imageUrl: string | null;
  tags: string[];
  contentFull: string | null;
  body: string;
}

export interface ArticleEntry {
  id: string;
  data: ArticleData;
  body: string;
}

function rowToArticle(row: any): ArticleEntry {
  const tags: string[] = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [];
  return {
    id: row.id,
    body: row.content_full || row.content || '',
    data: {
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt || '',
      sourceUrl: row.source_url,
      sourceName: row.source_name,
      category: row.category,
      publishedAt: row.published_at,
      imageUrl: row.image_url || null,
      tags: tags.slice(0, 5),
      contentFull: row.content_full || null,
      body: row.content_full || row.content || '',
    },
  };
}

async function safeAll(db: D1Database, sql: string, ...bind: unknown[]) {
  try {
    return await db.prepare(sql).bind(...bind).all();
  } catch { return { results: [] as Record<string, unknown>[], success: false }; }
}

async function safeFirst(db: D1Database, sql: string, ...bind: unknown[]) {
  try {
    return await db.prepare(sql).bind(...bind).first();
  } catch { return null; }
}

export async function getAllArticles(db: D1Database): Promise<ArticleEntry[]> {
  const { results } = await safeAll(db, 'SELECT * FROM articles ORDER BY published_at DESC LIMIT 100');
  return (results || []).map(rowToArticle);
}

export async function getArticleBySlug(db: D1Database, slug: string): Promise<ArticleEntry | null> {
  const row = await safeFirst(db, 'SELECT * FROM articles WHERE slug = ? LIMIT 1', slug);
  if (!row) return null;
  return rowToArticle(row);
}

export async function getArticlesByCategory(db: D1Database, category: string): Promise<ArticleEntry[]> {
  const { results } = await safeAll(db, 'SELECT * FROM articles WHERE category = ? ORDER BY published_at DESC LIMIT 50', category);
  return (results || []).map(rowToArticle);
}

export async function getRelatedArticles(db: D1Database, category: string, slug: string, limit = 3): Promise<ArticleEntry[]> {
  const { results } = await safeAll(db, 'SELECT * FROM articles WHERE category = ? AND slug != ? ORDER BY published_at DESC LIMIT ?', category, slug, limit);
  return (results || []).map(rowToArticle);
}

export function getDB(context: any): D1Database | null {
  try {
    const runtime = context.locals?.runtime;
    if (runtime?.env?.IAS_DB) return runtime.env.IAS_DB;
    if (context.env?.IAS_DB) return context.env.IAS_DB;
    return null;
  } catch {
    return null;
  }
}