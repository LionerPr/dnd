import {
  ABILITIES,
  FULL_CASTER_SLOTS,
  PACT_SLOTS,
  SKILLS,
  SKILL_KEYS,
  type Ability,
  type Condition,
  type DamageType,
  type Skill,
} from './data.js';
import { editionOf } from './types.js';
import type {
  Character,
  CharacterClass,
  ContentIndex,
  Effect,
  Feature,
  Item,
  LevelCount,
  ProficiencyKind,
  Edition,
  Spellcasting,
  Subclass,
} from './types.js';
import { backgroundById } from './backgrounds.js';
import { tryFormula } from './formula.js';

/** Откуда умение или владение: раса, класс, предыстория, черта, своё, предмет */
export type FeatureFrom = 'race' | 'class' | 'background' | 'feat' | 'custom' | 'item';

/** Значение «по уровню»: { 3: 2, 10: 3 } на 12-м уровне даёт 3; число — как есть; ниже первого порога — 0. */
export function atLevel(count: LevelCount | undefined, level: number): number {
  if (count === undefined) return 0;
  if (typeof count === 'number') return count;
  const keys = Object.keys(count).map(Number).filter((k) => k <= level).sort((a, b) => b - a);
  return keys.length ? count[keys[0]!] ?? 0 : 0;
}

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

export const totalLevel = (c: Pick<Character, 'classes'>): number =>
  c.classes.reduce((sum, cl) => sum + cl.level, 0);

export const proficiencyBonus = (level: number): number => 2 + Math.floor((Math.max(level, 1) - 1) / 4);

export interface SourcedFeature extends Feature {
  /** Откуда умение: «Дварф», «Варвар 3», «Черта» */
  origin: string;
  from: FeatureFrom;
  /** Уровень класса-источника, нужен для ресурсов, зависящих от уровня */
  sourceLevel: number;
  /** Для умения с выбором частей (боевой стиль, метамагия): выбранные части */
  chosenParts?: string[];
}

/** Все активные умения персонажа: раса, подраса, классы и подклассы до текущего уровня, черты, ручные. */
/** Подкласс записи класса: свой или взятый у одноимённого класса другого издания */
/**
 * Подкласс другого издания у класса 2024: умения, которые в 2014 давались раньше, чем класс 2024 выбирает подкласс
 * (домен жреца на 1-м, круг друида на 2-м), приходят на уровне выбора подкласса — как советует Книга игрока 2024.
 */
export function adaptSubclass(sub: Subclass, from: CharacterClass | undefined, to: CharacterClass | undefined): Subclass {
  if (!to || !from || from.id === to.id) return sub;
  const at = to.subclassLevel;
  return { ...sub, features: sub.features.map((f) => ({ ...f, level: Math.max(f.level ?? from.subclassLevel, at) })) };
}

export function subclassOf(entry: Character['classes'][number], content: ContentIndex) {
  if (entry.subclassFrom && entry.subclassFrom !== entry.classId) {
    const from = content.classes.get(entry.subclassFrom);
    const s = from?.subclasses.find((x) => x.id === entry.subclassId);
    if (s) return adaptSubclass(s, from, content.classes.get(entry.classId));
  }
  return content.classes.get(entry.classId)?.subclasses.find((x) => x.id === entry.subclassId);
}

export function collectFeatures(c: Character, content: ContentIndex): SourcedFeature[] {
  const out: SourcedFeature[] = [];
  const lvl = totalLevel(c);
  const allowed = (f: Feature) => !f.optional || c.optionalFeatures.includes(f.id);

  const race = c.raceId ? content.races.get(c.raceId) : undefined;
  if (race) {
    // Раса из книг 2014 у персонажа 2024: увеличение характеристик даёт предыстория, а не раса (PHB 2024)
    const legacy = editionOf(c) === '2024' && editionOf(race) !== '2024';
    const adapt = (f: Feature): Feature =>
      legacy && f.effects?.some((e) => e.type === 'ability_bonus' || e.type === 'ability_choice')
        ? { ...f, effects: f.effects.filter((e) => e.type !== 'ability_bonus' && e.type !== 'ability_choice') }
        : f;
    for (const f of race.features) if (allowed(f)) out.push({ ...adapt(f), origin: race.name, from: 'race', sourceLevel: lvl });
    const sub = race.subraces?.find((s) => s.id === c.subraceId);
    if (sub) for (const f of sub.features) if (allowed(f)) out.push({ ...adapt(f), origin: sub.name, from: 'race', sourceLevel: lvl });
  }

  for (const entry of c.classes) {
    const cls = content.classes.get(entry.classId);
    if (!cls) continue;
    const unlocked = new Set(cls.levels.filter((l) => l.level <= entry.level).flatMap((l) => l.features));
    for (const f of cls.features) {
      const byLevel = f.level !== undefined ? f.level <= entry.level : unlocked.has(f.id);
      if (byLevel && allowed(f)) out.push({ ...f, origin: `${cls.name} ${entry.level}`, from: 'class', sourceLevel: entry.level });
    }
    const sub = subclassOf(entry, content);
    if (sub) {
      for (const f of sub.features) {
        if ((f.level ?? cls.subclassLevel) <= entry.level && allowed(f)) {
          out.push({ ...f, origin: sub.name, from: 'class', sourceLevel: entry.level });
        }
      }
    }
  }

  const bg = backgroundById(c.backgroundId);
  if (bg) {
    const effects: Effect[] = [{ type: 'proficiency', kind: 'skill', ids: bg.skills }];
    if (bg.tools?.length) effects.push({ type: 'proficiency', kind: 'tool', ids: bg.tools });
    if (bg.toolChoice) effects.push({ type: 'choice', id: 'bg.tools', kind: 'tool', pick: bg.toolChoice.pick, of: bg.toolChoice.of });
    if (bg.languages) effects.push({ type: 'choice', id: 'bg.languages', kind: 'language', pick: bg.languages, of: 'any' });
    if (bg.abilityPool) effects.push({ type: 'ability_choice', id: 'bg.asi', pick: bg.abilityPool.total, value: 1, from: bg.abilityPool.options, repeat: bg.abilityPool.max });
    out.push({ id: `bg.${bg.id}`, name: bg.feature.name, description: bg.feature.description, effects, origin: bg.name, from: 'background', sourceLevel: lvl });
    // 2024: предыстория даёт черту происхождения
    const feat = bg.featId ? content.feats.get(bg.featId) : undefined;
    if (feat && !c.featIds.includes(bg.featId!)) out.push({ ...feat, origin: bg.name, from: 'background', sourceLevel: lvl });
  }

  for (const id of c.featIds) {
    const feat = content.feats.get(id);
    if (feat) out.push({ ...feat, origin: 'Черта', from: 'feat', sourceLevel: lvl });
  }
  for (const f of c.extraFeatures) out.push({ ...f, origin: 'Своё', from: 'custom', sourceLevel: lvl });
  return out;
}

function itemEffectsActive(item: Item, equipped: boolean, attuned: boolean): boolean {
  if (!equipped) return false;
  return !item.attunement || attuned;
}

interface EffectWithLevel {
  effect: Effect;
  sourceLevel: number;
}

function collectEffects(c: Character, content: ContentIndex, features: SourcedFeature[]): EffectWithLevel[] {
  const effects: EffectWithLevel[] = [];
  for (const f of features) {
    for (const e of f.effects ?? []) effects.push({ effect: e, sourceLevel: f.sourceLevel });
    // Эффекты выбранных частей умения («Защитник» божественного порядка даёт тяжёлые доспехи)
    const picked = c.choices[`part.${f.id}`];
    if (picked?.length) for (const part of f.parts ?? []) if (picked.includes(part.name)) for (const e of part.effects ?? []) effects.push({ effect: e, sourceLevel: f.sourceLevel });
  }
  for (const inv of c.inventory) {
    const item = inv.itemId ? content.items.get(inv.itemId) : undefined;
    if (item?.effects && itemEffectsActive(item, !!inv.equipped, !!inv.attuned)) {
      for (const e of item.effects) effects.push({ effect: e, sourceLevel: totalLevel(c) });
    }
  }
  return effects;
}

/** Значение колонки из таблицы класса на текущем уровне персонажа («Боевые искусства»: «1к6») */
function classColumn(c: Character, content: ContentIndex, name: RegExp): string | undefined {
  for (const entry of c.classes) {
    const cls = content.classes.get(entry.classId);
    const rows = (cls?.levels ?? []).filter((l) => l.level <= entry.level).sort((a, b) => b.level - a.level);
    for (const row of rows) {
      const key = Object.keys(row.columns ?? {}).find((k) => name.test(k));
      if (key && row.columns![key] && row.columns![key] !== '—' && row.columns![key] !== '-') return row.columns![key];
    }
  }
  return undefined;
}

const isAsi = (f: Feature) => f.asi || /^увеличение характеристик/i.test(f.name);

/**
 * Увеличение характеристик у класса: на 4, 8, 12… уровнях (по таблице класса) игрок
 * распределяет +2 (одной +2 или двум по +1) либо берёт черту. Выбор хранится в choices[`asi.<класс>.<уровень>`].
 */
function asiEffects(c: Character, content: ContentIndex, effects: EffectWithLevel[]) {
  const origins = new Map<Effect, string>();
  for (const entry of c.classes) {
    const cls = content.classes.get(entry.classId);
    if (!cls) continue;
    for (const f of cls.features.filter(isAsi)) {
      if (f.effects?.some((e) => e.type === 'ability_bonus' || e.type === 'ability_choice')) continue;
      const fromTable = cls.levels.filter((l) => l.features.includes(f.id)).map((l) => l.level);
      const levels = fromTable.length ? fromTable : f.level ? [f.level] : [];
      for (const lvl of levels) {
        if (lvl > entry.level) continue;
        const e: Effect = { type: 'ability_choice', id: `asi.${cls.id}.${lvl}`, pick: 2, value: 1 };
        effects.push({ effect: e, sourceLevel: entry.level });
        origins.set(e, `${cls.name}, ${lvl} уровень: увеличение характеристик`);
      }
    }
  }
  return origins;
}

export interface SkillValue {
  key: Skill;
  name: string;
  ability: Ability;
  proficient: boolean;
  expertise: boolean;
  bonus: number;
}

export interface AttackLine {
  id: string;
  name: string;
  bonus: number;
  damage: string;
  /** Универсальное оружие двумя руками (боевой посох, длинный меч): урон с большей костью */
  versatile?: string;
  /** Двумя руками нельзя: в руке щит */
  versatileBlocked?: boolean;
  damageType?: DamageType;
  ability: Ability;
  range?: string;
  properties: string[];
}

export interface CasterInfo {
  classId: string;
  className: string;
  ability: Ability;
  saveDc: number;
  attackBonus: number;
  mode: Spellcasting['mode'];
  /** Уровень в этом классе */
  classLevel: number;
  /** Сколько можно знать заговоров (undefined — класс без заговоров или неизвестно) */
  cantripsMax?: number;
  /** Сколько заклинаний 1+ круга: известных (known) или подготовленных (prepared) */
  spellsMax?: number;
  /** Волшебник: сколько заклинаний в книге */
  bookMax?: number;
  /** Самый высокий круг, который доступен этому классу */
  maxSpellLevel: number;
  /** Колдун: круги мистического арканума (по одному заклинанию 6–9 круга, вне лимита) */
  arcanum?: number[];
  edition: Edition;
  /** Заклинания подкласса, которые всегда подготовлены (клятва, домен, круг): по названиям, их ищут в библиотеке */
  granted?: SubclassSpell[];
  /** Заклинания, которые подкласс добавляет в список класса (расширенный список колдуна) */
  extraList?: SubclassSpell[];
}

export interface SubclassSpell {
  name: string;
  nameEn?: string;
  /** Откуда: название подкласса */
  origin: string;
}

/**
 * Таблицы заклинаний подкласса из текста умений («Уровень паладина | Заклинания», «3 | приказ [command], …»).
 * Если первая колонка — уровень заклинания, это расширенный список (колдун); иначе — уровень класса, заклинания всегда подготовлены.
 * Умения с несколькими таблицами (круг земли — по местности) и таблицы не по уровням (склонность божественной души) пропускаем: там нужен выбор.
 */
export function subclassSpells(sub: Subclass, classLevel: number, fallbackLevel: number): { granted: SubclassSpell[]; extraList: SubclassSpell[] } {
  const granted: SubclassSpell[] = [];
  const extraList: SubclassSpell[] = [];
  for (const f of sub.features) {
    if ((f.level ?? fallbackLevel) > classLevel) continue;
    const lines = f.description.split('\n');
    const heads = lines.map((l, i) => [l, i] as const).filter(([l]) => /^[^|]*\|\s*заклинани[ея]\s*$/i.test(l.trim()));
    if (heads.length !== 1) continue;
    const [head, at] = heads[0]!;
    const bySpellLevel = /заклинани/i.test(head.split('|')[0]!);
    for (const line of lines.slice(at + 1)) {
      const m = line.trim().match(/^(\d+)(?:-?й)?\s*\|\s*(.+)$/);
      if (!m) break;
      if (!bySpellLevel && Number(m[1]) > classLevel) continue;
      for (const cell of m[2]!.split(/,\s*(?![^\[]*\])/)) {
        const s = cell.trim().match(/^(.+?)\s*(?:\[([^\]]+)\])?(?:\s*\(.*\))?$/);
        if (!s?.[1]) continue;
        const spell = { name: s[1].trim(), ...(s[2] ? { nameEn: s[2].trim() } : {}), origin: sub.name };
        (bySpellLevel ? extraList : granted).push(spell);
      }
    }
  }
  return { granted, extraList };
}

export interface ResourceValue {
  id: string;
  name: string;
  max: number;
  used: number;
  recharge: 'short' | 'long' | 'none';
}

export interface Sheet {
  level: number;
  proficiencyBonus: number;
  abilities: Record<Ability, { score: number; mod: number; save: number; saveProficient: boolean }>;
  skills: SkillValue[];
  passivePerception: number;
  initiative: number;
  ac: number;
  acSource: string;
  maxHp: number;
  hitDice: { die: number; total: number; used: number }[];
  speed: { walk: number; fly?: number; swim?: number; climb?: number };
  darkvision: number;
  resistances: DamageType[];
  immunities: DamageType[];
  vulnerabilities: DamageType[];
  conditionImmunities: Condition[];
  proficiencies: Record<ProficiencyKind, string[]>;
  features: SourcedFeature[];
  resources: ResourceValue[];
  spellSlots: { level: number; max: number; used: number }[];
  pactSlots: { level: number; max: number; used: number } | null;
  casters: CasterInfo[];
  attacks: AttackLine[];
  carried: { weight: number; capacity: number };
  /** Какие значения переопределены вручную */
  overridden: string[];
  /** Выборы, которые игрок ещё не сделал: id эффекта → сколько нужно выбрать */
  /** asi: можно вместо характеристик взять черту (значение выбора «feat:<id>:<название>») */
  /** kind feature — выбрать части умения featureId (боевой стиль); expertise — навыки для компетентности */
  pendingChoices: { id: string; kind: string; pick: number; of: string[] | 'any'; origin: string; asi?: boolean; featureId?: string; repeat?: number }[];
  edition: Edition;
  /** Все выборы владений (и сделанные, и нет) с источником — для счётчиков «Класс 1/2, Раса 0/1» */
  choiceGroups: { id: string; kind: ProficiencyKind; pick: number; of: string[] | 'any'; origin: string; from: FeatureFrom; chosen: string[] }[];
  /** Владения, данные без выбора, с источником */
  grants: { kind: ProficiencyKind; id: string; origin: string; from: FeatureFrom }[];
}

/** Таблицы 2014 для классов без колонок «Известные заговоры/заклинания» (по названию класса) */
const LIMITS_2014: Record<string, { cantrips?: number[]; known?: number[]; prepared?: 'full' | 'half'; book?: boolean }> = {
  'жрец': { cantrips: [0, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], prepared: 'full' },
  'друид': { cantrips: [0, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], prepared: 'full' },
  'волшебник': { cantrips: [0, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], prepared: 'full', book: true },
  'паладин': { prepared: 'half' },
  'изобретатель': { cantrips: [0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4], prepared: 'half' },
  'бард': { cantrips: [0, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], known: [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22] },
  'чародей': { cantrips: [0, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6], known: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15] },
  'колдун': { cantrips: [0, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], known: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15] },
  'следопыт': { known: [0, 0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11] },
};
/** Мистический рыцарь и мистический ловкач: заговоры и известные заклинания с 3 уровня */
const THIRD_CANTRIPS = [0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];
const THIRD_KNOWN = [0, 0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13];

/** Сколько заговоров и заклинаний положено классу на его уровне */
function spellLimits(cls: CharacterClass, sc: Spellcasting, lvl: number, abilityMod: number): { cantripsMax?: number; spellsMax?: number; bookMax?: number } {
  const at = (arr: number[] | undefined) => (arr ? arr[Math.min(lvl, arr.length - 1)] : undefined);
  const out: { cantripsMax?: number; spellsMax?: number; bookMax?: number } = {};
  // 1) Таблицы в самом классе (SRD 5.2)
  if (sc.cantrips || sc.spells) {
    out.cantripsMax = at(sc.cantrips) || undefined;
    out.spellsMax = at(sc.spells);
    if (sc.book) out.bookMax = sc.book.first + sc.book.perLevel * (lvl - 1);
    return out;
  }
  // 2) Колонки таблицы класса с dnd.su
  const col = (re: RegExp) => {
    const rows = cls.levels.filter((l) => l.level <= lvl).sort((a, b) => b.level - a.level);
    for (const r of rows) {
      const k = Object.keys(r.columns ?? {}).find((x) => re.test(x));
      if (k) {
        const n = Number(r.columns![k]!.match(/\d+/)?.[0]);
        return Number.isFinite(n) ? n : 0;
      }
    }
    return undefined;
  };
  const t = LIMITS_2014[cls.name.toLowerCase()];
  const third = sc.progression === 'third';
  out.cantripsMax = col(/заговор/i) ?? at(t?.cantrips) ?? (third ? at(THIRD_CANTRIPS) : undefined);
  out.spellsMax = col(/известн\S* заклинан/i) ?? at(t?.known) ?? (third ? at(THIRD_KNOWN) : undefined);
  if (out.spellsMax === undefined && t?.prepared) {
    const base = t.prepared === 'full' ? lvl : Math.floor(lvl / 2);
    out.spellsMax = base > 0 ? Math.max(1, abilityMod + base) : 0;
  }
  if (t?.book) out.bookMax = 6 + 2 * (lvl - 1);
  if (!out.cantripsMax) delete out.cantripsMax;
  return out;
}

function casterLevelFor(cls: CharacterClass, entryLevel: number, subclassCasting: Spellcasting | undefined, multiclass: boolean) {
  const sc = cls.spellcasting ?? subclassCasting;
  if (!sc || sc.progression === 'pact') return 0;
  if (sc.progression === 'full') return entryLevel;
  // В 2024 паладин и следопыт колдуют с 1 уровня
  if (sc.progression === 'half') return multiclass ? Math.floor(entryLevel / 2) : entryLevel < (editionOf(cls) === '2024' ? 1 : 2) ? 0 : Math.ceil(entryLevel / 2);
  return multiclass ? Math.floor(entryLevel / 3) : entryLevel < 3 ? 0 : Math.ceil(entryLevel / 3);
}

export function computeSheet(c: Character, content: ContentIndex): Sheet {
  const level = totalLevel(c);
  const pb = proficiencyBonus(level);
  const features = collectFeatures(c, content);
  const effects = collectEffects(c, content, features);
  const asiOrigins = asiEffects(c, content, effects);
  const overridden: string[] = [];
  const ov = (key: string, value: number) => {
    const o = c.overrides[key];
    if (o === undefined) return value;
    overridden.push(key);
    return o;
  };

  // --- Характеристики
  const scores = { ...c.baseAbilities };
  for (const { effect: e } of effects) {
    if (e.type === 'ability_bonus') scores[e.ability] += e.value;
    if (e.type === 'ability_choice') {
      const taken = new Map<string, number>();
      for (const a of (c.choices[e.id] ?? []).slice(0, e.pick)) {
        if (!(ABILITIES as readonly string[]).includes(a)) continue;
        const n = (taken.get(a) ?? 0) + 1;
        if (e.repeat && n > e.repeat) continue;
        taken.set(a, n);
        scores[a as Ability] += e.value;
      }
    }
  }
  for (const a of ABILITIES) scores[a] = ov(`ability.${a}`, Math.min(scores[a], 30));
  const mod = (a: Ability) => abilityMod(scores[a]);

  // --- Владения
  const profs: Record<ProficiencyKind, Set<string>> = {
    armor: new Set(), weapon: new Set(), tool: new Set(), language: new Set(c.languages), save: new Set(), skill: new Set(),
  };
  const firstClass = c.classes[0] ? content.classes.get(c.classes[0].classId) : undefined;
  if (firstClass) {
    firstClass.saves.forEach((s) => profs.save.add(s));
    firstClass.armor.forEach((s) => profs.armor.add(s));
    firstClass.weapons.forEach((s) => profs.weapon.add(s));
    // Старые импорты: «Выберите один вид инструмента…» попадал в список как текст
    firstClass.tools.filter((t) => !/выберите|^либо|выбор/i.test(t)).forEach((s) => profs.tool.add(s));
    (c.choices[`class.${firstClass.id}.skills`] ?? []).slice(0, firstClass.skillChoices.pick).forEach((s) => profs.skill.add(s));
  }
  const pendingChoices: Sheet['pendingChoices'] = [];
  const choiceGroups: Sheet['choiceGroups'] = [];
  const grants: Sheet['grants'] = [];
  const sourceOf = (e: Effect) => {
    const f = features.find((x) => x.effects?.includes(e));
    return { origin: f?.origin ?? 'Предмет', from: f?.from ?? ('item' as const) };
  };
  if (firstClass) {
    firstClass.saves.forEach((id) => grants.push({ kind: 'save', id, origin: firstClass.name, from: 'class' }));
    firstClass.tools.filter((t) => !/выберите|^либо|выбор/i.test(t)).forEach((id) => grants.push({ kind: 'tool', id, origin: firstClass.name, from: 'class' }));
    choiceGroups.push({
      id: `class.${firstClass.id}.skills`, kind: 'skill', pick: firstClass.skillChoices.pick, of: firstClass.skillChoices.from, origin: firstClass.name, from: 'class',
      chosen: (c.choices[`class.${firstClass.id}.skills`] ?? []).slice(0, firstClass.skillChoices.pick),
    });
    const chosen = c.choices[`class.${firstClass.id}.skills`]?.length ?? 0;
    if (chosen < firstClass.skillChoices.pick) {
      pendingChoices.push({ id: `class.${firstClass.id}.skills`, kind: 'skill', pick: firstClass.skillChoices.pick - chosen, of: firstClass.skillChoices.from, origin: firstClass.name });
    }
  }
  const expertise = new Set<Skill>();
  for (const { effect: e } of effects) {
    if (e.type === 'proficiency') {
      const src = sourceOf(e);
      e.ids.forEach((id) => {
        profs[e.kind].add(id);
        grants.push({ kind: e.kind, id, ...src });
      });
    }
    if (e.type === 'choice') {
      const chosen = (c.choices[e.id] ?? []).slice(0, e.pick);
      chosen.forEach((id) => profs[e.kind].add(id));
      const src = sourceOf(e);
      choiceGroups.push({ id: e.id, kind: e.kind, pick: e.pick, of: e.of, chosen, ...src });
      if (chosen.length < e.pick) pendingChoices.push({ id: e.id, kind: e.kind, pick: e.pick - chosen.length, of: e.of, origin: src.origin });
    }
    if (e.type === 'ability_choice') {
      const values = c.choices[e.id] ?? [];
      const tookFeat = values.some((v) => v.startsWith('feat:'));
      if (!tookFeat && values.length < e.pick) {
        const asi = asiOrigins.get(e);
        const origin = asi ?? features.find((f) => f.effects?.includes(e))?.origin ?? '';
        pendingChoices.push({ id: e.id, kind: 'ability', pick: e.pick - values.length, of: e.from ?? [...ABILITIES], origin, ...(asi ? { asi: true } : {}), ...(e.repeat ? { repeat: e.repeat } : {}) });
      }
    }
    if (e.type === 'expertise') e.skills.forEach((s) => expertise.add(s));
  }

  // Умения с выбором частей: боевой стиль, метамагия, воззвания
  for (const f of features) {
    if (f.choose === undefined || !f.parts?.length) continue;
    const id = `part.${f.id}`;
    const count = atLevel(f.choose, f.sourceLevel);
    const available = f.parts.filter((p) => (p.minLevel ?? 0) <= f.sourceLevel).map((p) => p.name);
    const chosen = (c.choices[id] ?? []).filter((n) => available.includes(n)).slice(0, count);
    f.chosenParts = chosen;
    if (chosen.length < count) {
      pendingChoices.push({ id, kind: 'feature', pick: count - chosen.length, of: available.filter((n) => !chosen.includes(n)), origin: `${f.origin}: ${f.name}`, featureId: f.id });
    }
  }
  // Ручные правки игрока на листе: добавить/убрать владение навыком или спасброском, компетентность
  for (const k of c.choices['manual.skills'] ?? []) if ((SKILL_KEYS as readonly string[]).includes(k)) profs.skill.add(k as Skill);
  for (const k of c.choices['manual.skillsOff'] ?? []) profs.skill.delete(k as Skill);
  for (const k of c.choices['manual.saves'] ?? []) if ((ABILITIES as readonly string[]).includes(k)) profs.save.add(k as Ability);
  for (const k of c.choices['manual.savesOff'] ?? []) profs.save.delete(k as Ability);
  for (const k of c.choices['manual.expertise'] ?? []) if ((SKILL_KEYS as readonly string[]).includes(k)) expertise.add(k as Skill);
  // Компетентность: из навыков, которыми персонаж уже владеет
  for (const { effect: e, sourceLevel } of effects) {
    if (e.type !== 'expertise_choice') continue;
    const count = atLevel(e.pick, sourceLevel);
    const options = [...SKILL_KEYS.filter((k) => profs.skill.has(k)), ...(e.tools ?? []).filter((t) => profs.tool.has(t))];
    const chosen = (c.choices[e.id] ?? []).filter((x) => options.includes(x)).slice(0, count);
    chosen.forEach((x) => (SKILL_KEYS as readonly string[]).includes(x) && expertise.add(x as Skill));
    if (chosen.length < count) {
      const origin = features.find((f) => f.effects?.includes(e))?.origin ?? '';
      pendingChoices.push({ id: e.id, kind: 'expertise', pick: count - chosen.length, of: options.filter((o) => !chosen.includes(o)), origin });
    }
  }

  const abilities = Object.fromEntries(
    ABILITIES.map((a) => {
      const saveProficient = profs.save.has(a);
      return [a, { score: scores[a], mod: mod(a), saveProficient, save: ov(`save.${a}`, mod(a) + (saveProficient ? pb : 0)) }];
    }),
  ) as Sheet['abilities'];

  const skills: SkillValue[] = SKILL_KEYS.map((key) => {
    const def = SKILLS[key];
    const proficient = profs.skill.has(key);
    const exp = proficient && expertise.has(key);
    const bonus = mod(def.ability) + (exp ? pb * 2 : proficient ? pb : 0);
    return { key, name: def.name, ability: def.ability, proficient, expertise: exp, bonus: ov(`skill.${key}`, bonus) };
  });
  const perception = skills.find((s) => s.key === 'perception')!.bonus;

  // --- Защита
  const equipped = c.inventory
    .filter((i) => i.equipped && i.itemId)
    .map((i) => content.items.get(i.itemId!))
    .filter((i): i is Item => !!i);
  const armor = equipped.find((i) => i.armor);
  const shield = equipped.find((i) => i.shield);
  let ac = 10 + mod('dex');
  let acSource = 'Без доспехов';
  if (armor?.armor) {
    const dex = armor.armor.dexCap === null ? mod('dex') : Math.min(mod('dex'), armor.armor.dexCap);
    ac = armor.armor.base + dex;
    acSource = armor.name;
  } else {
    for (const { effect: e } of effects) {
      if (e.type !== 'ac_formula' || (shield && !e.allowShield)) continue;
      const v = e.base + e.abilities.reduce((s, a) => s + mod(a), 0);
      if (v > ac) {
        ac = v;
        acSource = features.find((f) => f.effects?.includes(e))?.name ?? 'Защита без доспехов';
      }
    }
  }
  if (shield?.shield) ac += shield.shield.bonus;
  for (const { effect: e } of effects) if (e.type === 'ac_bonus') ac += e.value;

  // --- Хиты
  const conMod = mod('con');
  let maxHp = 0;
  let levelIndex = 0;
  const hitDice: Sheet['hitDice'] = [];
  for (const entry of c.classes) {
    const cls = content.classes.get(entry.classId);
    const die = cls?.hitDie ?? 8;
    for (let i = 0; i < entry.level; i++) {
      const roll = levelIndex === 0 ? die : c.hpRolls[levelIndex] ?? die / 2 + 1;
      maxHp += Math.max(1, roll + conMod);
      levelIndex++;
    }
    const existing = hitDice.find((h) => h.die === die);
    if (existing) existing.total += entry.level;
    else hitDice.push({ die, total: entry.level, used: 0 });
  }
  for (const h of hitDice) h.used = Math.min(h.total, c.state.hitDiceUsed[h.die] ?? 0);
  for (const { effect: e, sourceLevel } of effects) {
    if (e.type === 'hp_per_level') maxHp += e.value * level;
    if (e.type === 'formula_bonus' && e.target === 'hp') maxHp += tryFormula(e.expr, { LVL: sourceLevel, PROF: pb, CON: mod('con') });
  }
  maxHp = ov('maxHp', maxHp) + c.state.maxHpModifier;
  if (c.state.exhaustion >= 4) maxHp = Math.floor(maxHp / 2);
  maxHp = Math.max(maxHp, 1);

  // --- Скорость и чувства
  const race = c.raceId ? content.races.get(c.raceId) : undefined;
  const speed: Sheet['speed'] = { walk: race?.speed ?? 30 };
  let darkvision = 0;
  const resist = new Set<DamageType>(), immune = new Set<DamageType>(), vuln = new Set<DamageType>();
  const condImmune = new Set<Condition>();
  let initBonus = 0;
  const resources: ResourceValue[] = [];
  const vars = (lvl: number) => ({
    LVL: lvl, PROF: pb, STR: mod('str'), DEX: mod('dex'), CON: mod('con'), INT: mod('int'), WIS: mod('wis'), CHA: mod('cha'),
  });
  for (const { effect: e, sourceLevel } of effects) {
    switch (e.type) {
      case 'speed':
        for (const k of ['walk', 'fly', 'swim', 'climb'] as const) {
          const v = e[k];
          if (v !== undefined) speed[k] = Math.max(speed[k] ?? 0, v);
        }
        break;
      case 'darkvision': darkvision = Math.max(darkvision, e.range); break;
      case 'resistance': resist.add(e.damage); break;
      case 'immunity': immune.add(e.damage); break;
      case 'vulnerability': vuln.add(e.damage); break;
      case 'condition_immunity': condImmune.add(e.condition); break;
      case 'initiative_bonus': initBonus += e.value; break;
      case 'formula_bonus': if (e.target === 'initiative') initBonus += tryFormula(e.expr, vars(sourceLevel)); break;
      case 'resource': {
        const max = e.maxExpr ? Math.max(0, tryFormula(e.maxExpr, vars(sourceLevel))) : atLevel(e.max, sourceLevel);
        const prev = resources.find((r) => r.id === e.id);
        if (prev) prev.max = Math.max(prev.max, max);
        else resources.push({ id: e.id, name: e.name, max, used: 0, recharge: e.recharge });
        break;
      }
    }
  }
  for (const r of resources) r.used = Math.min(r.max, c.state.resourcesUsed[r.id] ?? 0);
  // «Движение без доспехов» монаха и подобное: колонка таблицы класса, только без доспеха и щита
  const unarmoredMove = Number(classColumn(c, content, /скорость без доспехов/i)?.match(/\d+/)?.[0] ?? 0);
  if (unarmoredMove && !armor && !shield) speed.walk += unarmoredMove;
  if (c.state.exhaustion >= 5) speed.walk = 0;
  else if (c.state.exhaustion >= 2) speed.walk = Math.floor(speed.walk / 2);

  // --- Заклинания
  const multiclass = c.classes.length > 1;
  let casterLevel = 0;
  let warlockLevel = 0;
  const casters: CasterInfo[] = [];
  for (const entry of c.classes) {
    const cls = content.classes.get(entry.classId);
    if (!cls) continue;
    const sub = subclassOf(entry, content);
    const sc = cls.spellcasting ?? sub?.spellcasting;
    if (!sc) continue;
    if (sc.progression === 'pact') warlockLevel += entry.level;
    else casterLevel += casterLevelFor(cls, entry.level, sub?.spellcasting, multiclass);
    const ownSlots = sc.progression === 'pact' ? null : FULL_CASTER_SLOTS[Math.min(casterLevelFor(cls, entry.level, sub?.spellcasting, false), 20)] ?? [];
    const maxSpellLevel = sc.progression === 'pact' ? (PACT_SLOTS[Math.min(entry.level, 20)]?.[1] ?? 0) : ownSlots!.filter((n) => n > 0).length;
    const limits = spellLimits(cls, sc, entry.level, mod(sc.ability));
    casters.push({
      classId: cls.id,
      className: cls.name,
      ability: sc.ability,
      saveDc: ov(`spellDc.${cls.id}`, 8 + pb + mod(sc.ability)),
      attackBonus: ov(`spellAttack.${cls.id}`, pb + mod(sc.ability)),
      mode: sc.mode,
      classLevel: entry.level,
      maxSpellLevel,
      edition: editionOf(cls),
      ...limits,
      ...(sub ? (({ granted, extraList }) => ({ ...(granted.length ? { granted } : {}), ...(extraList.length ? { extraList } : {}) }))(subclassSpells(sub, entry.level, cls.subclassLevel)) : {}),
      ...(sc.progression === 'pact' && entry.level >= 11 ? { arcanum: [[11, 6], [13, 7], [15, 8], [17, 9]].filter(([l]) => entry.level >= l!).map(([, s]) => s!) } : {}),
    });
  }
  // Бонусы к числу заговоров и заклинаний от умений — первому заклинателю
  if (casters[0]) {
    for (const { effect: e } of effects) {
      if (e.type !== 'spell_bonus') continue;
      if (e.cantrips) casters[0].cantripsMax = (casters[0].cantripsMax ?? 0) + e.cantrips;
      if (e.spells && casters[0].spellsMax !== undefined) casters[0].spellsMax += e.spells;
    }
  }
  const slotRow = FULL_CASTER_SLOTS[Math.min(casterLevel, 20)] ?? [];
  const spellSlots = slotRow.map((max, i) => ({ level: i + 1, max, used: Math.min(max, c.state.spellSlotsUsed[i + 1] ?? 0) }));
  const pact = warlockLevel > 0 ? PACT_SLOTS[Math.min(warlockLevel, 20)]! : null;
  const pactSlots = pact ? { level: pact[1], max: pact[0], used: Math.min(pact[0], c.state.pactSlotsUsed) } : null;

  // --- Атаки
  const attacks: AttackLine[] = [];
  // «Боевые искусства» монаха: кость из таблицы класса
  const martialRaw = classColumn(c, content, /боевые искусства/i);
  const martial = martialRaw && /^\d+к\d+$/.test(martialRaw) ? martialRaw : undefined;
  const dieSize = (d: string) => Number(d.match(/к(\d+)/)?.[1] ?? 0);
  const bigger = (d: string) => (martial && dieSize(martial) > dieSize(d) ? martial : d);
  const withMod = (d: string, m: number) => `${d}${m === 0 ? '' : m > 0 ? `+${m}` : `${m}`}`;
  for (const inv of c.inventory) {
    const item = inv.itemId ? content.items.get(inv.itemId) : undefined;
    if (!item?.weapon || !inv.equipped) continue;
    const w = item.weapon;
    const finesse = w.properties.some((p) => /фехтовальное|finesse/i.test(p));
    // Оружие монаха: короткий меч и простое рукопашное без «тяжёлое» и «двуручное» — Ловкостью и костью боевых искусств
    const monkWeapon =
      !!martial && !w.ranged && (/^короткий меч$/i.test(item.name) || (!w.martial && !w.properties.some((p) => /тяж[её]л|двуручн/i.test(p))));
    const ability: Ability = w.ranged ? 'dex' : (finesse || monkWeapon) && mod('dex') > mod('str') ? 'dex' : 'str';
    const proficient =
      profs.weapon.has(item.id) || profs.weapon.has(w.martial ? 'martial' : 'simple') || profs.weapon.has(item.name.toLowerCase());
    const m = mod(ability);
    const twoHanded = w.versatile ?? w.properties.join(' ').match(/универсальное\s*\((\d+к\d+)\)/i)?.[1];
    attacks.push({
      id: inv.id,
      name: item.name,
      bonus: ov(`attack.${inv.id}`, m + (proficient ? pb : 0)),
      damage: withMod(monkWeapon ? bigger(w.damage) : w.damage, m),
      ...(twoHanded ? { versatile: withMod(monkWeapon ? bigger(twoHanded) : twoHanded, m), ...(shield ? { versatileBlocked: true } : {}) } : {}),
      damageType: w.damageType,
      ability,
      range: w.range,
      properties: monkWeapon ? [...w.properties, 'оружие монаха'] : w.properties,
    });
  }

  // Безоружный удар монаха: кость из таблицы класса, Ловкостью или Силой
  if (martial) {
    const ability: Ability = mod('dex') > mod('str') ? 'dex' : 'str';
    const m = mod(ability);
    attacks.push({
      id: 'unarmed',
      name: 'Безоружный удар',
      bonus: ov('attack.unarmed', m + pb),
      damage: `${martial}${m === 0 ? '' : m > 0 ? `+${m}` : `${m}`}`,
      damageType: 'bludgeoning',
      ability,
      properties: ['боевые искусства'],
    });
  }

  // --- Переносимый вес
  let weight = 0;
  for (const inv of c.inventory) {
    const item = inv.itemId ? content.items.get(inv.itemId) : undefined;
    weight += (item?.weight ?? 0) * inv.qty;
  }

  return {
    level,
    proficiencyBonus: pb,
    abilities,
    skills,
    passivePerception: ov('passivePerception', 10 + perception),
    initiative: ov('initiative', mod('dex') + initBonus),
    ac: ov('ac', ac),
    acSource,
    maxHp,
    hitDice,
    speed,
    darkvision,
    resistances: [...resist],
    immunities: [...immune],
    vulnerabilities: [...vuln],
    conditionImmunities: [...condImmune],
    proficiencies: Object.fromEntries(Object.entries(profs).map(([k, v]) => [k, [...v]])) as Sheet['proficiencies'],
    features,
    resources,
    spellSlots,
    pactSlots,
    casters,
    attacks,
    carried: { weight: Math.round(weight * 10) / 10, capacity: scores.str * 15 },
    overridden,
    pendingChoices,
    edition: c.edition ?? '2014',
    choiceGroups,
    grants,
  };
}
