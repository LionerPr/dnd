import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeSheet, evalFormula, type Character, type ContentIndex } from '@dnd/rules-engine';
import { fromLssDataset, humanizeFormulas } from './lss.js';

const file = resolve(import.meta.dirname, '../test-fixtures/lss/srd2024.json');

describe('формулы', () => {
  it('вычисляются и читаются', () => {
    expect(evalFormula('max([CHA],1)', { CHA: -1 })).toBe(1);
    expect(evalFormula('5*[LVL]', { LVL: 3 })).toBe(15);
    expect(evalFormula('min(floor(([LVL]+1)/6)+1,4)', { LVL: 11 })).toBe(3);
    expect(evalFormula('1+([LVL]>=7)', { LVL: 7 })).toBe(2);
    expect(humanizeFormulas('урон [f:1d10] и Сл [f:8+[CON]+[PROF]|Сл]')).toBe('урон 1к10 и Сл Сл (8 + мод. Телосложения + бонус мастерства)');
    expect(humanizeFormulas('[f:1d10+[LVL]|Второе дыхание]', true)).toBe('Второе дыхание');
  });
});

describe.skipIf(!existsSync(file))('SRD 5.2 из набора LSS', () => {
  const data = fromLssDataset(JSON.parse(readFileSync(file, 'utf8')), 'srd24');
  // Готовые записи для сервера и движка: перегенерируются этим тестом, если положить набор в test-fixtures/lss
  if (process.env.WRITE_SEED) {
    const root = resolve(import.meta.dirname, '../../..');
    writeFileSync(resolve(root, 'apps/server/src/seed/srd2024.json'), JSON.stringify([...data.classes, ...data.races, ...data.feats]));
    writeFileSync(resolve(root, 'packages/rules-engine/src/backgrounds-2024.json'), JSON.stringify(data.backgrounds, null, 1));
  }

  it('классы: кость хитов, спасброски, ресурсы по уровням, набор снаряжения', () => {
    expect(data.classes).toHaveLength(12);
    const barb = data.classes.find((c) => c.id === 'srd24-class-barbarian')!;
    expect(barb).toMatchObject({ hitDie: 12, saves: ['str', 'con'], armor: ['light', 'medium', 'shield'], edition: '2024' });
    const rage = barb.features.flatMap((f) => f.effects ?? []).find((e) => e.type === 'resource' && e.id === 'rage');
    expect(rage).toMatchObject({ max: { 1: 2, 3: 3, 6: 4, 12: 5, 17: 6 }, recharge: 'short' });
    expect(barb.kit).toEqual([{ label: 'Снаряжение', items: ['Большой топор', '4 ручных топора', 'Набор исследователя'], gold: 15 }, { label: 'Золото', items: [], gold: 75 }]);
    expect(barb.subclasses[0]!.name).toBe('Путь берсерка');
    expect(barb.features.filter((f) => f.asi).map((f) => f.level)).toEqual([4, 8, 12, 16, 19]);
  });

  it('лист: варвар 2024 с предысторией «Солдат» — +2/+1 и черта происхождения', () => {
    const barb = data.classes.find((c) => c.id === 'srd24-class-barbarian')!;
    const human = data.races.find((r) => r.id === 'srd24-race-human')!;
    const bg = data.backgrounds.find((b) => b.id === 'srd24-soldier')!;
    expect(bg.abilityPool).toEqual({ total: 3, max: 2, options: ['str', 'dex', 'con'] });
    const feat = data.feats.find((f) => f.id === bg.featId)!;
    const idx: ContentIndex = { races: new Map([[human.id, human]]), classes: new Map([[barb.id, barb]]), spells: new Map(), items: new Map(), feats: new Map([[feat.id, feat as never]]) };
    const c = {
      id: 'x', name: 'x', edition: '2024', raceId: human.id, classes: [{ classId: barb.id, level: 3 }], backgroundId: bg.id,
      baseAbilities: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 10 }, choices: { 'bg.asi': ['str', 'str', 'con', 'con'] },
      overrides: {}, extraFeatures: [], featIds: [], spellsKnown: [], spellsPrepared: [], inventory: [], optionalFeatures: [], hpRolls: [], languages: [],
      state: { hp: 0, tempHp: 0, maxHpMod: 0, hitDiceUsed: {}, spellSlotsUsed: {}, pactSlotsUsed: 0, resourcesUsed: {}, conditions: [], exhaustion: 0, deathSaves: { success: 0, fail: 0 }, inspiration: false, money: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, xp: 0 },
    } as unknown as Character;
    const s = computeSheet(c, idx);
    expect(s.abilities.str.score).toBe(17);
    expect(s.abilities.con.score).toBe(15); // третий выбор Телосложения сверх двух отброшен
    expect(s.features.some((f) => f.name === feat.name && f.from === 'background')).toBe(true);
    expect(s.resources.find((r) => r.id === 'rage')!.max).toBe(3);
    expect(s.edition).toBe('2024');
  });
});
