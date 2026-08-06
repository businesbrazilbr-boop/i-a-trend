import { getAllArticles, getDB } from '@/utils/d1';

const SITE = 'https://i-a-trend.com';

const CATEGORIES = [
  'ia-automacao',
  'negocios-tech',
  'startups',
  'marketing-tech',
  'tech-geral',
];

const STATIC_PAGES = ['/sobre', '/contato', '/privacidade'];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(loc: string, priority: string, changefreq: string, lastmod?: string, image?: string) {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <priority>${priority}</priority>
    <changefreq>${changefreq}</changefreq>
${lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>\n` : ''}${image ? `    <image:image><image:loc>${escapeXml(image)}</image:loc></image:image>\n` : ''}  </url>`;
}

export async function GET(context: any) {
  const db = getDB(context);
  const articles = db ? await getAllArticles(db) : [];

  const entries: string[] = [
    urlEntry(`${SITE}/`, '1.0', 'daily'),
    ...CATEGORIES.map(c => urlEntry(`${SITE}/categoria/${c}`, '0.8', 'daily')),
    ...STATIC_PAGES.map(p => urlEntry(`${SITE}${p}`, '0.5', 'monthly')),
    ...articles.map(a =>
      urlEntry(
        `${SITE}/noticia/${a.data.slug}`,
        '0.9',
        'weekly',
        a.data.publishedAt ? new Date(a.data.publishedAt).toISOString() : undefined,
        a.data.imageUrl || undefined
      )
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
}
