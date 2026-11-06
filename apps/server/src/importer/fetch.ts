/**
 * Загрузка страниц dnd.su: честный User-Agent, не чаще одного запроса в 1,5 секунды,
 * кэш в памяти на сутки, повторы с паузой при обрыве соединения.
 */
const UA = 'dnd-campaign-app/0.1 (private group tool; imports on user request)';
const MIN_INTERVAL_MS = 1500;
const CACHE_MS = 24 * 3600 * 1000;

let last = 0;
const cache = new Map<string, { at: number; html: string }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function assertDndSuUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Это не ссылка');
  }
  if (url.hostname !== 'dnd.su' && url.hostname !== 'www.dnd.su') throw new Error('Нужна ссылка на dnd.su');
  url.protocol = 'https:';
  url.hostname = 'dnd.su';
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

export async function fetchPage(raw: string, opts: { retries?: number } = {}): Promise<string> {
  const url = assertDndSuUrl(raw).toString();
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.html;
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) throw Object.assign(new Error('Страница не найдена на dnd.su'), { fatal: true });
      if (!res.ok) throw new Error(`dnd.su ответил ${res.status}`);
      const html = await res.text();
      cache.set(url, { at: Date.now(), html });
      return html;
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) break;
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw new Error(`Не удалось загрузить страницу: ${(lastErr as Error)?.message ?? 'ошибка сети'}`);
}

/** Карта сайта: все адреса по разделам. */
export async function sitemapUrls(): Promise<Record<string, string[]>> {
  const res = await fetch('https://dnd.su/sitemap.xml', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Карта сайта недоступна (${res.status})`);
  const xml = await res.text();
  const out: Record<string, string[]> = {};
  for (const m of xml.matchAll(/<loc>(https:\/\/dnd\.su\/([a-z_]+)\/\d+-[^<]+)<\/loc>/g)) {
    (out[m[2]!] ??= []).push(m[1]!);
  }
  return out;
}
