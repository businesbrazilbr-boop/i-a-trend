/** Utilitarios de texto compartilhados. */

/**
 * Decodifica entidades HTML. Vinha embutido no content-scraper.ts, que foi removido.
 *
 * Sem isto, titulos de RSS com &#8216; ... &#8217; viravam slugs como
 * "e8216carro-voadore8217-da-embraer". Precisa rodar ANTES de gerar o slug.
 */
export function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    // &amp; por ultimo: senao "&amp;#39;" viraria aspas em vez de "&#39;".
    .replace(/&amp;/g, '&');
}

export function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Marcas diacriticas combinantes, removidas apos normalize('NFD'). */
const COMBINING_MARKS = /[̀-ͯ]/g;

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem', 'sobre', 'entre',
  'e', 'ou', 'que', 'se', 'ao', 'aos', 'pelo', 'pela', 'pelos', 'pelas',
  'mais', 'menos', 'ja', 'nao', 'sim', 'como', 'apos', 'ate', 'ser', 'sao', 'foi',
  'the', 'of', 'to', 'in', 'for', 'and', 'on', 'with',
]);

/** Reduz um titulo ao conjunto de palavras significativas, sem acentos nem pontuacao. */
export function significantWords(title: string): Set<string> {
  const words = decodeEntities(title)
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

/** Jaccard entre os conjuntos de palavras significativas. 0 = nada em comum, 1 = iguais. */
export function titleSimilarity(a: string, b: string): number {
  const sa = significantWords(a);
  const sb = significantWords(b);
  if (sa.size === 0 || sb.size === 0) return 0;

  let intersection = 0;
  for (const w of sa) if (sb.has(w)) intersection++;

  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
