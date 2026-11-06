import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseClass, parseRace, parseSpell } from './dndsu.js';

// Снимки страниц dnd.su не хранятся в репозитории; положите их в test-fixtures/, чтобы прогнать тест.
const fx = (name: string) => resolve(import.meta.dirname, '../test-fixtures', name);
const has = existsSync(fx('78-dwarf.html')) && existsSync(fx('87-barbarian.html'));

describe.skipIf(!has)('разбор dnd.su', () => {
  it('раса: варианты, бонусы, скорость, зрение, выбор инструментов', () => {
    const r = parseRace(readFileSync(fx('78-dwarf.html'), 'utf8'), 'https://dnd.su/race/78-dwarf/');
    expect(r.name).toBe('Дварф');
    expect(r.speed).toBe(25);
    const mountain = r.subraces!.find((s) => s.id === 'mountain')!;
    const effects = mountain.features.flatMap((f) => f.effects ?? []);
    expect(effects).toContainEqual({ type: 'ability_bonus', ability: 'con', value: 2 });
    expect(effects).toContainEqual({ type: 'ability_bonus', ability: 'str', value: 2 });
    expect(effects).toContainEqual({ type: 'darkvision', range: 60 });
    expect(effects).toContainEqual({ type: 'resistance', damage: 'poison' });
    expect(effects.find((e) => e.type === 'choice')).toMatchObject({ kind: 'tool', pick: 1 });
  });

  it('класс: хиты, спасброски, навыки, таблица, умения, пути', () => {
    const c = parseClass(readFileSync(fx('87-barbarian.html'), 'utf8'), 'https://dnd.su/class/87-barbarian/');
    expect(c).toMatchObject({ name: 'Варвар', hitDie: 12, saves: ['str', 'con'], armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'], subclassLevel: 3 });
    expect(c.skillChoices.pick).toBe(2);
    expect(c.levels).toHaveLength(20);
    expect(c.features.find((f) => f.name === 'Ярость')?.level).toBe(1);
    expect(c.subclasses.map((s) => s.name)).toContain('Путь берсерка');
    expect(c.subclasses.every((s) => !s.id.startsWith('hb.'))).toBe(true);
  });
});

const hasMore = ['205-fireball.html', '204-fire_bolt.html', '145-cure_wounds.html', '93-monk.html'].every((f) => existsSync(fx(f)));

describe.skipIf(!hasMore)('разбор dnd.su: заклинания и монах', () => {
  it('огненный шар: уровень, школа, урон с ростом по ячейкам, спасбросок, классы', () => {
    const s = parseSpell(readFileSync(fx('205-fireball.html'), 'utf8'), 'https://dnd.su/spells/205-fireball/');
    expect(s).toMatchObject({ name: 'Огненный шар', level: 3, school: 'evocation', range: '150 футов', save: 'dex', concentration: false });
    expect(s.damage).toEqual({ dice: '8к6', type: 'fire', perSlotAbove: '1к6' });
    expect(s.classNames).toEqual(['волшебник', 'чародей']);
    expect(s.higherLevels).toMatch(/1к6/);
  });

  it('огненный снаряд: заговор с атакой и ростом урона; лечение ран', () => {
    const bolt = parseSpell(readFileSync(fx('204-fire_bolt.html'), 'utf8'), 'https://dnd.su/spells/204-fire_bolt/');
    expect(bolt).toMatchObject({ level: 0, attack: 'ranged', damage: { dice: '1к10', type: 'fire', cantripScaling: true } });
    const cure = parseSpell(readFileSync(fx('145-cure_wounds.html'), 'utf8'), 'https://dnd.su/spells/145-cure_wounds/');
    expect(cure.heal).toEqual({ dice: '1к8', perSlotAbove: '1к8' });
  });

  it('монах: ци по уровням, все монастырские традиции, таблица', () => {
    const m = parseClass(readFileSync(fx('93-monk.html'), 'utf8'), 'https://dnd.su/class/93-monk/');
    expect(m.subclasses.map((s) => s.name)).toContain('Путь тени');
    expect(m.subclasses.length).toBeGreaterThanOrEqual(8);
    const ki = m.features.flatMap((f) => f.effects ?? []).find((e) => e.type === 'resource');
    expect(ki).toMatchObject({ id: 'ki', recharge: 'short' });
    expect(m.levels[4]!.columns).toMatchObject({ 'Очки ци': '5' });
  });
});
