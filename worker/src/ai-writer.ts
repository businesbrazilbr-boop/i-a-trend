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

export const WRITER_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** ~370 palavras. Abaixo disso o texto nao sustenta analise propria. */
const MIN_BODY_CHARS = 2200;

/** Uma manchete real tem sujeito e verbo; menos que isto costuma ser rotulo generico. */
const MIN_TITLE_WORDS = 5;

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

FORMATO:
- Tom profissional e direto.
- Entre 500 e 800 palavras. Textos curtos serão rejeitados.
- Parágrafos curtos, de 2 a 4 frases.
- Comece pelo que mudou, não por "nos últimos anos...".
- Sem markdown, sem títulos internos. Separe parágrafos com uma linha em branco.
- Não escreva "segundo o site X" em todo parágrafo; a atribuição aparece numa seção de fontes.

Responda SOMENTE com JSON válido, sem cercas de código, neste formato:
{"title": "...", "excerpt": "...", "body": "...", "tags": ["...", "..."]}

excerpt: uma frase de até 200 caracteres.
body: o texto completo, com \\n\\n entre parágrafos.
tags: 3 a 5 palavras-chave em minúsculas.`;

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
      max_tokens: 2000,
      temperature: 0.6,
    });

    const parsed = extractPayload(result);
    if (!parsed) {
      console.error('[writer] Nao consegui extrair JSON da resposta, descartando tema.');
      return null;
    }

    const title = String(parsed.title || '').trim();
    const body = String(parsed.body || '').trim();

    // ~2200 caracteres sao aproximadamente 370 palavras. Abaixo disso o texto
    // vira nota curta sem analise, que e' exatamente o "conteudo de baixo valor"
    // que o AdSense recusa.
    if (body.length < MIN_BODY_CHARS) {
      console.error(`[writer] Corpo curto demais (${body.length} < ${MIN_BODY_CHARS}), descartando.`);
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
    };
  } catch (error) {
    console.error('[writer] Erro ao gerar artigo:', error);
    return null;
  }
}
