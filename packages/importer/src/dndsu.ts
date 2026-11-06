import type { Ability, CharacterClass, ClassLevel, Effect, Feature, Race, Skill, Spellcasting, Subclass, Subrace } from '@dnd/rules-engine';
import { SKILLS } from '@dnd/rules-engine';
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
function looseFeatures($: $, root: cheerio.Cheerio<AnyNode>, prefix: string, inside = false): Feature[] {
  const out: Feature[] = [];
  root.find('p').each((_, p) => {
    const $p = $(p);
    if (!inside && $p.closest('.hide-wrapper').length) return;
    const head = $p.children('strong, b').first();
    if (!head.length || !$p.text().trim().startsWith(head.text().trim().slice(0, 3))) return;
    const name = text(head.text()).replace(/[.:]\s*$/, '');
    if (!name || name.length > 60) return;
    const body = text($p.text()).slice(text(head.text()).length).trim();
    const id = `${prefix}.${out.length}`;
    out.push({ id, name, description: body, effects: effectsFromFeature(name, body, id, $p, $) });
  });
  return out;
}

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

export function effectsFromFeature(name: string, body: string, featureId: string, $html?: cheerio.Cheerio<AnyNode>, $?: $): Effect[] {
  const n = name.toLowerCase();
  const effects: Effect[] = [];
  if (n.startsWith('увеличение характеристик') || n.startsWith('повышение характеристик')) {
    for (const m of body.matchAll(/значение\s+(?:вашего|вашей|вашего\s+показателя)?\s*([А-ЯЁа-яё]+)\s+увеличивается\s+на\s+(\d)/gi)) {
      const a = abilityFromWord(m[1]!);
      if (a) effects.push({ type: 'ability_bonus', ability: a, value: Number(m[2]) });
    }
    if (/все\s+ваши\s+характеристики\s+увеличиваются\s+на\s+1/i.test(body)) {
      for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]) effects.push({ type: 'ability_bonus', ability: a, value: 1 });
    }
    const choiceTwo = body.match(/(?:увеличьте|увеличиваются)[^.]*?на\s+2[^.]*?на\s+1/i);
    if (!effects.length && choiceTwo) {
      effects.push({ type: 'ability_choice', id: `${featureId}.plus2`, pick: 1, value: 2 });
      effects.push({ type: 'ability_choice', id: `${featureId}.plus1`, pick: 1, value: 1 });
    }
    const other = body.match(/(\S+)\s+(?:другие|других|других\s+характеристик)[^.]*?на\s+1/i);
    if (other && !effects.some((e) => e.type !== 'ability_bonus')) {
      const count = NUMBER_WORDS[other[1]!.toLowerCase()] ?? 1;
      effects.push({ type: 'ability_choice', id: `${featureId}.choice`, pick: count, value: 1 });
    }
  }
  if (n === 'скорость' || /скорость ходьбы/i.test(body)) {
    const walk = body.match(/скорость\s+ходьбы\s+(?:составляет|равна)\s+(\d+)\s+фут/i);
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
    const m = body.match(/(\d+)\s+фут/);
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
  return effects;
}

// ---------- Расы ----------

function sizeFrom(body: string): Race['size'] {
  if (/крошечн/i.test(body)) return 'tiny';
  if (/маленьк/i.test(body)) return 'small';
  if (/больш/i.test(body)) return 'large';
  return 'medium';
}

function featuresFromParagraphs($: $, root: cheerio.Cheerio<AnyNode>, prefix: string): Feature[] {
  const out: Feature[] = [];
  const marked = root.find('p.article-body__feature');
  if (!marked.length) return looseFeatures($, root, prefix);
  marked.each((i, p) => {
    const $p = $(p);
    const name = text($p.find('.article-body__feature-name').first().text());
    const body = text($p.text()).replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\.?\\s*`), '');
    const id = `${prefix}.${i}`;
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
  const tools = /^нет$/i.test(toolsText) ? [] : toolsText.split(/,\s*/).filter(Boolean);
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
    const bodyNodes = h3.nextUntil('h3, h2');
    const firstEm = text(bodyNodes.first().find('em').first().text());
    const level = levelFromEm(firstEm) ?? levels.find((l) => l.features.includes(fid))?.level;
    const description = blockText($, bodyNodes.filter((i) => !(i === 0 && levelFromEm(firstEm) !== undefined)));
    const effects = rules.effects?.[fid] ?? [];
    features.push({ id: `${slug}.${fid}`, name: title(h3.text()), description, level, effects, optional: h3.closest('.TCE-feature-on').length > 0 || undefined });
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
      subFeatures.push({
        id: `${slug}.${sid}.${i}`,
        name: title(h3.text()),
        description: blockText($, nodes.filter((j) => !(j === 0 && level !== undefined))),
        level,
      });
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
