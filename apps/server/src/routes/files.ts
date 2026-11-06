/**
 * Файлы кампании: карты, картинки, музыка. Хранятся прямо в D1 кусками по 1,5 МБ (R2 на бесплатном плане
 * требует карту). Загрузка — по кускам отдельными запросами, раздача — из кэша Cloudflare, файл неизменяем.
 */
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { requireUser, type User } from '../auth.js';
import { forbidden, HttpError, notFound } from '../errors.js';
import type { Api } from '../http.js';
import { memberRole } from '../repo.js';

export const CHUNK = 1_500_000;
const LIMITS = { image: 10_000_000, map: 15_000_000, audio: 40_000_000 } as const;
const CAMPAIGN_QUOTA = 800_000_000;
const MIME = { image: /^image\/(png|jpe?g|webp|gif|avif)$/, map: /^image\/(png|jpe?g|webp|gif|avif)$/, audio: /^audio\/(mpeg|mp3|ogg|wav|x-wav|webm|aac|mp4|x-m4a|flac|opus)$/ } as const;

export interface FileRow {
  id: string;
  campaign_id: string;
  owner_id: string;
  name: string;
  mime: string;
  size: number;
  chunks: number;
  kind: keyof typeof LIMITS;
  complete: number;
  created_at: string;
}

const view = (f: FileRow) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, kind: f.kind, ownerId: f.owner_id, createdAt: f.created_at });

export function fileRoutes(api: Api, deps: AppDeps) {
  const { db, rt } = deps;

  const getFile = async (id: string) => {
    const f = (await db.query<FileRow>(`SELECT * FROM files WHERE id = $1`, [id]))[0];
    if (!f) throw notFound('Файл не найден');
    return f;
  };

  api.get('/campaigns/:id/files', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    if (!(await memberRole(db, id, user.id))) throw forbidden('Вы не участник этой кампании');
    const rows = await db.query<FileRow>(`SELECT * FROM files WHERE campaign_id = $1 AND complete = 1 ORDER BY created_at`, [id]);
    const used = rows.reduce((s, f) => s + f.size, 0);
    return { files: rows.map(view), used, quota: CAMPAIGN_QUOTA };
  });

  api.post('/campaigns/:id/files', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const role = await memberRole(db, id, user.id);
    if (!role) throw forbidden('Вы не участник этой кампании');
    const body = z.object({ name: z.string().min(1).max(200), mime: z.string().max(100), size: z.number().int().min(1), kind: z.enum(['image', 'map', 'audio']) }).parse(req.body);
    if (body.kind !== 'image' && role !== 'dm') throw forbidden('Карты и музыку загружает мастер');
    if (!MIME[body.kind].test(body.mime)) throw new HttpError(400, body.kind === 'audio' ? 'Нужен аудиофайл: mp3, ogg, wav, m4a' : 'Нужна картинка: png, jpg, webp');
    if (body.size > LIMITS[body.kind]) throw new HttpError(413, `Файл больше ${Math.round(LIMITS[body.kind] / 1e6)} МБ`);
    const used = (await db.query<{ s: number | null }>(`SELECT SUM(size) AS s FROM files WHERE campaign_id = $1`, [id]))[0]?.s ?? 0;
    if (used + body.size > CAMPAIGN_QUOTA) throw new HttpError(413, 'Место для файлов кампании закончилось — удалите старые');
    // Незаконченные загрузки старше суток убираем заодно
    await db.query(`DELETE FROM files WHERE campaign_id = $1 AND complete = 0 AND created_at < $2`, [id, new Date(Date.now() - 86400_000).toISOString()]);
    const fid = nanoid(12);
    const chunks = Math.ceil(body.size / CHUNK);
    await db.query(`INSERT INTO files (id, campaign_id, owner_id, name, mime, size, chunks, kind, complete) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`, [fid, id, user.id, body.name, body.mime, body.size, chunks, body.kind]);
    return { id: fid, chunkSize: CHUNK, chunks };
  });

  api.post('/files/:id/complete', async (req) => {
    const user = requireUser(req);
    const f = await getFile((req.params as { id: string }).id);
    if (f.owner_id !== user.id) throw forbidden();
    const n = (await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM file_chunks WHERE file_id = $1`, [f.id]))[0]?.n ?? 0;
    if (n !== f.chunks) throw new HttpError(400, `Загружено ${n} из ${f.chunks} частей`);
    await db.query(`UPDATE files SET complete = 1 WHERE id = $1`, [f.id]);
    const v = view({ ...f, complete: 1 });
    rt.all(f.campaign_id, 'file', v);
    return { file: v };
  });

  api.put('/files/:id', async (req) => {
    const user = requireUser(req);
    const f = await getFile((req.params as { id: string }).id);
    const role = await memberRole(db, f.campaign_id, user.id);
    if (role !== 'dm' && f.owner_id !== user.id) throw forbidden();
    const { name } = z.object({ name: z.string().min(1).max(200) }).parse(req.body);
    await db.query(`UPDATE files SET name = $2 WHERE id = $1`, [f.id, name]);
    const v = view({ ...f, name });
    rt.all(f.campaign_id, 'file', v);
    return { file: v };
  });

  api.delete('/files/:id', async (req) => {
    const user = requireUser(req);
    const f = await getFile((req.params as { id: string }).id);
    const role = await memberRole(db, f.campaign_id, user.id);
    if (role !== 'dm' && f.owner_id !== user.id) throw forbidden();
    await db.query(`DELETE FROM file_chunks WHERE file_id = $1`, [f.id]);
    await db.query(`DELETE FROM files WHERE id = $1`, [f.id]);
    rt.all(f.campaign_id, 'file-removed', { id: f.id });
    return { ok: true };
  });
}

// ---------- Двоичные запросы: мимо JSON-маршрутизатора ----------

async function fileFor(d1: D1Database, id: string) {
  return d1.prepare(`SELECT * FROM files WHERE id = ?1`).bind(id).first<FileRow>();
}

async function role(d1: D1Database, campaignId: string, userId: string) {
  return (await d1.prepare(`SELECT role FROM campaign_members WHERE campaign_id = ?1 AND user_id = ?2`).bind(campaignId, userId).first<{ role: string }>())?.role ?? null;
}

const err = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

/** PUT /api/files/:id/chunks/:n — тело запроса и есть кусок файла */
export async function uploadChunk(request: Request, d1: D1Database, user: User | null, id: string, n: number) {
  if (!user) return err(401, 'Нужно войти');
  const f = await fileFor(d1, id);
  if (!f) return err(404, 'Файл не найден');
  if (f.owner_id !== user.id) return err(403, 'Нет доступа');
  if (f.complete) return err(400, 'Файл уже загружен');
  if (!(n >= 0 && n < f.chunks)) return err(400, 'Неверный номер части');
  const data = new Uint8Array(await request.arrayBuffer());
  const expected = n === f.chunks - 1 ? f.size - CHUNK * (f.chunks - 1) : CHUNK;
  if (data.byteLength !== expected) return err(400, `Часть ${n}: ждали ${expected} байт, пришло ${data.byteLength}`);
  await d1.prepare(`INSERT INTO file_chunks (file_id, idx, data) VALUES (?1, ?2, ?3) ON CONFLICT(file_id, idx) DO UPDATE SET data = excluded.data`).bind(id, n, data).run();
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}

/** GET /api/files/:id — файл целиком; участникам кампании. Кэшируется: файл после загрузки не меняется. */
export async function downloadFile(request: Request, d1: D1Database, user: User | null, id: string, ctx: ExecutionContext) {
  if (!user) return err(401, 'Нужно войти');
  const f = await fileFor(d1, id);
  if (!f || !f.complete) return err(404, 'Файл не найден');
  if (!(await role(d1, f.campaign_id, user.id))) return err(403, 'Нет доступа');
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request(`https://files.letopis.internal/${f.id}`);
  const headers = {
    'Content-Type': f.mime,
    'Content-Length': String(f.size),
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  };
  const hit = await cache?.match(key);
  if (hit) return new Response(hit.body, { headers });
  // Отдаём кусками по мере чтения из базы — память воркера не забивается
  const { readable, writable } = new FixedLengthStream(f.size);
  const writer = writable.getWriter();
  const pump = (async () => {
    try {
      for (let i = 0; i < f.chunks; i++) {
        const row = await d1.prepare(`SELECT data FROM file_chunks WHERE file_id = ?1 AND idx = ?2`).bind(f.id, i).first<{ data: ArrayBuffer | number[] }>();
        if (!row) throw new Error('нет части файла');
        await writer.write(row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(row.data));
      }
      await writer.close();
    } catch (e) {
      await writer.abort(e);
    }
  })();
  ctx.waitUntil(pump);
  const res = new Response(readable, { headers });
  if (cache) {
    const [a, b] = res.body!.tee();
    ctx.waitUntil(cache.put(key, new Response(b, { headers: { ...headers, 'Cache-Control': 'public, max-age=31536000, immutable' } })).catch(() => {}));
    return new Response(a, { headers });
  }
  return res;
}
