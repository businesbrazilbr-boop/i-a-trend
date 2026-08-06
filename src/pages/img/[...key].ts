/**
 * Serve as ilustracoes proprias guardadas no R2.
 *
 * Mantem o bucket privado: nao precisa de dominio proprio nem de acesso publico.
 * As imagens sao imutaveis (a key inclui o id do artigo), entao podem ser
 * cacheadas indefinidamente.
 */

/** So' aceitamos as keys que o worker gera: articles/<id>.jpg */
const KEY_PATTERN = /^articles\/[A-Za-z0-9_-]+\.jpg$/;

export async function GET(context: any) {
  const key = context.params.key as string | undefined;

  if (!key || !KEY_PATTERN.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const bucket = context.locals?.runtime?.env?.IAS_IMAGES as R2Bucket | undefined;
  if (!bucket) {
    return new Response('Storage indisponivel', { status: 503 });
  }

  const object = await bucket.get(key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/jpeg');

  return new Response(object.body, { headers });
}
