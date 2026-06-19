const DAILY_COUNT_KEY = 'ias:daily_count';
const LAST_RUN_KEY = 'ias:last_run';
const ARTICLES_DATE_KEY = 'ias:articles_date';
const PROCESSED_URLS_KEY = 'ias:processed_urls';

export async function getDailyCount(kv: KVNamespace, date: string): Promise<number> {
  const count = await kv.get(`${DAILY_COUNT_KEY}:${date}`);
  return count ? parseInt(count, 10) : 0;
}

export async function setDailyCount(kv: KVNamespace, date: string, count: number): Promise<void> {
  await kv.put(`${DAILY_COUNT_KEY}:${date}`, count.toString(), {
    expirationTtl: 86400,
  });
}

export async function getLastRun(kv: KVNamespace): Promise<string | null> {
  return kv.get(LAST_RUN_KEY);
}

export async function setLastRun(kv: KVNamespace): Promise<void> {
  await kv.put(LAST_RUN_KEY, new Date().toISOString());
}

export async function isUrlProcessed(kv: KVNamespace, url: string): Promise<boolean> {
  const hash = await sha256(url);
  const result = await kv.get(`${PROCESSED_URLS_KEY}:${hash}`);
  return result !== null;
}

export async function getArticlesDate(kv: KVNamespace): Promise<string | null> {
  return kv.get(ARTICLES_DATE_KEY);
}

export async function setArticlesDate(kv: KVNamespace, date: string): Promise<void> {
  await kv.put(ARTICLES_DATE_KEY, date);
}

export async function markUrlProcessed(kv: KVNamespace, url: string): Promise<void> {
  const hash = await sha256(url);
  await kv.put(`${PROCESSED_URLS_KEY}:${hash}`, '1', {
    expirationTtl: 86400 * 7,
  });
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}