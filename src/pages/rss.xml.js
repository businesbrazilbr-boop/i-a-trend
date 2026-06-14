import { getCollection } from 'astro:content';
import { generateSlug } from '@/utils/slug';

export async function GET(context) {
  const site = 'https://i-a-trend.com';
  const allNews = await getCollection('news');
  const sorted = allNews.sort((a, b) =>
    new Date(b.data.publishedAt).getTime() - new Date(a.data.publishedAt).getTime()
  );

  const items = sorted.slice(0, 50).map(a => `
    <item>
      <title><![CDATA[${a.data.title}]]></title>
      <link>${site}/noticia/${a.data.slug}</link>
      <guid isPermaLink="true">${site}/noticia/${a.data.slug}</guid>
      <description><![CDATA[${a.data.excerpt}]]></description>
      <pubDate>${new Date(a.data.publishedAt).toUTCString()}</pubDate>
      <source url="${a.data.sourceUrl}">${a.data.sourceName}</source>
      <category>${a.data.category}</category>
    </item>
  `).join('');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>i-a-trend - Automação com IA para Negócios</title>
    <link>${site}</link>
    <description>As 10 notícias mais relevantes todo dia sobre IA, automação e tecnologia para o mercado brasileiro.</description>
    <language>pt-br</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${site}/rss.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}