export interface ScrapedContent {
  title: string;
  textContent: string;
  imageUrl: string | null;
}

function extractTagContent(html: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'gi');
  let match;
  while ((match = regex.exec(html)) !== null) {
    const text = match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code, 10)))
      .replace(/\s+/g, ' ')
      .trim();
    if (text && text.length > 30) {
      results.push(text);
    }
  }
  return results;
}

function extractMetaContent(html: string, property: string): string | null {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const match = regex.exec(html);
  if (match) return match[1];

  const regex2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  );
  const match2 = regex2.exec(html);
  return match2 ? match2[1] : null;
}

function stripNoise(html: string): string {
  const removeTags = ['script', 'style', 'nav', 'footer', 'aside', 'noscript', 'svg', 'form'];
  let cleaned = html;
  for (const tag of removeTags) {
    cleaned = cleaned.replace(
      new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\/${tag}>`, 'gi'),
      ' ',
    );
  }
  return cleaned;
}

export async function scrapeArticle(url: string): Promise<ScrapedContent> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[scraper] HTTP ${response.status} for ${url}`);
      return { title: '', textContent: '', imageUrl: null };
    }

    const html = await response.text();
    const cleaned = stripNoise(html);

    const title =
      extractMetaContent(html, 'og:title') ||
      extractMetaContent(html, 'twitter:title') ||
      extractTagContent(html, 'title')[0] ||
      '';

    const imageUrl = extractMetaContent(html, 'og:image') || extractMetaContent(html, 'twitter:image');

    const paragraphs = extractTagContent(cleaned, 'p');
    const headings = extractTagContent(cleaned, 'h1');
    const subheadings = extractTagContent(cleaned, 'h2');
    const subheadings3 = extractTagContent(cleaned, 'h3');
    const listItems = extractTagContent(cleaned, 'li');
    const blockquotes = extractTagContent(cleaned, 'blockquote');

    const parts: string[] = [];
    if (headings.length > 0) parts.push(`## ${headings[0]}`);

    const allParagraphs = [...paragraphs];
    const used = new Set<number>();

    for (const h of [...subheadings, ...subheadings3]) {
      parts.push(`\n### ${h}`);
    }

    for (const p of allParagraphs) {
      parts.push(p);
    }

    for (const bq of blockquotes) {
      parts.push(`> ${bq}`);
    }

    if (listItems.length > 0) {
      parts.push('\n' + listItems.slice(0, 10).map(li => `- ${li}`).join('\n'));
    }

    let textContent = parts.join('\n\n').slice(0, 8000);

    textContent = textContent
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[\s\n]+|[\s\n]+$/g, '');

    if (textContent.length < 100) {
      console.error(`[scraper] Too little content (${textContent.length} chars) for ${url}`);
      return { title, textContent: '', imageUrl };
    }

    console.log(`[scraper] Extracted ${textContent.length} chars from ${url}`);
    return { title, textContent, imageUrl };
  } catch (error) {
    console.error(`[scraper] Error scraping ${url}:`, error);
    return { title: '', textContent: '', imageUrl: null };
  }
}