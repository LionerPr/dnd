import type { FastifyInstance } from 'fastify';
import { io as ioClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { openDb, type Db } from './db.js';

process.env.NODE_ENV = 'test';

let app: FastifyInstance;
let db: Db;
const rng = () => 0.5; // d20 → 11, к12 → 7

async function as(cookie: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as never, headers: cookie ? { cookie } : {} });
  return { status: res.statusCode, body: res.json() as any, cookie: res.headers['set-cookie'] };
}

async function signup(username: string) {
  const r = await as(null, 'POST', '/api/auth/register', { username, password: 'secret1', displayName: username });
  expect(r.status).toBe(200);
  const raw = Array.isArray(r.cookie) ? r.cookie[0]! : r.cookie!;
  return { cookie: raw.split(';')[0]!, user: r.body.user };
}

beforeAll(async () => {
  db = await openDb();
  ({ app } = await buildApp(db, { rng, webDist: '/nonexistent' }));
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe('игра целиком', () => {
  let dm: Awaited<ReturnType<typeof signup>>;
  let player: Awaited<ReturnType<typeof signup>>;
  let raceId: string, classId: string, charId: string, campaignId: string, invite: string;

  it('регистрация: первый — администратор, повторный логин занят', async () => {
    dm = await signup('master');
    player = await signup('torin');
    expect(dm.user.isAdmin).toBe(true);
    expect(player.user.isAdmin).toBe(false);
    expect((await as(null, 'POST', '/api/auth/register', { username: 'torin', password: 'secret1' })).status).toBe(409);
    expect((await as(null, 'POST', '/api/auth/login', { username: 'torin', password: 'wrong!!' })).status).toBe(401);
    expect((await as(player.cookie, 'GET', '/api/auth/me')).body.user.username).toBe('torin');
  });

  it('свои раса и класс', async () => {
    const race = await as(player.cookie, 'POST', '/api/content', {
      kind: 'race', name: 'Горный дварф',
      data: { kind: 'race', size: 'medium', speed: 25, features: [{ id: 'asi', name: 'Увеличение характеристик', description: '', effects: [{ type: 'ability_bonus', ability: 'con', value: 2 }] }] },
    });
    expect(race.status).toBe(200);
    raceId = race.body.item.id;
    const cls = await as(player.cookie, 'POST', '/api/content', {
      kind: 'class', name: 'Варвар',
      data: {
        kind: 'class', hitDie: 12, saves: ['str', 'con'], armor: [], weapons: ['simple', 'martial'], tools: [],
        skillChoices: { pick: 2, from: ['athletics', 'perception'] }, levels: [], subclassLevel: 3, subclasses: [],
        features: [{ id: 'rage', name: 'Ярость', description: '', level: 1, effects: [{ type: 'resource', id: 'rage', name: 'Ярость', max: 2, recharge: 'long' }] }],
      },
    });
    classId = cls.body.item.id;
    const list = await as(player.cookie, 'GET', '/api/content?kind=race');
    expect(list.body.items.map((i: { name: string }) => i.name)).toContain('Горный дварф');
    // Чужой приватный контент не виден
    expect((await as(dm.cookie, 'GET', `/api/content/${raceId}`)).status).toBe(404);
  });

  it('персонаж: лист считается сам, хиты полные', async () => {
    const created = await as(player.cookie, 'POST', '/api/characters', { name: 'Торин' });
    charId = created.body.id;
    const data = {
      ...created.body.data,
      raceId,
      classes: [{ classId, level: 1 }],
      baseAbilities: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 10 },
      choices: { [`class.${classId}.skills`]: ['athletics', 'perception'] },
    };
    const saved = await as(player.cookie, 'PUT', `/api/characters/${charId}`, { data, version: created.body.version });
    expect(saved.status).toBe(200);
    expect(saved.body.sheet.maxHp).toBe(12 + 3);
    expect(saved.body.data.state.hp).toBe(15);
    expect(saved.body.sheet.resources[0]).toMatchObject({ id: 'rage', max: 2 });
    // Старая версия — конфликт
    expect((await as(player.cookie, 'PUT', `/api/characters/${charId}`, { data, version: created.body.version })).status).toBe(409);
  });

  it('кампания, приглашение, вход по коду', async () => {
    const c = await as(dm.cookie, 'POST', '/api/campaigns', { name: 'Рудники Фанделвера' });
    campaignId = c.body.campaign.id;
    invite = c.body.campaign.inviteCode;
    expect(invite).toHaveLength(6);
    const joined = await as(player.cookie, 'POST', '/api/campaigns/join', { code: invite.toLowerCase(), characterId: charId });
    expect(joined.status).toBe(200);
    expect(joined.body.role).toBe('player');
    expect(joined.body.campaign.inviteCode).toBeUndefined();
    expect(joined.body.characters).toHaveLength(1);
    // Мастер видит лист игрока
    expect((await as(dm.cookie, 'GET', `/api/characters/${charId}`)).body.access).toMatchObject({ dm: true, canEdit: true });
  });

  it('мастер управляет состоянием, игрок — нет, если запрещено', async () => {
    const hit = await as(dm.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'damage', amount: 7, damageType: 'slashing' } });
    expect(hit.body.data.state.hp).toBe(8);
    expect(hit.body.event.summary).toContain('−7');
    await as(dm.cookie, 'PUT', `/api/campaigns/${campaignId}`, { settings: { playersEditHp: false, playersEditMoney: false } });
    const denied = await as(player.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'heal', amount: 5 } });
    expect(denied.status).toBe(403);
    expect((await as(player.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'xp', amount: 100 } })).status).toBe(403);
    // Ресурсы и отдых игрок ведёт сам
    expect((await as(player.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'resource', id: 'rage', delta: 1 } })).status).toBe(200);
    const money = await as(dm.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'money', delta: { gp: 25, sp: 3 } } });
    expect(money.body.data.state.money).toMatchObject({ gp: 25, sp: 3 });
    const spent = await as(dm.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'spend', amount: 30, coin: 'gp' } });
    expect(spent.status).toBe(400);
    const rest = await as(player.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'short_rest', hitDice: [12] } });
    // к12 при rng 0.5 → 7, +2 Тел = 9 → 8+9 = 17, но не больше 15
    expect(rest.body.data.state.hp).toBe(15);
    const lr = await as(player.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'long_rest' } });
    expect(lr.body.data.state.resourcesUsed).toEqual({});
  });

  it('повышение уровня — только мастер', async () => {
    const up = await as(dm.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'level_up', classId, hp: 'average' } });
    expect(up.status).toBe(200);
    expect(up.body.sheet.level).toBe(2);
    expect(up.body.sheet.maxHp).toBe(15 + 7 + 3);
    expect(up.body.data.state.hp).toBe(25);
  });

  it('враги мастера: пачка, урон без цифр для игроков, скрытые', async () => {
    const created = await as(dm.cookie, 'POST', `/api/campaigns/${campaignId}/npcs`, {
      count: 3, npc: { name: 'Гоблин', ac: 15, maxHp: 7, resistances: [], initiativeBonus: 2 },
    });
    expect(created.body.npcs.map((n: { data: { name: string } }) => n.data.name)).toEqual(['Гоблин 1', 'Гоблин 2', 'Гоблин 3']);
    const g1 = created.body.npcs[0].id;
    const boss = (await as(dm.cookie, 'POST', `/api/campaigns/${campaignId}/npcs`, { npc: { name: 'Кларг', ac: 16, maxHp: 30, hidden: true } })).body.npcs[0].id;
    expect((await as(player.cookie, 'POST', `/api/npcs/${g1}/command`, { command: { type: 'damage', amount: 3 } })).status).toBe(403);
    const mass = await as(dm.cookie, 'POST', `/api/campaigns/${campaignId}/command`, {
      targets: created.body.npcs.map((n: { id: string }) => ({ kind: 'npc', id: n.id })).concat([{ kind: 'character', id: charId }]),
      command: { type: 'damage', amount: 5, damageType: 'fire' },
    });
    expect(mass.body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    const snapPlayer = (await as(player.cookie, 'GET', `/api/campaigns/${campaignId}`)).body;
    expect(snapPlayer.npcs).toHaveLength(3);
    expect(snapPlayer.npcs[0].data).toMatchObject({ name: 'Гоблин 1', status: 'bloodied' });
    expect(snapPlayer.npcs[0].data.hp).toBeUndefined();
    expect(snapPlayer.npcs.some((n: { id: string }) => n.id === boss)).toBe(false);
    const snapDm = (await as(dm.cookie, 'GET', `/api/campaigns/${campaignId}`)).body;
    expect(snapDm.npcs).toHaveLength(4);
    expect(snapDm.npcs[0].data.hp).toBe(2);
  });

  it('бой: инициатива и ходы', async () => {
    const start = await as(dm.cookie, 'POST', `/api/campaigns/${campaignId}/combat`, { action: 'start' });
    expect(start.body.combat.round).toBe(1);
    expect(start.body.combat.order.length).toBe(5);
    let c = start.body.combat;
    for (let i = 0; i < c.order.length; i++) c = (await as(dm.cookie, 'POST', `/api/campaigns/${campaignId}/combat`, { action: 'next' })).body.combat;
    expect(c.round).toBe(2);
    const snapPlayer = (await as(player.cookie, 'GET', `/api/campaigns/${campaignId}`)).body;
    expect(snapPlayer.campaign.combat).toBeTruthy();
    await as(dm.cookie, 'POST', `/api/campaigns/${campaignId}/combat`, { action: 'end' });
  });

  it('достижения выдаёт мастер', async () => {
    const a = await as(dm.cookie, 'POST', `/api/campaigns/${campaignId}/achievements`, { title: 'Сыграть в гольф', description: 'Нанести дробящий удар в голову' });
    expect((await as(player.cookie, 'POST', `/api/achievements/${a.body.achievement.id}/award`, { characterId: charId })).status).toBe(403);
    expect((await as(dm.cookie, 'POST', `/api/achievements/${a.body.achievement.id}/award`, { characterId: charId, note: 'Гоблин 2' })).status).toBe(200);
    const sheet = await as(player.cookie, 'GET', `/api/characters/${charId}`);
    expect(sheet.body.awards[0]).toMatchObject({ title: 'Сыграть в гольф', note: 'Гоблин 2' });
  });

  it('журнал и отмена последнего действия', async () => {
    const before = (await as(dm.cookie, 'GET', `/api/characters/${charId}`)).body.data.state.hp;
    const hit = await as(dm.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'damage', amount: 4 } });
    expect(hit.body.data.state.hp).toBe(before - 4);
    expect((await as(dm.cookie, 'POST', `/api/events/${hit.body.event.id}/undo`)).status).toBe(200);
    expect((await as(dm.cookie, 'GET', `/api/characters/${charId}`)).body.data.state.hp).toBe(before);
    const log = (await as(player.cookie, 'GET', `/api/campaigns/${campaignId}/events`)).body.events;
    expect(log.some((e: { type: string }) => e.type === 'achievement')).toBe(true);
    expect(log.some((e: { hidden: boolean }) => e.hidden)).toBe(false);
  });

  it('скрытый бросок мастера не виден игроку, кубики в русской записи', async () => {
    const r = await as(dm.cookie, 'POST', `/api/campaigns/${campaignId}/roll`, { formula: '2к6+3', label: 'Засада', hidden: true });
    expect(r.body.roll.total).toBe(4 + 4 + 3);
    const log = (await as(player.cookie, 'GET', `/api/campaigns/${campaignId}/events`)).body.events;
    expect(log.some((e: { summary: string }) => e.summary.includes('Засада'))).toBe(false);
    expect((await as(player.cookie, 'POST', `/api/campaigns/${campaignId}/roll`, { formula: 'абв' })).status).toBe(400);
  });

  it('обновления приходят по сокету', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const sock = ioClient(`http://127.0.0.1:${port}`, { extraHeaders: { cookie: player.cookie }, transports: ['websocket'] });
    const joined = await new Promise<{ ok: boolean; role?: string }>((res) => sock.on('connect', () => sock.emit('join', campaignId, res)));
    expect(joined).toEqual({ ok: true, role: 'player' });
    const got = new Promise<any>((res) => sock.on('character', res));
    await as(dm.cookie, 'POST', `/api/characters/${charId}/command`, { command: { type: 'condition', condition: 'poisoned', on: true } });
    const update = await got;
    expect(update.data.state.conditions).toContain('poisoned');
    sock.close();
  });
});
