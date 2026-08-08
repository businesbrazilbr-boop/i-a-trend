/**
 * Redator de sintese.
 *
 * Substitui o antigo ai-rewriter.ts, que reescrevia um artigo alheio palavra por
 * palavra ("spinning"). Isso e' conteudo derivado e viola a politica de spam do
 * Google (scaled content abuse).
 *
 * Aqui o modelo recebe apenas titulo + resumo publico (o que o proprio veiculo
 * sindica no RSS) de VARIAS fontes sobre o mesmo tema, e escreve uma analise
 * propria. Nunca recebe o corpo de nenhum artigo, porque nunca o buscamos.
 */

import { significantWords, setSimilarity } from './text';

export const WRITER_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * ~270 palavras. Abaixo disso o texto nao sustenta analise propria.
 *
 * Era 2200 (~370 palavras) e o prompt pedia 500 a 800 palavras avisando que
 * "textos curtos serao rejeitados". Havia piso e nenhum teto, entao o modelo
 * batia a meta enchendo linguica: duas conclusoes e a mesma frase repetida.
 * Piso mais baixo + teto + checagem de repeticao tiram o incentivo a esticar.
 */
const MIN_BODY_CHARS = 1600;

/** ~620 palavras. Daqui para cima esta' pipeline nao acrescenta fato, acrescenta repeticao. */
const MAX_BODY_CHARS = 3800;

/** Uma manchete real tem sujeito e verbo; menos que isto costuma ser rotulo generico. */
const MIN_TITLE_WORDS = 5;

/**
 * Jaccard entre dois paragrafos. Acima disto, dizem a mesma coisa com outras palavras.
 *
 * Calibrado nos dois artigos publicados em 06/08: no que veio esticado, os pares
 * repetidos deram 0.47, 0.42 e 0.41; no que nao repetia (so' especulava), o par
 * mais parecido deu 0.17. Comecou em 0.6, que nunca disparava.
 */
const PARAGRAPH_REPEAT_THRESHOLD = 0.42;

/** Conectores que so' cabem num paragrafo de fecho. Dois fechos = texto esticado. */
const FECHO = /^\s*(em resumo|em conclus[ãa]o|em suma|resumindo|concluindo|por fim|em s[ií]ntese)\b/i;

/**
 * Verbos de especulacao. "pode ajudar", "pode contribuir", "pode levar a
 * melhorias" nao informam nada; um texto feito so' disso e' conversa fiada com
 * cara de analise.
 */
const ESPECULACAO = /\b(pode|podem|poderia|poderiam)\b/gi;

export interface SourceRef {
  name: string;
  url: string;
}

export interface TopicInput {
  /** Titulos + resumos publicos das fontes que falam do mesmo assunto. */
  items: Array<{ title: string; excerpt: string; source: SourceRef }>;
  category: string;
}

export interface WrittenArticle {
  title: string;
  excerpt: string;
  body: string;
  tags: string[];
  sources: SourceRef[];
  /**
   * Descricao visual concreta do assunto, em ingles, para gerar a capa.
   * Vazia quando o modelo omite o campo — image.ts cai de volta nas tags.
   */
  imagePrompt: string;
}

const SYSTEM_PROMPT = `Você é editor do i-a-trend, um site brasileiro sobre inteligência artificial aplicada a negócios.

Você recebe manchetes e resumos públicos de vários veículos sobre um mesmo assunto. Sua tarefa é escrever uma ANÁLISE PRÓPRIA — não um resumo, não uma reescrita.

REGRAS ABSOLUTAS:
- NUNCA parafraseie um único veículo. Se só há uma fonte, escreva sobre o CONTEXTO do fato, não sobre o texto dela.
- NUNCA invente números, datas, valores, nomes ou declarações. Use apenas o que está nos resumos. Se um dado não está lá, não o mencione.
- NUNCA copie frases dos resumos. Formule tudo com suas próprias palavras.
- O valor do texto está no ÂNGULO: o que isso muda para uma empresa brasileira em custo, processo, prazo ou risco. Essa análise é sua, não das fontes.

ORTOGRAFIA (obrigatório):
- Escreva em português brasileiro correto, COM TODOS OS ACENTOS E CEDILHAS.
- "automação" e não "automacao"; "inteligência" e não "inteligencia"; "análise", "negócios", "início", "serviço".
- Texto sem acentuação será rejeitado.

TÍTULO (o mais importante):
- Deve dizer O QUE ACONTECEU, com sujeito e verbo. Específico e concreto.
- BOM: "Embraer conclui primeiro voo horizontal do eVTOL"
- RUIM: "IA na Automação", "Nova Fronteira na Automação", "IA avança" — genéricos demais, serão rejeitados.
- Máximo 90 caracteres. Não copie nenhuma das manchetes recebidas.

CONCRETO (obrigatório):
- Todo dado que aparecer nos resumos — número, valor, prazo, nome de produto ou de
  empresa — deve entrar no texto. É o que separa análise de conversa fiada.
- Se os resumos não trazem dado nenhum, escreva sobre o mecanismo concreto: o que muda
  no processo, em que etapa, com que custo ou que risco. Nunca sobre "o potencial da IA".

FORMATO:
- Tom profissional e direto.
- Entre 350 e 550 palavras. Um texto curto e denso vale mais que um longo e repetitivo.
- Parágrafos curtos, de 2 a 4 frases.
- Comece pelo que mudou, não por "nos últimos anos...".
- Sem markdown, sem títulos internos. Separe parágrafos com uma linha em branco.
- Não escreva "segundo o site X" em todo parágrafo; a atribuição aparece numa seção de fontes.

ENCHER LINGUIÇA É MOTIVO DE REJEIÇÃO:
- UM único parágrafo de fecho. Nunca "Em resumo" no meio e "Em conclusão" no fim.
- Nunca repita uma ideia já dita com outras palavras. Parágrafo que não acrescenta fato
  ou consequência nova deve ser cortado, não reescrito.
- No máximo um "pode/poderia" por parágrafo, e sempre ancorado em algo concreto.
- Se os resumos não dão material para 350 palavras de análise real, responda
  exatamente {"skip": true}. Recusar o tema é melhor que inventar volume.

Responda SOMENTE com JSON válido, sem cercas de código, neste formato:
{"title": "...", "excerpt": "...", "body": "...", "tags": ["...", "..."], "imagePrompt": "..."}

excerpt: uma frase de até 200 caracteres.
body: o texto completo, com \\n\\n entre parágrafos.
tags: 3 a 5 palavras-chave em minúsculas.
imagePrompt: frase curta EM INGLÊS descrevendo objetos e cenário concretos do assunto tratado,
para gerar a ilustração de capa. Regras:
  - Seja específico do tema. BOM: "hospital data dashboard, medical records, chat bubbles".
    RUIM: "artificial intelligence, technology" — genérico demais.
  - Descreva apenas objetos, ambientes e conceitos. NUNCA texto, letras, logotipos, marcas
    registradas ou rostos de pessoas.
  - NUNCA descreva a cena como fotografia de um acontecimento real. É uma ilustração conceitual.`;

function buildUserPrompt(topic: TopicInput): string {
  const fontes = topic.items
    .map((it, i) => `[${i + 1}] ${it.source.name}\nManchete: ${it.title}\nResumo: ${it.excerpt || '(sem resumo)'}`)
    .join('\n\n');

  return `Categoria: ${topic.category}

Fontes sobre o mesmo assunto:

${fontes}

Escreva a analise do i-a-trend sobre este assunto, seguindo as regras.`;
}

/**
 * Normaliza a saida do Workers AI, que varia conforme o modelo e a versao:
 *  - { response: "<texto>" }              formato antigo
 *  - { response: { ... } }                ja' desserializado quando a saida e' JSON
 *  - { choices: [{ message: { content }}]} formato compativel com OpenAI
 *
 * Tratar tudo como string quebrava com "raw.trim is not a function" e o artigo
 * era descartado silenciosamente.
 */
function extractPayload(result: any): any | null {
  if (!result) return null;

  if (result.response && typeof result.response === 'object') return result.response;
  if (typeof result.response === 'string') return parseJsonLoose(result.response);

  const content = result?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return parseJsonLoose(content);
  if (content && typeof content === 'object') return content;

  return null;
}

/** Extrai o primeiro objeto JSON da resposta, tolerando cercas de codigo e texto em volta. */
function parseJsonLoose(raw: string): any | null {
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    // Modelos as vezes deixam quebras de linha cruas dentro das strings.
    try {
      return JSON.parse(s.replace(/\n/g, '\\n'));
    } catch {
      return null;
    }
  }
}

export async function writeArticle(ai: any, topic: TopicInput): Promise<WrittenArticle | null> {
  if (topic.items.length === 0) return null;

  const sources = topic.items.map(it => it.source);

  try {
    console.log(`[writer] Sintetizando ${topic.items.length} fonte(s) em ${topic.category}...`);
    const result = await ai.run(WRITER_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(topic) },
      ],
      // Folga generosa de proposito: o corpo sozinho passa de 600 tokens e, se a
      // resposta for cortada no meio, o JSON fica invalido e o tema inteiro e'
      // descartado — falha silenciosa e cara.
      max_tokens: 3500,
      temperature: 0.6,
    });

    const parsed = extractPayload(result);
    if (!parsed) {
      console.error('[writer] Nao consegui extrair JSON da resposta, descartando tema.');
      return null;
    }

    // Saida de recusa prevista no prompt: melhor o modelo dizer que o tema nao
    // da' materia do que produzir 500 palavras de especulacao para preencher.
    if (parsed.skip === true) {
      console.warn('[writer] Modelo recusou o tema por falta de material.');
      return null;
    }

    const title = String(parsed.title || '').trim();
    const body = String(parsed.body || '').trim();

    // Abaixo do piso o texto vira nota curta sem analise, que e' exatamente o
    // "conteudo de baixo valor" que o AdSense recusa.
    if (body.length < MIN_BODY_CHARS) {
      console.error(`[writer] Corpo curto demais (${body.length} < ${MIN_BODY_CHARS}), descartando.`);
      return null;
    }

    if (body.length > MAX_BODY_CHARS) {
      console.error(`[writer] Corpo longo demais (${body.length} > ${MAX_BODY_CHARS}), descartando.`);
      return null;
    }

    // Paragrafos curtos demais sao separadores ou frases soltas, nao entram nas
    // checagens de estrutura.
    const paragrafos = body.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 40);

    // Dois fechos no mesmo texto ("Em resumo" no meio, "Em conclusao" no fim) e' a
    // assinatura do modelo esticando o texto para bater a contagem de palavras.
    const fechos = paragrafos.filter(p => FECHO.test(p)).length;
    if (fechos > 1) {
      console.error(`[writer] ${fechos} paragrafos de conclusao, descartando.`);
      return null;
    }

    // Paragrafos que repetem um ao outro. No artigo do gateway de IA a frase
    // "controle mais preciso sobre como seus recursos de IA sao utilizados"
    // apareceu em tres paragrafos diferentes.
    const conjuntos = paragrafos.map(significantWords);
    for (let i = 0; i < conjuntos.length; i++) {
      for (let j = i + 1; j < conjuntos.length; j++) {
        const sim = setSimilarity(conjuntos[i], conjuntos[j]);
        if (sim >= PARAGRAPH_REPEAT_THRESHOLD) {
          console.error(`[writer] Paragrafos ${i + 1} e ${j + 1} repetidos (${sim.toFixed(2)}), descartando.`);
          return null;
        }
      }
    }

    // Mais de um verbo especulativo por paragrafo, em media, e' texto feito de
    // "pode ajudar" e "pode contribuir" — nenhum fato, so' volume.
    const especulacoes = (body.match(ESPECULACAO) || []).length;
    if (paragrafos.length > 0 && especulacoes > paragrafos.length) {
      console.error(
        `[writer] Especulativo demais (${especulacoes} "pode" em ${paragrafos.length} paragrafos), descartando.`,
      );
      return null;
    }

    // Titulo generico ("IA na Automacao") nao informa nada e prejudica busca e
    // avaliacao editorial. Uma manchete real tem sujeito e verbo.
    const palavrasTitulo = title.split(/\s+/).filter(w => w.length > 1).length;
    if (palavrasTitulo < MIN_TITLE_WORDS) {
      console.error(`[writer] Titulo generico demais ("${title}"), descartando.`);
      return null;
    }

    // Se o modelo repetiu uma manchete recebida, e' sinal de que copiou em vez de analisar.
    const copiou = topic.items.some(
      it => it.title.trim().toLowerCase() === title.toLowerCase(),
    );
    if (copiou) {
      console.error('[writer] Titulo identico ao da fonte, descartando tema.');
      return null;
    }

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 5)
      : [];

    return {
      title: title.slice(0, 140),
      excerpt: String(parsed.excerpt || '').trim().slice(0, 300),
      body,
      tags,
      sources,
      imagePrompt: String(parsed.imagePrompt || '').trim().slice(0, 300),
    };
  } catch (error) {
    console.error('[writer] Erro ao gerar artigo:', error);
    return null;
  }
}
