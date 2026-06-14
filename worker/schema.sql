CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,
  source_url TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'tech-geral',
  published_at TEXT NOT NULL,
  image_url TEXT,
  tags TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_source_url ON articles(source_url);
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at);