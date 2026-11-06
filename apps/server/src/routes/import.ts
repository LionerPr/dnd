/**
 * Импорт с dnd.su. Разбор страниц идёт в браузере (на бесплатном Cloudflare у сервера всего ~10 мс процессора),
 * а сервер только приносит страницу — dnd.su не отдаёт её чужим сайтам напрямую — и сохраняет готовый результат.
 * Страницы запрашиваются с честным User-Agent и кэшируются на сутки; закрытые для роботов разделы (/piece) не трогаем.
 */
import { assertDndSuUrl } from '@dnd/importer/src/sitemap';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { canAuthor, requireUser } from '../auth.js';
import { forbidden, HttpError } from '../errors.js';
import type { Api } from '../http.js';
import { upsertLibraryContent } from '../repo.js';

const UA = 'dnd-campaign-app/0.1 (private group tool; imports on user request)';
const DAY = 86400;

async function cachedFetch(url: string, type: string) {
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request(url);
  const hit = await cache?.match(key);
  if (hit) return hit.text();
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: type }, signal: AbortSignal.timeout(25000) });
  } catch (e) {
    throw new HttpError(502, `dnd.su не отвечает (${(e as Error).message}). Можно сохранить страницу в браузере и загрузить файл.`);
  }
  if (res.status === 404) throw new HttpError(404, 'Страница не найдена на dnd.su');
  if (!res.ok) throw new HttpError(502, `dnd.su ответил ${res.status}. Можно сохранить страницу в браузере и загрузить файл.`);
  const text = await res.text();
  await cache?.put(key, new Response(text, { headers: { 'Content-Type': type, 'Cache-Control': `max-age=${DAY}` } }));
  return text;
}

const textResponse = (text: string, type: string) => new Response(text, { headers: { 'Content-Type': `${type}; charset=utf-8` } });

/** Названия классов со страницы заклинания → id классов из общей библиотеки */
export async function linkSpellClasses(db: AppDeps['db'], data: Record<string, unknown>) {
  const names = (data.classNames as string[] | undefined) ?? [];
  if (!names.length) return data;
  const rows = await db.query<{ id: string; name: string }>(`SELECT id, name FROM content WHERE kind = 'class' AND owner_id IS NULL`);
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
  return { ...data, classes: names.map((n) => byName.get(n.toLowerCase())).filter(Boolean) };
}

export function importRoutes(api: Api, { db }: AppDeps) {
  /** Страница dnd.su как есть — её разберёт браузер. */
  api.get('/import/page', async (req) => {
    requireUser(req);
    let url: string;
    try {
      url = assertDndSuUrl(z.object({ url: z.string().max(500) }).parse(req.query).url).toString();
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    return textResponse(await cachedFetch(url, 'text/html'), 'text/html');
  });

  /** Карта сайта — по ней администратор загружает разделы целиком. */
  api.get('/import/sitemap', async (req) => {
    const user = requireUser(req);
    if (!canAuthor(user)) throw forbidden('Каталог загружают администратор и модераторы');
    return textResponse(await cachedFetch('https://dnd.su/sitemap.xml', 'application/xml'), 'application/xml');
  });

  /** Разобранная запись — в общую библиотеку (только администратор). Повторный импорт обновляет запись. */
  api.post('/import/library', async (req) => {
    const user = requireUser(req);
    if (!canAuthor(user)) throw forbidden('Общую библиотеку пополняют администратор и модераторы');
    const body = z
      .object({ kind: z.enum(['race', 'class', 'spell', 'item', 'monster']), url: z.string().max(500), data: z.record(z.string(), z.unknown()) })
      .parse(req.body);
    let url: string;
    try {
      url = assertDndSuUrl(body.url).toString();
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const name = String(body.data.name ?? '').trim();
    if (!name) throw new HttpError(400, 'У записи нет названия');
    const data = body.kind === 'spell' ? await linkSpellClasses(db, body.data) : body.data;
    const id = await upsertLibraryContent(db, body.kind, name, url, data);
    return { id, kind: body.kind, name };
  });
}
