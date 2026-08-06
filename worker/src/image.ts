/**
 * Ilustracao propria por artigo.
 *
 * Antes o site pegava a og:image do veiculo original e servia por hotlink: e'
 * uso de obra de terceiro (a foto costuma ser de agencia, nao do veiculo) e
 * consome banda alheia. Aqui geramos uma ilustracao nossa e guardamos em R2.
 *
 * O prompt e' deliberadamente conceitual/abstrato: a imagem serve de capa
 * editorial e NAO pode parecer o registro fotografico de um fato real. O
 * template marca a legenda como "Ilustracao gerada por IA".
 */

export const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

const STYLE = 'editorial conceptual illustration, flat vector style, geometric shapes, '
  + 'limited palette of deep blue and warm orange on light background, clean negative space, '
  + 'abstract, no text, no letters, no logos, no faces, no real people';

/** Constroi um prompt visual a partir das palavras-chave, nunca do fato noticioso em si. */
function buildPrompt(tags: string[], category: string): string {
  const tema = tags.length > 0 ? tags.slice(0, 3).join(', ') : category.replace(/-/g, ' ');
  return `Abstract editorial illustration representing the concept of ${tema}. ${STYLE}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Gera a ilustracao e grava no bucket. Devolve a key do R2 (nao uma URL externa),
 * que o site serve por /img/[key].
 *
 * Devolve null se falhar: o artigo e' publicado sem capa, o que e' preferivel a
 * publicar imagem de terceiro.
 */
export async function generateAndStoreImage(
  ai: any,
  bucket: R2Bucket,
  articleId: string,
  tags: string[],
  category: string,
): Promise<string | null> {
  try {
    const prompt = buildPrompt(tags, category);
    console.log(`[image] Gerando ilustracao para ${articleId}...`);

    const result = await ai.run(IMAGE_MODEL, { prompt, steps: 4 }) as { image?: string };

    if (!result?.image) {
      console.error('[image] Modelo nao devolveu imagem.');
      return null;
    }

    const bytes = base64ToBytes(result.image);
    const key = `articles/${articleId}.jpg`;

    await bucket.put(key, bytes, {
      httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    console.log(`[image] Salva em R2: ${key} (${bytes.length} bytes)`);
    return key;
  } catch (error) {
    console.error('[image] Erro ao gerar/gravar ilustracao:', error);
    return null;
  }
}
