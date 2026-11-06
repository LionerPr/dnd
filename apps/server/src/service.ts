import { computeSheet, type Character } from '@dnd/rules-engine';
import type { AppDeps } from './app.js';
import type { User } from './auth.js';
import { applyToCharacter, applyToNpc, DM_COMMANDS, HP_COMMANDS, MONEY_COMMANDS, type Command } from './commands.js';
import type { Db } from './db.js';
import { forbidden } from './errors.js';
import {
  contentIndexFor,
  getCampaign,
  getCharacter,
  getNpc,
  memberRole,
  npcForPlayers,
  saveCharacterData,
  type CharacterRow,
  type NpcRow,
} from './repo.js';

export interface EventRow {
  id: string;
  campaign_id: string | null;
  actor_id: string | null;
  target_kind: string;
  target_id: string;
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  undone: boolean;
  hidden: boolean;
  created_at: string;
}

export async function logEvent(
  db: Db,
  e: { campaignId: string | null; actorId: string; targetKind: string; targetId: string; type: string; summary: string; payload?: unknown; before?: unknown; hidden?: boolean },
): Promise<EventRow> {
  const rows = await db.query<EventRow>(
    `INSERT INTO events (campaign_id, actor_id, target_kind, target_id, type, summary, payload, before, hidden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id::text, campaign_id, actor_id, target_kind, target_id, type, summary, payload, undone, hidden, created_at`,
    [e.campaignId, e.actorId, e.targetKind, e.targetId, e.type, e.summary, e.payload ?? {}, e.before ?? null, e.hidden ?? false],
  );
  return rows[0]!;
}

export function emitEvent(rt: AppDeps['rt'], ev: EventRow) {
  if (!ev.campaign_id) return;
  if (ev.hidden) rt.dm(ev.campaign_id, 'event', ev);
  else rt.all(ev.campaign_id, 'event', ev);
}

export function namesFor(c: Character, index: Awaited<ReturnType<typeof contentIndexFor>>) {
  const race = c.raceId ? index.races.get(c.raceId) : undefined;
  return {
    race: race?.name,
    subrace: race?.subraces?.find((s) => s.id === c.subraceId)?.name,
    classes: c.classes.map((cl) => {
      const cls = index.classes.get(cl.classId);
      return { id: cl.classId, name: cls?.name ?? '?', level: cl.level, subclass: cls?.subclasses.find((s) => s.id === cl.subclassId)?.name };
    }),
  };
}

export async function characterView(db: Db, row: CharacterRow) {
  const index = await contentIndexFor(db, [row.data]);
  return {
    id: row.id, ownerId: row.owner_id, campaignId: row.campaign_id, version: row.version, data: row.data,
    sheet: computeSheet(row.data, index), names: namesFor(row.data, index),
  };
}

export async function broadcastCharacter(deps: AppDeps, row: CharacterRow) {
  const view = await characterView(deps.db, row);
  if (row.campaign_id) deps.rt.all(row.campaign_id, 'character', view);
  deps.rt.character(row.id, 'character', view);
  return view;
}

/** Кто может что делать с персонажем. */
export async function characterAccess(db: Db, user: User, row: CharacterRow) {
  const owner = row.owner_id === user.id;
  const role = row.campaign_id ? await memberRole(db, row.campaign_id, user.id) : null;
  return { owner, dm: role === 'dm', member: !!role, canView: owner || !!role, canEdit: owner || role === 'dm' };
}

export async function runCharacterCommand(deps: AppDeps, user: User, characterId: string, cmd: Command) {
  const { db } = deps;
  return db.tx(async (tx) => {
    const row = await getCharacter(tx, characterId);
    const access = await characterAccess(tx, user, row);
    if (!access.canEdit) throw forbidden('Это не ваш персонаж');
    if (!access.dm && row.campaign_id) {
      const camp = await getCampaign(tx, row.campaign_id);
      if (DM_COMMANDS.has(cmd.type)) throw forbidden('Это решает мастер');
      if (HP_COMMANDS.has(cmd.type) && !camp.settings.playersEditHp) throw forbidden('Хиты в этой кампании меняет мастер');
      if (MONEY_COMMANDS.has(cmd.type) && !camp.settings.playersEditMoney) throw forbidden('Деньги и предметы в этой кампании выдаёт мастер');
    }
    const index = await contentIndexFor(tx, [row.data]);
    const result = applyToCharacter(row.data, cmd, index, deps.rng);
    const version = await saveCharacterData(tx, row.id, result.data);
    const ev = await logEvent(tx, {
      campaignId: row.campaign_id,
      actorId: user.id,
      targetKind: 'character',
      targetId: row.id,
      type: cmd.type,
      summary: result.summary,
      payload: { command: cmd, ...result.details },
      before: row.data,
    });
    return { row: { ...row, data: result.data, version: version ?? row.version + 1 }, ev };
  });
}

export async function broadcastNpc(deps: AppDeps, npc: NpcRow) {
  const camp = await getCampaign(deps.db, npc.campaign_id);
  deps.rt.dm(npc.campaign_id, 'npc', npc);
  if (npc.data.hidden) deps.rt.players(npc.campaign_id, 'npc-removed', { id: npc.id });
  else deps.rt.players(npc.campaign_id, 'npc', npcForPlayers(npc, camp.settings));
}

export async function runNpcCommand(deps: AppDeps, user: User, npcId: string, cmd: Command) {
  return deps.db.tx(async (tx) => {
    const npc = await getNpc(tx, npcId);
    if ((await memberRole(tx, npc.campaign_id, user.id)) !== 'dm') throw forbidden('Существами управляет мастер');
    const result = applyToNpc(npc.data, cmd);
    await tx.query(`UPDATE npcs SET data = $2 WHERE id = $1`, [npc.id, result.data]);
    const ev = await logEvent(tx, {
      campaignId: npc.campaign_id,
      actorId: user.id,
      targetKind: 'npc',
      targetId: npc.id,
      type: cmd.type,
      summary: result.summary,
      payload: { command: cmd },
      before: npc.data,
      hidden: npc.data.hidden,
    });
    return { npc: { ...npc, data: result.data }, ev };
  });
}

export function freshCharacter(id: string, name: string): Character {
  return {
    id,
    name,
    classes: [],
    baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    choices: {},
    overrides: {},
    extraFeatures: [],
    featIds: [],
    spellsKnown: [],
    spellsPrepared: [],
    inventory: [],
    optionalFeatures: [],
    hpRolls: [],
    languages: [],
    state: {
      hp: 0, tempHp: 0, maxHpModifier: 0, deathSaves: { success: 0, failure: 0 }, dead: false, conditions: [], exhaustion: 0,
      hitDiceUsed: {}, spellSlotsUsed: {}, pactSlotsUsed: 0, resourcesUsed: {}, inspiration: false,
      money: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, xp: 0,
    },
  };
}
