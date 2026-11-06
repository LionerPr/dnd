import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { requireUser } from '../auth.js';
import { forbidden, HttpError } from '../errors.js';
import { detectKind, parseClass, parseRace } from '../importer/dndsu.js';
import { assertDndSuUrl, fetchPage, sitemapUrls } from '../importer/fetch.js';
import { upsertLibraryContent } from '../repo.js';

const PARSERS = {
  race: parseRace,
  class: parseClass,
} as const;
type ParsableKind = keyof typeof PARSERS;

function parse(url: string, html: string) {
  const kind = detectKind(url);
  if (!kind) throw new HttpError(400, 'Это не страница расы, класса, заклинания, монстра или предмета');
  const parser = PARSERS[kind as ParsableKind];
  if (!parser) throw new HttpError(400, 'Импорт этого раздела ещё не готов');
  try {
    return { kind: kind as ParsableKind, data: parser(html, url) };
  } catch (e) {
    throw new HttpError(422, `Не получилось разобрать страницу: ${(e as Error).message}`);
  }
}

interface Job {
  id: string;
  kinds: string[];
  total: number;
  done: number;
  failed: { url: string; error: string }[];
  status: 'running' | 'finished' | 'stopped';
  startedAt: string;
}

const SECTION_FOR: Record<ParsableKind, string> = { race: 'race', class: 'class' };

export function importRoutes(api: FastifyInstance, { db }: AppDeps) {
  let job: Job | null = null;

  /** Разобрать страницу по ссылке (или присланный HTML, если сайт недоступен с сервера) и вернуть черновик. */
  api.post('/import/preview', async (req) => {
    requireUser(req);
    const body = z.object({ url: z.string().max(500), html: z.string().max(5_000_000).optional() }).parse(req.body);
    let url: string;
    try {
      url = assertDndSuUrl(body.url).toString();
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    let html = body.html;
    if (!html) {
      try {
        html = await fetchPage(url);
      } catch (e) {
        throw new HttpError(502, `${(e as Error).message}. Можно сохранить страницу в браузере и загрузить файл.`);
      }
    }
    return { url, ...parse(url, html) };
  });

  /** Сразу положить в общую библиотеку (только администратор). */
  api.post('/import/library', async (req) => {
    const user = requireUser(req);
    if (!user.isAdmin) throw forbidden('Общую библиотеку пополняет администратор');
    const { url, html } = z.object({ url: z.string().max(500), html: z.string().max(5_000_000).optional() }).parse(req.body);
    const clean = assertDndSuUrl(url).toString();
    const parsed = parse(clean, html ?? (await fetchPage(clean)));
    const id = await upsertLibraryContent(db, parsed.kind, parsed.data.name, clean, parsed.data as never);
    return { id, kind: parsed.kind, name: parsed.data.name };
  });

  /** Залить разделы целиком по карте сайта: медленно, по одной странице. */
  api.post('/import/catalog', async (req) => {
    const user = requireUser(req);
    if (!user.isAdmin) throw forbidden('Каталог загружает администратор');
    const { kinds } = z.object({ kinds: z.array(z.enum(['race', 'class'])).min(1) }).parse(req.body);
    if (job?.status === 'running') throw new HttpError(409, 'Загрузка уже идёт');
    const map = await sitemapUrls();
    const urls = kinds.flatMap((k) => map[SECTION_FOR[k]] ?? []);
    const current: Job = { id: String(Date.now()), kinds, total: urls.length, done: 0, failed: [], status: 'running', startedAt: new Date().toISOString() };
    job = current;
    void (async () => {
      for (const url of urls) {
        if (current.status !== 'running') break;
        try {
          const parsed = parse(url, await fetchPage(url, { retries: 2 }));
          await upsertLibraryContent(db, parsed.kind, parsed.data.name, url, parsed.data as never);
        } catch (e) {
          current.failed.push({ url, error: (e as Error).message });
        }
        current.done++;
      }
      if (current.status === 'running') current.status = 'finished';
    })();
    return { job: current };
  });

  api.get('/import/catalog', async (req) => {
    requireUser(req);
    return { job };
  });

  api.delete('/import/catalog', async (req) => {
    const user = requireUser(req);
    if (!user.isAdmin) throw forbidden();
    if (job?.status === 'running') job.status = 'stopped';
    return { job };
  });
}
