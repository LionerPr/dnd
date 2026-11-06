import type { Ability, CharacterClass, ClassLevel, Coin, Effect, Feature, FeaturePart, Item, LevelCount, Race, Skill, Spellcasting, Subclass, Subrace } from '@dnd/rules-engine';
import { LANGUAGES, SKILLS } from '@dnd/rules-engine';
import * as cheerio from 'cheerio/slim';
import type { AnyNode } from 'domhandler';

type $ = cheerio.CheerioAPI;

// ---------- Словари русского текста ----------

const ABILITY_FORMS: [RegExp, Ability][] = [
  [/сил[аыуе]/i, 'str'],
  [/ловкост[ьи]/i, 'dex'],
  [/телосложени[еяю]/i, 'con'],
  [/интеллект[аеу]?/i, 'int'],
  [/мудрост[ьи]/i, 'wis'],
  [/харизм[аыуе]/i, 'cha'],
];

export function abilityFromWord(word: string): Ability | undefined {
  return ABILITY_FORMS.find(([re]) => re.test(word))?.[1];
}

const DAMAGE_WORDS: [RegExp, string][] = [
  [/кислот/i, 'acid'],
  [/дробящ/i, 'bludgeoning'],
  [/холод/i, 'cold'],
  [/огн|огон/i, 'fire'],
  [/силов/i, 'force'],
  [/электричеств|молни/i, 'lightning'],
  [/некротическ/i, 'necrotic'],
  [/колющ/i, 'piercing'],
  [/яд/i, 'poison'],
  [/психическ/i, 'psychic'],
  [/излучени/i, 'radiant'],
  [/рубящ/i, 'slashing'],
  [/звук|гром/i, 'thunder'],
];

const NUMBER_WORDS: Record<string, number> = { один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5 };

const text = (s: string) => s.replace(/\s+/g, ' ').trim();
/** «ЯРОСТЬ» → «Ярость»: заголовки на dnd.su часто набраны капсом */
const title = (s: string) => {
  const t = text(s);
  return t === t.toUpperCase() && /[А-ЯЁ]/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};
const slugOf = (url: string) => new URL(url).pathname.split('/').filter(Boolean).pop()!.replace(/^\d+-/, '');

function cardTitle($: $) {
  const raw = text($('h2.card-title').first().text());
  const m = raw.match(/^(.*?)\s*\[(.+?)\]/);
  return { name: m ? m[1]!.trim() : raw, en: m?.[2]?.trim(), book: pageBook($) };
}

/**
 * Самодельные (homebrew) страницы размечены проще: <p><strong><em>Название.</em></strong> текст</p>.
 * Абзацы внутри скрытых блоков (.hide-wrapper) — это разновидности, их разбираем отдельно.
 */

/** Разновидности на самодельных страницах: заголовок h2.bigSectionTitle и скрытый блок за ним. */
function looseSubraces($: $, slug: string): Subrace[] | undefined {
  const heads = $('h2.bigSectionTitle');
  const subs: Subrace[] = [];
  heads.each((i, h) => {
    const $h = $(h);
    const body = $h.next('.hide-wrapper');
    if (!body.length) return;
    const id = `v${i}`;
    const features = looseFeatures($, body, `${slug}.${id}`, true);
    if (features.length) subs.push({ id, name: text($h.text()), features });
  });
  return subs.length ? subs : undefined;
}

/** Книга-источник страницы: «Источник: «Player's Handbook»» в шапке карточки. */
function pageBook($: $): string | undefined {
  const label = $('strong')
    .filter((_, el) => /^Источник:?$/.test(text($(el).text())))
    .first();
  const book = text(label.parent().find('span').first().text() || label.parent().text().replace(/Источник:?/, '')).replace(/[«»]/g, '').trim();
  return book || undefined;
}

/** Текст блока с сохранением абзацев и списков — так описание читается в листе. */
function blockText($: $, nodes: cheerio.Cheerio<AnyNode>): string {
  const parts: string[] = [];
  nodes.each((_, el) => {
    const $el = $(el);
    if (el.type !== 'tag') return;
    const tag = (el as { tagName: string }).tagName;
    if (tag === 'br') return;
    if (tag === 'ul' || tag === 'ol') {
      $el.children('li').each((__, li) => {
        parts.push(`• ${text($(li).text())}`);
      });
      return;
    }
    if (tag === 'table') {
      $el.find('tr').each((__, tr) => {
        parts.push($(tr).children('td,th').map((___, td) => text($(td).text())).get().join(' | '));
      });
      return;
    }
    const t = text($el.text());
    if (t) parts.push(t);
  });
  return parts.join('\n');
}

// ---------- Эффекты из текста особенностей ----------

const COUNT_WORDS: Record<string, number> = { одн: 1, дв: 2, тр: 3, четыр: 4 };
const countOf = (w: string) => Object.entries(COUNT_WORDS).find(([k]) => w.toLowerCase().startsWith(k))?.[1];

/**
 * «Увеличение характеристик» в любых формулировках dnd.su:
 * «Значение вашего Интеллекта увеличивается на 2 и значение Телосложения — на 1», «Ваше значение Телосложения увеличено на 2, а Интеллекта на 1»,
 * «Значения ваших Силы, Ловкости и Телосложения увеличиваются на 1», «Значение всех ваших характеристик увеличивается на 1»,
 * «Увеличьте две характеристики по вашему выбору на 1», «одной характеристики по выбору на 2, а другой — на 1».
 */
function asiEffects(body: string, featureId: string): Effect[] {
  // «Либо +2 и +1, либо трём по +1» — лист не умеет «либо», берём первый вариант
  const first = (body.split(/(?<=\.)\s+(?=[А-ЯЁ])/)[0] ?? body).split(/,\s*либо\s+/i)[0]!.replace(/^либо\s+/i, '');
  if (/всех\s+ваших\s+характеристик|все\s+ваши\s+характеристики/i.test(first)) {
    const v = Number(first.match(/на\s+(\d)/)?.[1] ?? 1);
    return (['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]).map((a) => ({ type: 'ability_bonus', ability: a, value: v }));
  }
  const out: Effect[] = [];
  // Делим на части: «…на 2, а значение Интеллекта на 1», «…на 2 и значение … на 1», «Либо …, либо …»
  // (\b в JS не работает с кириллицей, поэтому границы слов не используем)
  const parts = first.split(/,?\s+(?:а|и)\s+(?=значени|ваше|вашей|вашего|друг)|,\s+а\s+|;\s*/i);
  let carry: number | undefined;
  for (const raw of parts.reverse()) {
    const part = raw.trim();
    const num = Number(part.match(/на\s+(\d)/)?.[1] ?? carry ?? 0);
    carry = num || carry;
    if (!num) continue;
    const pick = part.match(/(одн|дв|тр|четыр)\S*\s+(?:(?:различн|разн|друг)\S*\s+)?(?:ваш\S*\s+)?характеристик/i);
    if (pick || /по\s+(?:вашему\s+)?выбору|друг(?:ой|ую|ая)[\s,.—-]/i.test(part)) {
      out.push({ type: 'ability_choice', id: '', pick: pick ? countOf(pick[1]!) ?? 1 : 1, value: num });
      continue;
    }
    const abilities = [...new Set(part.split(/[^А-ЯЁа-яё]+/).map((w) => abilityFromWord(w)).filter((a): a is Ability => !!a))];
    for (const a of abilities) out.push({ type: 'ability_bonus', ability: a, value: num });
  }
  out.reverse();
  // id выбора — как в прежних версиях разбора, чтобы уже сделанный в листах выбор не сбрасывался при повторном импорте
  const hasPlus2 = out.some((e) => e.type === 'ability_choice' && e.value === 2 && e.pick === 1);
  for (const e of out) {
    if (e.type !== 'ability_choice') continue;
    e.id = `${featureId}.${e.value === 2 && e.pick === 1 ? 'plus2' : hasPlus2 && e.pick === 1 ? 'plus1' : 'choice'}`;
  }
  return out;
}

export function effectsFromFeature(name: string, body: string, featureId: string, $html?: cheerio.Cheerio<AnyNode>, $?: $): Effect[] {
  const n = name.toLowerCase();
  const effects: Effect[] = [];
  if (/^(увеличение|повышение) характеристик/.test(n)) effects.push(...asiEffects(body, featureId));
  if (n === 'скорость' || /скорость ходьбы/i.test(body)) {
    // «скорость ходьбы составляет 30 футов», «— 30 футов», «скорость перемещения равна 40 футам», «30 фт.»
    const walk = body.match(/скорость\s+(?:ходьбы|перемещения|передвижения)?\s*(?:составляет|равна|—|-|:)?\s*(\d+)\s*(?:фут|фт)/i);
    if (walk) effects.push({ type: 'speed', walk: Number(walk[1]) });
  }
  for (const [kind, re] of [
    ['fly', /скорость\s+полёта\s+(?:составляет|равна|,\s*равную)?\s*(\d+)\s+фут/i],
    ['swim', /скорость\s+плавания\s+(?:составляет|равна|,\s*равную)?\s*(\d+)\s+фут/i],
    ['climb', /скорость\s+лазания\s+(?:составляет|равна|,\s*равную)?\s*(\d+)\s+фут/i],
  ] as const) {
    const m = body.match(re);
    if (m) effects.push({ type: 'speed', [kind]: Number(m[1]) });
  }
  if (n.includes('тёмное зрение') || n.includes('темное зрение')) {
    const m = body.match(/(\d+)\s*(?:фут|фт)/);
    if (m) effects.push({ type: 'darkvision', range: Number(m[1]) });
  }
  const resist = body.match(/сопротивление\s+(?:к\s+)?урону\s+([^.,;]+)/i);
  if (resist) {
    for (const [re, dmg] of DAMAGE_WORDS) if (re.test(resist[1]!)) effects.push({ type: 'resistance', damage: dmg as never });
  }
  // Навыки и инструменты — по машинным ключам tooltip-for
  if ($html && $) {
    const skills = $html.find('[tooltip-for^="skill."]').map((_, el) => $(el).attr('tooltip-for')!.slice(6)).get().filter((s) => s in SKILLS) as Skill[];
    const tools = $html.find('[tooltip-for^="tools."]').map((_, el) => $(el).attr('tooltip-for')!).get();
    const choose = /на\s+ваш\s+выбор|выберите|по\s+вашему\s+выбору/i.test(body);
    const countWord = body.match(/(один|одним|одну|два|двумя|две|три|тремя)\s+(?:навык|из\s+следующих)/i)?.[1]?.toLowerCase();
    const pick = countWord ? (NUMBER_WORDS[countWord.replace(/(мя|ним)$/, (s) => (s === 'ним' ? 'ин' : 'а'))] ?? 1) : 1;
    const grantsSkill = /владе(?:ете|ние|ния)\s+(?:\S+\s+)?навык/i.test(body);
    if (skills.length && (grantsSkill || choose)) {
      if (choose && skills.length > 1) effects.push({ type: 'choice', id: `${featureId}.skills`, kind: 'skill', pick, of: skills });
      else effects.push({ type: 'proficiency', kind: 'skill', ids: skills });
    } else if (/владение\s+(?:двумя|одним)?\s*навык(?:ом|ами)\s+(?:на\s+ваш\s+выбор|по\s+вашему\s+выбору)/i.test(body)) {
      effects.push({ type: 'choice', id: `${featureId}.skills`, kind: 'skill', pick, of: 'any' });
    }
    if (tools.length) {
      if (choose && tools.length > 1) effects.push({ type: 'choice', id: `${featureId}.tools`, kind: 'tool', pick: 1, of: tools });
      else effects.push({ type: 'proficiency', kind: 'tool', ids: tools });
    }
  }
  if (/максимум\s+ваших\s+хитов\s+увеличивается\s+на\s+1[^.]*кажд/i.test(body)) effects.push({ type: 'hp_per_level', value: 1 });
  if (/^язык/.test(n)) effects.push(...languageEffects(body, featureId));
  // «Вы владеете лёгкими и средними доспехами»
  const armorPhrase = body.match(/владе\S*\s+([^.]*?)доспех/i)?.[1];
  if (armorPhrase !== undefined) {
    const ids = ARMOR_WORDS.filter(([re]) => re.test(armorPhrase)).map(([, k]) => k).filter((k) => k !== 'shield');
    if (ids.length) effects.push({ type: 'proficiency', kind: 'armor', ids });
  }
  return effects;
}

/** «Вы можете говорить, читать и писать на Общем и Дварфийском языках», «…и ещё одном языке на ваш выбор» */
function languageEffects(body: string, featureId: string): Effect[] {
  const first = body.split(/(?<=\.)\s+/)[0] ?? body;
  const ids = [...new Set(first.split(/[^А-ЯЁа-яё]+/).filter((w) => /^[А-ЯЁ]/.test(w)).map((w) => LANGUAGES.find((l) => l.stem.test(w))?.name).filter((x): x is string => !!x))];
  const out: Effect[] = [];
  if (ids.length) out.push({ type: 'proficiency', kind: 'language', ids });
  const extra = first.match(/(?:ещё|еще)\s+(одн|дв)\S*\s+(?:\S+\s+)?язык|(одн|дв)\S*\s+(?:другим|другими|другом|дополнительн\S*)?\s*язык\S*\s+(?:на|по)\s+ваш/i);
  if (extra) out.push({ type: 'choice', id: `${featureId}.languages`, kind: 'language', pick: /дв/i.test(extra[1] ?? extra[2] ?? '') ? 2 : 1, of: 'any' });
  return out;
}

// ---------- Расы ----------

function sizeFrom(body: string): Race['size'] {
  if (/крошечн/i.test(body)) return 'tiny';
  if (/маленьк/i.test(body)) return 'small';
  if (/больш/i.test(body)) return 'large';
  return 'medium';
}

function featuresFromParagraphs($: $, root: cheerio.Cheerio<AnyNode>, prefix: string): Feature[] {
  return looseFeatures($, root, prefix);
}

/** Справочные строки, а не особенности: списки имён, источник, сведения о доме метки, таблицы роста и веса */
const LORE = /имена|^прозвища|^фамилии|^источник|^разновидност|^подрас[аы]?$|^лидер$|^штаб-квартира$|^резиденция$|^высота$|^вес в фунтах$|^модификатор размера$/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Особенности расы — абзацы, начинающиеся с выделенного названия. На dnd.su встречается разная разметка:
 * p.article-body__feature (официальные), <strong><em>Название.</em></strong>, <em><strong>…</strong></em>,
 * обёртка в <span> (книги 2022 года и самодельное). Абзацы в скрытых блоках (.hide-wrapper) — разновидности, их разбираем отдельно.
 */
function looseFeatures($: $, root: cheerio.Cheerio<AnyNode>, prefix: string, inside = false): Feature[] {
  const out: Feature[] = [];
  root.find('p').each((_, p) => {
    const $p = $(p);
    if (!inside && $p.closest('.hide-wrapper').length) return;
    const full = text($p.text());
    let name: string;
    if ($p.hasClass('article-body__feature')) {
      name = text($p.find('.article-body__feature-name').first().text());
    } else {
      const head = $p.find('strong, b, .dnd-feature-name').first();
      const headText = text(head.text());
      if (!head.length || !headText || !full.startsWith(headText.slice(0, Math.min(4, headText.length)))) return;
      name = headText;
    }
    name = name.replace(/[\s.:]+$/, '');
    if (!name || name.length > 60 || !/[А-ЯЁа-яёA-Za-z]/.test(name) || LORE.test(name)) return;
    const body = full.replace(new RegExp(`^${escapeRe(name)}\\s*[.:]?\\s*`), '');
    const id = `${prefix}.${out.length}`;
    out.push({ id, name, description: body, effects: effectsFromFeature(name, body, id, $p, $) });
  });
  return out;
}

export function parseRace(html: string, url: string): Race {
  const $ = cheerio.load(html);
  const { name, en, book } = cardTitle($);
  const slug = slugOf(url);
  const article = $('div.card__article-body, div.article-body').first().length ? $('div.card__article-body, div.article-body').first() : $('body');
  const variants = $('div.multiforo');
  let features: Feature[] = [];
  let subraces: Subrace[] | undefined;
  if (variants.length) {
    subraces = variants
      .map((i, el) => {
        const $el = $(el);
        const caption = cheerio.load($el.attr('caption') ?? '');
        const id = caption('span').attr('id') ?? `v${i}`;
        const subName = text(caption.text()) || `Вариант ${i + 1}`;
        return { id, name: subName, features: featuresFromParagraphs($, $el, `${slug}.${id}`) };
      })
      .get();
  } else {
    features = featuresFromParagraphs($, article, slug);
    if (!article.find('p.article-body__feature').length) subraces = looseSubraces($, slug);
  }
  // Расы из книг 2022+ (Dragonlance, UA) не дают бонусов сами: по общему правилу +2 и +1 к характеристикам на выбор
  const hasAsi = [...features, ...(subraces ?? []).flatMap((s) => s.features)].some((f) =>
    (f.effects ?? []).some((e) => e.type === 'ability_bonus' || e.type === 'ability_choice'),
  );
  if (!hasAsi) {
    const id = `${slug}.asi`;
    features.unshift({
      id,
      name: 'Увеличение характеристик',
      description: 'Описание расы не даёт бонусов к характеристикам. По общему правилу увеличьте одну характеристику на 2, а другую — на 1.',
      effects: [
        { type: 'ability_choice', id: `${id}.plus2`, pick: 1, value: 2 },
        { type: 'ability_choice', id: `${id}.plus1`, pick: 1, value: 1 },
      ],
    });
  }
  const all = [...features, ...(subraces?.[0]?.features ?? [])];
  const sizeFeature = all.find((f) => f.name.toLowerCase() === 'размер');
  const speedEffect = all.flatMap((f) => f.effects ?? []).find((e): e is Extract<Effect, { type: 'speed' }> => e.type === 'speed' && !!e.walk);
  const intro = text($('h3 span#features').closest('h3').prevAll('p').first().text());
  return {
    kind: 'race',
    id: `dndsu-race-${slug}`,
    name,
    source: 'dnd.su',
    sourceUrl: url,
    nameEn: en,
    book,
    size: sizeFrom(sizeFeature?.description ?? ''),
    speed: speedEffect?.walk ?? 30,
    description: intro || undefined,
    features,
    subraces,
  };
}

// ---------- Классы ----------

/** Заклинательство и ресурсы классов: из текста надёжно не вытащить, поэтому — справочник по адресу. */
const CLASS_RULES: Record<string, { spellcasting?: Spellcasting; effects?: Record<string, Effect[]> }> = {
  barbarian: {
    effects: {
      rage: [{ type: 'resource', id: 'rage', name: 'Ярость', max: { 1: 2, 3: 3, 6: 4, 12: 5, 17: 6, 20: 99 }, recharge: 'long' }],
      'unarmored-defence': [{ type: 'ac_formula', base: 10, abilities: ['dex', 'con'], allowShield: true }],
      'fast-movement': [{ type: 'speed', walk: 0 }],
    },
  },
  bard: {
    spellcasting: { ability: 'cha', progression: 'full', mode: 'known', ritual: true },
    effects: { 'bardic-inspiration': [{ type: 'resource', id: 'bardic-inspiration', name: 'Вдохновение барда', max: 3, recharge: 'long' }] },
  },
  cleric: {
    spellcasting: { ability: 'wis', progression: 'full', mode: 'prepared', ritual: true },
    effects: { 'channel-divinity': [{ type: 'resource', id: 'channel-divinity', name: 'Божественный канал', max: { 2: 1, 6: 2, 18: 3 }, recharge: 'short' }] },
  },
  druid: {
    spellcasting: { ability: 'wis', progression: 'full', mode: 'prepared', ritual: true },
    effects: { 'wild-shape': [{ type: 'resource', id: 'wild-shape', name: 'Дикий облик', max: 2, recharge: 'short' }] },
  },
  fighter: {
    effects: {
      'second-wind': [{ type: 'resource', id: 'second-wind', name: 'Второе дыхание', max: 1, recharge: 'short' }],
      'action-surge': [{ type: 'resource', id: 'action-surge', name: 'Всплеск действий', max: { 2: 1, 17: 2 }, recharge: 'short' }],
      indomitable: [{ type: 'resource', id: 'indomitable', name: 'Упорный', max: { 9: 1, 13: 2, 17: 3 }, recharge: 'long' }],
    },
  },
  monk: {
    effects: {
      'unarmored-defense': [{ type: 'ac_formula', base: 10, abilities: ['dex', 'wis'], allowShield: false }],
      'unarmored-defence': [{ type: 'ac_formula', base: 10, abilities: ['dex', 'wis'], allowShield: false }],
      ki: [{ type: 'resource', id: 'ki', name: 'Ци', max: Object.fromEntries(Array.from({ length: 19 }, (_, i) => [i + 2, i + 2])), recharge: 'short' }],
    },
  },
  paladin: {
    spellcasting: { ability: 'cha', progression: 'half', mode: 'prepared' },
    effects: {
      'lay-on-hands': [{ type: 'resource', id: 'lay-on-hands', name: 'Наложение рук (хиты)', max: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, (i + 1) * 5])), recharge: 'long' }],
      'divine-sense': [{ type: 'resource', id: 'divine-sense', name: 'Божественное чувство', max: 3, recharge: 'long' }],
      'channel-divinity': [{ type: 'resource', id: 'channel-divinity', name: 'Божественный канал', max: 1, recharge: 'short' }],
    },
  },
  ranger: { spellcasting: { ability: 'wis', progression: 'half', mode: 'known' } },
  rogue: {},
  sorcerer: {
    spellcasting: { ability: 'cha', progression: 'full', mode: 'known' },
    effects: { 'font-of-magic': [{ type: 'resource', id: 'sorcery-points', name: 'Единицы чародейства', max: Object.fromEntries(Array.from({ length: 19 }, (_, i) => [i + 2, i + 2])), recharge: 'long' }] },
  },
  warlock: { spellcasting: { ability: 'cha', progression: 'pact', mode: 'known' } },
  wizard: {
    spellcasting: { ability: 'int', progression: 'full', mode: 'prepared', ritual: true },
    effects: { 'arcane-recovery': [{ type: 'resource', id: 'arcane-recovery', name: 'Магическое восстановление', max: 1, recharge: 'long' }] },
  },
  artificer: { spellcasting: { ability: 'int', progression: 'half', mode: 'prepared', ritual: true } },
};

const SUBCLASS_CASTING: Record<string, Spellcasting> = {
  'martial.eldritch-knight': { ability: 'int', progression: 'third', mode: 'known' },
  'archetype.arcane-trickster': { ability: 'int', progression: 'third', mode: 'known' },
};

const ARMOR_WORDS: [RegExp, string][] = [
  [/лёгк|легк/i, 'light'],
  [/средн/i, 'medium'],
  [/тяжёл|тяжел/i, 'heavy'],
  [/щит/i, 'shield'],
];

function levelFromEm(t: string): number | undefined {
  const m = t.match(/(\d+)-[йм]\s+уровень/);
  return m ? Number(m[1]) : undefined;
}

// ---------- Умения классов: части и выборы ----------

const COUNT_RE = '(один|одно|одну|два|две|три|четыре)';

/**
 * Тело умения → вступление и части. Части — подзаголовки h4 (техники ци, варианты боевого стиля, метамагия).
 * Опциональные варианты (Котёл Таши) лежат в div.TCE-feature-on — разворачиваем их.
 */
function splitParts($: $, nodes: cheerio.Cheerio<AnyNode>): { intro: string; parts: FeaturePart[] } {
  const flat: { el: AnyNode; optional: boolean }[] = [];
  nodes.each((_, el) => {
    const $el = $(el);
    if ($el.is('div') && $el.find('h4').length) $el.children().each((__, ch) => void flat.push({ el: ch, optional: $el.hasClass('TCE-feature-on') }));
    else flat.push({ el, optional: false });
  });
  const intro: AnyNode[] = [];
  const parts: { name: string; nodes: AnyNode[]; optional: boolean }[] = [];
  for (const { el, optional } of flat) {
    const $el = $(el);
    if ($el.is('h4')) parts.push({ name: title($el.text()), nodes: [], optional });
    else if (parts.length) parts[parts.length - 1]!.nodes.push(el);
    else intro.push(el);
  }
  return {
    intro: blockText($, $(intro)),
    parts: parts.map((x) => {
      const body = $(x.nodes).filter((_, el) => !/^(опциональный|optional)/i.test(text($(el).text())));
      return { name: x.name, description: blockText($, body), ...(x.optional || $(x.nodes).filter((_, el) => /опциональный вариант/i.test(text($(el).text()))).length ? { optional: true } : {}) };
    }),
  };
}

/** Список вариантов в отдельном разделе страницы (воззвания колдуна): ссылка из умения → элементы с data-level */
function linkedParts($: $, nodes: cheerio.Cheerio<AnyNode>): FeaturePart[] {
  for (const a of nodes.find('a[href^="#"]').toArray()) {
    const id = $(a).attr('href')!.slice(1);
    const anchor = $(`[id="${id}"]`).first();
    const wrapper = anchor.closest('h2').next('.hide-wrapper');
    const items = wrapper.find('[data-sort="element"]');
    if (items.length < 3) {
      // Боевые приёмы: абзацы «<strong>Название.</strong> описание»
      const paras = wrapper.children('p').filter((_, el) => $(el).children('strong').length > 0 && text($(el).text()).startsWith(text($(el).children('strong').first().text())));
      if (paras.length < 3) continue;
      return paras.toArray().map((el) => {
        const name = text($(el).children('strong').first().text()).replace(/[.:]$/, '');
        return { name, description: text($(el).text()).slice(name.length).replace(/^[.:]?\s*/, '') };
      });
    }
    return items.toArray().map((el) => {
      const $el = $(el);
      const h = $el.find('h3, h4').first();
      const minLevel = Number($el.attr('data-level')) || undefined;
      return { name: title(h.text()), description: blockText($, h.nextAll()), ...(minLevel ? { minLevel } : {}), ...($el.attr('data-source') === 'TCE' ? { optional: true } : {}) };
    });
  }
  return [];
}

const WORD_COUNT: Record<string, number> = { один: 1, одно: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4 };

/** «Выберите один из следующих вариантов», «Вы выбираете два варианта… На 10-м и 17-м уровне вы получаете ещё по одному» */
function chooseCount(intro: string, level: number): LevelCount | undefined {
  const m = intro.match(new RegExp(`(?:выберите|выбираете|получаете|изучаете)\\s+${COUNT_RE}\\s+(?:из\\s+следующих|вариант|умени[йея]\\s+на\\s+выбор|на\\s+выбор|манёвр|маневр|при[её]м)`, 'i'));
  if (!m) return undefined;
  const base = WORD_COUNT[m[1]!.toLowerCase()] ?? 1;
  const out: Partial<Record<number, number>> = { [level]: base };
  const more = intro.match(/На\s+((?:\d+-м(?:,\s*|\s+и\s+)?)+)\s*уровн\S*\s+вы\s+(?:получаете|изучаете)\s+(?:ещё|еще)\s+по\s+(?:одному|одной)/i);
  let n = base;
  for (const l of [...(more?.[1] ?? '').matchAll(/(\d+)-м/g)].map((x) => Number(x[1])).sort((a, b) => a - b)) out[l] = ++n;
  // «Вы изучаете два дополнительных приёма при достижении 7-го, 10-го и 15-го уровней»
  const extra = intro.match(new RegExp(`${COUNT_RE}\\s+дополнительн\\S+\\s+\\S+\\s+при\\s+достижении\\s+((?:\\d+-го(?:,\\s*|\\s+и\\s+)?)+)`, 'i'));
  if (extra) {
    const step = WORD_COUNT[extra[1]!.toLowerCase()] ?? 1;
    for (const l of [...extra[2]!.matchAll(/(\d+)-го/g)].map((x) => Number(x[1])).sort((a, b) => a - b)) out[l] = n += step;
  }
  return n === base ? base : out;
}

/** Колонка таблицы класса, похожая на название умения («Таинственные воззвания» → «Известные воззвания»), как LevelCount */
function columnCount(levels: ClassLevel[], name: string): LevelCount | undefined {
  const stems = name.toLowerCase().split(/[^а-яё]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
  const key = Object.keys(levels[0]?.columns ?? {}).find((k) => stems.some((st) => k.toLowerCase().includes(st)));
  if (!key) return undefined;
  const out: Partial<Record<number, number>> = {};
  let prev = 0;
  for (const l of levels) {
    const v = Number(l.columns?.[key]);
    if (v && v !== prev) out[l.level] = prev = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Умение класса или подкласса из заголовка h3 и узлов после него. */
function classFeature($: $, id: string, name: string, nodes: cheerio.Cheerio<AnyNode>, level: number | undefined, levels: ClassLevel[]): Feature {
  const body = nodes.filter((i, el) => !(i === 0 && levelFromEm(text($(el).find('em').first().text())) !== undefined));
  let { intro, parts } = splitParts($, body);
  // Один подзаголовок — это не варианты, а просто раздел текста
  if (parts.length < 2) ({ intro, parts } = { intro: blockText($, body), parts: [] });
  let choose: LevelCount | undefined;
  if (parts.length >= 2) choose = chooseCount(intro, level ?? 1);
  if (!parts.length) {
    const linked = linkedParts($, body);
    const count = linked.length ? columnCount(levels, name) ?? chooseCount(intro, level ?? 1) : undefined;
    // Ссылка на список без «выберите N» — просто упоминание (как «Универсальность воина»), список не прикладываем
    if (count !== undefined) {
      parts = linked;
      choose = count;
    }
  }
  const f: Feature = { id, name, description: parts.length ? intro : blockText($, body), level };
  if (parts.length) f.parts = parts;
  if (choose !== undefined) f.choose = choose;
  // Компетентность: «Выберите два ваших владения… На 6-м уровне вы можете выбрать ещё два»
  if (/^(компетентность|экспертиза)$/i.test(name)) {
    const lvl = level ?? 1;
    const later = intro.match(/На\s+(\d+)-м\s+уровне\s+вы\s+можете\s+выбрать\s+е[щш]ё?е?\s+(?:два|две|2)/i);
    const tools = body.find('[tooltip-for^="tools."]').length ? ['tools.thieves'] : undefined;
    f.effects = [{ type: 'expertise_choice', id: `${id}.expertise`, pick: later ? { [lvl]: 2, [Number(later[1])]: 4 } : 2, ...(tools ? { tools } : {}) }];
  }
  return f;
}

export function parseClass(html: string, url: string): CharacterClass {
  const $ = cheerio.load(html);
  const { name, en, book } = cardTitle($);
  const slug = slugOf(url);
  const rules = CLASS_RULES[slug] ?? {};

  const field = (label: string) => {
    const p = $('p').filter((_, el) => text($(el).find('strong').first().text()).replace(/:$/, '') === label).first();
    return { $p: p, value: text(p.text()).replace(new RegExp(`^${label}:?\\s*`), '') };
  };

  const hitDie = Number(field('Кость Хитов').value.match(/к(\d+)/)?.[1] ?? 8);
  const saves = field('Спасброски')
    .value.split(/,\s*/)
    .map((w) => abilityFromWord(w))
    .filter((a): a is Ability => !!a);
  const armorText = field('Доспехи').value;
  const armor = ARMOR_WORDS.filter(([re]) => re.test(armorText)).map(([, k]) => k);
  const weaponText = field('Оружие').value;
  const weapons = weaponText
    .split(/,\s*/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w && w !== 'нет')
    .map((w) => (/простое/.test(w) ? 'simple' : /воинское/.test(w) ? 'martial' : w));
  const toolsText = field('Инструменты').value;
  // «Выберите один вид инструмента ремесленников…» — выбор, а не список: его делает игрок по тексту класса
  const tools = /^нет$/i.test(toolsText) || /выберите|на\s+ваш\s+выбор/i.test(toolsText) ? [] : toolsText.split(/,\s*/).filter(Boolean);
  const skillsField = field('Навыки');
  const skillKeys = skillsField.$p.find('[tooltip-for^="skill."]').map((_, el) => $(el).attr('tooltip-for')!.slice(6)).get().filter((s) => s in SKILLS) as Skill[];
  const countWord = skillsField.value.match(/Выберите\s+(\S+)/i)?.[1]?.toLowerCase() ?? 'два';
  const skillChoices = { pick: NUMBER_WORDS[countWord.replace(/х$/, '')] ?? NUMBER_WORDS[countWord] ?? 2, from: skillKeys.length ? skillKeys : (Object.keys(SKILLS) as Skill[]) };

  // Таблица уровней
  const levels: ClassLevel[] = [];
  const table = $('table.class_table').first();
  table.find('br').replaceWith(' ');
  const headers = table.find('tr.table_header td').map((_, td) => text($(td).find('.long').text() || $(td).text())).get();
  table.find('tr').not('.table_header').each((_, tr) => {
    const cells = $(tr).children('td');
    const level = Number(text(cells.eq(0).text()));
    if (!level) return;
    const features = cells
      .find('a[href^="#feature."]')
      .map((__, a) => $(a).attr('href')!.slice('#feature.'.length))
      .get();
    const columns: Record<string, string> = {};
    cells.each((i, td) => {
      const h = headers[i];
      if (!h || i === 0 || /уровень|бонус|умения/i.test(h) || /^\d$/.test(h)) return;
      columns[h] = text($(td).text());
    });
    levels.push({ level, features, columns });
  });

  // Умения класса
  const features: Feature[] = [];
  $('h3 span[id^="feature."]').each((_, span) => {
    const fid = $(span).attr('id')!.slice('feature.'.length);
    const h3 = $(span).closest('h3');
    // Следующее умение может лежать в обёртке опциональных (div.TCE-feature-on) — на ней тоже останавливаемся
    const bodyNodes = h3.nextUntil('h3, h2, div:has(> h3)');
    const firstEm = text(bodyNodes.first().find('em').first().text());
    const level = levelFromEm(firstEm) ?? levels.find((l) => l.features.includes(fid))?.level;
    const f = classFeature($, `${slug}.${fid}`, title(h3.text()), bodyNodes, level, levels);
    f.effects = [...(rules.effects?.[fid] ?? []), ...(f.effects ?? [])];
    if (h3.closest('.TCE-feature-on').length) f.optional = true;
    features.push(f);
  });
  // Самодельные классы: умение — заголовок h3, за которым «N-й уровень, умение …»; h3 без уровня — часть описания
  const loose = features.length === 0;
  if (loose) {
    const isFeature = (h3: cheerio.Cheerio<AnyNode>) => levelFromEm(text(h3.next('p').find('em').first().text())) !== undefined;
    $('h3').each((i, el) => {
      const h3 = $(el);
      if (h3.closest('.hide-wrapper').length || !isFeature(h3)) return;
      const nodes: AnyNode[] = [];
      let n = h3.next();
      while (n.length && !n.is('h2') && !(n.is('h3') && isFeature(n))) {
        nodes.push(n[0]!);
        n = n.next();
      }
      const level = levelFromEm(text(h3.next('p').find('em').first().text()));
      features.push({ id: `${slug}.f${i}`, name: title(h3.text()), description: blockText($, $(nodes.slice(1))), level, effects: [] });
    });
  }
  // Ссылки в таблице — на полные id
  for (const l of levels) l.features = l.features.map((f) => `${slug}.${f}`);
  // Быстрое передвижение варвара: +10 футов к скорости — эффект прибавки, а не абсолютное значение
  for (const f of features) f.effects = f.effects?.filter((e) => !(e.type === 'speed' && e.walk === 0));

  // Подклассы: официальные — до раздела «Unearthed Arcana & Unofficial»
  const unofficial = $('span#unofficial').closest('h2');
  const unofficialIndex = unofficial.length ? $('h2').index(unofficial) : Infinity;
  const subclasses: Subclass[] = [];
  $('h2.bigSectionTitle.hide-next span[id]').each((_, span) => {
    const h2 = $(span).closest('h2');
    if ($('h2').index(h2) > unofficialIndex) return;
    const sid = $(span).attr('id')!;
    if (/^(ua|hb)\./.test(sid) || (!sid.includes('.') && !loose)) return;
    const wrapper = h2.next('.hide-wrapper');
    if (!wrapper.length) return;
    // У самодельных классов под такими заголовками бывают и не подклассы — берём только блоки с умениями по уровням
    if (loose && !wrapper.children('h3').toArray().some((h) => levelFromEm(text($(h).next('p').find('em').first().text())) !== undefined)) return;
    const subFeatures: Feature[] = [];
    wrapper.children('h3').each((i, h3el) => {
      const h3 = $(h3el);
      const nodes = h3.nextUntil('h3, h2');
      const em = text(nodes.first().find('em').first().text());
      const level = levelFromEm(em);
      subFeatures.push(classFeature($, `${slug}.${sid}.${i}`, title(h3.text()), nodes, level, levels));
    });
    const intro = blockText($, $(wrapper.children('h3').first().prevAll('p').toArray().reverse()));
    subclasses.push({ id: sid, name: text(span.children.length ? $(span).text() : h2.text()), description: intro || undefined, features: subFeatures, spellcasting: SUBCLASS_CASTING[sid] });
  });
  const subclassLevel = Math.min(...subclasses.flatMap((s) => s.features.map((f) => f.level ?? 99)), 99);
  for (const s of subclasses) for (const f of s.features) f.level ??= subclassLevel === 99 ? 3 : subclassLevel;

  return {
    kind: 'class',
    id: `dndsu-class-${slug}`,
    name,
    source: 'dnd.su',
    sourceUrl: url,
    nameEn: en,
    book,
    hitDie,
    saves,
    armor,
    weapons,
    tools,
    skillChoices,
    equipment: blockText($, $('h4').filter((_, h) => /снаряжение/i.test($(h).text())).first().nextUntil('h4, h3')) || undefined,
    spellcasting: rules.spellcasting,
    features,
    levels,
    subclassLevel: subclassLevel === 99 ? 3 : subclassLevel,
    subclasses,
  };
}

export function detectKind(url: string): 'race' | 'class' | 'spell' | 'monster' | 'item' | null {
  // Самодельное (homebrew) и «мультивселенная» лежат в тех же разделах, только с префиксом
  const p = new URL(url).pathname.replace(/^\/(homebrew|multiverse)(?=\/)/, '');
  if (p.startsWith('/race/')) return 'race';
  if (p.startsWith('/class/')) return 'class';
  if (p.startsWith('/spells/')) return 'spell';
  if (p.startsWith('/bestiary/')) return 'monster';
  if (p.startsWith('/items/')) return 'item';
  return null;
}

// ---------- Заклинания ----------

const SCHOOL_WORDS: [RegExp, string][] = [
  [/ограждени/i, 'abjuration'],
  [/вызов/i, 'conjuration'],
  [/прорицани/i, 'divination'],
  [/очаровани/i, 'enchantment'],
  [/воплощени/i, 'evocation'],
  [/иллюзи/i, 'illusion'],
  [/некромант/i, 'necromancy'],
  [/преобразовани/i, 'transmutation'],
];

const DICE = String.raw`\d+к\d+(?:\s*\+\s*\d+)?`;

export interface ParsedSpell {
  kind: 'spell';
  id: string;
  name: string;
  nameEn?: string;
  source: 'dnd.su';
  sourceUrl: string;
  book?: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: { v: boolean; s: boolean; m?: string };
  duration: string;
  concentration: boolean;
  ritual: boolean;
  /** Названия классов со страницы; при загрузке в библиотеку превращаются в id классов */
  classNames: string[];
  subclassNames: string[];
  classes: string[];
  description: string;
  higherLevels?: string;
  damage?: { dice: string; type?: string; perSlotAbove?: string; cantripScaling?: boolean };
  heal?: { dice: string; perSlotAbove?: string };
  save?: Ability;
  attack?: 'melee' | 'ranged';
}

export function parseSpell(html: string, url: string): ParsedSpell {
  const $ = cheerio.load(html);
  const card = $('.card[data-cardlink^="/spells/"]').first();
  const titleEl = card.find('h2.card-title [data-copy]').first();
  const full = text(titleEl.text() || card.find('h2.card-title').first().text());
  if (!full) throw new Error('не нашлось названия заклинания');
  const m = full.match(/^(.*?)\s*\[(.+?)\]\s*$/);
  const name = (m ? m[1] : full)!.trim();
  const book = card.find('h2.card-title .source-plaque').first().attr('title');

  const params = card.find('ul.params').first();
  const field = (label: string) => {
    let out = '';
    params.children('li').each((_, li) => {
      const strong = text($(li).find('strong').first().text());
      if (strong.replace(/:$/, '').toLowerCase() === label) out = text($(li).text()).slice(strong.length).trim();
    });
    return out;
  };
  const head = text(params.find('li.size-type-alignment').first().text());
  const level = /заговор/i.test(head) ? 0 : Number(head.match(/(\d)\s*уровень/)?.[1] ?? 0);
  const school = SCHOOL_WORDS.find(([re]) => re.test(head))?.[1] ?? 'evocation';
  const ritual = /ритуал/i.test(head);
  const comps = field('компоненты');
  const material = comps.match(/М\s*\(([\s\S]*)\)\s*$/)?.[1];
  const durationRaw = field('длительность');
  const concentration = /концентрац/i.test(durationRaw);
  const duration = durationRaw.replace(/^концентрация,\s*/i, '').replace(/^вплоть до/i, 'Вплоть до');
  const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const desc = params.find('[itemprop="description"]').first();
  const paras: string[] = [];
  let higherLevels: string | undefined;
  desc.children().each((_, el) => {
    const t = text($(el).text());
    if (!t) return;
    if (/^на больших уровнях\.?/i.test(t)) higherLevels = t.replace(/^на больших уровнях\.?\s*/i, '');
    else paras.push(t);
  });
  const description = paras.join('\n\n') || text(desc.text());
  const all = `${description} ${higherLevels ?? ''}`;

  const spell: ParsedSpell = {
    kind: 'spell',
    id: `dndsu-spell-${new URL(url).pathname.split('/').filter(Boolean).pop()}`,
    name,
    nameEn: m?.[2],
    source: 'dnd.su',
    sourceUrl: url,
    book,
    level,
    school,
    castingTime: field('время накладывания'),
    range: field('дистанция'),
    components: { v: /(^|,\s*)В(,|$|\s)/.test(comps), s: /(^|,\s*)С(,|$|\s)/.test(comps), ...(material ? { m: material.trim() } : {}) },
    duration: duration || durationRaw,
    concentration,
    ritual,
    classNames: splitList(field('классы')),
    subclassNames: splitList(field('подклассы')),
    classes: [],
    description,
    ...(higherLevels ? { higherLevels } : {}),
  };

  const dmgA = description.match(new RegExp(`(${DICE})\\s+урона\\s+([а-яё]+(?:\\s+[а-яё]+)?)`, 'i'));
  const dmgB = description.match(new RegExp(`урона?\\s+([а-яё]+(?:\\s+[а-яё]+)?)\\s+(${DICE})`, 'i'));
  const dmg = dmgA ? [dmgA[1]!, dmgA[2]!] : dmgB ? [dmgB[2]!, dmgB[1]!] : null;
  if (dmg) {
    const type = DAMAGE_WORDS.find(([re]) => re.test(dmg[1]!))?.[1];
    const per = higherLevels?.match(new RegExp(`урон[^.]*?увеличивается\\s+на\\s+(${DICE})`, 'i'))?.[1];
    const cantripScaling = level === 0 && /достига\S*\s+5[-\s]/i.test(all);
    spell.damage = { dice: dmg[0]!.replace(/\s+/g, ''), ...(type ? { type } : {}), ...(per ? { perSlotAbove: per.replace(/\s+/g, '') } : {}), ...(cantripScaling ? { cantripScaling } : {}) };
  }
  const heal = description.match(new RegExp(`восстанавлива\\S*\\s+(?:количество\\s+хитов,\\s+равное\\s+|хиты\\s+в\\s+количестве\\s+|)(${DICE})`, 'i'));
  if (heal) {
    const per = higherLevels?.match(new RegExp(`(?:лечени|восстан)[^.]*?увеличивается\\s+на\\s+(${DICE})`, 'i'))?.[1];
    spell.heal = { dice: heal[1]!.replace(/\s+/g, ''), ...(per ? { perSlotAbove: per.replace(/\s+/g, '') } : {}) };
  }
  const save = all.match(/спасброс\S*\s+([А-ЯЁ][а-яё]+)/);
  const ab = save ? abilityFromWord(save[1]!) : undefined;
  if (ab) spell.save = ab;
  if (/рукопашную\s+атаку\s+заклинанием/i.test(all)) spell.attack = 'melee';
  else if (/дальнобойную\s+атаку\s+заклинанием/i.test(all)) spell.attack = 'ranged';
  return spell;
}

// ---------- Предметы ----------

const COIN_WORDS: [RegExp, Coin][] = [
  [/^мм/i, 'cp'],
  [/^см/i, 'sp'],
  [/^эм/i, 'ep'],
  [/^зм/i, 'gp'],
  [/^пм/i, 'pp'],
];

/** «2 зм», «1 000 зм», «5 см.» → { amount, coin } */
export function parseCost(s: string): Item['cost'] | undefined {
  const m = s.replace(/ /g, ' ').match(/(\d[\d\s]*)\s*(мм|см|эм|зм|пм)/i);
  if (!m) return undefined;
  const coin = COIN_WORDS.find(([re]) => re.test(m[2]!))?.[1] ?? 'gp';
  return { amount: Number(m[1]!.replace(/\s/g, '')), coin };
}

/** «4 фнт.», «½ фнт.», «1,5 фнт.», «1/2 фнт.» → фунты */
function parseWeight(s: string): number | undefined {
  const t = s.replace(/ /g, ' ').trim();
  if (/½/.test(t)) return 0.5;
  if (/¼/.test(t)) return 0.25;
  const frac = t.match(/(\d+)\s*\/\s*(\d+)/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1]!.replace(',', '.')) : undefined;
}

const isCost = (s: string) => /^\d[\d\s ]*\s*(мм|см|эм|зм|пм)\.?$/i.test(s.trim());

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
export const slugify = (s: string) =>
  s.toLowerCase().split('').map((ch) => TRANSLIT[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const cellTexts = ($: $, tr: AnyNode) => $(tr).children('td,th').map((_, td) => text($(td).text())).get();

function baseItem(name: string, url: string, category: Item['category'], cost: string, weight: string): Item {
  return {
    kind: 'item', id: `dndsu-gear-${slugify(name)}`, name, source: 'dnd.su', sourceUrl: `${url}#${slugify(name)}`, category,
    cost: parseCost(cost), weight: parseWeight(weight), book: "Player's Handbook",
  };
}

/**
 * Обычное снаряжение со статей dnd.su «Оружие», «Доспехи и щиты», «Снаряжение», «Инструменты»:
 * таблицы с ценой и весом. У оружия — урон и свойства, у доспехов — КД, требование Силы и помеха Скрытности.
 */
export function parseGear(html: string, url: string): Item[] {
  const $ = cheerio.load(html);
  const out: Item[] = [];
  const seen = new Set<string>();
  const push = (it: Item) => {
    if (!it.name || seen.has(it.name)) return;
    seen.add(it.name);
    out.push(it);
  };
  $('table').each((_, table) => {
    const rows = $(table).find('tr').toArray();
    if (!rows.length) return;
    const head = cellTexts($, rows[0]!).join(' ').toLowerCase();
    if (/урон/.test(head)) {
      // Оружие: разделы «Простое рукопашное оружие», «Воинское дальнобойное оружие»
      let martial = false;
      let ranged = false;
      for (const tr of rows.slice(1)) {
        const c = cellTexts($, tr);
        if (c.length === 1) {
          martial = /воинск/i.test(c[0]!);
          ranged = /дальнобойн/i.test(c[0]!);
          continue;
        }
        if (c.length < 5) continue;
        const [name, cost, dmg, weight, props] = c as [string, string, string, string, string];
        const dm = dmg.match(/(\d+к\d+|\d+)\s*(\S+)?/);
        const properties = props === '-' || props === '—' ? [] : props.split(/,\s*(?![^()]*\))/).map((p) => p.trim()).filter(Boolean);
        const it = baseItem(name, url, 'weapon', cost, weight);
        it.weapon = {
          damage: dm?.[1] ?? '—',
          damageType: (DAMAGE_WORDS.find(([re]) => re.test(dm?.[2] ?? ''))?.[1] ?? 'bludgeoning') as NonNullable<Item['weapon']>['damageType'],
          versatile: props.match(/универсальное\s*\((\d+к\d+)\)/i)?.[1],
          properties,
          range: props.match(/дис\.\s*([\d/]+)/i)?.[1],
          martial,
          ranged,
        };
        push(it);
      }
      return;
    }
    if (/класс доспеха/.test(head)) {
      let type: 'light' | 'medium' | 'heavy' | 'shield' = 'light';
      for (const tr of rows.slice(1)) {
        const c = cellTexts($, tr);
        if (c.length === 1) {
          type = /лёгк|легк/i.test(c[0]!) ? 'light' : /средн/i.test(c[0]!) ? 'medium' : /тяж/i.test(c[0]!) ? 'heavy' : 'shield';
          continue;
        }
        if (c.length < 6) continue;
        const [name, cost, ac, str, stealth, weight] = c as [string, string, string, string, string, string];
        if (type === 'shield' || /^\+\d/.test(ac)) {
          const it = baseItem(name, url, 'shield', cost, weight);
          it.shield = { bonus: Number(ac.match(/\d+/)?.[0] ?? 2) };
          push(it);
          continue;
        }
        // «Кожаный», «Стёганый» → «Кожаный доспех»; «Латы», «Кольчуга» — как есть
        const it = baseItem(/(ый|ий|ой)$/i.test(name) ? `${name} доспех` : name, url, 'armor', cost, weight);
        const cap = ac.match(/макс\.?\s*(\d+)/i)?.[1];
        it.armor = {
          base: Number(ac.match(/\d+/)?.[0] ?? 10),
          dexCap: /ЛОВ/i.test(ac) ? (cap ? Number(cap) : null) : 0,
          type,
          ...(/помех/i.test(stealth) ? { stealthDisadvantage: true } : {}),
          ...(/\d+/.test(str) ? { strength: Number(str.match(/\d+/)![0]) } : {}),
        };
        push(it);
      }
      return;
    }
    if (!/стоимость|цена/.test(head) || !/вес/.test(head)) return;
    // Снаряжение и инструменты: иногда по два предмета в строке, заголовки разделов — отдельными ячейками
    const tools = /инструмент/i.test($('h1, h2.card-title').first().text()) || /100-tools/.test(url);
    let section = '';
    for (const tr of rows.slice(1)) {
      const c = cellTexts($, tr);
      for (let i = 0; i < c.length; ) {
        if (i + 1 < c.length && isCost(c[i + 1]!)) {
          const name = c[i]!;
          const category: Item['category'] = tools || /инструмент|набор/i.test(section) ? 'tool' : 'gear';
          push(baseItem(name, url, category, c[i + 1]!, c[i + 2] ?? ''));
          i += 3;
        } else {
          section = c[i]!;
          i += 1;
        }
      }
    }
  });
  return out;
}

const RARITY = /(очень редк\S*|необычн\S*|обычн\S*|редк\S*|легендарн\S*|артефакт|редкость варьируется)/i;

/** Магический предмет со страницы dnd.su/items/… */
export function parseItem(html: string, url: string): Item {
  const $ = cheerio.load(html);
  const { name, en, book } = cardTitle($);
  const typeLine = text($('.size-type-alignment').first().text());
  const description = blockText($, $('[itemprop="description"]').first().children());
  const rarity = typeLine.match(RARITY)?.[1]?.toLowerCase();
  const consumable = /^(зелье|свиток|боеприпас)/i.test(typeLine);
  const effects: Effect[] = [];
  // «Вы получаете бонус +1 к КД» — кольцо и плащ защиты, магические доспехи и щиты
  const ac = description.match(/бонус\s*\+(\d)\s*к\s*(?:КД|Классу Доспеха)/i);
  if (ac && !/^оружие/i.test(typeLine)) effects.push({ type: 'ac_bonus', value: Number(ac[1]) });
  const resist = description.match(/сопротивлени\S*\s+(?:к\s+)?урону?\s+([^.,;]+)/i);
  if (resist && !/на ваш выбор|выбранного/i.test(resist[0])) {
    for (const [re, dmg] of DAMAGE_WORDS) if (re.test(resist[1]!)) effects.push({ type: 'resistance', damage: dmg as never });
  }
  return {
    kind: 'item',
    id: `dndsu-item-${slugOf(url)}`,
    name,
    nameEn: en,
    book,
    source: 'dnd.su',
    sourceUrl: url,
    category: consumable ? 'consumable' : 'magic',
    description: [typeLine, description].filter(Boolean).join('\n'),
    rarity,
    attunement: /настройк/i.test(typeLine) || undefined,
    cost: parseCost(text($('.price').first().text())),
    ...(effects.length ? { effects } : {}),
  };
}
