import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { requireUser } from '../auth.js';
import { memberRole, deleteContent, getContent, getContentBatch, listContent, saveContent } from '../repo.js';
import { forbidden } from '../errors.js';

const Kind = z.enum(['race', 'class', 'spell', 'item', 'monster', 'feat']);

const ContentInput = z.object({
  kind: Kind,
  name: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()),
  visibility: z.enum(['private', 'campaign', 'public']).optional(),
  campaignId: z.string().nullable().optional(),
  source: z.enum(['custom', 'dnd.su']).optional(),
  sourceUrl: z.string().max(500).nullable().optional(),
});

export function contentRoutes(api: FastifyInstance, { db }: AppDeps) {
  api.get('/content', async (req) => {
    const user = requireUser(req);
    const q = z
      .object({
        kind: Kind.optional(),
        q: z.string().max(100).optional(),
        classId: z.string().optional(),
        level: z.coerce.number().int().min(0).max(9).optional(),
        limit: z.coerce.number().int().min(1).max(3000).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.query);
    return { items: await listContent(db, user.id, q) };
  });

  /** Несколько записей целиком (заклинания персонажа и т. п.) */
  api.get('/content/batch', async (req) => {
    const user = requireUser(req);
    const { ids } = z.object({ ids: z.string().max(20000) }).parse(req.query);
    const list = ids.split(',').filter(Boolean).slice(0, 500);
    return { items: await getContentBatch(db, user.id, list) };
  });

  api.get('/content/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    return { item: await getContent(db, user.id, id) };
  });

  api.post('/content', async (req) => {
    const user = requireUser(req);
    const body = ContentInput.parse(req.body);
    if (body.campaignId && !(await memberRole(db, body.campaignId, user.id))) throw forbidden();
    const id = await saveContent(db, user.id, body);
    return { item: await getContent(db, user.id, id) };
  });

  api.put('/content/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = ContentInput.parse(req.body);
    await saveContent(db, user.id, { ...body, id });
    return { item: await getContent(db, user.id, id) };
  });

  /** Копия чужой или библиотечной записи в свою коллекцию — чтобы поправить под себя */
  api.post('/content/:id/copy', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const src = await getContent(db, user.id, id);
    const { sourceUrl: _s, ...data } = src.data as Record<string, unknown>;
    const newId = await saveContent(db, user.id, { kind: src.kind, name: `${src.name} (копия)`, data });
    return { item: await getContent(db, user.id, newId) };
  });

  api.delete('/content/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await deleteContent(db, user.id, id, user.isAdmin);
    return { ok: true };
  });
}
