import type { Ability, Coin, Condition, DamageType, Skill, SpellSchool } from './data.js';

// ---------- Эффекты: машинные правила, которые лист применяет сам ----------

export type ProficiencyKind = 'armor' | 'weapon' | 'tool' | 'language' | 'save' | 'skill';

export type Effect =
  | { type: 'ability_bonus'; ability: Ability; value: number }
  /** «+2 к одной и +1 к другой на выбор»: игрок выбирает, выбор хранится в character.choices */
  | { type: 'ability_choice'; id: string; pick: number; value: number; from?: Ability[]; repeat?: number }
  | { type: 'speed'; walk?: number; fly?: number; swim?: number; climb?: number }
  | { type: 'darkvision'; range: number }
  | { type: 'resistance' | 'immunity' | 'vulnerability'; damage: DamageType }
  | { type: 'condition_immunity'; condition: Condition }
  | { type: 'proficiency'; kind: ProficiencyKind; ids: string[] }
  /** Выбор из списка (навыки, инструменты, языки): выбранное хранится в character.choices[id] */
  | { type: 'choice'; id: string; kind: ProficiencyKind; pick: number; of: string[] | 'any' }
  | { type: 'expertise'; skills: Skill[] }
  /** «Компетентность»: удвоить бонус мастерства для N навыков, которыми персонаж владеет. pick — число или «уровень класса → всего» */
  | { type: 'expertise_choice'; id: string; pick: LevelCount; tools?: string[] }
  | { type: 'hp_per_level'; value: number }
  | { type: 'ac_bonus'; value: number }
  /** Защита без доспехов и подобное: 10 + модификаторы */
  | { type: 'ac_formula'; base: number; abilities: Ability[]; allowShield: boolean }
  | { type: 'initiative_bonus'; value: number }
  /** Бонус по формуле: «[PROF]» к инициативе, «[LVL]» к хитам. Переменные: [LVL] (уровень класса), [PROF], [STR]…[CHA] (модификаторы) */
  | { type: 'formula_bonus'; target: 'initiative' | 'hp' | 'ac'; expr: string }
  /** maxExpr — максимум по формуле («max([CHA],1)», «5*[LVL]»); если задан, важнее max */
  | { type: 'resource'; id: string; name: string; max: number | Partial<Record<number, number>>; maxExpr?: string; recharge: 'short' | 'long' | 'none' };

/** Число, растущее с уровнем класса: { 3: 2, 10: 3, 17: 4 } — с 3-го уровня 2, с 10-го 3… */
export type LevelCount = number | Partial<Record<number, number>>;

/** Часть умения: техника ци, вариант боевого стиля, метамагия, воззвание */
export interface FeaturePart {
  name: string;
  description: string;
  /** Опциональный вариант (например, из «Котла Таши») */
  optional?: boolean;
  /** Доступно с этого уровня класса */
  minLevel?: number;
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  level?: number;
  effects?: Effect[];
  /** Опциональное правило (например, из «Котла Таши»): включается в настройках персонажа */
  optional?: boolean;
  /** «Увеличение характеристик»: на каждом уровне, где умение открывается, игрок выбирает +2/+1+1 или черту */
  asi?: boolean;
  /** Части умения: показываются отдельными карточками */
  parts?: FeaturePart[];
  /** Сколько частей игрок выбирает (по уровню класса). Без этого поля действуют все части. Выбор — в choices[`part.<id умения>`] */
  choose?: LevelCount;
}

// ---------- Контент: расы, классы, заклинания, предметы, монстры ----------

export type ContentSource = 'custom' | 'srd' | 'dnd.su';

/** Издание правил: 2014 (5e) или 2024 (5.5e). Без поля — 2014. */
export type Edition = '2014' | '2024';
export const EDITIONS: { id: Edition; name: string; note: string }[] = [
  { id: '2014', name: 'D&D 5e', note: 'Правила 2014 года' },
  { id: '2024', name: 'D&D 5.5e', note: 'Обновлённые правила 2024 года' },
];
export const editionOf = (x: { edition?: Edition } | undefined | null): Edition => x?.edition ?? '2014';

export interface ContentMeta {
  id: string;
  name: string;
  source: ContentSource;
  sourceUrl?: string;
  /** Книга-источник, например «Player's Handbook» */
  book?: string;
  /** Название на английском */
  nameEn?: string;
  edition?: Edition;
}

export interface Race extends ContentMeta {
  kind: 'race';
  size: 'tiny' | 'small' | 'medium' | 'large';
  speed: number;
  description?: string;
  features: Feature[];
  subraces?: Subrace[];
}

export interface Subrace {
  id: string;
  name: string;
  features: Feature[];
}

export interface ClassLevel {
  level: number;
  /** id умений из features, которые открываются на этом уровне */
  features: string[];
  /** Колонки таблицы класса: «Ярость: 2», «Известные заговоры: 3» */
  columns?: Record<string, string>;
}

export interface Spellcasting {
  ability: Ability;
  /** full — волшебник, жрец; half — паладин, следопыт; third — мистический рыцарь; pact — колдун */
  progression: 'full' | 'half' | 'third' | 'pact';
  /** prepared — готовит из списка класса; known — знает фиксированное число */
  mode: 'prepared' | 'known';
  ritual?: boolean;
}

export interface CharacterClass extends ContentMeta {
  kind: 'class';
  hitDie: number;
  saves: Ability[];
  armor: string[];
  weapons: string[];
  tools: string[];
  skillChoices: { pick: number; from: Skill[] };
  equipment?: string;
  /** Стартовое снаряжение по вариантам (2024): «Снаряжение» — предметы и немного золота, «Золото» — только золото */
  kit?: { label: string; items: string[]; gold: number }[];
  /** Для карточки: главные характеристики (варианты «или») и сложность 0–2 */
  hint?: { main: Ability[][]; complexity: number };
  description?: string;
  spellcasting?: Spellcasting;
  features: Feature[];
  levels: ClassLevel[];
  subclassLevel: number;
  subclasses: Subclass[];
}

export interface Subclass {
  id: string;
  name: string;
  description?: string;
  features: Feature[];
  spellcasting?: Spellcasting;
}

export interface Spell extends ContentMeta {
  kind: 'spell';
  level: number;
  school: SpellSchool;
  castingTime: string;
  range: string;
  components: { v: boolean; s: boolean; m?: string };
  duration: string;
  concentration: boolean;
  ritual: boolean;
  classes: string[];
  /** Как на странице источника: «волшебник», «путь четырёх стихий (монах)» */
  classNames?: string[];
  subclassNames?: string[];
  nameEn?: string;
  description: string;
  higherLevels?: string;
  /** Формула урона/лечения для кнопки «сотворить», например «8к6» */
  /** cantripScaling: заговор усиливается на 5, 11 и 17 уровнях персонажа */
  damage?: { dice: string; type?: DamageType; perSlotAbove?: string; cantripScaling?: boolean };
  heal?: { dice: string; perSlotAbove?: string };
  save?: Ability;
  attack?: 'melee' | 'ranged';
}

export interface Item extends ContentMeta {
  kind: 'item';
  category: 'weapon' | 'armor' | 'shield' | 'gear' | 'tool' | 'magic' | 'consumable' | 'other';
  weight?: number;
  cost?: { amount: number; coin: Coin };
  description?: string;
  rarity?: string;
  attunement?: boolean;
  weapon?: {
    damage: string;
    damageType: DamageType;
    versatile?: string;
    properties: string[];
    range?: string;
    martial: boolean;
    ranged: boolean;
  };
  armor?: { base: number; dexCap: number | null; type: 'light' | 'medium' | 'heavy'; stealthDisadvantage?: boolean; strength?: number };
  shield?: { bonus: number };
  effects?: Effect[];
}

export interface MonsterAction {
  name: string;
  description: string;
  attackBonus?: number;
  damage?: string;
  damageType?: DamageType;
}

export interface Monster extends ContentMeta {
  kind: 'monster';
  size: string;
  type: string;
  alignment?: string;
  ac: number;
  acNote?: string;
  hp: number;
  hpFormula?: string;
  speed: string;
  abilities: Record<Ability, number>;
  saves?: Partial<Record<Ability, number>>;
  skills?: Partial<Record<Skill, number>>;
  resistances?: DamageType[];
  immunities?: DamageType[];
  vulnerabilities?: DamageType[];
  conditionImmunities?: Condition[];
  senses?: string;
  languages?: string;
  cr: string;
  xp?: number;
  traits: MonsterAction[];
  actions: MonsterAction[];
  bonusActions?: MonsterAction[];
  reactions?: MonsterAction[];
  legendary?: MonsterAction[];
  /** Вступление к легендарным действиям: сколько их за раунд */
  legendaryIntro?: string;
  /** Логово, действия логова, региональные эффекты и описание — как текст */
  description?: string;
  /** Местность обитания */
  habitat?: string;
}

export type Content = Race | CharacterClass | Spell | Item | Monster;

// ---------- Персонаж ----------

export type Money = Record<Coin, number>;

export interface InventoryEntry {
  id: string;
  itemId?: string;
  /** Предмет без карточки в каталоге: просто название */
  name?: string;
  qty: number;
  equipped?: boolean;
  attuned?: boolean;
  notes?: string;
}

export interface CharacterState {
  hp: number;
  tempHp: number;
  /** Временное изменение максимума (например, от некротического урона) */
  maxHpModifier: number;
  deathSaves: { success: number; failure: number };
  dead: boolean;
  conditions: Condition[];
  exhaustion: number;
  /** Потраченные кости хитов по размеру кости: { 8: 2 } */
  hitDiceUsed: Record<number, number>;
  /** Использованные ячейки по уровню: { 1: 2, 3: 1 } */
  spellSlotsUsed: Record<number, number>;
  pactSlotsUsed: number;
  /** Потраченные заряды ресурсов по id ресурса */
  resourcesUsed: Record<string, number>;
  concentration?: string;
  inspiration: boolean;
  money: Money;
  xp: number;
}

export interface Character {
  id: string;
  name: string;
  raceId?: string;
  subraceId?: string;
  classes: { classId: string; level: number; subclassId?: string }[];
  baseAbilities: Record<Ability, number>;
  /** Выборы игрока: ключ — id эффекта choice / ability_choice, значение — выбранные id */
  choices: Record<string, string[]>;
  /** Ручные переопределения вычисленных значений: { ac: 18, 'skill.stealth': 7 } */
  overrides: Record<string, number>;
  /** Дополнительные умения и черты, добавленные вручную */
  extraFeatures: Feature[];
  featIds: string[];
  /** id заклинаний: известные и подготовленные */
  spellsKnown: string[];
  spellsPrepared: string[];
  inventory: InventoryEntry[];
  /** Включённые опциональные умения (id) */
  optionalFeatures: string[];
  hpRolls: number[];
  edition?: Edition;
  /** Предыстория из Книги игрока (id из BACKGROUNDS); background — её название или своя */
  backgroundId?: string;
  background?: string;
  alignment?: string;
  appearance?: string;
  backstory?: string;
  notes?: string;
  languages: string[];
  state: CharacterState;
}

export interface ContentIndex {
  races: Map<string, Race>;
  classes: Map<string, CharacterClass>;
  spells: Map<string, Spell>;
  items: Map<string, Item>;
  feats: Map<string, Feature>;
}
