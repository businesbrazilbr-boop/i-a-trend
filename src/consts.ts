/**
 * Categorias do menu, na ordem em que aparecem.
 *
 * O Header só renderiza as que tiverem artigo — ver getCategoriesWithArticles.
 * Estava tudo escrito à mão no Header e repetido no sitemap, que era como as
 * quatro categorias vazias acabavam linkadas em toda página do site.
 */
export const CATEGORY_NAV = [
  { slug: 'ia-automacao', label: 'IA & Automação' },
  { slug: 'negocios-tech', label: 'Negócios' },
  { slug: 'startups', label: 'Startups' },
  { slug: 'marketing-tech', label: 'Marketing' },
  { slug: 'tech-geral', label: 'Tech Geral' },
];

/**
 * Blocos de anúncio do AdSense.
 *
 * Os três apontam para o mesmo slot porque hoje só existe uma unidade criada no
 * painel. Crie uma unidade por posição em https://adsense.google.com
 * (Anúncios → Por unidade de anúncio) e troque os IDs abaixo: os relatórios
 * passam a mostrar o desempenho de cada posição em separado.
 *
 * AD_SLOT_ARTIGO deve ser criado como "In-article" / "No artigo".
 */
export const AD_SLOT_TOPO = '3209503292';
export const AD_SLOT_ARTIGO = '3209503292';
export const AD_SLOT_RODAPE = '3209503292';

/**
 * A partir de quantos caracteres um artigo comporta o bloco intercalado.
 *
 * Abaixo disso ficam três anúncios num texto curto, que é exatamente o padrão
 * "anúncios excedem o conteúdo" que a revisão do AdSense reprova. ~3.000
 * caracteres são cerca de 500 palavras.
 */
export const MIN_CHARS_PARA_AD_INTERCALADO = 3000;

/** Depois de qual parágrafo o bloco intercalado entra. */
export const AD_APOS_PARAGRAFO = 3;

/** Mínimo de parágrafos para intercalar sem cortar o texto ao meio. */
export const MIN_PARAGRAFOS_PARA_AD = 6;
