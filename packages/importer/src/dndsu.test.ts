import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectKind, parseClass, parseRace, parseSpell } from './dndsu.js';

// Снимки страниц dnd.su не хранятся в репозитории; положите их в test-fixtures/, чтобы прогнать тест.
const fx = (name: string) => resolve(import.meta.dirname, '../test-fixtures', name);
const has = existsSync(fx('78-dwarf.html')) && existsSync(fx('87-barbarian.html'));

describe.skipIf(!has)('разбор dnd.su', () => {
  it('раса: варианты, бонусы, скорость, зрение, выбор инструментов', () => {
    const r = parseRace(readFileSync(fx('78-dwarf.html'), 'utf8'), 'https://dnd.su/race/78-dwarf/');
    expect(r.book).toBe("Player's Handbook");
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

describe('самодельные страницы (homebrew)', () => {
  it.skipIf(!existsSync(fx('545-oniborne.html')))('раса с простой разметкой и скрытыми разновидностями', () => {
    const r = parseRace(readFileSync(fx('545-oniborne.html'), 'utf8'), 'https://dnd.su/homebrew/race/545-oniborne/');
    expect(r.name).toBe('Онирождённый');
    expect(r.book).toBe("Ryoko's guide to the yokai realms");
    expect(r.features.map((f) => f.name)).toContain('Мощное телосложение');
    expect(r.features.find((f) => f.name === 'Увеличение характеристик')?.effects).toEqual([{ type: 'ability_bonus', ability: 'con', value: 2 }]);
    expect(r.subraces?.map((s) => s.name)).toEqual(['Красный онирождённый', 'Синий онирождённый', 'Зелёный онирождённый']);
    expect(r.subraces?.[0]?.features[0]?.effects?.[0]).toMatchObject({ type: 'ability_bonus', ability: 'wis', value: 1 });
  });

  it.skipIf(!existsSync(fx('195-blood-hunter.html')))('класс: умения по уровням и ордена', () => {
    const c = parseClass(readFileSync(fx('195-blood-hunter.html'), 'utf8'), 'https://dnd.su/homebrew/class/195-blood-hunter/');
    expect(c.name).toBe('Кровавый охотник');
    expect(c.features.find((f) => f.name === 'Охотничья погибель')?.level).toBe(1);
    expect(c.features.find((f) => f.name === 'Дополнительная атака')?.level).toBe(5);
    expect(c.subclasses.map((s) => s.name)).toContain('Орден призрачных убийц');
  });

  it.skipIf(!existsSync(fx('281-bugbear.html')))('раса 2022 года: разметка в span, бонус на выбор', () => {
    const r = parseRace(readFileSync(fx('281-bugbear.html'), 'utf8'), 'https://dnd.su/multiverse/race/281-bugbear/');
    expect(r.features.map((f) => f.name)).toEqual(expect.arrayContaining(['Увеличение характеристик', 'Тёмное зрение', 'Длинные конечности', 'Скрытность', 'Внезапное нападение']));
    expect(r.features[0]!.effects).toEqual([
      { type: 'ability_choice', id: expect.stringMatching(/plus2$/), pick: 1, value: 2 },
      { type: 'ability_choice', id: expect.stringMatching(/plus1$/), pick: 1, value: 1 },
    ]);
    expect(r.speed).toBe(30);
  });

  it.skipIf(!existsSync(fx('83-gnome.html')))('разновидности с разметкой dnd-feature-name, без списков имён', () => {
    const r = parseRace(readFileSync(fx('83-gnome.html'), 'utf8'), 'https://dnd.su/race/83-gnome/');
    const forest = r.subraces!.find((s) => s.name === 'Лесной')!;
    expect(forest.features.find((f) => f.name === 'Увеличение характеристик')?.effects).toEqual([
      { type: 'ability_bonus', ability: 'int', value: 2 },
      { type: 'ability_bonus', ability: 'dex', value: 1 },
    ]);
    expect(r.subraces!.flatMap((s) => s.features).some((f) => /имена|^источник/i.test(f.name))).toBe(false);
  });

  it('раздел определяется и для homebrew/multiverse', () => {
    expect(detectKind('https://dnd.su/homebrew/race/545-oniborne/')).toBe('race');
    expect(detectKind('https://dnd.su/multiverse/race/193-reborn/')).toBe('race');
    expect(detectKind('https://dnd.su/homebrew/class/12-x/')).toBe('class');
  });
});
