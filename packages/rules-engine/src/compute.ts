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
import type {
  Character,
  CharacterClass,
  ContentIndex,
  Effect,
  Feature,
  Item,
  ProficiencyKind,
  Spellcasting,
} from './types.js';

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

export const totalLevel = (c: Pick<Character, 'classes'>): number =>
  c.classes.reduce((sum, cl) => sum + cl.level, 0);

export const proficiencyBonus = (level: number): number => 2 + Math.floor((Math.max(level, 1) - 1) / 4);

export interface SourcedFeature extends Feature {
  /** Откуда умение: «Дварф», «Варвар 3», «Черта» */
  origin: string;
  /** Уровень класса-источника, нужен для ресурсов, зависящих от уровня */
  sourceLevel: number;
}

/** Все активные умения персонажа: раса, подраса, классы и подклассы до текущего уровня, черты, ручные. */
export function collectFeatures(c: Character, content: ContentIndex): SourcedFeature[] {
  const out: SourcedFeature[] = [];
  const lvl = totalLevel(c);
  const allowed = (f: Feature) => !f.optional || c.optionalFeatures.includes(f.id);

  const race = c.raceId ? content.races.get(c.raceId) : undefined;
  if (race) {
    for (const f of race.features) if (allowed(f)) out.push({ ...f, origin: race.name, sourceLevel: lvl });
    const sub = race.subraces?.find((s) => s.id === c.subraceId);
    if (sub) for (const f of sub.features) if (allowed(f)) out.push({ ...f, origin: sub.name, sourceLevel: lvl });
  }

  for (const entry of c.classes) {
    const cls = content.classes.get(entry.classId);
    if (!cls) continue;
    const unlocked = new Set(cls.levels.filter((l) => l.level <= entry.level).flatMap((l) => l.features));
    for (const f of cls.features) {
      const byLevel = f.level !== undefined ? f.level <= entry.level : unlocked.has(f.id);
      if (byLevel && allowed(f)) out.push({ ...f, origin: `${cls.name} ${entry.level}`, sourceLevel: entry.level });
    }
    const sub = cls.subclasses.find((s) => s.id === entry.subclassId);
    if (sub) {
      for (const f of sub.features) {
        if ((f.level ?? cls.subclassLevel) <= entry.level && allowed(f)) {
          out.push({ ...f, origin: sub.name, sourceLevel: entry.level });
        }
      }
    }
  }

  for (const id of c.featIds) {
    const feat = content.feats.get(id);
    if (feat) out.push({ ...feat, origin: 'Черта', sourceLevel: lvl });
  }
  for (const f of c.extraFeatures) out.push({ ...f, origin: 'Своё', sourceLevel: lvl });
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
  for (const f of features) for (const e of f.effects ?? []) effects.push({ effect: e, sourceLevel: f.sourceLevel });
  for (const inv of c.inventory) {
    const item = inv.itemId ? content.items.get(inv.itemId) : undefined;
    if (item?.effects && itemEffectsActive(item, !!inv.equipped, !!inv.attuned)) {
      for (const e of item.effects) effects.push({ effect: e, sourceLevel: totalLevel(c) });
    }
  }
  return effects;
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
  pendingChoices: { id: string; kind: string; pick: number; of: string[] | 'any'; origin: string; asi?: boolean }[];
}

function casterLevelFor(cls: CharacterClass, entryLevel: number, subclassCasting: Spellcasting | undefined, multiclass: boolean) {
  const sc = cls.spellcasting ?? subclassCasting;
  if (!sc || sc.progression === 'pact') return 0;
  if (sc.progression === 'full') return entryLevel;
  if (sc.progression === 'half') return multiclass ? Math.floor(entryLevel / 2) : entryLevel < 2 ? 0 : Math.ceil(entryLevel / 2);
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
      for (const a of (c.choices[e.id] ?? []).slice(0, e.pick)) {
        if ((ABILITIES as readonly string[]).includes(a)) scores[a as Ability] += e.value;
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
    firstClass.tools.forEach((s) => profs.tool.add(s));
    (c.choices[`class.${firstClass.id}.skills`] ?? []).slice(0, firstClass.skillChoices.pick).forEach((s) => profs.skill.add(s));
  }
  const pendingChoices: Sheet['pendingChoices'] = [];
  if (firstClass) {
    const chosen = c.choices[`class.${firstClass.id}.skills`]?.length ?? 0;
    if (chosen < firstClass.skillChoices.pick) {
      pendingChoices.push({ id: `class.${firstClass.id}.skills`, kind: 'skill', pick: firstClass.skillChoices.pick - chosen, of: firstClass.skillChoices.from, origin: firstClass.name });
    }
  }
  const expertise = new Set<Skill>();
  for (const { effect: e } of effects) {
    if (e.type === 'proficiency') e.ids.forEach((id) => profs[e.kind].add(id));
    if (e.type === 'choice') {
      const chosen = (c.choices[e.id] ?? []).slice(0, e.pick);
      chosen.forEach((id) => profs[e.kind].add(id));
      if (chosen.length < e.pick) {
        const origin = features.find((f) => f.effects?.includes(e))?.origin ?? '';
        pendingChoices.push({ id: e.id, kind: e.kind, pick: e.pick - chosen.length, of: e.of, origin });
      }
    }
    if (e.type === 'ability_choice') {
      const values = c.choices[e.id] ?? [];
      const tookFeat = values.some((v) => v.startsWith('feat:'));
      if (!tookFeat && values.length < e.pick) {
        const asi = asiOrigins.get(e);
        const origin = asi ?? features.find((f) => f.effects?.includes(e))?.origin ?? '';
        pendingChoices.push({ id: e.id, kind: 'ability', pick: e.pick - values.length, of: e.from ?? [...ABILITIES], origin, ...(asi ? { asi: true } : {}) });
      }
    }
    if (e.type === 'expertise') e.skills.forEach((s) => expertise.add(s));
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
  for (const { effect: e } of effects) if (e.type === 'hp_per_level') maxHp += e.value * level;
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
      case 'resource': {
        let max: number;
        if (typeof e.max === 'number') max = e.max;
        else {
          const keys = Object.keys(e.max).map(Number).filter((k) => k <= sourceLevel).sort((a, b) => b - a);
          max = keys.length ? e.max[keys[0]!]! : 0;
        }
        const prev = resources.find((r) => r.id === e.id);
        if (prev) prev.max = Math.max(prev.max, max);
        else resources.push({ id: e.id, name: e.name, max, used: 0, recharge: e.recharge });
        break;
      }
    }
  }
  for (const r of resources) r.used = Math.min(r.max, c.state.resourcesUsed[r.id] ?? 0);
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
    const sub = cls.subclasses.find((s) => s.id === entry.subclassId);
    const sc = cls.spellcasting ?? sub?.spellcasting;
    if (!sc) continue;
    if (sc.progression === 'pact') warlockLevel += entry.level;
    else casterLevel += casterLevelFor(cls, entry.level, sub?.spellcasting, multiclass);
    casters.push({
      classId: cls.id,
      className: cls.name,
      ability: sc.ability,
      saveDc: ov(`spellDc.${cls.id}`, 8 + pb + mod(sc.ability)),
      attackBonus: ov(`spellAttack.${cls.id}`, pb + mod(sc.ability)),
      mode: sc.mode,
    });
  }
  const slotRow = FULL_CASTER_SLOTS[Math.min(casterLevel, 20)] ?? [];
  const spellSlots = slotRow.map((max, i) => ({ level: i + 1, max, used: Math.min(max, c.state.spellSlotsUsed[i + 1] ?? 0) }));
  const pact = warlockLevel > 0 ? PACT_SLOTS[Math.min(warlockLevel, 20)]! : null;
  const pactSlots = pact ? { level: pact[1], max: pact[0], used: Math.min(pact[0], c.state.pactSlotsUsed) } : null;

  // --- Атаки
  const attacks: AttackLine[] = [];
  for (const inv of c.inventory) {
    const item = inv.itemId ? content.items.get(inv.itemId) : undefined;
    if (!item?.weapon || !inv.equipped) continue;
    const w = item.weapon;
    const finesse = w.properties.some((p) => /фехтовальное|finesse/i.test(p));
    const ability: Ability = w.ranged ? 'dex' : finesse && mod('dex') > mod('str') ? 'dex' : 'str';
    const proficient =
      profs.weapon.has(item.id) || profs.weapon.has(w.martial ? 'martial' : 'simple') || profs.weapon.has(item.name.toLowerCase());
    const m = mod(ability);
    attacks.push({
      id: inv.id,
      name: item.name,
      bonus: ov(`attack.${inv.id}`, m + (proficient ? pb : 0)),
      damage: `${w.damage}${m === 0 ? '' : m > 0 ? `+${m}` : `${m}`}`,
      damageType: w.damageType,
      ability,
      range: w.range,
      properties: w.properties,
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
  };
}
