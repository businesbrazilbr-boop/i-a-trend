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

const SYSTEM_PROMPT = `Voce e' editor do i-a-trend, um site brasileiro sobre inteligencia artificial aplicada a negocios.

Voce recebe manchetes e resumos publicos de varios veiculos sobre um mesmo assunto. Sua tarefa e' escrever uma ANALISE PROPRIA, nao um resumo e nao uma reescrita.

REGRAS ABSOLUTAS:
- NUNCA parafraseie um unico veiculo. Se so' ha' uma fonte, escreva sobre o CONTEXTO do fato, nao sobre o texto dela.
- NUNCA invente numeros, datas, valores, nomes ou declaracoes. Use apenas o que esta' nos resumos. Se um dado nao esta' la', nao o mencione.
- NUNCA copie frases dos resumos. Formule tudo com suas proprias palavras.
- O valor do texto esta' no ANGULO: o que isso muda para uma empresa brasileira em custo, processo, prazo ou risco. Essa analise e' sua, nao das fontes.

FORMATO:
- Portugues brasileiro, tom profissional e direto.
- Entre 500 e 800 palavras.
- Paragrafos curtos, de 2 a 4 frases.
- Comece pelo que mudou, nao por "nos ultimos anos...".
- Sem markdown, sem titulos internos. Separe paragrafos com uma linha em branco.
- Nao escreva "segundo o site X" em todo paragrafo; a atribuicao aparece numa secao de fontes.

Responda SOMENTE com JSON valido, sem cercas de codigo, neste formato:
{"title": "...", "excerpt": "...", "body": "...", "tags": ["...", "..."]}

title: manchete propria, no maximo 90 caracteres, sem copiar nenhuma das manchetes recebidas.
excerpt: uma frase de ate 200 caracteres.
body: o texto completo, com \\n\\n entre paragrafos.
tags: 3 a 5 palavras-chave em minusculas.`;

function buildUserPrompt(topic: TopicInput): string {
  const fontes = topic.items
    .map((it, i) => `[${i + 1}] ${it.source.name}\nManchete: ${it.title}\nResumo: ${it.excerpt || '(sem resumo)'}`)
    .join('\n\n');

  return `Categoria: ${topic.category}

Fontes sobre o mesmo assunto:

${fontes}

Escreva a analise do i-a-trend sobre este assunto, seguindo as regras.`;
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
    }) as { response?: string };

    const parsed = parseJsonLoose(result.response || '');
    if (!parsed) {
      console.error('[writer] Resposta nao e\' JSON valido, descartando tema.');
      return null;
    }

    const title = String(parsed.title || '').trim();
    const body = String(parsed.body || '').trim();

    // Descarta saidas degeneradas em vez de publicar lixo.
    if (title.length < 15 || body.length < 600) {
      console.error(`[writer] Saida curta demais (titulo ${title.length}, corpo ${body.length}), descartando.`);
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
