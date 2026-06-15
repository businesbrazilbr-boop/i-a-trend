const SYSTEM_PROMPT = `Você é um redator de blog especializado em inteligência artificial, automação e tecnologia para negócios no Brasil.
Sua função é reescrever artigos de notícias em português brasileiro.
Regras:
- Mantenha os fatos principais do artigo original
- Use palavras diferentes e estrutura própria
- Estilo profissional mas acessível
- Parágrafos curtos (2-4 frases cada)
- Entre 300 e 600 palavras
- NÃO use markdown ou formatação especial
- Separe parágrafos com duas quebras de linha
- NÃO inclua metadados como "Artigo reescrito por IA" ou similar
- Escreva como um jornalista brasileiro experiente`;

interface AIRunResponse {
  response?: string;
}

export async function rewriteWithAI(
  ai: any,
  title: string,
  scrapedContent: string,
): Promise<string> {
  if (!scrapedContent || scrapedContent.length < 100) {
    console.log('[ai] Content too short, skipping rewrite');
    return scrapedContent;
  }

  const userPrompt = `Reescreva este artigo em português brasileiro como uma notícia original para o blog i-a-trend, que cobre IA e automação para negócios.

Título original: ${title}

Artigo original:
${scrapedContent.slice(0, 6000)}`;

  try {
    console.log(`[ai] Sending ${scrapedContent.length} chars to Workers AI...`);
    const result = await ai.run('@cf/meta/llama-3.2-3b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1500,
      temperature: 0.7,
    }) as AIRunResponse;

    const rewritten = (result.response || '').trim();
    console.log(`[ai] Rewritten content: ${rewritten.length} chars`);

    if (rewritten.length < 100) {
      console.warn('[ai] Rewritten content too short, using original');
      return scrapedContent;
    }

    return rewritten;
  } catch (error) {
    console.error('[ai] Error rewriting content:', error);
    return scrapedContent;
  }
}