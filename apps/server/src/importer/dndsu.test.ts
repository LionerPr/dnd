import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseClass, parseRace } from './dndsu.js';

// Снимки страниц dnd.su не хранятся в репозитории; положите их в test-fixtures/, чтобы прогнать тест.
const fx = (name: string) => resolve(import.meta.dirname, '../../test-fixtures', name);
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
