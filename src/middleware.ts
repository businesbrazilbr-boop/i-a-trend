import { defineMiddleware } from 'astro/middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();

  if (response.headers.get('content-type')?.includes('text/html')) {
    const cc = response.headers.get('Cache-Control') || '';
    const directives = cc.split(',').map(d => d.trim()).filter(Boolean);
    if (!directives.includes('no-transform')) {
      directives.push('no-transform');
    }
    response.headers.set('Cache-Control', directives.join(', '));
  }

  return response;
});
