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

import { significantWords, setSimilarity, stripAccents, verbatimOverlap } from './text';

export const WRITER_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * ~500 palavras. Bate com MIN_CHARS_PARA_AD_INTERCALADO do site (3000), ou seja,
 * todo artigo publicado comporta o bloco de anuncio no meio sem cair no padrao
 * "anuncios excedem o conteudo", que e' reprovado na revisao do AdSense.
 *
 * Comecou em 3800 (~630 palavras) e derrubou TREZE temas bons num unico ciclo:
 * este modelo entrega entre 1.900 e 3.100 caracteres de forma consistente, por
 * mais que o prompt peca 700 a 900 palavras. O piso agora e' alcancavel, e o que
 * fecha a diferenca e' a segunda passada de ampliacao (expandBody), nao a
 * insistencia no prompt.
 */
export const MIN_BODY_CHARS = 3000;

/** ~1150 palavras. Daqui para cima nao vem informacao, vem repeticao. */
export const MAX_BODY_CHARS = 7000;

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
 * Construcoes de especulacao. Texto feito so' disto e' conversa fiada com cara
 * de analise, e e' o que o AdSense recusa como conteudo de baixo valor.
 *
 * A lista anterior so' tinha pode/podem/poderia/poderiam, e deixou passar um
 * artigo que dizia "têm o potencial de impactar" e "têm o potencial de
 * revolucionar" — a mesma jogada por outra porta. Aplicada sobre o texto sem
 * acento, para que "poderá" e "poderão" tambem casem.
 */
const ESPECULACAO = /\b(pode|podem|poderia|poderiam|podera|poderao|potencial de|tende a|tendem a|possivelmente|provavelmente|eventualmente)\b/g;

/**
 * Palavras seguidas iguais as da fonte que ja' configuram copia.
 *
 * Oito e' curto o bastante para pegar frase reaproveitada e longo o bastante
 * para nao disparar em construcao comum ("de acordo com a empresa, o novo
 * modelo"). Ver verbatimOverlap em text.ts.
 */
const VERBATIM_WORDS = 8;

export interface SourceRef {
  name: string;
  url: string;
}

export interface TopicInput {
  /** Titulos + resumos publicos das fontes que falam do mesmo assunto. */
  items: Array<{
    title: string;
    excerpt: string;
    source: SourceRef;
    /**
     * Texto da materia de origem, so' como material de apoio para os fatos.
     * Nunca deve reaparecer no artigo: verbatimOverlap barra isso na saida.
     */
    reference?: string;
  }>;
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

Junto com as manchetes você recebe MATERIAL DE APOIO: o texto das matérias de origem.
Ele existe para você saber os FATOS — o que foi anunciado, por quem, com que números.
Não é rascunho, não é texto para reaproveitar.

REGRAS ABSOLUTAS:
- NUNCA copie frases do material de apoio. Reformule tudo. Qualquer sequência de oito
  palavras seguidas igual à do original faz o artigo ser rejeitado automaticamente.
- NUNCA reescreva a matéria na mesma ordem em que ela conta os fatos. Isso é spinning.
  Comece pelo que interessa a uma empresa brasileira, não pelo lide do veículo.
- NUNCA invente números, datas, valores, nomes ou declarações. Use apenas o que está no
  material. Se um dado não está lá, não o mencione.
- O valor do texto está no ÂNGULO: o que isso muda para uma empresa brasileira em custo,
  processo, prazo ou risco. Essa análise é sua, não das fontes.

ORTOGRAFIA (obrigatório):
- Escreva em português brasileiro correto, COM TODOS OS ACENTOS E CEDILHAS.
- "automação" e não "automacao"; "inteligência" e não "inteligencia"; "análise", "negócios", "início", "serviço".
- Texto sem acentuação será rejeitado.

TÍTULO (o mais importante):
- Deve dizer O QUE ACONTECEU, com sujeito e verbo. Específico e concreto.
- BOM: "Embraer conclui primeiro voo horizontal do eVTOL"
- RUIM: "IA na Automação", "Nova Fronteira na Automação", "IA avança" — genéricos demais, serão rejeitados.
- Máximo 90 caracteres. Não copie nenhuma das manchetes recebidas.

CONCRETO (é o que separa análise de conversa fiada):
- Extraia do material de apoio os fatos duros e ponha-os no texto: números, valores,
  prazos, versões, nomes de produto, de empresa e de quem falou.
- Um artigo sem nenhum dado concreto não serve. Se o material tem "dez avanços", diga
  quais. Se tem uma cifra, use a cifra.
- Proibido escrever sobre "o potencial da IA" em abstrato. Escreva sobre o que muda:
  em que etapa do processo, com que custo, em que prazo, com que risco.

FORMATO:
- Tom profissional e direto.
- Entre 700 e 900 palavras. Só se chega lá com fatos; não se chega repetindo.
- Parágrafos de 3 a 5 frases.
- Comece pelo que mudou, não por "nos últimos anos...".
- Sem markdown, sem títulos internos. Separe parágrafos com uma linha em branco.
- Não escreva "segundo o site X" em todo parágrafo; a atribuição aparece numa seção de fontes.
- Termine a última frase. Texto cortado no meio é rejeitado.

ENCHER LINGUIÇA É MOTIVO DE REJEIÇÃO:
- UM único parágrafo de fecho. Nunca "Em resumo" no meio e "Em conclusão" no fim.
- Nunca repita uma ideia já dita com outras palavras. Parágrafo que não acrescenta fato
  ou consequência nova deve ser cortado, não reescrito.
- No máximo uma especulação por parágrafo ("pode", "poderá", "tem o potencial de",
  "tende a"), e sempre ancorada num fato do material.
- Se o material de apoio não dá base para 700 palavras de análise com fatos, responda
  apenas com a linha ###PULAR###. Recusar o tema é melhor que inventar volume.

Responda EXATAMENTE neste formato, sem cercas de código e sem nenhum texto fora dele:

###TITULO###
o título
###RESUMO###
uma frase de até 200 caracteres
###TAGS###
3 a 5 palavras-chave em minúsculas, separadas por vírgula
###IMAGEM###
a descrição da ilustração, em inglês
###CORPO###
o texto completo, com uma linha em branco entre parágrafos

Escreva os marcadores ###...### exatamente assim, cada um sozinho na sua linha.

IMAGEM: frase curta EM INGLÊS descrevendo objetos e cenário concretos do assunto tratado,
para gerar a ilustração de capa. Regras:
  - Seja específico do tema. BOM: "hospital data dashboard, medical records, chat bubbles".
    RUIM: "artificial intelligence, technology" — genérico demais.
  - Descreva apenas objetos, ambientes e conceitos. NUNCA texto, letras, logotipos, marcas
    registradas ou rostos de pessoas.
  - NUNCA descreva a cena como fotografia de um acontecimento real. É uma ilustração conceitual.`;

function buildUserPrompt(topic: TopicInput): string {
  const fontes = topic.items
    .map((it, i) => {
      const bloco = [
        `[${i + 1}] ${it.source.name}`,
        `Manchete: ${it.title}`,
        `Resumo: ${it.excerpt || '(sem resumo)'}`,
      ];
      if (it.reference) bloco.push(`Material de apoio (NAO copiar):\n${it.reference}`);
      return bloco.join('\n');
    })
    .join('\n\n---\n\n');

  return `Categoria: ${topic.category}

Fontes sobre o mesmo assunto:

${fontes}

Escreva a analise do i-a-trend sobre este assunto, seguindo as regras.`;
}

/** Texto cru da resposta, seja qual for o formato em que o Workers AI o embrulhe. */
function rawText(result: any): string {
  if (!result) return '';
  if (typeof result.response === 'string') return result.response;
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (typeof result === 'string') return result;
  return '';
}

interface Campos {
  skip: boolean;
  title: string;
  excerpt: string;
  tags: string[];
  imagePrompt: string;
  body: string;
}

/**
 * Le a saida em blocos ###MARCADOR###.
 *
 * Antes o modelo devolvia JSON, e num ciclo inteiro SEIS temas cairam com
 * "nao consegui extrair JSON da resposta": um corpo de 700 palavras com aspas e
 * quebras de linha por dentro quase sempre produz JSON invalido, e nenhuma
 * tentativa de reparo cobre todos os casos. Marcadores em linha propria nao tem
 * escaping, entao nao ha' o que quebrar.
 */
function parseDelimited(raw: string): Campos | null {
  const texto = raw.replace(/```/g, '').trim();
  if (!texto) return null;
  if (/###\s*PULAR\s*###/i.test(texto)) {
    return { skip: true, title: '', excerpt: '', tags: [], imagePrompt: '', body: '' };
  }

  const bloco = (nome: string): string => {
    const re = new RegExp(`###\\s*${nome}\\s*###([\\s\\S]*?)(?=###\\s*[A-ZÇÃÉÍÓÚ]+\\s*###|$)`, 'i');
    const m = re.exec(texto);
    return m ? m[1].trim() : '';
  };

  const body = bloco('CORPO');
  const title = bloco('TITULO');
  if (!body || !title) return null;

  return {
    skip: false,
    title,
    excerpt: bloco('RESUMO'),
    tags: bloco('TAGS').split(/[,;\n]/).map(t => t.toLowerCase().trim()).filter(Boolean).slice(0, 5),
    imagePrompt: bloco('IMAGEM'),
    body,
  };
}

/**
 * Segunda passada: pede ao modelo que amplie o proprio texto com mais fatos.
 *
 * Nao e' "escreva mais": e' "volte ao material e traga o que ficou de fora". A
 * diferenca importa, porque um pedido generico de tamanho e' exatamente o que
 * produzia dupla conclusao e paragrafos repetidos. O resultado passa pelas mesmas
 * checagens do texto original, entao uma ampliacao preguicosa e' barrada depois.
 */
async function expandBody(ai: any, userPrompt: string, body: string): Promise<string | null> {
  try {
    const result = await ai.run(WRITER_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: `###CORPO###\n${body}` },
        {
          role: 'user',
          content: `O texto ficou curto. Reescreva-o inteiro, mais longo, entre 700 e 900 palavras.

COMO AMPLIAR (nesta ordem):
- Volte ao material de apoio e traga os fatos que você deixou de fora: números, nomes,
  versões, prazos, valores, quem disse o quê.
- Explique o mecanismo: como a coisa funciona, em que etapa do processo entra, o que
  substitui, o que exige de quem for adotar.
- Acrescente a consequência prática para uma empresa brasileira, ancorada nesses fatos.

PROIBIDO: repetir com outras palavras algo que o texto já diz, acrescentar um segundo
parágrafo de conclusão, ou encher com "pode", "poderá" e "tem o potencial de".
Se não houver mais fato no material, responda apenas ###PULAR###.

Responda só com o bloco ###CORPO### seguido do texto.`,
        },
      ],
      max_tokens: 5000,
      temperature: 0.6,
    });

    const texto = rawText(result).replace(/```/g, '').trim();
    if (!texto || /###\s*PULAR\s*###/i.test(texto)) return null;

    const m = /###\s*CORPO\s*###([\s\S]*)/i.exec(texto);
    const ampliado = (m ? m[1] : texto).trim();
    return ampliado.length > 0 ? ampliado : null;
  } catch (e) {
    console.warn('[writer] Falha ao ampliar o texto:', e);
    return null;
  }
}

export async function writeArticle(ai: any, topic: TopicInput): Promise<WrittenArticle | null> {
  if (topic.items.length === 0) return null;

  const sources = topic.items.map(it => it.source);

  const userPrompt = buildUserPrompt(topic);

  try {
    console.log(`[writer] Sintetizando ${topic.items.length} fonte(s) em ${topic.category}...`);
    const result = await ai.run(WRITER_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      // Folga generosa: 700 a 900 palavras passam de 1.500 tokens e uma resposta
      // cortada no meio invalida o tema inteiro — falha silenciosa e cara.
      max_tokens: 5000,
      temperature: 0.6,
    });

    const parsed = parseDelimited(rawText(result));
    if (!parsed) {
      console.error('[writer] Resposta fora do formato esperado, descartando tema.');
      return null;
    }

    // Saida de recusa prevista no prompt: melhor o modelo dizer que o tema nao
    // da' materia do que produzir 500 palavras de especulacao para preencher.
    if (parsed.skip) {
      console.warn('[writer] Modelo recusou o tema por falta de material.');
      return null;
    }

    const title = parsed.title;
    let body = parsed.body;

    // Pedir "700 a 900 palavras" no prompt nao basta: este modelo entrega entre
    // 1.900 e 3.100 caracteres com muita regularidade. Num ciclo inteiro, TREZE
    // temas bons foram descartados so' por tamanho. Em vez de rejeitar, pedimos a
    // ampliacao — com instrucao explicita de acrescentar fatos, nao paragrafos.
    if (body.length < MIN_BODY_CHARS) {
      console.log(`[writer] Corpo com ${body.length}, pedindo ampliacao ate ${MIN_BODY_CHARS}...`);
      const ampliado = await expandBody(ai, userPrompt, body);
      if (ampliado && ampliado.length > body.length) body = ampliado;
    }

    if (body.length < MIN_BODY_CHARS) {
      console.error(`[writer] Corpo curto demais mesmo apos ampliar (${body.length} < ${MIN_BODY_CHARS}), descartando.`);
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

    // Mais de uma especulacao por paragrafo, em media, e' texto feito de "pode
    // ajudar" e "tem o potencial de" — nenhum fato, so' volume.
    const especulacoes = (stripAccents(body.toLowerCase()).match(ESPECULACAO) || []).length;
    if (paragrafos.length > 0 && especulacoes > paragrafos.length) {
      console.error(
        `[writer] Especulativo demais (${especulacoes} em ${paragrafos.length} paragrafos), descartando.`,
      );
      return null;
    }

    // Guarda anti-spinning. Desde que o redator recebe o corpo da materia de
    // origem, esta e' a unica checagem que separa sintese propria de copia
    // disfarcada — o prompt sozinho nao garante nada.
    for (const it of topic.items) {
      if (!it.reference) continue;
      const trecho = verbatimOverlap(body, it.reference, VERBATIM_WORDS);
      if (trecho) {
        console.error(`[writer] Trecho copiado de ${it.source.name}: "${trecho}", descartando.`);
        return null;
      }
    }

    // Resposta cortada pelo limite de tokens: o ultimo paragrafo fica sem
    // terminar e o artigo vai ao ar truncado.
    const fim = body.trimEnd().slice(-1);
    if (!'.!?"”)'.includes(fim)) {
      console.error(`[writer] Texto termina sem pontuacao final ("...${body.trimEnd().slice(-40)}"), descartando.`);
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

    return {
      title: title.slice(0, 140),
      excerpt: parsed.excerpt.slice(0, 300),
      body,
      tags: parsed.tags,
      sources,
      imagePrompt: parsed.imagePrompt.slice(0, 300),
    };
  } catch (error) {
    console.error('[writer] Erro ao gerar artigo:', error);
    return null;
  }
}
