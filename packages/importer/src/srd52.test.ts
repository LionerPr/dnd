import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diceIn, fromO5eSpell, parseRuSpells, rangeRu, weapons2024, type O5eSpell } from './srd52.js';

const dir = resolve(import.meta.dirname, '../test-fixtures/srd52');
const ruDir = resolve(import.meta.dirname, '../data/srd52-spells-ru');
const ru = Object.assign({}, ...readdirSync(ruDir).sort().map((f) => parseRuSpells(readFileSync(resolve(ruDir, f), 'utf8'))));

it('дистанции по-русски', () => {
  expect(rangeRu('60 feet')).toBe('60 футов');
  expect(rangeRu('1 mile')).toBe('1 миля');
  expect(rangeRu('Self')).toBe('На себя');
});

describe.skipIf(!existsSync(resolve(dir, 'Spell.json')))('заклинания SRD 5.2', () => {
  const src = JSON.parse(readFileSync(resolve(dir, 'Spell.json'), 'utf8')) as O5eSpell[];
  const names = Object.fromEntries((JSON.parse(readFileSync(resolve(dir, 'slugs24.json'), 'utf8')) as { slug: string; name: string }[]).map((x) => [x.slug, x.name]));
  const spells = src.map((o) => {
    const slug = o.pk.replace(/^srd-2024_/, '');
    return fromO5eSpell(o, names[slug], ru[slug]);
  });
  if (process.env.WRITE_SEED) writeFileSync(resolve(import.meta.dirname, '../../../apps/server/src/seed/srd2024-spells.json'), JSON.stringify(spells));

  it('у каждого заклинания есть перевод, и кости в нём совпадают с оригиналом', () => {
    const missing = src.map((o) => o.pk.replace(/^srd-2024_/, '')).filter((s) => !ru[s]);
    expect(missing).toEqual([]);
    const bad = src.flatMap((o) => {
      const s = o.pk.replace(/^srd-2024_/, '');
      const a = diceIn(`${o.fields.desc} ${o.fields.higher_level ?? ''}`).join(' ');
      const b = diceIn(`${ru[s]!.description} ${ru[s]!.higherLevels ?? ''}`).join(' ');
      return a === b ? [] : [`${s}: ${a} ≠ ${b}`];
    });
    expect(bad).toEqual([]);
  });

  it('поля для кнопки «сотворить»', () => {
    const fb = spells.find((s) => s.id === 'srd24-spell-fireball')!;
    expect(fb).toMatchObject({ name: 'Огненный шар', level: 3, save: 'dex', damage: { dice: '8к6', type: 'fire', perSlotAbove: '1к6' }, edition: '2024', range: '150 футов' });
    const cw = spells.find((s) => s.id === 'srd24-spell-cure-wounds')!;
    expect(cw.heal).toEqual({ dice: '2к8', perSlotAbove: '2к8' });
    expect(spells.find((s) => s.id === 'srd24-spell-fire-bolt')!.damage).toMatchObject({ dice: '1к10', cantripScaling: true });
    expect(spells.find((s) => s.id === 'srd24-spell-antipathysympathy')!.name).toBe('Антипатия/симпатия');
  });
});

describe.skipIf(!existsSync(resolve(dir, 'Weapon.json')))('оружие SRD 5.2', () => {
  const read = (n: string) => JSON.parse(readFileSync(resolve(dir, n), 'utf8'));
  const weapons = weapons2024(read('Weapon.json'), read('WeaponPropertyAssignment.json'), read('Item.json'));
  if (process.env.WRITE_SEED) writeFileSync(resolve(import.meta.dirname, '../../../apps/server/src/seed/srd2024-items.json'), JSON.stringify(weapons));

  it('приёмы и свойства', () => {
    expect(weapons).toHaveLength(38);
    expect(weapons.find((w) => w.id === 'srd24-item-quarterstaff')).toMatchObject({
      name: 'Боевой посох', cost: { amount: 2, coin: 'sp' }, weapon: { damage: '1к6', versatile: '1к8', properties: ['Универсальное (1к8)', 'Приём: Опрокидывание'], martial: false },
    });
    expect(weapons.find((w) => w.id === 'srd24-item-longbow')!.weapon).toMatchObject({ ranged: true, range: '150/600', properties: ['Боеприпас (дис. 150/600)', 'Тяжёлое', 'Двуручное', 'Приём: Замедление'] });
    expect(weapons.every((w) => !/[a-z]{3}/i.test(w.name))).toBe(true);
  });
});
