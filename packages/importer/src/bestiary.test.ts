import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMonster } from './dndsu';

const fx = (n: string) => new URL(`../test-fixtures/bestiary/${n}.html`, import.meta.url);
const load = (n: string) => parseMonster(readFileSync(fx(n), 'utf8'), `https://dnd.su/bestiary/${n}/`);
const has = existsSync(fx('4-goblin'));

describe.skipIf(!has)('бестиарий dnd.su', () => {
  it('гоблин', () => {
    const m = load('4-goblin');
    if (process.env.SHOW) console.log(JSON.stringify(m, null, 1));
    expect(m.name).toBe('Гоблин');
    expect(m.nameEn).toBe('Goblin');
    expect(m.book).toBe('Monster Manual');
    expect(m.size).toBe('Маленький');
    expect(m.type).toBe('Гуманоид (Гоблиноид)');
    expect(m.alignment).toBe('нейтрально-злой');
    expect(m.ac).toBe(15);
    expect(m.acNote).toBe('кожаный доспех, щит');
    expect(m.hp).toBe(7);
    expect(m.hpFormula).toBe('2к6');
    expect(m.abilities).toEqual({ str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 });
    expect(m.skills).toEqual({ stealth: 6 });
    expect(m.cr).toBe('1/4');
    expect(m.xp).toBe(50);
    expect(m.traits.map((t) => t.name)).toEqual(['Ловкий побег']);
    expect(m.actions[0]).toMatchObject({ name: 'Скимитар', attackBonus: 4, damage: '1к6+2', damageType: 'slashing' });
    expect(m.actions[1]).toMatchObject({ name: 'Короткий лук', damageType: 'piercing' });
    expect(m.description).toContain('Гоблины');
  });
  it('древний чёрный дракон', () => {
    const m = load('95-ancient_black_dragon');
    if (process.env.SHOW) console.log(JSON.stringify(m, null, 1));
    expect(m.hp).toBe(367);
    expect(m.hpFormula).toBe('21к20+147');
    expect(m.saves).toEqual({ dex: 9, con: 14, wis: 9, cha: 11 });
    expect(m.immunities).toEqual(['acid']);
    expect(m.cr).toBe('21');
    expect(m.xp).toBe(33000);
    expect(m.actions.find((a) => a.name === 'Укус')).toMatchObject({ attackBonus: 15, damage: '2к10+8', damageType: 'piercing' });
    expect(m.legendary?.map((a) => a.name)).toEqual(['Обнаружение', 'Атака хвостом', 'Атака крыльями (стоит 2 действия)']);
    expect(m.legendaryIntro).toMatch(/3 легендарных действия/);
    expect(m.description).toContain('Действия логова');
    expect(m.traits.map((t) => t.name)).toEqual(['Амфибия', 'Легендарное сопротивление (3/день)']);
    expect(m.description).toContain('Опционально: Драконы и врождённое колдовство');
  });
  it('другие страницы разбираются', () => {
    for (const n of ['434-mage', '25-owlbear', '164-ghost']) {
      const m = load(n);
      if (process.env.SHOW) console.log(n, m.name, m.cr, m.hp, m.hpFormula, m.actions.map((a) => `${a.name}:${a.damage ?? ''}`).join(' | '), m.resistances, m.immunities, m.conditionImmunities, m.reactions?.map((r) => r.name));
      expect(m.actions.length).toBeGreaterThan(0);
      expect(m.hp).toBeGreaterThan(0);
    }
  });
});
