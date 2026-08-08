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

/**
 * Remove acentos e cedilhas, preservando o resto do texto.
 *
 * Necessario para casar palavra inteira: \b do JavaScript trata caractere
 * acentuado como separador, entao /\bia\b/ casaria dentro de "notícia".
 * Normalizando antes, a fronteira de palavra volta a funcionar.
 */
export function stripAccents(input: string): string {
  return input.normalize('NFD').replace(COMBINING_MARKS, '');
}

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

/**
 * Jaccard entre dois conjuntos ja' calculados.
 *
 * O agrupamento e' O(n^2) em comparacoes, entao normalizar a string dentro do
 * laco (como fazia titleSimilarity) estourava a CPU do Worker. Calcule o
 * conjunto uma vez por item com significantWords e compare com esta funcao.
 */
export function setSimilarity(sa: Set<string>, sb: Set<string>): number {
  if (sa.size === 0 || sb.size === 0) return 0;

  // Itera sempre o menor conjunto.
  const [menor, maior] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  let intersection = 0;
  for (const w of menor) if (maior.has(w)) intersection++;

  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Conveniencia para comparacoes avulsas. Nao usar dentro de lacos. */
export function titleSimilarity(a: string, b: string): number {
  return setSimilarity(significantWords(a), significantWords(b));
}

/** Palavras normalizadas, para comparar sequencias sem tropecar em acento ou pontuacao. */
function tokens(input: string): string[] {
  return stripAccents(input.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Procura uma sequencia de `n` palavras do texto de origem copiada no artigo.
 * Devolve a sequencia encontrada, ou null se nao houver.
 *
 * Esta e' a defesa de verdade contra o spinning. Desde que o redator passou a
 * receber o corpo da materia de origem (fetch-source.ts), instrucao no prompt
 * deixou de bastar: o modelo pode reproduzir trechos sem que nenhuma checagem
 * de estrutura perceba. Oito palavras iguais em sequencia praticamente nao
 * acontecem por acaso entre dois textos escritos de forma independente, mas
 * acontecem o tempo todo quando um foi copiado do outro.
 */
export function verbatimOverlap(artigo: string, origem: string, n = 8): string | null {
  const a = tokens(artigo);
  const o = tokens(origem);
  if (a.length < n || o.length < n) return null;

  const sequenciasOrigem = new Set<string>();
  for (let i = 0; i + n <= o.length; i++) {
    sequenciasOrigem.add(o.slice(i, i + n).join(' '));
  }

  for (let i = 0; i + n <= a.length; i++) {
    const seq = a.slice(i, i + n).join(' ');
    if (sequenciasOrigem.has(seq)) return seq;
  }
  return null;
}
