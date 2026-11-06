import { average, computeSheet, roll, type Monster } from '@dnd/rules-engine';
import type { Api } from '../http.js';
import { customAlphabet, nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { requireUser, type User } from '../auth.js';
import { CommandSchema } from '../commands.js';
import { forbidden, HttpError, notFound } from '../errors.js';
import {
  contentIndexFor,
  defaultSettings,
  getCampaign,
  getCharacter,
  getContent,
  getNpc,
  memberRole,
  npcForPlayers,
  type CampaignRow,
  type CharacterRow,
  type Combat,
  type NpcData,
  type NpcRow,
} from '../repo.js';
import {
  broadcastCharacter,
  broadcastNpc,
  characterView,
  emitEvent,
  freshCharacter,
  logEvent,
  namesFor,
  runCharacterCommand,
  runNpcCommand,
  type EventRow,
} from '../service.js';

const inviteCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

const Settings = z.object({
  playersEditHp: z.boolean(),
  playersEditMoney: z.boolean(),
  showEnemyHp: z.boolean(),
  allowedRaces: z.array(z.string()),
  allowedClasses: z.array(z.string()),
}).partial();


/** Бой глазами игроков: без скрытых существ; если ходит скрытое — подсветки хода нет (turn = -1). */
function combatForPlayers(combat: Combat, hidden: Set<string>): Combat {
  const current = combat.order[combat.turn]?.id;
  const order = combat.order.filter((o) => !hidden.has(o.id));
  return { ...combat, order, turn: order.findIndex((o) => o.id === current) };
}

const NpcInput = z.object({
  name: z.string().min(1).max(100),
  ac: z.number().int().min(0).max(50),
  maxHp: z.number().int().min(1).max(10000),
  hp: z.number().int().min(0).max(10000).optional(),
  tempHp: z.number().int().min(0).optional(),
  conditions: z.array(z.string()).optional(),
  resistances: z.array(z.string()).optional(),
  immunities: z.array(z.string()).optional(),
  vulnerabilities: z.array(z.string()).optional(),
  initiativeBonus: z.number().int().min(-10).max(30).optional(),
  hidden: z.boolean().optional(),
  ally: z.boolean().optional(),
  hpView: z.enum(['exact', 'status', 'none']).nullable().optional(),
  notes: z.string().max(5000).optional(),
  monsterId: z.string().optional(),
  statblock: z.record(z.string(), z.unknown()).optional(),
});

async function requireDm(deps: AppDeps, campaignId: string, user: User) {
  if ((await memberRole(deps.db, campaignId, user.id)) !== 'dm') throw forbidden('Это может только мастер');
}

async function requireMember(deps: AppDeps, campaignId: string, user: User) {
  const role = await memberRole(deps.db, campaignId, user.id);
  if (!role) throw forbidden('Вы не участник этой кампании');
  return role;
}

function npcFromMonster(m: Monster, name: string, rollHp: boolean, rng: () => number): NpcData {
  const hp = rollHp && m.hpFormula ? Math.max(1, roll(m.hpFormula, rng).total) : m.hp || (m.hpFormula ? average(m.hpFormula) : 1);
  return {
    name,
    monsterId: m.id,
    ac: m.ac,
    maxHp: hp,
    hp,
    tempHp: 0,
    conditions: [],
    resistances: m.resistances ?? [],
    immunities: m.immunities ?? [],
    vulnerabilities: m.vulnerabilities ?? [],
    initiativeBonus: Math.floor(((m.abilities?.dex ?? 10) - 10) / 2),
    hidden: false,
    ally: false,
    notes: '',
    statblock: m as unknown as Record<string, unknown>,
  };
}

export function campaignRoutes(api: Api, deps: AppDeps) {
  const { db, rt } = deps;

  async function snapshot(campaignId: string, user: User) {
    const role = await requireMember(deps, campaignId, user);
    const camp = await getCampaign(db, campaignId);
    const members = await db.query<{ user_id: string; role: string; display_name: string }>(
      `SELECT m.user_id, m.role, u.display_name FROM campaign_members m JOIN users u ON u.id = m.user_id WHERE m.campaign_id = $1 ORDER BY m.joined_at`,
      [campaignId],
    );
    const chars = await db.query<CharacterRow>(`SELECT * FROM characters WHERE campaign_id = $1 ORDER BY updated_at`, [campaignId]);
    const index = await contentIndexFor(db, chars.map((c) => c.data));
    const characters = chars.map((r) => ({ id: r.id, ownerId: r.owner_id, campaignId: r.campaign_id, version: r.version, data: r.data, sheet: computeSheet(r.data, index), names: namesFor(r.data, index) }));
    const npcRows = await db.query<NpcRow>(`SELECT * FROM npcs WHERE campaign_id = $1 ORDER BY created_at`, [campaignId]);
    const npcs = role === 'dm' ? npcRows : npcRows.filter((n) => !n.data.hidden).map((n) => npcForPlayers(n, camp.settings));
    const achievements = await db.query(`SELECT * FROM achievements WHERE campaign_id = $1 ORDER BY created_at`, [campaignId]);
    const awards = await db.query(
      `SELECT aw.* FROM achievement_awards aw JOIN achievements a ON a.id = aw.achievement_id WHERE a.campaign_id = $1 ORDER BY aw.awarded_at DESC`,
      [campaignId],
    );
    const events = await db.query<EventRow>(
      `SELECT id::text, campaign_id, actor_id, target_kind, target_id, type, summary, payload, undone, hidden, created_at FROM events
       WHERE campaign_id = $1 ${role === 'dm' ? '' : 'AND NOT hidden'} ORDER BY id DESC LIMIT 100`,
      [campaignId],
    );
    return {
      campaign: { id: camp.id, name: camp.name, description: camp.description, dmId: camp.dm_id, settings: camp.settings, combat: camp.combat && role !== 'dm' ? combatForPlayers(camp.combat, new Set(npcRows.filter((n) => n.data.hidden).map((n) => n.id))) : camp.combat, inviteCode: role === 'dm' ? camp.invite_code : undefined },
      role,
      members: members.map((m) => ({ userId: m.user_id, role: m.role, displayName: m.display_name })),
      characters,
      npcs,
      achievements,
      awards,
      events,
    };
  }

  async function broadcastCombat(camp: Pick<CampaignRow, 'id'>, combat: Combat | null) {
    if (!combat) return rt.all(camp.id, 'combat', null);
    rt.dm(camp.id, 'combat', combat);
    const hidden = new Set(
      (await db.query<{ id: string }>(`SELECT id FROM npcs WHERE campaign_id = $1 AND (data->>'hidden')::boolean`, [camp.id])).map((r) => r.id),
    );
    rt.players(camp.id, 'combat', combatForPlayers(combat, hidden));
  }

  // ---------- Кампании ----------

  api.get('/campaigns', async (req) => {
    const user = requireUser(req);
    const rows = await db.query(
      `SELECT c.id, c.name, c.description, m.role, (SELECT count(*)::int FROM characters ch WHERE ch.campaign_id = c.id) AS characters,
         u.display_name AS dm_name
       FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id JOIN users u ON u.id = c.dm_id
       WHERE m.user_id = $1 ORDER BY c.created_at DESC`,
      [user.id],
    );
    return { campaigns: rows };
  });

  api.post('/campaigns', async (req) => {
    const user = requireUser(req);
    const body = z.object({ name: z.string().min(1).max(100), description: z.string().max(5000).optional() }).parse(req.body);
    const id = nanoid(10);
    await db.tx(async (tx) => {
      await tx.query(`INSERT INTO campaigns (id, name, description, dm_id, invite_code, settings) VALUES ($1,$2,$3,$4,$5,$6)`, [
        id, body.name, body.description ?? '', user.id, inviteCode(), defaultSettings(),
      ]);
      await tx.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [id, user.id]);
    });
    return snapshot(id, user);
  });

  api.get('/campaigns/:id', async (req) => snapshot((req.params as { id: string }).id, requireUser(req)));

  api.put('/campaigns/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await requireDm(deps, id, user);
    const body = z.object({ name: z.string().min(1).max(100).optional(), description: z.string().max(5000).optional(), settings: Settings.optional() }).parse(req.body);
    const camp = await getCampaign(db, id);
    await db.query(`UPDATE campaigns SET name = $2, description = $3, settings = $4 WHERE id = $1`, [
      id, body.name ?? camp.name, body.description ?? camp.description, { ...camp.settings, ...body.settings },
    ]);
    rt.all(id, 'campaign-changed', {});
    return snapshot(id, user);
  });

  api.post('/campaigns/:id/new-invite', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await requireDm(deps, id, user);
    const code = inviteCode();
    await db.query(`UPDATE campaigns SET invite_code = $2 WHERE id = $1`, [id, code]);
    return { inviteCode: code };
  });

  api.delete('/campaigns/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await requireDm(deps, id, user);
    await db.query(`DELETE FROM campaigns WHERE id = $1`, [id]);
    rt.all(id, 'campaign-deleted', {});
    return { ok: true };
  });

  api.post('/campaigns/join', async (req) => {
    const user = requireUser(req);
    const body = z
      .object({ code: z.string().min(4).max(12), characterId: z.string().optional(), newCharacter: z.string().trim().min(1).max(100).optional() })
      .parse(req.body);
    const { code } = body;
    let characterId = body.characterId;
    const rows = await db.query<{ id: string }>(`SELECT id FROM campaigns WHERE invite_code = $1`, [code.trim().toUpperCase()]);
    const camp = rows[0];
    if (!camp) throw new HttpError(404, 'Кампания с таким кодом не найдена');
    const role = await memberRole(db, camp.id, user.id);
    if (!role) await db.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [camp.id, user.id]);
    // Новый герой создаётся только после проверки кода, чтобы не плодить лишних
    if (!characterId && body.newCharacter) {
      characterId = nanoid(12);
      await db.query(`INSERT INTO characters (id, owner_id, data) VALUES ($1, $2, $3)`, [characterId, user.id, freshCharacter(characterId, body.newCharacter)]);
    }
    if (characterId) {
      const ch = await getCharacter(db, characterId);
      if (ch.owner_id !== user.id) throw forbidden();
      if (ch.campaign_id && ch.campaign_id !== camp.id) rt.all(ch.campaign_id, 'character-removed', { id: ch.id });
      await db.query(`UPDATE characters SET campaign_id = $2 WHERE id = $1`, [characterId, camp.id]);
      await broadcastCharacter(deps, { ...ch, campaign_id: camp.id });
    }
    const snap = await snapshot(camp.id, user);
    rt.all(camp.id, 'campaign-changed', {});
    return { ...snap, characterId: characterId ?? null };
  });

  api.post('/campaigns/:id/characters', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await requireMember(deps, id, user);
    const { characterId } = z.object({ characterId: z.string() }).parse(req.body);
    const ch = await getCharacter(db, characterId);
    if (ch.owner_id !== user.id) throw forbidden();
    await db.query(`UPDATE characters SET campaign_id = $2 WHERE id = $1`, [characterId, id]);
    await broadcastCharacter(deps, { ...ch, campaign_id: id });
    return snapshot(id, user);
  });

  api.delete('/campaigns/:id/characters/:characterId', async (req) => {
    const user = requireUser(req);
    const { id, characterId } = req.params as { id: string; characterId: string };
    const ch = await getCharacter(db, characterId);
    const role = await memberRole(db, id, user.id);
    if (ch.campaign_id !== id || (ch.owner_id !== user.id && role !== 'dm')) throw forbidden();
    await db.query(`UPDATE characters SET campaign_id = NULL WHERE id = $1`, [characterId]);
    rt.all(id, 'character-removed', { id: characterId });
    return { ok: true };
  });

  api.delete('/campaigns/:id/members/:userId', async (req) => {
    const user = requireUser(req);
    const { id, userId } = req.params as { id: string; userId: string };
    if (userId !== user.id) await requireDm(deps, id, user);
    const camp = await getCampaign(db, id);
    if (userId === camp.dm_id) throw new HttpError(400, 'Мастер не может покинуть свою кампанию');
    await db.query(`UPDATE characters SET campaign_id = NULL WHERE campaign_id = $1 AND owner_id = $2`, [id, userId]);
    await db.query(`DELETE FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`, [id, userId]);
    rt.all(id, 'campaign-changed', {});
    return { ok: true };
  });

  // ---------- Массовые команды мастера ----------

  api.post('/campaigns/:id/command', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await requireDm(deps, id, user);
    const body = z
      .object({ targets: z.array(z.object({ kind: z.enum(['character', 'npc']), id: z.string() })).min(1).max(50), command: CommandSchema })
      .parse(req.body);
    const results = [];
    for (const t of body.targets) {
      try {
        if (t.kind === 'character') {
          const ch = await getCharacter(db, t.id);
          if (ch.campaign_id !== id) throw forbidden();
          const { row, ev } = await runCharacterCommand(deps, user, t.id, body.command);
          emitEvent(rt, ev);
          await broadcastCharacter(deps, row);
          results.push({ ...t, ok: true, summary: ev.summary });
        } else {
          const npc = await getNpc(db, t.id);
          if (npc.campaign_id !== id) throw forbidden();
          const r = await runNpcCommand(deps, user, t.id, body.command);
          emitEvent(rt, r.ev);
          await broadcastNpc(deps, r.npc);
          results.push({ ...t, ok: true, summary: r.ev.summary });
        }
      } catch (e) {
        results.push({ ...t, ok: false, error: (e as Error).message });
      }
    }
    return { results };
  });

  // ---------- Враги и NPC ----------

  api.post('/campaigns/:id/npcs', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await requireDm(deps, id, user);
    const body = z
      .object({ monsterId: z.string().optional(), count: z.number().int().min(1).max(30).optional(), rollHp: z.boolean().optional(), name: z.string().max(100).optional(), npc: NpcInput.optional(), hidden: z.boolean().optional(), hpView: z.enum(['exact', 'status', 'none']).optional() })
      .parse(req.body);
    const created: NpcRow[] = [];
    const count = body.count ?? 1;
    let base: (n: number) => NpcData;
    if (body.monsterId) {
      const m = (await getContent(db, user.id, body.monsterId)).data as unknown as Monster;
      const baseName = body.name || m.name;
      base = (n) => ({ ...npcFromMonster(m, count > 1 ? `${baseName} ${n}` : baseName, !!body.rollHp, deps.rng), hidden: !!body.hidden, ...(body.hpView ? { hpView: body.hpView } : {}) });
    } else if (body.npc) {
      const d = body.npc;
      base = (n) => ({
        name: count > 1 ? `${d.name} ${n}` : d.name,
        ac: d.ac, maxHp: d.maxHp, hp: d.hp ?? d.maxHp, tempHp: d.tempHp ?? 0, conditions: d.conditions ?? [],
        resistances: d.resistances ?? [], immunities: d.immunities ?? [], vulnerabilities: d.vulnerabilities ?? [],
        initiativeBonus: d.initiativeBonus ?? 0, hidden: d.hidden ?? !!body.hidden, ally: d.ally ?? false, notes: d.notes ?? '', statblock: d.statblock, monsterId: d.monsterId,
        ...(d.hpView || body.hpView ? { hpView: (d.hpView ?? body.hpView)! } : {}),
      });
    } else throw new HttpError(400, 'Нужен монстр из бестиария или данные существа');
    // Одинаковые имена выглядят как дубли карточек — нумеруем: «Гоблин 2», «Гоблин 3»…
    const taken = new Set((await db.query<{ name: string }>(`SELECT data->>'name' AS name FROM npcs WHERE campaign_id = $1`, [id])).map((r) => r.name));
    const uniqueName = (name: string) => {
      if (!taken.has(name)) return name;
      const stem = name.replace(/ \d+$/, '');
      let k = 2;
      while (taken.has(`${stem} ${k}`)) k++;
      return `${stem} ${k}`;
    };
    for (let n = 1; n <= count; n++) {
      const data = base(n);
      data.name = uniqueName(data.name);
      taken.add(data.name);
      const row: NpcRow = { id: nanoid(10), campaign_id: id, data, created_at: new Date().toISOString() };
      await db.query(`INSERT INTO npcs (id, campaign_id, data) VALUES ($1, $2, $3)`, [row.id, id, row.data]);
      created.push(row);
      await broadcastNpc(deps, row);
    }
    return { npcs: created };
  });

  api.put('/npcs/:id', async (req) => {
    const user = requireUser(req);
    const npc = await getNpc(db, (req.params as { id: string }).id);
    await requireDm(deps, npc.campaign_id, user);
    const patch = NpcInput.partial().parse(req.body);
    const data = { ...npc.data, ...patch } as NpcData;
    if (patch.hpView === null) delete data.hpView;
    data.hp = Math.min(data.hp, data.maxHp);
    await db.query(`UPDATE npcs SET data = $2 WHERE id = $1`, [npc.id, data]);
    const row = { ...npc, data };
    await broadcastNpc(deps, row);
    if (npc.data.hidden !== data.hidden) {
      const camp = await getCampaign(db, npc.campaign_id);
      if (camp.combat) await broadcastCombat(camp, camp.combat);
    }
    return { npc: row };
  });

  api.delete('/npcs/:id', async (req) => {
    const user = requireUser(req);
    const npc = await getNpc(db, (req.params as { id: string }).id);
    await requireDm(deps, npc.campaign_id, user);
    await db.query(`DELETE FROM npcs WHERE id = $1`, [npc.id]);
    rt.all(npc.campaign_id, 'npc-removed', { id: npc.id });
    const camp = await getCampaign(db, npc.campaign_id);
    if (camp.combat) {
      const order = camp.combat.order.filter((o) => o.id !== npc.id);
      const combat = { ...camp.combat, order, turn: Math.min(camp.combat.turn, Math.max(0, order.length - 1)) };
      await db.query(`UPDATE campaigns SET combat = $2 WHERE id = $1`, [camp.id, combat]);
      await broadcastCombat(camp, combat);
    }
    return { ok: true };
  });

  api.post('/npcs/:id/command', async (req) => {
    const user = requireUser(req);
    const cmd = CommandSchema.parse((req.body as { command?: unknown })?.command);
    const { npc, ev } = await runNpcCommand(deps, user, (req.params as { id: string }).id, cmd);
    emitEvent(rt, ev);
    await broadcastNpc(deps, npc);
    return { npc, event: ev };
  });

  // ---------- Бой и инициатива ----------

  api.post('/campaigns/:id/combat', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await requireDm(deps, id, user);
    const body = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('start'), npcIds: z.array(z.string()).optional(), characterIds: z.array(z.string()).optional() }),
        z.object({ action: z.literal('next') }),
        z.object({ action: z.literal('prev') }),
        z.object({ action: z.literal('end') }),
        z.object({ action: z.literal('set_initiative'), targetId: z.string(), initiative: z.number().int().min(-10).max(60) }),
        z.object({ action: z.literal('add'), kind: z.enum(['character', 'npc']), targetId: z.string(), initiative: z.number().int().optional() }),
        z.object({ action: z.literal('remove'), targetId: z.string() }),
      ])
      .parse(req.body);
    const camp = await getCampaign(db, id);
    let combat: Combat | null = camp.combat;
    const d20 = () => roll('1к20', deps.rng).total;
    const sort = (c: Combat) => ({ ...c, order: [...c.order].sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name)) });

    const chars = await db.query<CharacterRow>(`SELECT * FROM characters WHERE campaign_id = $1`, [id]);
    const index = await contentIndexFor(db, chars.map((c) => c.data));
    const charInit = (c: CharacterRow) => computeSheet(c.data, index).initiative;
    const npcRows = await db.query<NpcRow>(`SELECT * FROM npcs WHERE campaign_id = $1`, [id]);

    let summary = '';
    switch (body.action) {
      case 'start': {
        const cs = chars.filter((c) => !body.characterIds || body.characterIds.includes(c.id));
        const ns = npcRows.filter((n) => (body.npcIds ? body.npcIds.includes(n.id) : n.data.hp > 0));
        combat = sort({
          round: 1,
          turn: 0,
          order: [
            ...cs.map((c) => ({ id: c.id, kind: 'character' as const, name: c.data.name, initiative: d20() + charInit(c) })),
            ...ns.map((n) => ({ id: n.id, kind: 'npc' as const, name: n.data.name, initiative: d20() + n.data.initiativeBonus })),
          ],
        });
        summary = 'Бой начался — брошена инициатива';
        break;
      }
      case 'next':
      case 'prev': {
        if (!combat || !combat.order.length) throw new HttpError(400, 'Бой не идёт');
        const step = body.action === 'next' ? 1 : -1;
        let turn = combat.turn + step;
        let round = combat.round;
        if (turn >= combat.order.length) { turn = 0; round += 1; }
        if (turn < 0) { turn = combat.order.length - 1; round = Math.max(1, round - 1); }
        combat = { ...combat, turn, round };
        const who = combat.order[turn]!;
        const hidden = who.kind === 'npc' && npcRows.find((n) => n.id === who.id)?.data.hidden;
        summary = hidden ? '' : `Раунд ${round}: ходит ${who.name}`;
        break;
      }
      case 'end':
        combat = null;
        summary = 'Бой окончен';
        break;
      case 'set_initiative': {
        if (!combat) throw new HttpError(400, 'Бой не идёт');
        const current = combat.order[combat.turn]?.id;
        combat = sort({ ...combat, order: combat.order.map((o) => (o.id === body.targetId ? { ...o, initiative: body.initiative } : o)) });
        combat.turn = Math.max(0, combat.order.findIndex((o) => o.id === current));
        break;
      }
      case 'add': {
        if (!combat) throw new HttpError(400, 'Бой не идёт');
        if (combat.order.some((o) => o.id === body.targetId)) break;
        const current = combat.order[combat.turn]?.id;
        let name = '';
        let init = body.initiative;
        if (body.kind === 'character') {
          const c = chars.find((x) => x.id === body.targetId);
          if (!c) throw notFound();
          name = c.data.name;
          init ??= d20() + charInit(c);
        } else {
          const n = npcRows.find((x) => x.id === body.targetId);
          if (!n) throw notFound();
          name = n.data.name;
          init ??= d20() + n.data.initiativeBonus;
        }
        combat = sort({ ...combat, order: [...combat.order, { id: body.targetId, kind: body.kind, name, initiative: init }] });
        combat.turn = Math.max(0, combat.order.findIndex((o) => o.id === current));
        break;
      }
      case 'remove': {
        if (!combat) throw new HttpError(400, 'Бой не идёт');
        const idx = combat.order.findIndex((o) => o.id === body.targetId);
        const order = combat.order.filter((o) => o.id !== body.targetId);
        let turn = combat.turn;
        if (idx >= 0 && idx < turn) turn -= 1;
        combat = { ...combat, order, turn: Math.min(turn, Math.max(0, order.length - 1)) };
        break;
      }
    }
    await db.query(`UPDATE campaigns SET combat = $2 WHERE id = $1`, [id, combat]);
    await broadcastCombat(camp, combat);
    if (summary) {
      const ev = await logEvent(db, { campaignId: id, actorId: user.id, targetKind: 'campaign', targetId: id, type: 'combat', summary });
      emitEvent(rt, ev);
    }
    return { combat };
  });

  // ---------- Броски ----------

  api.post('/campaigns/:id/roll', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const role = await requireMember(deps, id, user);
    const body = z
      .object({ formula: z.string().min(1).max(60), label: z.string().max(120).optional(), hidden: z.boolean().optional(), characterId: z.string().optional() })
      .parse(req.body);
    let who = user.displayName;
    if (body.characterId) {
      const ch = await getCharacter(db, body.characterId);
      if (ch.campaign_id !== id || (ch.owner_id !== user.id && role !== 'dm')) throw forbidden();
      who = ch.data.name;
    }
    let r;
    try {
      r = roll(body.formula, deps.rng);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const hidden = role === 'dm' && !!body.hidden;
    const ev = await logEvent(db, {
      campaignId: id,
      actorId: user.id,
      targetKind: body.characterId ? 'character' : 'user',
      targetId: body.characterId ?? user.id,
      type: 'roll',
      summary: `${who}${body.label ? ` — ${body.label}` : ''}: ${r.total}`,
      payload: { roll: r, label: body.label },
      hidden,
    });
    emitEvent(rt, ev);
    return { roll: r, event: ev };
  });

  // ---------- Достижения ----------

  const AchievementInput = z.object({ title: z.string().min(1).max(120), description: z.string().max(2000).optional(), icon: z.string().max(40).optional() });

  api.post('/campaigns/:id/achievements', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await requireDm(deps, id, user);
    const body = AchievementInput.parse(req.body);
    const rows = await db.query(`INSERT INTO achievements (id, campaign_id, title, description, icon) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [
      nanoid(10), id, body.title, body.description ?? '', body.icon ?? 'star',
    ]);
    rt.all(id, 'achievement', rows[0]);
    return { achievement: rows[0] };
  });

  api.put('/achievements/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const rows = await db.query<{ campaign_id: string }>(`SELECT campaign_id FROM achievements WHERE id = $1`, [id]);
    if (!rows[0]) throw notFound();
    await requireDm(deps, rows[0].campaign_id, user);
    const body = AchievementInput.parse(req.body);
    const updated = await db.query(`UPDATE achievements SET title = $2, description = $3, icon = $4 WHERE id = $1 RETURNING *`, [
      id, body.title, body.description ?? '', body.icon ?? 'star',
    ]);
    rt.all(rows[0].campaign_id, 'achievement', updated[0]);
    return { achievement: updated[0] };
  });

  api.delete('/achievements/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const rows = await db.query<{ campaign_id: string }>(`SELECT campaign_id FROM achievements WHERE id = $1`, [id]);
    if (!rows[0]) throw notFound();
    await requireDm(deps, rows[0].campaign_id, user);
    await db.query(`DELETE FROM achievements WHERE id = $1`, [id]);
    rt.all(rows[0].campaign_id, 'campaign-changed', {});
    return { ok: true };
  });

  api.post('/achievements/:id/award', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const { characterId, note } = z.object({ characterId: z.string(), note: z.string().max(500).optional() }).parse(req.body);
    const rows = await db.query<{ campaign_id: string; title: string }>(`SELECT campaign_id, title FROM achievements WHERE id = $1`, [id]);
    const ach = rows[0];
    if (!ach) throw notFound();
    await requireDm(deps, ach.campaign_id, user);
    const ch = await getCharacter(db, characterId);
    if (ch.campaign_id !== ach.campaign_id) throw new HttpError(400, 'Персонаж не в этой кампании');
    const award = (
      await db.query(`INSERT INTO achievement_awards (id, achievement_id, character_id, note) VALUES ($1,$2,$3,$4) RETURNING *`, [nanoid(10), id, characterId, note ?? ''])
    )[0];
    const ev = await logEvent(db, {
      campaignId: ach.campaign_id, actorId: user.id, targetKind: 'character', targetId: characterId, type: 'achievement',
      summary: `${ch.data.name} получает достижение «${ach.title}»`, payload: { achievementId: id, awardId: (award as { id: string }).id },
    });
    emitEvent(rt, ev);
    rt.all(ach.campaign_id, 'award', award);
    return { award };
  });

  api.delete('/awards/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const rows = await db.query<{ campaign_id: string }>(
      `SELECT a.campaign_id FROM achievement_awards aw JOIN achievements a ON a.id = aw.achievement_id WHERE aw.id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound();
    await requireDm(deps, rows[0].campaign_id, user);
    await db.query(`DELETE FROM achievement_awards WHERE id = $1`, [id]);
    rt.all(rows[0].campaign_id, 'campaign-changed', {});
    return { ok: true };
  });

  // ---------- Журнал и отмена ----------

  api.get('/campaigns/:id/events', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const role = await requireMember(deps, id, user);
    const { before } = z.object({ before: z.coerce.number().int().optional() }).parse(req.query);
    const events = await db.query(
      `SELECT id::text, campaign_id, actor_id, target_kind, target_id, type, summary, payload, undone, hidden, created_at FROM events
       WHERE campaign_id = $1 ${role === 'dm' ? '' : 'AND NOT hidden'} ${before ? 'AND id < $2' : ''} ORDER BY id DESC LIMIT 100`,
      before ? [id, before] : [id],
    );
    return { events };
  });

  api.post('/events/:id/undo', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const result = await db.tx(async (tx) => {
      const rows = await tx.query<EventRow & { before: unknown }>(`SELECT id::text, campaign_id, actor_id, target_kind, target_id, type, summary, before, undone FROM events WHERE id = $1`, [Number(id)]);
      const ev = rows[0];
      if (!ev || !ev.before || ev.undone) throw new HttpError(400, 'Это действие нельзя отменить');
      const role = ev.campaign_id ? await memberRole(tx, ev.campaign_id, user.id) : null;
      if (role !== 'dm' && ev.actor_id !== user.id) throw forbidden();
      const later = await tx.query(`SELECT 1 FROM events WHERE target_id = $1 AND id > $2 AND NOT undone AND before IS NOT NULL LIMIT 1`, [ev.target_id, id]);
      if (later.length) throw new HttpError(409, 'После этого были другие изменения — отмените сначала их');
      if (ev.target_kind === 'character') await tx.query(`UPDATE characters SET data = $2, version = version + 1 WHERE id = $1`, [ev.target_id, ev.before]);
      else if (ev.target_kind === 'npc') await tx.query(`UPDATE npcs SET data = $2 WHERE id = $1`, [ev.target_id, ev.before]);
      await tx.query(`UPDATE events SET undone = true WHERE id = $1`, [id]);
      return ev;
    });
    if (result.campaign_id) rt.all(result.campaign_id, 'event-undone', { id });
    if (result.target_kind === 'character') await broadcastCharacter(deps, await getCharacter(db, result.target_id));
    if (result.target_kind === 'npc') await broadcastNpc(deps, await getNpc(db, result.target_id));
    return { ok: true };
  });

  // Для страницы персонажа в кампании: полный вид одного персонажа
  api.get('/campaigns/:id/characters/:characterId', async (req) => {
    const user = requireUser(req);
    const { id, characterId } = req.params as { id: string; characterId: string };
    await requireMember(deps, id, user);
    const ch = await getCharacter(db, characterId);
    if (ch.campaign_id !== id) throw notFound();
    return characterView(db, ch);
  });
}
