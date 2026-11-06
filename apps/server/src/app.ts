import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { COOKIE, userFromToken } from './auth.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import { Realtime } from './realtime.js';
import { authRoutes } from './routes/auth.js';
import { campaignRoutes } from './routes/campaigns.js';
import { characterRoutes } from './routes/characters.js';
import { contentRoutes } from './routes/content.js';
import { importRoutes } from './routes/import.js';

export interface AppDeps {
  db: Db;
  rt: Realtime;
  secureCookies: boolean;
  rng: () => number;
}

export async function buildApp(db: Db, opts: { secureCookies?: boolean; webDist?: string; rng?: () => number } = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' }, bodyLimit: 5 * 1024 * 1024 });
  const deps: AppDeps = { db, rt: new Realtime(), secureCookies: !!opts.secureCookies, rng: opts.rng ?? Math.random };

  await app.register(cookie);
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => {
    req.user = await userFromToken(db, req.cookies[COOKIE]);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Неверные данные', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Ошибка сервера' });
  });

  await app.register(
    async (api) => {
      authRoutes(api, deps);
      contentRoutes(api, deps);
      characterRoutes(api, deps);
      campaignRoutes(api, deps);
      importRoutes(api, deps);
      api.get('/health', async () => ({ ok: true }));
    },
    { prefix: '/api' },
  );

  const dist = opts.webDist ?? resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(dist)) {
    // wildcard: true — файлы ищутся на диске при каждом запросе, поэтому пересборка фронтенда не требует перезапуска
    await app.register(fastifyStatic, { root: dist, wildcard: true });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/assets/') || req.method !== 'GET') return reply.status(404).send({ error: 'Не найдено' });
      return reply.sendFile('index.html');
    });
  }

  await app.ready();
  deps.rt.attach(app.server, db);
  return { app: app as FastifyInstance, deps };
}
