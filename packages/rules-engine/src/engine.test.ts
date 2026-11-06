import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  average,
  computeSheet,
  damageCharacter,
  emptyMoney,
  freshState,
  healCharacter,
  longRest,
  roll,
  rollDeathSave,
  shortRest,
  spendMoney,
  type Character,
  type CharacterClass,
  type ContentIndex,
  type Item,
  type Race,
} from './index.js';

const dwarf: Race = {
  kind: 'race', id: 'dwarf', name: 'Дварф', source: 'srd', size: 'medium', speed: 25,
  features: [
    { id: 'dwarf.asi', name: 'Увеличение характеристик', description: '', effects: [{ type: 'ability_bonus', ability: 'con', value: 2 }] },
    { id: 'dwarf.dv', name: 'Тёмное зрение', description: '', effects: [{ type: 'darkvision', range: 60 }] },
    { id: 'dwarf.res', name: 'Дварфийская устойчивость', description: '', effects: [{ type: 'resistance', damage: 'poison' }] },
    { id: 'dwarf.tools', name: 'Владение инструментами', description: '', effects: [{ type: 'choice', id: 'dwarf.tools', kind: 'tool', pick: 1, of: ['tools.smith', 'tools.brewer', 'tools.mason'] }] },
  ],
  subraces: [{ id: 'hill', name: 'Холмовой', features: [
    { id: 'hill.asi', name: 'Увеличение характеристик', description: '', effects: [{ type: 'ability_bonus', ability: 'wis', value: 1 }] },
    { id: 'hill.tough', name: 'Дварфийская выдержка', description: '', effects: [{ type: 'hp_per_level', value: 1 }] },
  ] }],
};

const barbarian: CharacterClass = {
  kind: 'class', id: 'barbarian', name: 'Варвар', source: 'srd', hitDie: 12, saves: ['str', 'con'],
  armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'], tools: [],
  skillChoices: { pick: 2, from: ['athletics', 'perception', 'survival', 'intimidation', 'nature', 'animalHandling'] },
  features: [
    { id: 'rage', name: 'Ярость', description: '', level: 1, effects: [{ type: 'resource', id: 'rage', name: 'Ярость', max: { 1: 2, 3: 3, 6: 4 }, recharge: 'long' }] },
    { id: 'unarmored', name: 'Защита без доспехов', description: '', level: 1, effects: [{ type: 'ac_formula', base: 10, abilities: ['dex', 'con'], allowShield: true }] },
  ],
  levels: [{ level: 1, features: ['rage', 'unarmored'] }],
  subclassLevel: 3,
  subclasses: [],
};

const wizard: CharacterClass = {
  kind: 'class', id: 'wizard', name: 'Волшебник', source: 'srd', hitDie: 6, saves: ['int', 'wis'],
  armor: [], weapons: [], tools: [], skillChoices: { pick: 2, from: ['arcana', 'history'] },
  spellcasting: { ability: 'int', progression: 'full', mode: 'prepared', ritual: true },
  features: [], levels: [], subclassLevel: 2, subclasses: [],
};

const greataxe: Item = {
  kind: 'item', id: 'greataxe', name: 'Секира', source: 'srd', category: 'weapon', weight: 7,
  weapon: { damage: '1к12', damageType: 'slashing', properties: ['тяжёлое', 'двуручное'], martial: true, ranged: false },
};
const shield: Item = { kind: 'item', id: 'shield', name: 'Щит', source: 'srd', category: 'shield', weight: 6, shield: { bonus: 2 } };
const chain: Item = { kind: 'item', id: 'chain', name: 'Кольчуга', source: 'srd', category: 'armor', weight: 55, armor: { base: 16, dexCap: 0, type: 'heavy' } };

const content: ContentIndex = {
  races: new Map([[dwarf.id, dwarf]]),
  classes: new Map([[barbarian.id, barbarian], [wizard.id, wizard]]),
  spells: new Map(),
  items: new Map([[greataxe.id, greataxe], [shield.id, shield], [chain.id, chain]]),
  feats: new Map(),
};

const torin = (): Character => ({
  id: 't', name: 'Торин', raceId: 'dwarf', subraceId: 'hill',
  classes: [{ classId: 'barbarian', level: 3 }],
  baseAbilities: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 12 },
  choices: { 'class.barbarian.skills': ['athletics', 'perception'], 'dwarf.tools': ['tools.smith'] },
  overrides: {}, extraFeatures: [], featIds: [], spellsKnown: [], spellsPrepared: [],
  inventory: [{ id: 'i1', itemId: 'greataxe', qty: 1, equipped: true }],
  optionalFeatures: [], hpRolls: [], languages: ['common', 'dwarvish'],
  state: freshState(0),
});

describe('computeSheet', () => {
  it('применяет расу, подрасу и класс', () => {
    const s = computeSheet(torin(), content);
    expect(s.abilities.con.score).toBe(16);
    expect(s.abilities.wis.score).toBe(11);
    expect(s.proficiencyBonus).toBe(2);
    expect(s.abilities.str.save).toBe(4);
    expect(s.abilities.dex.save).toBe(2);
    // 12+3, (7+3)*2, +1 за уровень от холмового дварфа
    expect(s.maxHp).toBe(15 + 20 + 3);
    expect(s.speed.walk).toBe(25);
    expect(s.darkvision).toBe(60);
    expect(s.resistances).toContain('poison');
    expect(s.proficiencies.tool).toContain('tools.smith');
    expect(s.skills.find((x) => x.key === 'athletics')?.bonus).toBe(4);
    expect(s.passivePerception).toBe(12);
    expect(s.pendingChoices).toHaveLength(0);
  });

  it('защита без доспехов, доспехи и щит', () => {
    const c = torin();
    expect(computeSheet(c, content).ac).toBe(10 + 2 + 3);
    c.inventory.push({ id: 'i2', itemId: 'shield', qty: 1, equipped: true });
    expect(computeSheet(c, content).ac).toBe(17);
    c.inventory.push({ id: 'i3', itemId: 'chain', qty: 1, equipped: true });
    expect(computeSheet(c, content).ac).toBe(18);
  });

  it('ресурсы растут с уровнем', () => {
    const c = torin();
    expect(computeSheet(c, content).resources[0]).toMatchObject({ id: 'rage', max: 3 });
    c.classes[0]!.level = 1;
    expect(computeSheet(c, content).resources[0]!.max).toBe(2);
  });

  it('атака оружием', () => {
    const a = computeSheet(torin(), content).attacks[0]!;
    expect(a.bonus).toBe(4);
    expect(a.damage).toBe('1к12+2');
  });

  it('ячейки заклинаний и мультикласс', () => {
    const c = torin();
    c.classes = [{ classId: 'wizard', level: 5 }];
    let s = computeSheet(c, content);
    expect(s.spellSlots.map((x) => x.max)).toEqual([4, 3, 2]);
    expect(s.casters[0]).toMatchObject({ saveDc: 8 + 3 - 1, attackBonus: 2 });
    c.classes = [{ classId: 'barbarian', level: 2 }, { classId: 'wizard', level: 1 }];
    s = computeSheet(c, content);
    expect(s.spellSlots.map((x) => x.max)).toEqual([2]);
    expect(s.hitDice).toEqual([{ die: 12, total: 2, used: 0 }, { die: 6, total: 1, used: 0 }]);
  });

  it('ручное переопределение и невыбранное', () => {
    const c = torin();
    c.overrides.ac = 20;
    c.choices = {};
    const s = computeSheet(c, content);
    expect(s.ac).toBe(20);
    expect(s.overridden).toContain('ac');
    expect(s.pendingChoices.map((p) => p.id).sort()).toEqual(['class.barbarian.skills', 'dwarf.tools']);
  });
});

describe('урон и лечение', () => {
  const def = { maxHp: 30, resistances: ['poison' as const], immunities: ['psychic' as const] };

  it('временные хиты, сопротивление, иммунитет', () => {
    expect(applyDamage({ hp: 20, tempHp: 5 }, 8, 'fire', def).state).toEqual({ hp: 17, tempHp: 0 });
    expect(applyDamage({ hp: 20, tempHp: 0 }, 9, 'poison', def).dealt).toBe(4);
    expect(applyDamage({ hp: 20, tempHp: 0 }, 9, 'psychic', def).state.hp).toBe(20);
  });

  it('падение до нуля, спасброски от смерти, мгновенная смерть', () => {
    let s = { ...freshState(30), hp: 5 };
    let r = damageCharacter(s, 10, 'slashing', def);
    expect(r.state.hp).toBe(0);
    expect(r.state.conditions).toContain('unconscious');
    s = damageCharacter(r.state, 3, 'slashing', def, true).state;
    expect(s.deathSaves.failure).toBe(2);
    s = rollDeathSave(s, 5);
    expect(s.dead).toBe(true);

    r = damageCharacter({ ...freshState(30), hp: 10 }, 40, 'fire', def);
    expect(r.state.dead).toBe(true);
  });

  it('лечение поднимает с нуля', () => {
    const down = damageCharacter({ ...freshState(30), hp: 3 }, 5, undefined, def).state;
    const up = healCharacter(down, 7, 30);
    expect(up.hp).toBe(7);
    expect(up.conditions).not.toContain('unconscious');
  });
});

describe('деньги', () => {
  it('платит без размена', () => {
    expect(spendMoney({ ...emptyMoney(), gp: 10 }, 3, 'gp')).toMatchObject({ gp: 7 });
  });
  it('разменивает крупную монету', () => {
    expect(spendMoney({ ...emptyMoney(), pp: 1 }, 3, 'gp')).toMatchObject({ pp: 0, gp: 7 });
    expect(spendMoney({ ...emptyMoney(), gp: 1 }, 5, 'cp')).toMatchObject({ gp: 0, sp: 9, cp: 5 });
  });
  it('не хватает денег', () => {
    expect(spendMoney({ ...emptyMoney(), sp: 5 }, 1, 'gp')).toBeNull();
  });
});

describe('отдых', () => {
  const ctx = { maxHp: 30, hitDice: [{ die: 12, total: 3 }], resources: [{ id: 'rage', recharge: 'long' as const }, { id: 'ki', recharge: 'short' as const }], hasPactMagic: false };
  it('короткий отдых', () => {
    const s = { ...freshState(30), hp: 10, resourcesUsed: { rage: 1, ki: 2 } };
    const after = shortRest(s, ctx, [{ die: 12, roll: 6 }, { die: 12, roll: 1 }], 2);
    expect(after.hp).toBe(10 + 8 + 3);
    expect(after.hitDiceUsed[12]).toBe(2);
    expect(after.resourcesUsed).toEqual({ rage: 1 });
  });
  it('долгий отдых', () => {
    const s = { ...freshState(30), hp: 4, exhaustion: 2, hitDiceUsed: { 12: 3 }, spellSlotsUsed: { 1: 2 }, resourcesUsed: { rage: 3 } };
    const after = longRest(s, ctx);
    expect(after).toMatchObject({ hp: 30, exhaustion: 1, hitDiceUsed: { 12: 2 }, spellSlotsUsed: {}, resourcesUsed: {} });
  });
});

describe('кубики', () => {
  const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]!; };
  it('русская и английская запись', () => {
    expect(roll('2к6+3', seq(0, 0.99)).total).toBe(1 + 6 + 3);
    expect(roll('1d20-1', seq(0.5)).total).toBe(10);
    expect(average('4к8+4')).toBe(22);
  });
  it('преимущество', () => {
    expect(roll('2к20kh1+2', seq(0.1, 0.8)).total).toBe(17 + 2);
  });
  it('ошибка в формуле', () => {
    expect(() => roll('2к6+abc')).toThrow();
  });
});

describe('увеличение характеристик', () => {
  const fighter: CharacterClass = {
    ...barbarian,
    id: 'fighter',
    name: 'Воин',
    features: [{ id: 'asi', name: 'Увеличение характеристик', description: '', level: 4 }],
    levels: [{ level: 4, features: ['asi'] }, { level: 6, features: ['asi'] }, { level: 8, features: ['asi'] }],
  };
  const idx: ContentIndex = { ...content, classes: new Map([[fighter.id, fighter]]) };
  const hero = (choices: Record<string, string[]>): Character => ({ ...torin(), raceId: undefined, subraceId: undefined, classes: [{ classId: 'fighter', level: 6 }], choices });

  it('появляется выбор на каждом открытом уровне', () => {
    const s = computeSheet(hero({}), idx);
    expect(s.pendingChoices.filter((p) => p.asi).map((p) => p.id)).toEqual(['asi.fighter.4', 'asi.fighter.6']);
  });

  it('+2 к одной характеристике и черта вместо второго выбора', () => {
    const s = computeSheet(hero({ 'asi.fighter.4': ['str', 'str'], 'asi.fighter.6': ['feat:tough:Крепкий'] }), idx);
    expect(s.abilities.str.score).toBe(17);
    expect(s.pendingChoices.some((p) => p.asi)).toBe(false);
  });
});

describe('таблица класса', () => {
  const monk: CharacterClass = {
    ...barbarian, id: 'monk', name: 'Монах', hitDie: 8, features: [],
    levels: [
      { level: 1, features: [], columns: { 'Боевые искусства': '1к4', 'Скорость без доспехов': '—' } },
      { level: 2, features: [], columns: { 'Боевые искусства': '1к4', 'Скорость без доспехов': '+10 футов' } },
      { level: 5, features: [], columns: { 'Боевые искусства': '1к6', 'Скорость без доспехов': '+10 футов' } },
    ],
  };
  const idx: ContentIndex = { ...content, classes: new Map([[monk.id, monk]]) };
  const kai = (): Character => ({ ...torin(), raceId: undefined, subraceId: undefined, inventory: [], classes: [{ classId: 'monk', level: 5 }], baseAbilities: { str: 10, dex: 16, con: 14, int: 10, wis: 15, cha: 8 } });

  it('боевые искусства и движение без доспехов', () => {
    const s = computeSheet(kai(), idx);
    expect(s.attacks.find((a) => a.id === 'unarmed')).toMatchObject({ damage: '1к6+3', bonus: 6, ability: 'dex' });
    expect(s.speed.walk).toBe(40);
  });
});
