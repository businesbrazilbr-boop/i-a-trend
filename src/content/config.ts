import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string().max(120),
    slug: z.string().max(140),
    excerpt: z.string().max(300),
    sourceUrl: z.string().url(),
    sourceName: z.string(),
    category: z.enum([
      'ia-automacao',
      'negocios-tech',
      'startups',
      'marketing-tech',
      'tech-geral',
    ]),
    publishedAt: z.string().datetime({ offset: true }),
    imageUrl: z.string().url().optional(),
    tags: z.array(z.string()).default([]),
    contentFull: z.string().optional(),
    author: z.string().optional(),
    isOriginal: z.boolean().default(false),
  }),
});

export const collections = { news };