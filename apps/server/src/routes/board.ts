/**
 * Доска кампании: карта, фишки, рисунки, медиа и музыка — одна запись на кампанию (таблица boards).
 * Клиенты присылают маленькие операции, сервер применяет их к записи и рассылает всем участникам.
 * Скрытые мастером фишки игрокам не уходят.
 */
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { requireUser, type User } from '../auth.js';
import { forbidden, HttpError, notFound } from '../errors.js';
import type { Api } from '../http.js';
import { memberRole } from '../repo.js';

export interface Token {
  id: string;
  /** character — герой (refId — id персонажа), npc — существо из комнаты, custom — просто метка */
  kind: 'character' | 'npc' | 'custom';
  refId?: string;
  label: string;
  x: number;
  y: number;
  /** Размер в клетках: 1 — среднее существо, 2 — большое… */
  size: number;
  color: string;
  imageFileId?: string;
  hidden?: boolean;
  ownerId?: string;
}

export interface Stroke {
  id: string;
  color: string;
  width: number;
  /** Плоский список координат: x1, y1, x2, y2… */
  points: number[];
  authorId: string;
}

export interface MediaPost {
  id: string;
  fileId: string;
  caption?: string;
  authorId: string;
  authorName: string;
  at: string;
}

export interface MusicState {
  trackId: string | null;
  playing: boolean;
  /** Позиция трека (сек) в момент startedAt (мс, часы сервера) */
  offset: number;
  startedAt: number;
  speed: number;
  volume: number;
  /** Длительность плавного перехода, сек */
  fade: number;
}

export interface Board {
  mapFileId: string | null;
  width: number;
  height: number;
  grid: number;
  showGrid: boolean;
  /** Рисовать могут все или только мастер */
  playersDraw: boolean;
  tokens: Token[];
  strokes: Stroke[];
  media: MediaPost[];
  music: MusicState;
  /** Тайлы: «x,y» клетки → цвет. Из них мастер и игроки строят карту прямо на доске */
  tiles: Record<string, string>;
  /** Объекты как в Miro: картинки, заметки, надписи, фигуры */
  items: BoardItem[];
}

export interface BoardItem {
  id: string;
  type: 'image' | 'note' | 'text' | 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  fileId?: string;
  text?: string;
  color?: string;
  authorId: string;
}

export const emptyBoard = (): Board => ({
  mapFileId: null,
  width: 2000,
  height: 1400,
  grid: 70,
  showGrid: true,
  playersDraw: true,
  tokens: [],
  strokes: [],
  media: [],
  music: { trackId: null, playing: false, offset: 0, startedAt: 0, speed: 1, volume: 0.8, fade: 2 },
  tiles: {},
  items: [],
});

const MAX_STROKES = 300;
const MAX_POINTS = 600;
const MAX_MEDIA = 100;
const MAX_TOKENS = 120;
const MAX_TILES = 20000;
const MAX_ITEMS = 200;

const coord = z.number().finite().min(-200000).max(200000);
const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);

const Op = z.discriminatedUnion('t', [
  z.object({ t: z.literal('token-add'), token: z.object({ kind: z.enum(['character', 'npc', 'custom']), refId: z.string().max(40).optional(), label: z.string().max(60), x: coord, y: coord, size: z.number().min(0.5).max(6).optional(), color: color.optional(), imageFileId: z.string().max(40).optional(), hidden: z.boolean().optional() }) }),
  z.object({ t: z.literal('token-move'), id: z.string().max(40), x: coord, y: coord }),
  z.object({ t: z.literal('token-update'), id: z.string().max(40), patch: z.object({ label: z.string().max(60).optional(), size: z.number().min(0.5).max(6).optional(), color: color.optional(), hidden: z.boolean().optional(), imageFileId: z.string().max(40).nullable().optional() }) }),
  z.object({ t: z.literal('token-remove'), id: z.string().max(40) }),
  z.object({ t: z.literal('stroke'), stroke: z.object({ color, width: z.number().min(1).max(40), points: z.array(coord).min(2).max(MAX_POINTS * 2) }) }),
  z.object({ t: z.literal('stroke-remove'), id: z.string().max(40) }),
  z.object({ t: z.literal('strokes-clear') }),
  z.object({ t: z.literal('settings'), mapFileId: z.string().max(40).nullable().optional(), width: z.number().int().min(200).max(12000).optional(), height: z.number().int().min(200).max(12000).optional(), grid: z.number().min(10).max(400).optional(), showGrid: z.boolean().optional(), playersDraw: z.boolean().optional() }),
  z.object({ t: z.literal('media-add'), fileId: z.string().max(40), caption: z.string().max(300).optional() }),
  z.object({ t: z.literal('media-remove'), id: z.string().max(40) }),
  z.object({ t: z.literal('tiles'), cells: z.array(z.tuple([z.number().int().min(-5000).max(5000), z.number().int().min(-5000).max(5000)])).min(1).max(4000), color: color.nullable() }),
  z.object({ t: z.literal('tiles-clear') }),
  z.object({ t: z.literal('item-add'), item: z.object({ type: z.enum(['image', 'note', 'text', 'rect']), x: coord, y: coord, w: z.number().min(10).max(20000), h: z.number().min(10).max(20000), fileId: z.string().max(40).optional(), text: z.string().max(2000).optional(), color: color.optional() }) }),
  z.object({ t: z.literal('item-update'), id: z.string().max(40), patch: z.object({ x: coord.optional(), y: coord.optional(), w: z.number().min(10).max(20000).optional(), h: z.number().min(10).max(20000).optional(), text: z.string().max(2000).optional(), color: color.optional(), z: z.enum(['front', 'back']).optional() }) }),
  z.object({ t: z.literal('item-remove'), id: z.string().max(40) }),
  z.object({ t: z.literal('music'), trackId: z.string().max(40).nullable().optional(), playing: z.boolean().optional(), position: z.number().min(0).max(36000).optional(), speed: z.number().min(0.25).max(3).optional(), volume: z.number().min(0).max(1).optional(), fade: z.number().min(0).max(15).optional() }),
]);
export type BoardOp = z.infer<typeof Op>;

/** Что отправляется участникам: операции уже с id и полными объектами */
export type AppliedOp =
  | { t: 'token-set'; token: Token }
  | { t: 'token-remove'; id: string }
  | { t: 'stroke'; stroke: Stroke }
  | { t: 'stroke-remove'; id: string }
  | { t: 'strokes-clear' }
  | { t: 'settings'; settings: Pick<Board, 'mapFileId' | 'width' | 'height' | 'grid' | 'showGrid' | 'playersDraw'> }
  | { t: 'media-add'; post: MediaPost }
  | { t: 'media-remove'; id: string }
  | { t: 'music'; music: MusicState }
  | { t: 'tiles'; cells: [number, number][]; color: string | null }
  | { t: 'tiles-clear' }
  | { t: 'item-set'; item: BoardItem }
  | { t: 'item-remove'; id: string };

const round = (n: number) => Math.round(n * 10) / 10;

interface Ctx {
  user: User;
  dm: boolean;
  /** Персонажи пользователя в этой кампании */
  myCharacters: Set<string>;
  campaignId: string;
  fileOk: (id: string, kind?: string) => Promise<boolean>;
  now: number;
}

/** Применить операцию к доске. Возвращает, что разослать, или ошибку прав. */
export async function applyOp(b: Board, op: BoardOp, c: Ctx): Promise<AppliedOp[]> {
  const token = (id: string) => {
    const t = b.tokens.find((x) => x.id === id);
    if (!t) throw notFound('Фишка не найдена');
    return t;
  };
  const canMove = (t: Token) => c.dm || (t.kind === 'character' && !!t.refId && c.myCharacters.has(t.refId)) || t.ownerId === c.user.id;
  switch (op.t) {
    case 'token-add': {
      const tk = op.token;
      if (!c.dm && !(tk.kind === 'character' && tk.refId && c.myCharacters.has(tk.refId))) throw forbidden('Игрок может поставить только своего героя');
      if (b.tokens.length >= MAX_TOKENS) throw new HttpError(400, 'На доске слишком много фишек');
      if (tk.kind !== 'custom' && tk.refId) {
        const existing = b.tokens.find((x) => x.kind === tk.kind && x.refId === tk.refId);
        if (existing) {
          existing.x = round(tk.x);
          existing.y = round(tk.y);
          return [{ t: 'token-set', token: existing }];
        }
      }
      if (tk.imageFileId && !(await c.fileOk(tk.imageFileId, 'image'))) throw notFound('Картинка не найдена');
      const t: Token = { id: nanoid(8), kind: tk.kind, refId: tk.refId, label: tk.label, x: round(tk.x), y: round(tk.y), size: tk.size ?? 1, color: tk.color ?? (tk.kind === 'npc' ? '#b33a3a' : '#3a6db3'), imageFileId: tk.imageFileId, hidden: c.dm ? tk.hidden : undefined, ownerId: c.user.id };
      b.tokens.push(t);
      return [{ t: 'token-set', token: t }];
    }
    case 'token-move': {
      const t = token(op.id);
      if (!canMove(t)) throw forbidden('Эту фишку двигает мастер');
      t.x = round(op.x);
      t.y = round(op.y);
      return [{ t: 'token-set', token: t }];
    }
    case 'token-update': {
      const t = token(op.id);
      if (!c.dm && !canMove(t)) throw forbidden('Это может только мастер');
      const p = op.patch;
      if (p.label !== undefined) t.label = p.label;
      if (p.size !== undefined) t.size = p.size;
      if (p.color !== undefined) t.color = p.color;
      if (p.hidden !== undefined && c.dm) t.hidden = p.hidden || undefined;
      if (p.imageFileId !== undefined) {
        if (p.imageFileId && !(await c.fileOk(p.imageFileId, 'image'))) throw notFound('Картинка не найдена');
        t.imageFileId = p.imageFileId ?? undefined;
      }
      return [{ t: 'token-set', token: t }];
    }
    case 'token-remove': {
      const t = token(op.id);
      if (!c.dm && !canMove(t)) throw forbidden('Это может только мастер');
      b.tokens = b.tokens.filter((x) => x.id !== op.id);
      return [{ t: 'token-remove', id: op.id }];
    }
    case 'stroke':
    case 'stroke-remove':
    case 'strokes-clear':
      throw new Error('рисунки хранятся отдельно');
    case 'settings': {
      if (!c.dm) throw forbidden('Это может только мастер');
      if (op.mapFileId !== undefined) {
        if (op.mapFileId && !(await c.fileOk(op.mapFileId, 'image'))) throw notFound('Карта не найдена');
        b.mapFileId = op.mapFileId;
      }
      if (op.width !== undefined) b.width = op.width;
      if (op.height !== undefined) b.height = op.height;
      if (op.grid !== undefined) b.grid = op.grid;
      if (op.showGrid !== undefined) b.showGrid = op.showGrid;
      if (op.playersDraw !== undefined) b.playersDraw = op.playersDraw;
      const { mapFileId, width, height, grid, showGrid, playersDraw } = b;
      return [{ t: 'settings', settings: { mapFileId, width, height, grid, showGrid, playersDraw } }];
    }
    case 'media-add': {
      if (!(await c.fileOk(op.fileId, 'image'))) throw notFound('Картинка не найдена');
      const post: MediaPost = { id: nanoid(8), fileId: op.fileId, caption: op.caption, authorId: c.user.id, authorName: c.user.displayName, at: new Date(c.now).toISOString() };
      b.media.unshift(post);
      if (b.media.length > MAX_MEDIA) b.media = b.media.slice(0, MAX_MEDIA);
      return [{ t: 'media-add', post }];
    }
    case 'media-remove': {
      const p = b.media.find((x) => x.id === op.id);
      if (!p) return [];
      if (!c.dm && p.authorId !== c.user.id) throw forbidden('Убрать чужую картинку может только мастер');
      b.media = b.media.filter((x) => x.id !== op.id);
      return [{ t: 'media-remove', id: op.id }];
    }
    case 'tiles': {
      if (!c.dm && !b.playersDraw) throw forbidden('Мастер выключил рисование для игроков');
      for (const [x, y] of op.cells) {
        const k = `${x},${y}`;
        if (op.color) b.tiles[k] = op.color;
        else delete b.tiles[k];
      }
      if (Object.keys(b.tiles).length > MAX_TILES) throw new HttpError(400, 'Слишком много тайлов на доске');
      return [{ t: 'tiles', cells: op.cells, color: op.color }];
    }
    case 'tiles-clear': {
      if (!c.dm) throw forbidden('Это может только мастер');
      b.tiles = {};
      return [{ t: 'tiles-clear' }];
    }
    case 'item-add': {
      if (!c.dm && !b.playersDraw) throw forbidden('Мастер выключил рисование для игроков');
      if (b.items.length >= MAX_ITEMS) throw new HttpError(400, 'На доске слишком много объектов');
      const it = op.item;
      if (it.type === 'image' && !(it.fileId && (await c.fileOk(it.fileId, 'image')))) throw notFound('Картинка не найдена');
      const z = b.items.reduce((m, x) => Math.max(m, x.z), 0) + 1;
      const item: BoardItem = { id: nanoid(8), type: it.type, x: round(it.x), y: round(it.y), w: round(it.w), h: round(it.h), z, fileId: it.type === 'image' ? it.fileId : undefined, text: it.text, color: it.color, authorId: c.user.id };
      b.items.push(item);
      return [{ t: 'item-set', item }];
    }
    case 'item-update': {
      const item = b.items.find((x) => x.id === op.id);
      if (!item) throw notFound('Объект не найден');
      if (!c.dm && item.authorId !== c.user.id) throw forbidden('Чужой объект двигает мастер');
      const p = op.patch;
      if (p.x !== undefined) item.x = round(p.x);
      if (p.y !== undefined) item.y = round(p.y);
      if (p.w !== undefined) item.w = round(p.w);
      if (p.h !== undefined) item.h = round(p.h);
      if (p.text !== undefined) item.text = p.text;
      if (p.color !== undefined) item.color = p.color;
      if (p.z === 'front') item.z = b.items.reduce((m, x) => Math.max(m, x.z), 0) + 1;
      if (p.z === 'back') item.z = b.items.reduce((m, x) => Math.min(m, x.z), 0) - 1;
      return [{ t: 'item-set', item }];
    }
    case 'item-remove': {
      const item = b.items.find((x) => x.id === op.id);
      if (!item) return [];
      if (!c.dm && item.authorId !== c.user.id) throw forbidden('Убрать чужой объект может только мастер');
      b.items = b.items.filter((x) => x.id !== op.id);
      return [{ t: 'item-remove', id: op.id }];
    }
    case 'music': {
      if (!c.dm) throw forbidden('Музыкой управляет мастер');
      const m = b.music;
      // Текущая позиция по часам сервера — от неё считаем дальше
      const pos = m.playing ? m.offset + ((c.now - m.startedAt) / 1000) * m.speed : m.offset;
      if (op.trackId !== undefined && op.trackId !== m.trackId) {
        if (op.trackId && !(await c.fileOk(op.trackId, 'audio'))) throw notFound('Трек не найден');
        m.trackId = op.trackId;
        m.offset = op.position ?? 0;
      } else {
        m.offset = op.position ?? pos;
      }
      if (op.playing !== undefined) m.playing = op.playing && !!m.trackId;
      if (op.speed !== undefined) m.speed = op.speed;
      if (op.volume !== undefined) m.volume = op.volume;
      if (op.fade !== undefined) m.fade = op.fade;
      m.startedAt = c.now;
      return [{ t: 'music', music: { ...m } }];
    }
  }
}

/** Что из доски видит игрок */
export function boardForPlayers(b: Board): Board {
  return { ...b, tokens: b.tokens.filter((t) => !t.hidden) };
}

function opsForPlayers(ops: AppliedOp[], before: Map<string, boolean>): AppliedOp[] {
  const out: AppliedOp[] = [];
  for (const op of ops) {
    if (op.t === 'token-set') {
      if (!op.token.hidden) out.push(op);
      else if (before.get(op.token.id) === false) out.push({ t: 'token-remove', id: op.token.id });
    } else if (op.t === 'token-remove') {
      if (before.get(op.id) === false) out.push(op);
    } else out.push(op);
  }
  return out;
}

/** Запись доски без рисунков: рисунки — в board_strokes, чтобы частые операции не таскали мегабайты линий */
export async function loadBoard(deps: AppDeps, campaignId: string): Promise<{ board: Board; version: number }> {
  const rows = await deps.db.query<{ data: Board; version: number }>(`SELECT data, version FROM boards WHERE campaign_id = $1`, [campaignId]);
  if (!rows[0]) return { board: emptyBoard(), version: 0 };
  return { board: { ...emptyBoard(), ...rows[0].data, strokes: [] }, version: rows[0].version };
}

async function loadStrokes(deps: AppDeps, campaignId: string): Promise<Stroke[]> {
  const rows = await deps.db.query<{ data: Stroke }>(`SELECT data FROM board_strokes WHERE campaign_id = $1 ORDER BY rowid`, [campaignId]);
  return rows.map((r) => r.data);
}

const STROKE_OPS = new Set(['stroke', 'stroke-remove', 'strokes-clear']);

async function applyStrokeOp(deps: AppDeps, campaignId: string, op: BoardOp, c: { user: User; dm: boolean; playersDraw: boolean }): Promise<AppliedOp[]> {
  const { db } = deps;
  if (op.t === 'stroke') {
    if (!c.dm && !c.playersDraw) throw forbidden('Мастер выключил рисование для игроков');
    const pts = op.stroke.points.length % 2 ? op.stroke.points.slice(0, -1) : op.stroke.points;
    const st: Stroke = { id: nanoid(8), color: op.stroke.color, width: op.stroke.width, points: pts.map(round), authorId: c.user.id };
    await db.query(`INSERT INTO board_strokes (id, campaign_id, author_id, data) VALUES ($1, $2, $3, $4)`, [st.id, campaignId, c.user.id, st]);
    await db.query(
      `DELETE FROM board_strokes WHERE campaign_id = $1 AND rowid NOT IN (SELECT rowid FROM board_strokes WHERE campaign_id = $1 ORDER BY rowid DESC LIMIT ${MAX_STROKES})`,
      [campaignId],
    );
    return [{ t: 'stroke', stroke: st }];
  }
  if (op.t === 'stroke-remove') {
    const row = (await db.query<{ author_id: string }>(`SELECT author_id FROM board_strokes WHERE id = $1 AND campaign_id = $2`, [op.id, campaignId]))[0];
    if (!row) return [];
    if (!c.dm && row.author_id !== c.user.id) throw forbidden('Стереть чужой рисунок может только мастер');
    await db.query(`DELETE FROM board_strokes WHERE id = $1`, [op.id]);
    return [{ t: 'stroke-remove', id: op.id }];
  }
  if (op.t === 'strokes-clear') {
    if (!c.dm) throw forbidden('Это может только мастер');
    await db.query(`DELETE FROM board_strokes WHERE campaign_id = $1`, [campaignId]);
    return [{ t: 'strokes-clear' }];
  }
  return [];
}

export function boardRoutes(api: Api, deps: AppDeps) {
  const { db, rt } = deps;

  const role = async (campaignId: string, user: User) => {
    const r = await memberRole(db, campaignId, user.id);
    if (!r) throw forbidden('Вы не участник этой кампании');
    return r;
  };

  api.get('/campaigns/:id/board', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const r = await role(id, user);
    const [{ board }, strokes] = await Promise.all([loadBoard(deps, id), loadStrokes(deps, id)]);
    board.strokes = strokes;
    return { board: r === 'dm' ? board : boardForPlayers(board), serverNow: Date.now() };
  });

  api.post('/campaigns/:id/board', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const r = await role(id, user);
    const { ops } = z.object({ ops: z.array(Op).min(1).max(50) }).parse(req.body);
    const mine = new Set((await db.query<{ id: string }>(`SELECT id FROM characters WHERE campaign_id = $1 AND owner_id = $2`, [id, user.id])).map((x) => x.id));
    const fileCache = new Map<string, boolean>();
    const fileOk = async (fid: string, kind?: string) => {
      const key = `${fid}:${kind}`;
      if (!fileCache.has(key)) {
        const f = await db.query<{ kind: string }>(`SELECT kind FROM files WHERE id = $1 AND campaign_id = $2 AND complete = 1`, [fid, id]);
        fileCache.set(key, !!f[0] && (!kind || f[0].kind === kind || (kind === 'image' && f[0].kind === 'map')));
      }
      return fileCache.get(key)!;
    };
    const broadcast = (applied: AppliedOp[], now: number, visibleBefore = new Map<string, boolean>()) => {
      if (!applied.length) return;
      rt.dm(id, 'board', { ops: applied, by: user.id, at: now });
      const forPlayers = opsForPlayers(applied, visibleBefore);
      if (forPlayers.length) rt.players(id, 'board', { ops: forPlayers, by: user.id, at: now });
    };
    // Рисунки — отдельные строки, без перезаписи доски
    const strokeOps = ops.filter((o) => STROKE_OPS.has(o.t));
    const boardOps = ops.filter((o) => !STROKE_OPS.has(o.t));
    const strokeApplied: AppliedOp[] = [];
    if (strokeOps.length) {
      const { board } = await loadBoard(deps, id);
      for (const op of strokeOps) strokeApplied.push(...(await applyStrokeOp(deps, id, op, { user, dm: r === 'dm', playersDraw: board.playersDraw })));
      broadcast(strokeApplied, Date.now());
    }
    if (!boardOps.length) return { ops: strokeApplied, serverNow: Date.now() };
    // Оптимистичная запись: если кто-то успел раньше, перечитываем и применяем заново
    for (let attempt = 0; attempt < 4; attempt++) {
      const { board, version } = await loadBoard(deps, id);
      const visibleBefore = new Map(board.tokens.map((t) => [t.id, !!t.hidden]));
      const now = Date.now();
      const applied: AppliedOp[] = [];
      for (const op of boardOps) applied.push(...(await applyOp(board, op, { user, dm: r === 'dm', myCharacters: mine, campaignId: id, fileOk, now })));
      const { strokes: _drop, ...stored } = board;
      const saved = version === 0
        ? await db.query<{ version: number }>(`INSERT INTO boards (campaign_id, data, version) VALUES ($1, $2, 1) ON CONFLICT(campaign_id) DO NOTHING RETURNING version`, [id, stored])
        : await db.query<{ version: number }>(`UPDATE boards SET data = $2, version = version + 1 WHERE campaign_id = $1 AND version = $3 RETURNING version`, [id, stored, version]);
      if (!saved[0]) continue;
      broadcast(applied, now, visibleBefore);
      return { ops: [...strokeApplied, ...applied], serverNow: now };
    }
    throw new HttpError(409, 'Доску одновременно меняют несколько человек — попробуйте ещё раз');
  });

  /** Мастер показывает картинку всем на весь экран */
  api.post('/campaigns/:id/board/show', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    if ((await role(id, user)) !== 'dm') throw forbidden('Это может только мастер');
    const { fileId, caption } = z.object({ fileId: z.string().max(40), caption: z.string().max(300).optional() }).parse(req.body);
    rt.all(id, 'show', { fileId, caption });
    return { ok: true };
  });
}
