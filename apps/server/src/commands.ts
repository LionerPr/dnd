import {
  CONDITIONS,
  COINS,
  COIN_ORDER,
  DAMAGE_TYPES,
  abilityMod,
  addCondition,
  addMoney,
  applyDamage,
  computeSheet,
  damageCharacter,
  grantTempHp,
  healCharacter,
  longRest,
  removeCondition,
  roll,
  rollDeathSave,
  shortRest,
  spendMoney,
  type Character,
  type Coin,
  type Condition,
  type ContentIndex,
  type DamageType,
  type Money,
} from '@dnd/rules-engine';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { HttpError } from './errors.js';
import type { NpcData } from './repo.js';

const damageType = z.enum(Object.keys(DAMAGE_TYPES) as [DamageType, ...DamageType[]]);
const condition = z.enum(Object.keys(CONDITIONS) as [Condition, ...Condition[]]);
const coin = z.enum(COIN_ORDER as [Coin, ...Coin[]]);
const int = z.number().int();

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('damage'), amount: int.min(0).max(10000), damageType: damageType.optional(), critical: z.boolean().optional() }),
  z.object({ type: z.literal('heal'), amount: int.min(0).max(10000) }),
  z.object({ type: z.literal('temp_hp'), amount: int.min(0).max(10000) }),
  z.object({ type: z.literal('set_hp'), hp: int.min(0).max(10000) }),
  z.object({ type: z.literal('max_hp_modifier'), value: int.min(-1000).max(1000) }),
  z.object({ type: z.literal('condition'), condition, on: z.boolean() }),
  z.object({ type: z.literal('exhaustion'), value: int.min(0).max(6) }),
  z.object({ type: z.literal('money'), delta: z.partialRecord(coin, int).refine((d) => Object.keys(d).length > 0, 'Пустая сумма') }),
  z.object({ type: z.literal('spend'), amount: int.min(1), coin }),
  z.object({ type: z.literal('xp'), amount: int.min(-1000000).max(1000000) }),
  z.object({ type: z.literal('short_rest'), hitDice: z.array(int.min(1).max(20)).max(20) }),
  z.object({ type: z.literal('long_rest') }),
  z.object({ type: z.literal('death_save') }),
  z.object({ type: z.literal('slot'), level: int.min(1).max(9), pact: z.boolean().optional(), delta: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ type: z.literal('resource'), id: z.string(), delta: int.min(-100).max(100) }),
  z.object({ type: z.literal('inspiration'), value: z.boolean() }),
  z.object({ type: z.literal('concentration'), spell: z.string().max(200).nullable() }),
  z.object({ type: z.literal('give_item'), name: z.string().min(1).max(200), itemId: z.string().optional(), qty: int.min(1).max(10000) }),
  z.object({ type: z.literal('take_item'), entryId: z.string(), qty: int.min(1).max(10000) }),
  z.object({ type: z.literal('level_up'), classId: z.string(), hp: z.union([z.literal('average'), z.literal('roll'), int.min(1).max(20)]), subclassId: z.string().optional() }),
]);
export type Command = z.infer<typeof CommandSchema>;

/** Команды, которые игрок не может применять к себе, если мастер это запретил. */
export const HP_COMMANDS = new Set(['damage', 'heal', 'temp_hp', 'set_hp', 'max_hp_modifier']);
export const MONEY_COMMANDS = new Set(['money', 'spend', 'give_item', 'take_item']);
/** Команды только для мастера (или для владельца вне кампании). */
export const DM_COMMANDS = new Set(['xp', 'level_up']);

const coinsText = (d: Partial<Money>) =>
  COIN_ORDER.filter((c) => d[c])
    .map((c) => `${d[c]! > 0 ? '+' : ''}${d[c]} ${COINS[c].name}`)
    .join(', ');

export interface CommandResult<T> {
  data: T;
  summary: string;
  /** Подробности для лога: броски и т. п. */
  details?: Record<string, unknown>;
}

export function applyToCharacter(c: Character, cmd: Command, content: ContentIndex, rng: () => number = Math.random): CommandResult<Character> {
  const sheet = computeSheet(c, content);
  const s = c.state;
  const defenses = { maxHp: sheet.maxHp, resistances: sheet.resistances, immunities: sheet.immunities, vulnerabilities: sheet.vulnerabilities };
  const done = (state: Character['state'], summary: string, details?: Record<string, unknown>): CommandResult<Character> => ({
    data: { ...c, state },
    summary: `${c.name}: ${summary}`,
    details,
  });

  switch (cmd.type) {
    case 'damage': {
      const r = damageCharacter(s, cmd.amount, cmd.damageType, defenses, cmd.critical);
      const note = r.note === 'immune' ? ' (иммунитет)' : r.note === 'resisted' ? ' (сопротивление)' : r.note === 'vulnerable' ? ' (уязвимость)' : '';
      const type = cmd.damageType ? `, ${DAMAGE_TYPES[cmd.damageType]}` : '';
      const tail = r.state.dead ? ' — погиб' : r.droppedToZero ? ' — без сознания' : '';
      return done(r.state, `−${r.dealt} хитов${type}${note}${tail}`);
    }
    case 'heal': {
      const state = healCharacter(s, cmd.amount, sheet.maxHp);
      return done(state, `+${state.hp - s.hp} хитов`);
    }
    case 'temp_hp':
      return done(grantTempHp(s, cmd.amount), `${cmd.amount} временных хитов`);
    case 'set_hp':
      return done({ ...s, hp: Math.min(cmd.hp, sheet.maxHp) }, `хиты = ${Math.min(cmd.hp, sheet.maxHp)}`);
    case 'max_hp_modifier':
      return done({ ...s, maxHpModifier: cmd.value }, `изменение максимума хитов ${cmd.value >= 0 ? '+' : ''}${cmd.value}`);
    case 'condition': {
      const conditions = cmd.on ? addCondition(s.conditions, cmd.condition) : removeCondition(s.conditions, cmd.condition);
      return done({ ...s, conditions }, `${cmd.on ? '' : 'снято: '}${CONDITIONS[cmd.condition].toLowerCase()}`);
    }
    case 'exhaustion':
      return done({ ...s, exhaustion: cmd.value }, `истощение ${cmd.value}`);
    case 'money': {
      const money = addMoney(s.money, cmd.delta);
      if (COIN_ORDER.some((k) => money[k] < 0)) throw new HttpError(400, 'Столько монет нет');
      return done({ ...s, money }, coinsText(cmd.delta));
    }
    case 'spend': {
      const money = spendMoney(s.money, cmd.amount, cmd.coin);
      if (!money) throw new HttpError(400, 'Не хватает денег');
      return done({ ...s, money }, `потрачено ${cmd.amount} ${COINS[cmd.coin].name}`);
    }
    case 'xp':
      return done({ ...s, xp: Math.max(0, s.xp + cmd.amount) }, `${cmd.amount >= 0 ? '+' : ''}${cmd.amount} опыта`);
    case 'short_rest': {
      const conMod = abilityMod(sheet.abilities.con.score);
      const spent = cmd.hitDice.map((die) => ({ die, roll: roll(`1к${die}`, rng).total }));
      const state = shortRest(s, { maxHp: sheet.maxHp, hitDice: sheet.hitDice, resources: sheet.resources, hasPactMagic: !!sheet.pactSlots }, spent, conMod);
      const healed = state.hp - s.hp;
      return done(state, `короткий отдых${spent.length ? `, потрачено костей хитов: ${spent.length}, +${healed} хитов` : ''}`, { rolls: spent });
    }
    case 'long_rest':
      return done(longRest(s, { maxHp: sheet.maxHp, hitDice: sheet.hitDice, resources: sheet.resources, hasPactMagic: !!sheet.pactSlots }), 'долгий отдых');
    case 'death_save': {
      const d20 = roll('1к20', rng).total;
      const state = rollDeathSave(s, d20);
      const outcome = state.dead ? 'погиб' : state.hp > 0 ? 'приходит в себя с 1 хитом' : d20 >= 10 ? 'успех' : 'провал';
      return done(state, `спасбросок от смерти: ${d20} — ${outcome}`, { d20 });
    }
    case 'slot': {
      if (cmd.pact) {
        const max = sheet.pactSlots?.max ?? 0;
        const used = Math.max(0, Math.min(max, s.pactSlotsUsed + cmd.delta));
        return done({ ...s, pactSlotsUsed: used }, cmd.delta > 0 ? 'потрачена ячейка договора' : 'возвращена ячейка договора');
      }
      const max = sheet.spellSlots.find((x) => x.level === cmd.level)?.max ?? 0;
      if (cmd.delta > 0 && (s.spellSlotsUsed[cmd.level] ?? 0) >= max) throw new HttpError(400, `Ячеек ${cmd.level} уровня не осталось`);
      const used = Math.max(0, Math.min(max, (s.spellSlotsUsed[cmd.level] ?? 0) + cmd.delta));
      return done({ ...s, spellSlotsUsed: { ...s.spellSlotsUsed, [cmd.level]: used } }, `${cmd.delta > 0 ? 'потрачена' : 'возвращена'} ячейка ${cmd.level} уровня`);
    }
    case 'resource': {
      const r = sheet.resources.find((x) => x.id === cmd.id);
      if (!r) throw new HttpError(400, 'Нет такого ресурса');
      const used = Math.max(0, Math.min(r.max, (s.resourcesUsed[cmd.id] ?? 0) + cmd.delta));
      return done({ ...s, resourcesUsed: { ...s.resourcesUsed, [cmd.id]: used } }, `${r.name}: осталось ${r.max - used} из ${r.max}`);
    }
    case 'inspiration':
      return done({ ...s, inspiration: cmd.value }, cmd.value ? 'получает вдохновение' : 'тратит вдохновение');
    case 'concentration':
      return done({ ...s, concentration: cmd.spell ?? undefined }, cmd.spell ? `концентрация: ${cmd.spell}` : 'концентрация прервана');
    case 'give_item': {
      const inventory = [...c.inventory];
      const same = inventory.find((i) => (cmd.itemId ? i.itemId === cmd.itemId : !i.itemId && i.name === cmd.name));
      if (same) Object.assign(same, { qty: same.qty + cmd.qty });
      else inventory.push({ id: nanoid(8), itemId: cmd.itemId, name: cmd.itemId ? undefined : cmd.name, qty: cmd.qty });
      return { data: { ...c, inventory: inventory.map((i) => ({ ...i })) }, summary: `${c.name}: получает «${cmd.name}» ×${cmd.qty}` };
    }
    case 'take_item': {
      const entry = c.inventory.find((i) => i.id === cmd.entryId);
      if (!entry) throw new HttpError(400, 'Нет такого предмета');
      const inventory = c.inventory
        .map((i) => (i.id === cmd.entryId ? { ...i, qty: i.qty - cmd.qty } : i))
        .filter((i) => i.qty > 0);
      const name = entry.name ?? content.items.get(entry.itemId ?? '')?.name ?? 'предмет';
      return { data: { ...c, inventory }, summary: `${c.name}: теряет «${name}» ×${cmd.qty}` };
    }
    case 'level_up': {
      const cls = content.classes.get(cmd.classId);
      if (!cls) throw new HttpError(400, 'Класс не найден');
      const total = sheet.level;
      if (total >= 20) throw new HttpError(400, 'Уже 20 уровень');
      const classes = c.classes.map((x) => ({ ...x }));
      const entry = classes.find((x) => x.classId === cmd.classId);
      if (entry) {
        entry.level += 1;
        if (cmd.subclassId) entry.subclassId = cmd.subclassId;
      } else classes.push({ classId: cmd.classId, level: 1, subclassId: cmd.subclassId });
      const hpRoll = cmd.hp === 'average' ? cls.hitDie / 2 + 1 : cmd.hp === 'roll' ? roll(`1к${cls.hitDie}`, rng).total : cmd.hp;
      const hpRolls = [...c.hpRolls];
      hpRolls[total] = hpRoll;
      const next: Character = { ...c, classes, hpRolls };
      const after = computeSheet(next, content);
      const state = { ...s, hp: s.hp + Math.max(0, after.maxHp - sheet.maxHp) };
      const lvl = entry ? entry.level : 1;
      return { data: { ...next, state }, summary: `${c.name}: ${cls.name} ${lvl} уровня (+${after.maxHp - sheet.maxHp} к максимуму хитов)`, details: { hpRoll } };
    }
  }
}

/** Команды, применимые к врагам и NPC мастера. */
export function applyToNpc(npc: NpcData, cmd: Command): CommandResult<NpcData> {
  const defenses = { maxHp: npc.maxHp, resistances: npc.resistances as DamageType[], immunities: npc.immunities as DamageType[], vulnerabilities: npc.vulnerabilities as DamageType[] };
  switch (cmd.type) {
    case 'damage': {
      const r = applyDamage({ hp: npc.hp, tempHp: npc.tempHp }, cmd.amount, cmd.damageType, defenses);
      const type = cmd.damageType ? `, ${DAMAGE_TYPES[cmd.damageType]}` : '';
      const conditions = r.state.hp === 0 ? [...new Set([...npc.conditions, 'unconscious'])] : npc.conditions;
      return { data: { ...npc, ...r.state, conditions }, summary: `${npc.name}: −${r.dealt} хитов${type}${r.state.hp === 0 ? ' — повержен' : ''}` };
    }
    case 'heal': {
      const hp = Math.min(npc.maxHp, npc.hp + cmd.amount);
      const conditions = hp > 0 ? npc.conditions.filter((x) => x !== 'unconscious') : npc.conditions;
      return { data: { ...npc, hp, conditions }, summary: `${npc.name}: +${hp - npc.hp} хитов` };
    }
    case 'temp_hp':
      return { data: { ...npc, tempHp: Math.max(npc.tempHp, cmd.amount) }, summary: `${npc.name}: ${cmd.amount} временных хитов` };
    case 'set_hp':
      return { data: { ...npc, hp: Math.min(cmd.hp, npc.maxHp) }, summary: `${npc.name}: хиты = ${Math.min(cmd.hp, npc.maxHp)}` };
    case 'condition': {
      const conditions = cmd.on ? [...new Set([...npc.conditions, cmd.condition])] : npc.conditions.filter((x) => x !== cmd.condition);
      return { data: { ...npc, conditions }, summary: `${npc.name}: ${cmd.on ? '' : 'снято: '}${CONDITIONS[cmd.condition].toLowerCase()}` };
    }
    default:
      throw new HttpError(400, 'Эта команда не применяется к существам');
  }
}
