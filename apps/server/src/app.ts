import { COOKIE, userFromToken } from './auth.js';
import { ensureSchema, fromD1, type Db } from './db.js';
import { Api, handle, json, parseCookies } from './http.js';
import { Realtime, type Room } from './realtime.js';
import { characterAccess } from './service.js';
import { getCharacter, memberRole } from './repo.js';
import { authRoutes } from './routes/auth.js';
import { campaignRoutes } from './routes/campaigns.js';
import { characterRoutes } from './routes/characters.js';
import { contentRoutes } from './routes/content.js';
import { importRoutes } from './routes/import.js';
import { boardRoutes } from './routes/board.js';
import { downloadFile, fileRoutes, uploadChunk } from './routes/files.js';
import { HttpError } from './errors.js';

export interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace<Room>;
  /** Только для тестов: «кубики» всегда выдают это число (0…1) */
  FIXED_RNG?: string;
}

export interface AppDeps {
  db: Db;
  rt: Realtime;
  secureCookies: boolean;
  rng: () => number;
}

function routes(deps: AppDeps) {
  const api = new Api();
  authRoutes(api, deps);
  contentRoutes(api, deps);
  characterRoutes(api, deps);
  campaignRoutes(api, deps);
  importRoutes(api, deps);
  boardRoutes(api, deps);
  fileRoutes(api, deps);
  api.get('/health', () => ({ ok: true }));
  return api;
}

/** Подключение к живой комнате: проверяем вход и права, затем передаём сокет объекту комнаты. */
async function websocket(request: Request, env: Env, db: Db, path: string) {
  if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Нужен WebSocket' }, 426);
  const user = await userFromToken(db, parseCookies(request.headers.get('Cookie'))[COOKIE]);
  if (!user) return json({ error: 'Нужно войти' }, 401);
  const m = /^\/ws\/(campaign|character)\/([^/]+)$/.exec(path);
  if (!m) return json({ error: 'Не найдено' }, 404);
  const [, kind, id] = m as unknown as [string, string, string];
  let room: string;
  let tag: string;
  if (kind === 'campaign') {
    const role = await memberRole(db, id, user.id);
    if (!role) return json({ error: 'Вы не участник этой кампании' }, 403);
    room = `c:${id}`;
    tag = role === 'dm' ? 'dm' : 'players';
  } else {
    try {
      const access = await characterAccess(db, user, await getCharacter(db, id));
      if (!access.canView) return json({ error: 'Нет доступа' }, 403);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      throw e;
    }
    room = `ch:${id}`;
    tag = 'watch';
  }
  const headers = new Headers(request.headers);
  headers.set('X-Room-Tag', tag);
  return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(request, { headers }));
}

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  await ensureSchema(env.DB);
  const db = fromD1(env.DB);
  if (url.pathname.startsWith('/ws/')) return websocket(request, env, db, url.pathname);
  if (!url.pathname.startsWith('/api/')) return json({ error: 'Не найдено' }, 404);
  // Файлы — двоичные данные, мимо JSON-маршрутизатора
  const fm = /^\/api\/files\/([\w-]+)(?:\/chunks\/(\d+))?$/.exec(url.pathname);
  if (fm && ((request.method === 'GET' && !fm[2]) || (request.method === 'PUT' && fm[2]))) {
    const user = await userFromToken(db, parseCookies(request.headers.get('Cookie'))[COOKIE]);
    return fm[2] ? uploadChunk(request, env.DB, user, fm[1]!, Number(fm[2])) : downloadFile(request, env.DB, user, fm[1]!, ctx);
  }
  const fixed = env.FIXED_RNG ? Number(env.FIXED_RNG) : null;
  const deps: AppDeps = {
    db,
    rt: new Realtime(env.ROOMS, (p) => ctx.waitUntil(p)),
    secureCookies: url.protocol === 'https:',
    rng: fixed !== null ? () => fixed : Math.random,
  };
  return handle(routes(deps), request, url.pathname.slice(4), (cookies) => userFromToken(db, cookies[COOKIE]));
}
