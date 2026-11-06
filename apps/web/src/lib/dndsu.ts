/**
 * Импорт с dnd.su в браузере: сервер лишь приносит страницу (честным User-Agent, с кэшем),
 * а разбирает её этот код — на бесплатном Cloudflare серверу на это не хватает процессорного времени.
 * Разборщик подгружается только при импорте, чтобы не утяжелять приложение.
 */
import { useSyncExternalStore } from 'react';
import { api, ApiError } from '../api/client';

export type ImportKind = 'race' | 'class' | 'spell' | 'item' | 'monster';
export interface Parsed {
  url: string;
  kind: ImportKind;
  data: any;
}

const importer = () => import('@dnd/importer');

async function fetchText(path: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const err = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    throw new ApiError(res.status, err?.error ?? `Ошибка ${res.status}`);
  }
  return res.text();
}

/** Разобрать страницу: по ссылке или из сохранённого HTML (если dnd.su недоступен). */
export async function parsePage(rawUrl: string, html?: string): Promise<Parsed> {
  const m = await importer();
  const url = m.assertDndSuUrl(rawUrl).toString();
  const kind = m.detectKind(url);
  if (!kind) throw new Error('Это не страница расы, класса, заклинания, предмета или существа');
  const page = html ?? (await fetchText(`/import/page?url=${encodeURIComponent(url)}`));
  try {
    const data =
      kind === 'race' ? m.parseRace(page, url) : kind === 'class' ? m.parseClass(page, url) : kind === 'item' ? m.parseItem(page, url) : kind === 'monster' ? m.parseMonster(page, url) : m.parseSpell(page, url);
    return { url, kind, data };
  } catch (e) {
    throw new Error(`Не получилось разобрать страницу: ${(e as Error).message}`);
  }
}

export const saveToLibrary = (p: Parsed) => api<{ id: string; name: string }>('/import/library', { body: { kind: p.kind, url: p.url, data: p.data } });

// ---------- Загрузка разделов целиком ----------

export interface CatalogJob {
  kinds: ImportKind[];
  total: number;
  done: number;
  failed: { url: string; error: string }[];
  status: 'running' | 'finished' | 'stopped';
}

const PAUSE_MS = 1500;
let job: CatalogJob | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const set = (patch: Partial<CatalogJob>) => {
  job = job ? { ...job, ...patch } : null;
  notify();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Обойти карту сайта и сложить разделы в общую библиотеку. Пока идёт загрузка, вкладку надо держать открытой. */
/**
 * Расы и классы берём со страниц-списков /race/ и /class/: там у каждой статьи её настоящий адрес,
 * включая «мультивселенную» (часть её в карте сайта отсутствует). Самодельное (homebrew) — отдельной кнопкой.
 * Заклинания — по карте сайта.
 */
async function indexUrls(kinds: ImportKind[], homebrew: boolean) {
  const out: { kind: ImportKind; url: string }[] = [];
  for (const kind of IMPORT_ORDER.filter((k) => kinds.includes(k) && (k === 'race' || k === 'class'))) {
    const html = await fetchText(`/import/page?url=${encodeURIComponent(`https://dnd.su/${kind}/`)}`);
    const prefix = homebrew ? '/homebrew' : '(?:/multiverse)?';
    const seen = new Set<string>();
    for (const m of html.matchAll(new RegExp(`href="(${prefix}/${kind}/\\d+-[^"/]+/)"`, 'g'))) {
      // Напарники (sidekick) из «Основных правил» — не классы для игроков
      if (seen.has(m[1]!) || /sidekick/.test(m[1]!)) continue;
      seen.add(m[1]!);
      out.push({ kind, url: `https://dnd.su${m[1]}` });
    }
  }
  return out;
}

const IMPORT_ORDER: ImportKind[] = ['race', 'class', 'spell', 'item', 'monster'];

export async function startCatalog(kinds: ImportKind[], onDone?: () => void, homebrew = false, mmOnly = false) {
  if (job?.status === 'running') return;
  const m = await importer();
  const items = await indexUrls(kinds, homebrew);
  const fromSitemap = kinds.filter((k) => k === 'spell' || k === 'item' || k === 'monster');
  if (!homebrew && fromSitemap.length) items.push(...m.catalogUrls(await fetchText('/import/sitemap'), fromSitemap, { mmOnly }));
  job = { kinds, total: items.length, done: 0, failed: [], status: 'running' };
  notify();
  for (const { url } of items) {
    if (job.status !== 'running') break;
    const started = Date.now();
    let error: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const parsed = await parsePage(url);
        // Только «Monster Manual»: среди первых номеров изредка попадаются существа из других книг
        if (!(mmOnly && parsed.kind === 'monster' && !/^Monster Manual$/i.test(parsed.data.book ?? ''))) await saveToLibrary(parsed);
        error = null;
        break;
      } catch (e) {
        error = (e as Error).message;
        // 4xx — повтор не поможет; сбой сети или dnd.su — пробуем ещё раз с паузой
        if (e instanceof ApiError && e.status < 500) break;
        await sleep(2000 * 2 ** attempt);
      }
    }
    set({ done: job.done + 1, failed: error ? [...job.failed, { url, error }] : job.failed });
    const wait = PAUSE_MS - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  if (job.status === 'running') set({ status: 'finished' });
  onDone?.();
}

export function stopCatalog() {
  if (job?.status === 'running') set({ status: 'stopped' });
}

export function useCatalogJob() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => job,
  );
}

// Не дать случайно закрыть вкладку посреди загрузки
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (job?.status === 'running') e.preventDefault();
  });
}
