/**
 * Открытые наборы данных в формате Long Story Short (https://longstoryshort.app/doc/developers/datasets/):
 * D&D 5e SRD 5.2 (2024), русский перевод, лицензия CC-BY 4.0. Переводим их классы, виды, предыстории и черты
 * в формат Летописи. Механика (кости хитов, владения, ресурсы, выборы) — в эффекты листа, текст — как есть.
 */
import type { Ability, Background, CharacterClass, DamageType, Edition, Effect, Feature, Race, Skill, Subclass } from '@dnd/rules-engine';

type G = { type: string; [k: string]: any };
interface Dataset {
  id: string;
  edition: string;
  license: string;
  name: string;
  classes: { id: string; label: string; subclassLevel: number; info?: any; grants: G[]; leveledGrants: { level: number; grants: G[] }[] }[];
  subclasses: { id: string; classId: string; label: string; info?: any; grants: G[]; leveledGrants?: { level: number; grants: G[] }[] }[];
  races: { id: string; label: string; size?: string; grants: G[]; info?: any }[];
  subraces: { id: string; raceId: string; label: string; grants: G[] }[];
  backgrounds: { id: string; label: string; grants: G[] }[];
  feats: { id: string; label: string; category?: string; grants: G[] }[];
}

const SKILL_EN: Record<string, Skill> = {
  athletics: 'athletics', acrobatics: 'acrobatics', 'sleight of hand': 'sleightOfHand', stealth: 'stealth', arcana: 'arcana', history: 'history',
  investigation: 'investigation', nature: 'nature', religion: 'religion', 'animal handling': 'animalHandling', insight: 'insight', medicine: 'medicine',
  perception: 'perception', survival: 'survival', deception: 'deception', intimidation: 'intimidation', performance: 'performance', persuasion: 'persuasion',
};
const skill = (s: string) => SKILL_EN[s.toLowerCase()] ?? (s as Skill);
const ARMOR: Record<string, string> = { 'armor-light': 'light', 'armor-medium': 'medium', 'armor-heavy': 'heavy', 'armor-shield': 'shield', 'armor-label': 'shield' };
const WEAPON: Record<string, string> = { 'weapon-simple': 'simple', 'weapon-martial': 'martial' };
const DAMAGE = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
const VAR_NAMES: Record<string, string> = {
  LVL: 'уровень', PROF: 'бонус мастерства', STR: 'мод. Силы', DEX: 'мод. Ловкости', CON: 'мод. Телосложения', INT: 'мод. Интеллекта', WIS: 'мод. Мудрости', CHA: 'мод. Харизмы',
};

/** Формулы в тексте: «[f:1d10|Жестокий удар]» → «Жестокий удар»; «[f:8+[CON]+[PROF]]» → «8 + мод. Телосложения + бонус мастерства» */
export function humanizeFormulas(text: string, nameOnly = false): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('[f:', i);
    if (start < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start);
    // Скобки внутри формулы вложенные: [f:8+[CON]+[PROF]|Сл]
    let depth = 0;
    let j = start;
    for (; j < text.length; j++) {
      if (text[j] === '[') depth++;
      else if (text[j] === ']' && --depth === 0) break;
    }
    const body = text.slice(start + 3, j);
    const bar = body.lastIndexOf('|');
    const [expr, label] = bar >= 0 && !body.slice(bar).includes(']') ? [body.slice(0, bar), body.slice(bar + 1)] : [body, ''];
    out += label && nameOnly ? label : label && !/^[\dк+\s-]+$/.test(label) ? `${label} (${readable(expr)})` : readable(expr);
    i = j + 1;
  }
  return out;
}
function readable(expr: string) {
  const dice = expr.match(/^(\d*)d(\d+)$/);
  if (dice) return `${dice[1] || 1}к${dice[2]}`;
  return expr
    .replace(/\[([A-Z]+)\]/g, (_, k: string) => VAR_NAMES[k] ?? k)
    .replace(/(\d)d(\d)/g, '$1к$2')
    .replace(/\s*([+*/])\s*/g, ' $1 ')
    .trim();
}

const text = (s: unknown) => humanizeFormulas(String(s ?? ''));
const name = (s: unknown) => humanizeFormulas(String(s ?? ''), true);

/** Эффекты листа из «грантов» набора. Тексты (trait) возвращаются отдельно — это умения. */
function effectsOf(grants: G[], prefix: string): Effect[] {
  const out: Effect[] = [];
  grants.forEach((g, n) => {
    switch (g.type) {
      case 'speed':
        out.push({ type: 'speed', walk: g.value });
        break;
      case 'skill-fixed':
        out.push({ type: 'proficiency', kind: 'skill', ids: g.skills.map(skill) });
        break;
      case 'skill-choice':
        out.push({ type: 'choice', id: `${prefix}.skills${n}`, kind: 'skill', pick: g.count, of: g.options === 'any' ? 'any' : g.options.map(skill) });
        break;
      case 'tool-fixed':
        out.push({ type: 'proficiency', kind: 'tool', ids: g.tools });
        break;
      case 'tool-choice':
        out.push({ type: 'choice', id: `${prefix}.tools${n}`, kind: 'tool', pick: g.count, of: g.options?.length && !g.options.some((o: string) => /по выбору/i.test(o)) ? g.options : 'any' });
        break;
      case 'language-fixed':
        out.push({ type: 'proficiency', kind: 'language', ids: g.languages });
        break;
      case 'language-choice':
        out.push({ type: 'choice', id: `${prefix}.languages${n}`, kind: 'language', pick: g.count, of: 'any' });
        break;
      case 'bonus':
        if (g.target === 'hp.max') out.push({ type: 'formula_bonus', target: 'hp', expr: g.expr });
        if (g.target === 'initiative') out.push({ type: 'formula_bonus', target: 'initiative', expr: g.expr });
        break;
    }
  });
  return out;
}

function traitEffects(g: G): Effect[] {
  const out: Effect[] = [];
  if (g.id === 'darkvision' || /^darkvision/.test(g.id ?? '')) out.push({ type: 'darkvision', range: g.params?.range ?? 60 });
  const res = String(g.id ?? '').match(/resistance-([a-z]+)/);
  if (res && DAMAGE.includes(res[1]!)) out.push({ type: 'resistance', damage: res[1] as DamageType });
  return out;
}

const recharge = (g: G) => (g.isShortRest ? 'short' : g.isLongRest ? 'long' : 'none') as 'short' | 'long' | 'none';
const goldOf = (grants: G[]) => grants.filter((x) => x.type === 'gold').reduce((s, x) => s + x.amount, 0);
const itemsOf = (grants: G[]) => grants.filter((x) => x.type === 'equipment-fixed').flatMap((x) => x.items as string[]);

/** Умения из грантов одного уровня: тексты + ресурсы и выборы, прикреплённые к умению с тем же id */
function featuresAt(grants: G[], level: number | undefined, prefix: string, resources: Map<string, Extract<Effect, { type: 'resource' }>>): Feature[] {
  const feats: Feature[] = [];
  const extra = effectsOf(grants, `${prefix}.l${level ?? 0}`);
  for (const g of grants) {
    if (g.type !== 'trait') continue;
    const id = `${prefix}.${g.id}`;
    // Один и тот же trait повторяется на уровнях, где он усиливается: оставляем первое описание и уточнения
    feats.push({ id: level ? `${id}.${level}` : id, name: name(g.name), description: text(g.description), ...(level ? { level } : {}), effects: traitEffects(g) });
  }
  for (const g of grants) {
    if (g.type !== 'resource') continue;
    const known = resources.get(g.id);
    if (known) {
      // Тот же ресурс на более высоком уровне: растёт максимум
      if (typeof known.max === 'object' && g.max !== undefined) known.max[level ?? 1] = g.max;
      if (g.maxExpr) known.maxExpr = g.maxExpr;
      continue;
    }
    const eff: Extract<Effect, { type: 'resource' }> = { type: 'resource', id: g.id, name: g.name, max: { [level ?? 1]: g.max ?? 0 }, recharge: recharge(g), ...(g.maxExpr ? { maxExpr: g.maxExpr } : {}) };
    resources.set(g.id, eff);
    const host = feats.find((f) => f.id.startsWith(`${prefix}.${g.id}`)) ?? feats[0];
    if (host) host.effects = [...(host.effects ?? []), eff];
    else feats.push({ id: `${prefix}.${g.id}.res`, name: g.name, description: g.notes ?? '', ...(level ? { level } : {}), effects: [eff] });
  }
  if (extra.length) {
    const host = feats[0];
    if (host) host.effects = [...(host.effects ?? []), ...extra];
    else feats.push({ id: `${prefix}.l${level ?? 0}.grants`, name: 'Владения', description: '', ...(level ? { level } : {}), effects: extra });
  }
  for (const f of feats) if (!f.effects?.length) delete f.effects;
  return feats;
}

/** Увеличение характеристик в 2024: 4, 8, 12, 16 (воин ещё 6 и 14, плут 10), на 19 — эпический дар */
const ASI_LEVELS: Record<string, number[]> = { fighter: [4, 6, 8, 12, 14, 16, 19], rogue: [4, 8, 10, 12, 16, 19] };

export function fromLssDataset(d: Dataset, prefix: string) {
  const edition = d.edition as Edition;
  const meta = { source: 'srd' as const, edition, book: d.id === 'srd-2024' ? 'SRD 5.2' : d.name };

  const classes: CharacterClass[] = d.classes.map((c) => {
    const id = `${prefix}-class-${c.id}`;
    const base = c.grants;
    const resources = new Map<string, Extract<Effect, { type: 'resource' }>>();
    const features: Feature[] = [
      ...featuresAt(base.filter((g) => !['hp-die', 'saving-throw', 'armor-prof', 'weapon-prof', 'skill-choice', 'pick-one', 'spellcasting'].includes(g.type)), 1, c.id, resources),
    ];
    // Компетентность: несколько грантов expertise-choice на разных уровнях → одно растущее число
    const expertise: Record<number, number> = {};
    let total = 0;
    for (const lv of c.leveledGrants) {
      const exp = lv.grants.filter((g) => g.type === 'expertise-choice');
      for (const g of exp) expertise[lv.level] = total += g.count;
      features.push(...featuresAt(lv.grants.filter((g) => g.type !== 'expertise-choice'), lv.level, c.id, resources));
    }
    for (const g of base.filter((x) => x.type === 'expertise-choice')) expertise[1] = total += g.count;
    if (total) {
      const first = Math.min(...Object.keys(expertise).map(Number));
      features.push({ id: `${c.id}.expertise`, name: 'Компетентность', description: 'Выберите навыки, которыми владеете: бонус мастерства для них удваивается.', level: first,
        effects: [{ type: 'expertise_choice', id: `${c.id}.expertise`, pick: expertise }] });
    }
    for (const lvl of ASI_LEVELS[c.id] ?? [4, 8, 12, 16, 19]) {
      features.push({ id: `${c.id}.asi.${lvl}`, name: lvl === 19 ? 'Эпический дар' : 'Увеличение характеристик', description: lvl === 19 ? 'Черта эпического дара или +2 к характеристикам.' : '+2 к одной характеристике, +1 к двум или черта.', level: lvl, asi: true });
    }
    const g = (t: string) => base.find((x) => x.type === t);
    const sc = g('spellcasting');
    const skills = g('skill-choice');
    const kitGrant = g('pick-one');
    const subclasses: Subclass[] = d.subclasses
      .filter((s) => s.classId === c.id)
      .map((s) => {
        const res = new Map<string, Extract<Effect, { type: 'resource' }>>();
        return {
          id: s.id,
          name: s.label,
          description: s.info?.tagline,
          features: [
            ...featuresAt(s.grants, c.subclassLevel, `${c.id}.${s.id}`, res),
            ...(s.leveledGrants ?? []).flatMap((lv) => featuresAt(lv.grants, lv.level, `${c.id}.${s.id}`, res)),
          ],
        };
      });
    return {
      kind: 'class', id, name: c.label, ...meta,
      hitDie: g('hp-die')?.die ?? 8,
      saves: (g('saving-throw')?.stats ?? []) as Ability[],
      armor: (g('armor-prof')?.armors ?? []).map((a: string) => ARMOR[a] ?? a),
      weapons: (g('weapon-prof')?.weapons ?? []).map((w: string) => WEAPON[w] ?? w),
      tools: [],
      skillChoices: { pick: skills?.count ?? 2, from: (skills?.options === 'any' ? Object.values(SKILL_EN) : (skills?.options ?? []).map(skill)) as Skill[] },
      ...(kitGrant ? { kit: kitGrant.options.map((o: { label: string; grants: G[] }) => ({ label: o.label, items: itemsOf(o.grants), gold: goldOf(o.grants) })) } : {}),
      ...(c.info ? { hint: { main: c.info.primaryStats ?? [], complexity: c.info.complexity ?? 1 } } : {}),
      ...(sc ? { spellcasting: { ability: sc.ability, progression: sc.progression, mode: sc.casterType === 'memory' ? 'known' : 'prepared', ...(sc.casterType === 'book' ? { ritual: true } : {}) } } : {}),
      features,
      levels: [],
      subclassLevel: c.subclassLevel,
      subclasses,
    } satisfies CharacterClass;
  });

  const races: Race[] = d.races.map((r) => {
    const res = new Map<string, Extract<Effect, { type: 'resource' }>>();
    const speed = r.grants.find((g) => g.type === 'speed')?.value ?? 30;
    const features = featuresAt(r.grants.filter((g) => g.type !== 'speed' && g.type !== 'pick-one' && g.type !== 'size'), undefined, r.id, res);
    // Размер на выбор (человек: средний или маленький) — пока как подсказка в описании
    const sizes = r.grants.find((g) => g.type === 'pick-one' && /size/.test(g.id ?? ''));
    return {
      kind: 'race', id: `${prefix}-race-${r.id}`, name: r.label, ...meta,
      size: (r.size ?? 'medium') as Race['size'], speed,
      ...(sizes ? { description: `Размер на выбор: ${sizes.options.map((o: { label: string }) => o.label.toLowerCase()).join(' или ')}.` } : {}),
      features,
      subraces: d.subraces
        .filter((s) => s.raceId === r.id)
        .map((s) => ({ id: s.id, name: s.label, features: featuresAt(s.grants.filter((g) => g.type !== 'speed'), undefined, s.id, new Map()).concat(
          s.grants.some((g) => g.type === 'speed') ? [{ id: `${s.id}.speed`, name: 'Скорость', description: `Скорость ${s.grants.find((g) => g.type === 'speed')!.value} футов.`, effects: [{ type: 'speed', walk: s.grants.find((g) => g.type === 'speed')!.value }] }] : [],
        ) })),
    } satisfies Race;
  });

  const feats = d.feats.map((f) => {
    const traits = f.grants.filter((g) => g.type === 'trait');
    return {
      kind: 'feat' as const, id: `${prefix}-feat-${f.id}`, name: f.label, ...meta,
      category: f.category,
      description: traits.map((t) => (traits.length > 1 ? `${name(t.name)}. ${text(t.description)}` : text(t.description))).join('\n\n'),
      effects: effectsOf(f.grants, `feat.${f.id}`),
    };
  });

  const backgrounds: Background[] = d.backgrounds.map((b) => {
    const g = (t: string) => b.grants.find((x) => x.type === t);
    const pool = g('asi-pool');
    const pick = g('pick-one');
    const kit = pick?.options.find((o: { grants: G[] }) => o.grants.some((x) => x.type === 'equipment-fixed'));
    const goldOnly = pick?.options.find((o: { grants: G[] }) => !o.grants.some((x) => x.type === 'equipment-fixed'));
    const toolChoice = g('tool-choice');
    const featId = g('feat')?.featId;
    const featName = d.feats.find((f) => f.id === featId)?.label;
    return {
      id: `${prefix}-${b.id}`, name: b.label, edition,
      skills: (g('skill-fixed')?.skills ?? []).map(skill),
      ...(g('tool-fixed') ? { tools: g('tool-fixed')!.tools } : {}),
      ...(toolChoice ? { toolChoice: { pick: toolChoice.count, of: ['tools.dice', 'tools.chess', 'tools.cards', 'tools.threedragon'] } } : {}),
      equipment: kit ? itemsOf(kit.grants) : [],
      gold: kit ? goldOf(kit.grants) : 0,
      ...(goldOnly ? { goldInstead: goldOf(goldOnly.grants) } : {}),
      feature: { name: featName ? `Черта: ${featName}` : b.label, description: featName ? `Предыстория даёт черту происхождения «${featName}».` : '' },
      ...(pool ? { abilityPool: { total: pool.total, max: pool.max, options: pool.options } } : {}),
      ...(featId ? { featId: `${prefix}-feat-${featId}` } : {}),
    } satisfies Background;
  });

  return { classes, races, feats, backgrounds, license: `${d.name} — ${d.license}` };
}
