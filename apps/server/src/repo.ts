import type { Character, Content, ContentIndex, Feature } from '@dnd/rules-engine';
import { nanoid } from 'nanoid';
import type { Db } from './db.js';
import { forbidden, notFound } from './errors.js';

// ---------- Контент ----------

export type ContentKind = Content['kind'] | 'feat';

export interface ContentRow {
  id: string;
  kind: ContentKind;
  name: string;
  owner_id: string | null;
  campaign_id: string | null;
  visibility: 'private' | 'campaign' | 'public';
  source: string;
  source_url: string | null;
  data: Record<string, unknown>;
  updated_at: string;
}

/** Контент, видимый пользователю: общая библиотека (без владельца), публичный, свой, из его кампаний. */
const VISIBLE = `(c.owner_id IS NULL OR c.visibility = 'public' OR c.owner_id = $1
  OR (c.campaign_id IS NOT NULL AND c.campaign_id IN (SELECT campaign_id FROM campaign_members WHERE user_id = $1)))`;

export async function listContent(db: Db, userId: string, opts: { kind?: string; q?: string; limit?: number; offset?: number; classId?: string; level?: number }) {
  const params: unknown[] = [userId];
  let where = VISIBLE;
  if (opts.kind) {
    params.push(opts.kind);
    where += ` AND c.kind = $${params.length}`;
  }
  if (opts.q) {
    // lower() в SQLite не знает кириллицу, поэтому ищем по заранее приведённому имени
    params.push(`%${opts.q.toLowerCase()}%`);
    where += ` AND c.name_lc LIKE $${params.length}`;
  }
  if (opts.classId) {
    params.push(opts.classId);
    where += ` AND EXISTS (SELECT 1 FROM json_each(c.data, '$.classes') WHERE value = $${params.length})`;
  }
  if (opts.level !== undefined) {
    params.push(opts.level);
    where += ` AND json_extract(c.data, '$.level') = $${params.length}`;
  }
  params.push(Math.min(opts.limit ?? 100, 3000), opts.offset ?? 0);
  return db.query<ContentRow>(
    `SELECT c.id, c.kind, c.name, c.owner_id, c.campaign_id, c.visibility, c.source, c.source_url, c.updated_at,
       json_set(
         json_remove(c.data, '$.description', '$.features', '$.traits', '$.actions', '$.levels', '$.higherLevels',
           '$.subclasses', '$.subraces', '$.reactions', '$.legendary'),
         '$.subclassCount', COALESCE(json_array_length(c.data, '$.subclasses'), 0),
         '$.subraceCount', COALESCE(json_array_length(c.data, '$.subraces'), 0)) AS data
     FROM content c WHERE ${where} ORDER BY c.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export async function getContent(db: Db, userId: string, id: string): Promise<ContentRow> {
  const rows = await db.query<ContentRow>(`SELECT * FROM content c WHERE c.id = $2 AND ${VISIBLE}`, [userId, id]);
  if (!rows[0]) throw notFound('Запись не найдена');
  return rows[0];
}

export async function getContentBatch(db: Db, userId: string, ids: string[]): Promise<ContentRow[]> {
  if (!ids.length) return [];
  return db.query<ContentRow>(`SELECT * FROM content c WHERE c.id IN (SELECT value FROM json_each($2)) AND ${VISIBLE}`, [userId, ids]);
}

export async function getContentMany(db: Db, ids: string[]): Promise<ContentRow[]> {
  if (!ids.length) return [];
  return db.query<ContentRow>(`SELECT * FROM content WHERE id IN (SELECT value FROM json_each($1))`, [ids]);
}

export async function saveContent(
  db: Db,
  userId: string | null,
  input: { id?: string; kind: ContentKind; name: string; data: Record<string, unknown>; visibility?: string; campaignId?: string | null; source?: string; sourceUrl?: string | null },
) {
  if (input.id) {
    const rows = await db.query<ContentRow>(`SELECT * FROM content WHERE id = $1`, [input.id]);
    const row = rows[0];
    if (!row) throw notFound();
    if (row.owner_id !== userId) throw forbidden('Это чужая запись — сделайте копию');
    await db.query(
      `UPDATE content SET name = $2, data = $3, visibility = $4, campaign_id = $5, name_lc = $6, updated_at = now() WHERE id = $1`,
      [input.id, input.name, { ...input.data, id: input.id, name: input.name }, input.visibility ?? row.visibility, input.campaignId ?? row.campaign_id, input.name.toLowerCase()],
    );
    return input.id;
  }
  const id = `${input.kind}-${nanoid(10)}`;
  await db.query(
    `INSERT INTO content (id, kind, name, owner_id, campaign_id, visibility, source, source_url, data, name_lc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, input.kind, input.name, userId, input.campaignId ?? null, input.visibility ?? 'private', input.source ?? 'custom', input.sourceUrl ?? null, { ...input.data, id, name: input.name, kind: input.kind }, input.name.toLowerCase()],
  );
  return id;
}

/** Импорт в общую библиотеку: обновляет запись с тем же адресом источника. */
export async function upsertLibraryContent(db: Db, kind: ContentKind, name: string, sourceUrl: string, data: Record<string, unknown>, source = 'dnd.su') {
  const existing = await db.query<{ id: string }>(`SELECT id FROM content WHERE source_url = $1 AND owner_id IS NULL`, [sourceUrl]);
  if (existing[0]) {
    const id = existing[0].id;
    await db.query(`UPDATE content SET name = $2, data = $3, name_lc = $4, updated_at = now() WHERE id = $1`, [id, name, { ...data, id, name, kind, source, sourceUrl }, name.toLowerCase()]);
    return id;
  }
  const id = `${kind}-${nanoid(10)}`;
  await db.query(
    `INSERT INTO content (id, kind, name, owner_id, visibility, source, source_url, data, name_lc) VALUES ($1,$2,$3,NULL,'public',$4,$5,$6,$7)`,
    [id, kind, name, source, sourceUrl, { ...data, id, name, kind, source, sourceUrl }, name.toLowerCase()],
  );
  return id;
}

export async function deleteContent(db: Db, userId: string, id: string, isAdmin: boolean) {
  const rows = await db.query<ContentRow>(`SELECT owner_id FROM content WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound();
  if (rows[0].owner_id !== userId && !(isAdmin && rows[0].owner_id === null)) throw forbidden();
  await db.query(`DELETE FROM content WHERE id = $1`, [id]);
}

/** Индекс контента, нужный для расчёта листа: только то, на что ссылается персонаж. */
export async function contentIndexFor(db: Db, chars: Character[]): Promise<ContentIndex> {
  const ids = new Set<string>();
  for (const c of chars) {
    if (c.raceId) ids.add(c.raceId);
    c.classes.forEach((cl) => ids.add(cl.classId));
    c.inventory.forEach((i) => i.itemId && ids.add(i.itemId));
    c.featIds.forEach((f) => ids.add(f));
  }
  const rows = await getContentMany(db, [...ids]);
  const index: ContentIndex = { races: new Map(), classes: new Map(), spells: new Map(), items: new Map(), feats: new Map() };
  for (const r of rows) {
    const d = r.data as never;
    if (r.kind === 'race') index.races.set(r.id, d);
    else if (r.kind === 'class') index.classes.set(r.id, d);
    else if (r.kind === 'item') index.items.set(r.id, d);
    else if (r.kind === 'feat') index.feats.set(r.id, d as Feature);
  }
  return index;
}

// ---------- Персонажи ----------

export interface CharacterRow {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  data: Character;
  version: number;
  updated_at: string;
}

export async function getCharacter(db: Db, id: string): Promise<CharacterRow> {
  const rows = await db.query<CharacterRow>(`SELECT * FROM characters WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Персонаж не найден');
  return rows[0];
}

export async function saveCharacterData(db: Db, id: string, data: Character, expectedVersion?: number) {
  const rows = await db.query<{ version: number }>(
    `UPDATE characters SET data = $2, version = version + 1, updated_at = now()
     WHERE id = $1 ${expectedVersion !== undefined ? 'AND version = $3' : ''} RETURNING version`,
    expectedVersion !== undefined ? [id, data, expectedVersion] : [id, data],
  );
  return rows[0]?.version ?? null;
}

// ---------- Кампании ----------

export interface CampaignSettings {
  /** Игроки могут сами менять свои хиты */
  playersEditHp: boolean;
  /** Игроки могут сами менять свои деньги */
  playersEditMoney: boolean;
  /** Игроки видят точные хиты врагов */
  showEnemyHp: boolean;
  /** Разрешённый контент (пусто — всё) */
  allowedRaces: string[];
  allowedClasses: string[];
}

export const defaultSettings = (): CampaignSettings => ({
  playersEditHp: true,
  playersEditMoney: true,
  showEnemyHp: false,
  allowedRaces: [],
  allowedClasses: [],
});

export interface CampaignRow {
  id: string;
  name: string;
  description: string;
  dm_id: string;
  invite_code: string;
  settings: CampaignSettings;
  combat: Combat | null;
  created_at: string;
}

export interface Combatant {
  id: string;
  kind: 'character' | 'npc';
  name: string;
  initiative: number;
}

export interface Combat {
  round: number;
  turn: number;
  order: Combatant[];
}

export async function getCampaign(db: Db, id: string): Promise<CampaignRow> {
  const rows = await db.query<CampaignRow>(`SELECT * FROM campaigns WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Кампания не найдена');
  return { ...rows[0], settings: { ...defaultSettings(), ...rows[0].settings } };
}

export async function memberRole(db: Db, campaignId: string, userId: string): Promise<'dm' | 'player' | null> {
  const rows = await db.query<{ role: 'dm' | 'player' }>(`SELECT role FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`, [campaignId, userId]);
  return rows[0]?.role ?? null;
}

// ---------- NPC и враги ----------

export interface NpcData {
  name: string;
  monsterId?: string;
  ac: number;
  maxHp: number;
  hp: number;
  tempHp: number;
  conditions: string[];
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
  initiativeBonus: number;
  /** Скрыт от игроков (засада, ещё не появился) */
  hidden: boolean;
  /** Союзник: игроки видят его хиты */
  ally: boolean;
  notes: string;
  /** Снимок статблока на момент создания, чтобы мастер видел действия под рукой */
  statblock?: Record<string, unknown>;
}

export interface NpcRow {
  id: string;
  campaign_id: string;
  data: NpcData;
  created_at: string;
}

export async function getNpc(db: Db, id: string): Promise<NpcRow> {
  const rows = await db.query<NpcRow>(`SELECT * FROM npcs WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Существо не найдено');
  return rows[0];
}

/** Что видит игрок о враге: без цифр, только самочувствие. */
export function npcForPlayers(npc: NpcRow, settings: CampaignSettings) {
  const d = npc.data;
  const ratio = d.maxHp > 0 ? d.hp / d.maxHp : 0;
  const status = d.hp <= 0 ? 'down' : ratio <= 0.25 ? 'critical' : ratio <= 0.5 ? 'bloodied' : ratio < 1 ? 'hurt' : 'healthy';
  const exact = settings.showEnemyHp || d.ally;
  return {
    id: npc.id,
    campaign_id: npc.campaign_id,
    data: {
      name: d.name,
      conditions: d.conditions,
      ally: d.ally,
      status,
      ...(exact ? { hp: d.hp, maxHp: d.maxHp, tempHp: d.tempHp, ac: d.ac } : {}),
    },
  };
}
