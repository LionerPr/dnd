import { COINS, COIN_ORDER, type Coin, type Condition, type DamageType } from './data.js';
import type { CharacterState, Money } from './types.js';

/** Всё, что нужно знать о цели, чтобы применить урон: подходит и персонажу, и монстру. */
export interface Defenses {
  maxHp: number;
  resistances?: DamageType[];
  immunities?: DamageType[];
  vulnerabilities?: DamageType[];
}

export interface HpState {
  hp: number;
  tempHp: number;
}

export interface DamageResult<S extends HpState> {
  state: S;
  /** Урон после сопротивлений/уязвимостей */
  dealt: number;
  absorbedByTemp: number;
  note?: 'immune' | 'resisted' | 'vulnerable';
  droppedToZero: boolean;
  instantDeath: boolean;
}

export function adjustDamage(amount: number, type: DamageType | undefined, d: Defenses) {
  if (!type) return { amount, note: undefined };
  if (d.immunities?.includes(type)) return { amount: 0, note: 'immune' as const };
  if (d.resistances?.includes(type)) return { amount: Math.floor(amount / 2), note: 'resisted' as const };
  if (d.vulnerabilities?.includes(type)) return { amount: amount * 2, note: 'vulnerable' as const };
  return { amount, note: undefined };
}

/** Урон: сначала сопротивления, потом временные хиты, потом обычные. */
export function applyDamage<S extends HpState>(state: S, rawAmount: number, type: DamageType | undefined, d: Defenses): DamageResult<S> {
  const { amount, note } = adjustDamage(Math.max(0, Math.floor(rawAmount)), type, d);
  const absorbedByTemp = Math.min(state.tempHp, amount);
  const rest = amount - absorbedByTemp;
  const hpBefore = state.hp;
  const hp = Math.max(0, hpBefore - rest);
  const overflow = rest - hpBefore;
  return {
    state: { ...state, tempHp: state.tempHp - absorbedByTemp, hp },
    dealt: amount,
    absorbedByTemp,
    note,
    droppedToZero: hpBefore > 0 && hp === 0,
    // PHB: мгновенная смерть, если остаток урона после 0 хитов не меньше максимума хитов
    instantDeath: hpBefore > 0 && overflow >= d.maxHp,
  };
}

/** Урон персонажу с учётом спасбросков от смерти и состояния «без сознания». */
export function damageCharacter(state: CharacterState, amount: number, type: DamageType | undefined, d: Defenses, critical = false) {
  const wasAtZero = state.hp === 0;
  const r = applyDamage(state, amount, type, d);
  let s = r.state;
  if (r.instantDeath) {
    s = { ...s, dead: true };
  } else if (r.droppedToZero) {
    s = { ...s, conditions: addCondition(s.conditions, 'unconscious'), deathSaves: { success: 0, failure: 0 } };
  } else if (wasAtZero && r.dealt > 0) {
    // Урон по персонажу при 0 хитов — провал спасброска от смерти (крит — два)
    if (r.dealt >= d.maxHp) s = { ...s, dead: true };
    else {
      const failure = Math.min(3, s.deathSaves.failure + (critical ? 2 : 1));
      s = { ...s, deathSaves: { ...s.deathSaves, failure }, dead: failure >= 3 };
    }
  }
  return { ...r, state: s };
}

export function healCharacter(state: CharacterState, amount: number, maxHp: number): CharacterState {
  if (state.dead || amount <= 0) return state;
  const hp = Math.min(maxHp, state.hp + Math.floor(amount));
  const revived = state.hp === 0 && hp > 0;
  return {
    ...state,
    hp,
    deathSaves: revived ? { success: 0, failure: 0 } : state.deathSaves,
    conditions: revived ? state.conditions.filter((c) => c !== 'unconscious') : state.conditions,
  };
}

/** Временные хиты не складываются: остаётся большее значение. */
export const grantTempHp = <S extends HpState>(state: S, amount: number): S => ({ ...state, tempHp: Math.max(state.tempHp, Math.floor(amount)) });

export function addCondition(list: Condition[], c: Condition): Condition[] {
  return list.includes(c) ? list : [...list, c];
}
export const removeCondition = (list: Condition[], c: Condition): Condition[] => list.filter((x) => x !== c);

/** Результат броска спасброска от смерти (d20). */
export function rollDeathSave(state: CharacterState, d20: number): CharacterState {
  if (state.hp > 0 || state.dead) return state;
  if (d20 === 20) return healCharacter(state, 1, Number.MAX_SAFE_INTEGER);
  const ds = { ...state.deathSaves };
  if (d20 === 1) ds.failure = Math.min(3, ds.failure + 2);
  else if (d20 >= 10) ds.success += 1;
  else ds.failure += 1;
  if (ds.failure >= 3) return { ...state, deathSaves: ds, dead: true };
  if (ds.success >= 3) return { ...state, deathSaves: { success: 0, failure: 0 }, conditions: addCondition(state.conditions, 'unconscious') };
  return { ...state, deathSaves: ds };
}

// ---------- Деньги ----------

export const emptyMoney = (): Money => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
export const moneyInCp = (m: Money): number => COIN_ORDER.reduce((s, c) => s + m[c] * COINS[c].value, 0);

export function addMoney(m: Money, delta: Partial<Money>): Money {
  const out = { ...m };
  for (const c of COIN_ORDER) out[c] += delta[c] ?? 0;
  return out;
}

/**
 * Списать сумму: сначала этими же монетами, потом размениваем монеты крупнее.
 * Возвращает null, если денег не хватает.
 */
export function spendMoney(m: Money, amount: number, coin: Coin): Money | null {
  let need = amount * COINS[coin].value;
  if (moneyInCp(m) < need) return null;
  const out = { ...m };
  const desc = [...COIN_ORDER].reverse();
  // 1. Ровно, без размена: монеты не дороже нужной, от крупных к мелким
  for (const c of desc) {
    if (COINS[c].value > COINS[coin].value) continue;
    const take = Math.min(out[c], Math.floor(need / COINS[c].value));
    out[c] -= take;
    need -= take * COINS[c].value;
  }
  // 2. Остаток: разменять самую мелкую монету, которой хватает, или отдать крупнейшую из меньших
  while (need > 0) {
    const enough = COIN_ORDER.find((c) => out[c] > 0 && COINS[c].value >= need);
    const c = enough ?? desc.find((x) => out[x] > 0)!;
    out[c] -= 1;
    need -= COINS[c].value;
  }
  // 3. Сдача в зм/см/мм
  let change = -need;
  for (const c of ['gp', 'sp', 'cp'] as const) {
    const n = Math.floor(change / COINS[c].value);
    out[c] += n;
    change -= n * COINS[c].value;
  }
  return out;
}

// ---------- Отдых ----------

export interface RestContext {
  maxHp: number;
  hitDice: { die: number; total: number }[];
  resources: { id: string; recharge: 'short' | 'long' | 'none' }[];
  /** Колдун восстанавливает ячейки договора на коротком отдыхе */
  hasPactMagic: boolean;
}

/** Короткий отдых: трата костей хитов (результаты бросков передаются снаружи) и сброс «коротких» ресурсов. */
export function shortRest(state: CharacterState, ctx: RestContext, spent: { die: number; roll: number }[], conMod: number): CharacterState {
  let s: CharacterState = { ...state, hitDiceUsed: { ...state.hitDiceUsed }, resourcesUsed: { ...state.resourcesUsed } };
  for (const { die, roll } of spent) {
    const pool = ctx.hitDice.find((h) => h.die === die);
    if (!pool || (s.hitDiceUsed[die] ?? 0) >= pool.total) continue;
    s.hitDiceUsed[die] = (s.hitDiceUsed[die] ?? 0) + 1;
    s = healCharacter(s, Math.max(0, roll + conMod), ctx.maxHp);
  }
  for (const r of ctx.resources) if (r.recharge === 'short') delete s.resourcesUsed[r.id];
  if (ctx.hasPactMagic) s.pactSlotsUsed = 0;
  return s;
}

/** Долгий отдых: полные хиты, все ячейки и ресурсы, половина костей хитов, −1 истощение. */
export function longRest(state: CharacterState, ctx: RestContext): CharacterState {
  if (state.dead) return state;
  const hitDiceUsed = { ...state.hitDiceUsed };
  for (const h of ctx.hitDice) {
    const regain = Math.max(1, Math.floor(h.total / 2));
    hitDiceUsed[h.die] = Math.max(0, (hitDiceUsed[h.die] ?? 0) - regain);
  }
  const resourcesUsed = { ...state.resourcesUsed };
  for (const r of ctx.resources) if (r.recharge !== 'none') delete resourcesUsed[r.id];
  return {
    ...state,
    hp: ctx.maxHp,
    tempHp: 0,
    maxHpModifier: 0,
    deathSaves: { success: 0, failure: 0 },
    conditions: state.conditions.filter((c) => c !== 'unconscious'),
    exhaustion: Math.max(0, state.exhaustion - 1),
    hitDiceUsed,
    spellSlotsUsed: {},
    pactSlotsUsed: 0,
    resourcesUsed,
  };
}

export const freshState = (maxHp: number): CharacterState => ({
  hp: maxHp,
  tempHp: 0,
  maxHpModifier: 0,
  deathSaves: { success: 0, failure: 0 },
  dead: false,
  conditions: [],
  exhaustion: 0,
  hitDiceUsed: {},
  spellSlotsUsed: {},
  pactSlotsUsed: 0,
  resourcesUsed: {},
  inspiration: false,
  money: emptyMoney(),
  xp: 0,
});
