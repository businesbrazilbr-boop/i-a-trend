export interface ArticleRecord {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  content_full: string | null;
  source_url: string;
  source_name: string;
  category: string;
  published_at: string;
  image_url: string | null;
  tags: string;
  created_at: string;
}

export async function getTodayCount(d1: D1Database): Promise<number> {
  const tz = 'America/Sao_Paulo';
  const result = await d1.prepare(`
    SELECT COUNT(*) as count FROM articles
    WHERE DATE(published_at AT TIME ZONE 'UTC' AT TIME ZONE ?) = DATE('now', ?)
  `).bind(tz, `-3 hours`).first<{ count: number }>();
  return result?.count || 0;
}

export async function getExistingUrls(d1: D1Database): Promise<Set<string>> {
  const result = await d1.prepare('SELECT source_url FROM articles').all<{ source_url: string }>();
  return new Set(result.results?.map(r => r.source_url) || []);
}

export async function findDuplicatesByTitle(d1: D1Database, title: string): Promise<boolean> {
  const result = await d1.prepare(
    'SELECT id FROM articles WHERE title = ? LIMIT 1'
  ).bind(title).first();
  return !!result;
}

export async function insertArticle(d1: D1Database, article: {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  contentFull?: string;
  /** Fonte principal. Continua unica na tabela e e' o que evita reprocessar o mesmo item. */
  sourceUrl: string;
  sourceName: string;
  /** Todas as fontes usadas na sintese, renderizadas no bloco "Fontes" do artigo. */
  sources?: Array<{ name: string; url: string }>;
  category: string;
  publishedAt: string;
  /** Key do objeto no R2. Substitui image_url: nao servimos mais imagem de terceiro. */
  imageKey?: string | null;
  tags: string[];
}): Promise<void> {
  await d1.prepare(`
    INSERT OR IGNORE INTO articles (id, title, slug, excerpt, content, content_full, source_url, source_name, sources, category, published_at, image_url, image_key, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, datetime('now'))
  `).bind(
    article.id,
    article.title,
    article.slug,
    article.excerpt,
    article.content,
    article.contentFull || null,
    article.sourceUrl,
    article.sourceName,
    JSON.stringify(article.sources || []),
    article.category,
    article.publishedAt,
    article.imageKey || null,
    JSON.stringify(article.tags),
  ).run();
}

export async function getArticlesForMarkdown(d1: D1Database, since: string): Promise<ArticleRecord[]> {
  const result = await d1.prepare(`
    SELECT * FROM articles
    WHERE created_at > ?
    ORDER BY published_at DESC
  `).bind(since).all<ArticleRecord>();
  return result.results || [];
}

export async function initDatabase(d1: D1Database): Promise<void> {
  // d1.exec() separa os comandos por QUEBRA DE LINHA, entao um CREATE TABLE
  // escrito em varias linhas chegava picado e todo ciclo comecava com
  // "D1_EXEC_ERROR: Error in line 1: CREATE TABLE IF NOT EXISTS articles (:
  // incomplete input". O erro era capturado e ignorado, mas sujava o log de
  // producao e escondia falhas de verdade. Cada comando agora vai numa linha so'.
  const comandos = [
    "CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL, excerpt TEXT, content TEXT, content_full TEXT, source_url TEXT NOT NULL UNIQUE, source_name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'tech-geral', published_at TEXT NOT NULL, image_url TEXT, image_key TEXT, sources TEXT DEFAULT '[]', tags TEXT DEFAULT '[]', created_at TEXT NOT NULL)",
    'CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category)',
    'CREATE INDEX IF NOT EXISTS idx_articles_source_url ON articles(source_url)',
    'CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at)',
  ];
  for (const sql of comandos) {
    await d1.prepare(sql).run();
  }

  // Migracao para bancos criados antes destas colunas. ALTER TABLE falha se a
  // coluna ja' existe, e nao ha' "IF NOT EXISTS" para colunas no SQLite.
  for (const sql of [
    'ALTER TABLE articles ADD COLUMN image_key TEXT',
    "ALTER TABLE articles ADD COLUMN sources TEXT DEFAULT '[]'",
  ]) {
    try {
      await d1.exec(sql);
    } catch {
      // Coluna ja' existe.
    }
  }
}