// Базовые справочники 5e (SRD 5.1, CC BY 4.0). Названия — как на dnd.su.

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

export const ABILITY_NAMES: Record<Ability, { full: string; short: string }> = {
  str: { full: 'Сила', short: 'СИЛ' },
  dex: { full: 'Ловкость', short: 'ЛОВ' },
  con: { full: 'Телосложение', short: 'ТЕЛ' },
  int: { full: 'Интеллект', short: 'ИНТ' },
  wis: { full: 'Мудрость', short: 'МДР' },
  cha: { full: 'Харизма', short: 'ХАР' },
};

/** Ключи навыков совпадают с атрибутом tooltip-for="skill.<key>" на dnd.su. */
export const SKILLS = {
  athletics: { ability: 'str', name: 'Атлетика' },
  acrobatics: { ability: 'dex', name: 'Акробатика' },
  sleightOfHand: { ability: 'dex', name: 'Ловкость рук' },
  stealth: { ability: 'dex', name: 'Скрытность' },
  arcana: { ability: 'int', name: 'Магия' },
  history: { ability: 'int', name: 'История' },
  investigation: { ability: 'int', name: 'Анализ' },
  nature: { ability: 'int', name: 'Природа' },
  religion: { ability: 'int', name: 'Религия' },
  animalHandling: { ability: 'wis', name: 'Уход за животными' },
  insight: { ability: 'wis', name: 'Проницательность' },
  medicine: { ability: 'wis', name: 'Медицина' },
  perception: { ability: 'wis', name: 'Восприятие' },
  survival: { ability: 'wis', name: 'Выживание' },
  deception: { ability: 'cha', name: 'Обман' },
  intimidation: { ability: 'cha', name: 'Запугивание' },
  performance: { ability: 'cha', name: 'Выступление' },
  persuasion: { ability: 'cha', name: 'Убеждение' },
} as const satisfies Record<string, { ability: Ability; name: string }>;
export type Skill = keyof typeof SKILLS;
export const SKILL_KEYS = Object.keys(SKILLS) as Skill[];

export const DAMAGE_TYPES = {
  acid: 'кислота',
  bludgeoning: 'дробящий',
  cold: 'холод',
  fire: 'огонь',
  force: 'силовое поле',
  lightning: 'электричество',
  necrotic: 'некротическая энергия',
  piercing: 'колющий',
  poison: 'яд',
  psychic: 'психическая энергия',
  radiant: 'излучение',
  slashing: 'рубящий',
  thunder: 'звук',
} as const;
export type DamageType = keyof typeof DAMAGE_TYPES;

export const CONDITIONS = {
  blinded: 'Ослеплённый',
  charmed: 'Очарованный',
  deafened: 'Оглохший',
  frightened: 'Испуганный',
  grappled: 'Схваченный',
  incapacitated: 'Недееспособный',
  invisible: 'Невидимый',
  paralyzed: 'Парализованный',
  petrified: 'Окаменевший',
  poisoned: 'Отравленный',
  prone: 'Сбитый с ног',
  restrained: 'Опутанный',
  stunned: 'Ошеломлённый',
  unconscious: 'Бессознательный',
} as const;
export type Condition = keyof typeof CONDITIONS;

export const SPELL_SCHOOLS = {
  abjuration: 'Ограждение',
  conjuration: 'Вызов',
  divination: 'Прорицание',
  enchantment: 'Очарование',
  evocation: 'Воплощение',
  illusion: 'Иллюзия',
  necromancy: 'Некромантия',
  transmutation: 'Преобразование',
} as const;
export type SpellSchool = keyof typeof SPELL_SCHOOLS;

/** Монеты по возрастанию ценности и их стоимость в медных. */
export const COINS = {
  cp: { name: 'мм', value: 1 },
  sp: { name: 'см', value: 10 },
  ep: { name: 'эм', value: 50 },
  gp: { name: 'зм', value: 100 },
  pp: { name: 'пм', value: 1000 },
} as const;
export type Coin = keyof typeof COINS;
export const COIN_ORDER: Coin[] = ['cp', 'sp', 'ep', 'gp', 'pp'];

/** Ячейки заклинаний полного заклинателя по уровню заклинателя (PHB, таблица мультикласса). */
export const FULL_CASTER_SLOTS: number[][] = [
  [],
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Ячейки колдуна (магия договора): [число ячеек, уровень ячейки] по уровню колдуна. */
export const PACT_SLOTS: [number, number][] = [
  [0, 0],
  [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
  [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
];

export const XP_THRESHOLDS = [
  0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000,
  165000, 195000, 225000, 265000, 305000, 355000,
];
