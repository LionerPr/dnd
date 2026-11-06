import { computeSheet, type Character } from '@dnd/rules-engine';
import type { Api } from '../http.js';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { requireUser } from '../auth.js';
import { CommandSchema } from '../commands.js';
import { forbidden, HttpError } from '../errors.js';
import { contentIndexFor, getCharacter, saveCharacterData, type CharacterRow } from '../repo.js';
import { broadcastCharacter, characterAccess, characterView, emitEvent, freshCharacter, namesFor, runCharacterCommand } from '../service.js';

/** Лист целиком, кроме состояния: состояние меняется только командами (чтобы мастер и игрок не затирали друг друга). */
const CharacterBody = z.object({
  data: z.record(z.string(), z.unknown()),
  version: z.number().int().optional(),
});

export function characterRoutes(api: Api, deps: AppDeps) {
  const { db } = deps;

  api.get('/characters', async (req) => {
    const user = requireUser(req);
    const rows = await db.query<CharacterRow & { campaign_name: string | null }>(
      `SELECT ch.*, c.name AS campaign_name FROM characters ch LEFT JOIN campaigns c ON c.id = ch.campaign_id
       WHERE ch.owner_id = $1 ORDER BY ch.updated_at DESC`,
      [user.id],
    );
    const index = await contentIndexFor(db, rows.map((r) => r.data));
    return {
      characters: rows.map((r) => {
        const sheet = computeSheet(r.data, index);
        const race = r.data.raceId ? index.races.get(r.data.raceId)?.name : undefined;
        const classes = r.data.classes.map((c) => `${index.classes.get(c.classId)?.name ?? '?'} ${c.level}`).join(' / ');
        return {
          id: r.id, name: r.data.name, race, classes, level: sheet.level, hp: r.data.state.hp, maxHp: sheet.maxHp,
          ac: sheet.ac, campaignId: r.campaign_id, campaignName: r.campaign_name, updatedAt: r.updated_at, portrait: (r.data as Character & { portrait?: string }).portrait,
        };
      }),
    };
  });

  api.post('/characters', async (req) => {
    const user = requireUser(req);
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
    const id = nanoid(12);
    const data = freshCharacter(id, name);
    await db.query(`INSERT INTO characters (id, owner_id, data) VALUES ($1, $2, $3)`, [id, user.id, data]);
    return characterView(db, await getCharacter(db, id));
  });

  api.get('/characters/:id', async (req) => {
    const user = requireUser(req);
    const row = await getCharacter(db, (req.params as { id: string }).id);
    const access = await characterAccess(db, user, row);
    if (!access.canView) throw forbidden();
    const awards = await db.query(
      `SELECT aw.id, aw.note, aw.awarded_at, a.title, a.description, a.icon FROM achievement_awards aw
       JOIN achievements a ON a.id = aw.achievement_id WHERE aw.character_id = $1 ORDER BY aw.awarded_at DESC`,
      [row.id],
    );
    return { ...(await characterView(db, row)), access, awards };
  });

  api.put('/characters/:id', async (req) => {
    const user = requireUser(req);
    const body = CharacterBody.parse(req.body);
    const updated = await db.tx(async (tx) => {
      const row = await getCharacter(tx, (req.params as { id: string }).id);
      const access = await characterAccess(tx, user, row);
      if (!access.canEdit) throw forbidden('Это не ваш персонаж');
      const before = row.data;
      const incoming = { ...(body.data as unknown as Character), id: row.id, state: before.state };
      // Хиты: если персонаж был «полон», остаётся полным при росте максимума; иначе ограничиваем новым максимумом
      const index = await contentIndexFor(tx, [before, incoming]);
      const oldMax = computeSheet(before, index).maxHp;
      const newMax = computeSheet(incoming, index).maxHp;
      const full = before.state.hp >= oldMax || before.state.hp === 0 && before.classes.length === 0;
      incoming.state = { ...before.state, hp: full ? newMax : Math.min(before.state.hp, newMax) };
      const version = await saveCharacterData(tx, row.id, incoming, body.version);
      if (version === null) throw new HttpError(409, 'Лист изменили на другом устройстве — обновите страницу');
      return { ...row, data: incoming, version };
    });
    return broadcastCharacter(deps, updated);
  });

  /** Как будет выглядеть лист с изменениями, без сохранения: окно повышения уровня показывает новое до подтверждения */
  api.post('/characters/:id/preview', async (req) => {
    const user = requireUser(req);
    const body = CharacterBody.parse(req.body);
    const row = await getCharacter(db, (req.params as { id: string }).id);
    const access = await characterAccess(db, user, row);
    if (!access.canEdit) throw forbidden('Это не ваш персонаж');
    const draft = { ...(body.data as unknown as Character), id: row.id, state: row.data.state };
    const index = await contentIndexFor(db, [draft]);
    return { sheet: computeSheet(draft, index), names: namesFor(draft, index) };
  });

  api.post('/characters/:id/command', async (req) => {
    const user = requireUser(req);
    const cmd = CommandSchema.parse((req.body as { command?: unknown })?.command);
    const { row, ev } = await runCharacterCommand(deps, user, (req.params as { id: string }).id, cmd);
    emitEvent(deps.rt, ev);
    return { ...(await broadcastCharacter(deps, row)), event: ev };
  });

  api.post('/characters/:id/duplicate', async (req) => {
    const user = requireUser(req);
    const row = await getCharacter(db, (req.params as { id: string }).id);
    if (row.owner_id !== user.id) throw forbidden();
    const id = nanoid(12);
    const data = { ...row.data, id, name: `${row.data.name} (копия)` };
    await db.query(`INSERT INTO characters (id, owner_id, data) VALUES ($1, $2, $3)`, [id, user.id, data]);
    return characterView(db, await getCharacter(db, id));
  });

  api.delete('/characters/:id', async (req) => {
    const user = requireUser(req);
    const row = await getCharacter(db, (req.params as { id: string }).id);
    if (row.owner_id !== user.id) throw forbidden();
    await db.query(`DELETE FROM characters WHERE id = $1`, [row.id]);
    if (row.campaign_id) deps.rt.all(row.campaign_id, 'character-removed', { id: row.id });
    return { ok: true };
  });
}
