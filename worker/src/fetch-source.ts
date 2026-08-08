/**
 * Busca o texto da materia de origem para servir de MATERIAL DE APOIO ao redator.
 *
 * Por que isto existe, se o ai-writer nasceu justamente sem buscar corpo nenhum:
 * o redator so' recebia manchete + resumo do RSS, e um resumo de duas linhas nao
 * sustenta 700 palavras. O modelo preenchia o vazio com especulacao ("pode
 * ajudar", "tem o potencial de") — artigos bem formados e sem informacao.
 *
 * O perigo de voltar a buscar o corpo e' o spinning: reescrever o texto alheio
 * palavra por palavra. Contra isso NAO basta instruir o modelo. A defesa real
 * esta' em hasVerbatimOverlap (text.ts), aplicada na saida: se qualquer sequencia
 * longa de palavras do original reaparecer no artigo, o tema e' descartado.
 */

import { decodeEntities } from './text';

/** Acima disto o prompt fica caro sem ganhar informacao: a materia ja' se repetiu. */
const MAX_CHARS = 6000;

/** Paragrafo menor que isto costuma ser legenda, credito ou botao. */
const MIN_PARAGRAPH_CHARS = 80;

/** O fetch nao pode segurar o ciclo inteiro se um veiculo estiver lento. */
const TIMEOUT_MS = 8000;

/** Blocos que nunca contem a materia. Removidos antes de procurar paragrafos. */
const RUIDO = /<(script|style|nav|header|footer|aside|form|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

function limpar(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devolve o texto corrido da materia, ou '' se nao der para obter.
 *
 * Nunca lanca: uma fonte inacessivel nao pode derrubar o ciclo. O chamador
 * trata '' como "sem material de apoio" e segue com o resumo do RSS.
 */
export async function fetchSourceText(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return '';

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'i-a-trend/1.0 (+https://i-a-trend.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(`[fonte] ${url}: HTTP ${resp.status}`);
      return '';
    }

    const tipo = resp.headers.get('content-type') || '';
    if (!tipo.includes('html')) return '';

    const html = (await resp.text()).replace(RUIDO, ' ');

    // <p> e' o que quase todo CMS usa para o corpo. Pegar so' isso descarta menu,
    // rodape e afins sem precisar de um parser de DOM dentro do Worker.
    const paragrafos: string[] = [];
    const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const texto = limpar(m[1]);
      if (texto.length >= MIN_PARAGRAPH_CHARS) paragrafos.push(texto);
    }

    // Sem <p> util (single-page apps, conteudo em <div>), cai no corpo inteiro.
    const corpo = paragrafos.length >= 2
      ? paragrafos.join('\n\n')
      : limpar(html.replace(/[\s\S]*?<body\b[^>]*>/i, ''));

    return corpo.slice(0, MAX_CHARS);
  } catch (e: any) {
    console.warn(`[fonte] ${url}: ${e?.message || e}`);
    return '';
  }
}
