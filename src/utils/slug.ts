export function generateSlug(title: string, maxLength = 100): string {
  let slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(/-+$/, '');
  }

  return slug;
}

export function generateUniqueSlug(title: string, existingSlugs: string[]): string {
  let slug = generateSlug(title);
  let counter = 1;

  while (existingSlugs.includes(slug)) {
    slug = `${generateSlug(title)}-${counter}`;
    counter++;
  }

  return slug;
}

export function slugFromPath(path: string): string {
  return path.split('/').pop()?.replace('.md', '') || '';
}