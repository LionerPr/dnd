// Заклинания SRD 5.2 (2024). Игровые поля — из открытых данных Open5e (SRD 5.2, CC-BY 4.0, Wizards of the Coast),
// русские названия — из списка Long Story Short (CC-BY 4.0), тексты переведены для этого приложения (data/srd52-spells-ru).
import type { Ability } from '@dnd/rules-engine';

export interface O5eSpell {
  pk: string;
  fields: {
    name: string; desc: string; level: number; school: string; higher_level?: string | null;
    range_text: string; ritual: boolean; casting_time: string; reaction_condition?: string | null;
    verbal: boolean; somatic: boolean; material: boolean; material_specified?: string | null;
    saving_throw_ability?: string; attack_roll?: boolean; damage_roll?: string; damage_types?: string[];
    duration: string; concentration: boolean; classes: string[];
  };
}

export interface RuSpellText { name?: string; material?: string; description: string; higherLevels?: string }

/** Разбор файлов перевода: «## slug», необязательные «NAME:» и «M:», текст, необязательная строка «HL:» */
export function parseRuSpells(text: string): Record<string, RuSpellText> {
  const out: Record<string, RuSpellText> = {};
  for (const block of text.split(/^## /m).slice(1)) {
    const lines = block.replace(/\s+$/, '').split('\n');
    const slug = lines.shift()!.trim();
    const t: RuSpellText = { description: '' };
    const body: string[] = [];
    for (const line of lines) {
      if (line.startsWith('NAME: ')) t.name = line.slice(6).trim();
      else if (line.startsWith('M: ')) t.material = line.slice(3).trim();
      else if (line.startsWith('HL: ')) t.higherLevels = line.slice(4).trim();
      else body.push(line);
    }
    t.description = body.join('\n').trim();
    out[slug] = t;
  }
  return out;
}

const CLASS_RU: Record<string, string> = {
  bard: 'Бард', cleric: 'Жрец', druid: 'Друид', paladin: 'Паладин', ranger: 'Следопыт', sorcerer: 'Чародей', warlock: 'Колдун', wizard: 'Волшебник',
};
const CASTING: Record<string, string> = {
  action: '1 действие', 'bonus-action': '1 бонусное действие', reaction: '1 реакция',
  '1minute': '1 минута', '10minutes': '10 минут', '1hour': '1 час', '8hours': '8 часов', '12hours': '12 часов', '24hours': '24 часа',
};
const REACTION_RU: Record<string, string> = {
  counterspell: 'когда вы видите, как существо в пределах 60 футов от вас накладывает заклинание с вербальным, соматическим или материальным компонентом',
  'feather-fall': 'когда вы или существо, которое вы видите в пределах 60 футов от вас, падаете',
  'hellish-rebuke': 'в ответ на урон от существа, которое вы видите в пределах 60 футов от себя',
  shield: 'когда по вам попадает бросок атаки или вы становитесь целью заклинания Волшебная стрела',
};
const DURATION: Record<string, string> = {
  instantaneous: 'Мгновенная', special: 'Особая', 'until dispelled': 'Пока не рассеется', 'until dispelled or triggered': 'Пока не рассеется или не сработает',
  '1 round': '1 раунд', '6 rounds': '6 раундов', '1 minute': '1 минута', '10 minutes': '10 минут', '1 hour': '1 час', '2 hours': '2 часа',
  '8 hours': '8 часов', '24 hours': '24 часа', '1 day': '1 день', '7 days': '7 дней', '10 days': '10 дней', '30 days': '30 дней',
};
const ABILITY: Record<string, Ability> = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

export function rangeRu(s: string): string {
  if (s === 'Self') return 'На себя';
  if (s === 'Touch') return 'Касание';
  if (s === 'Sight') return 'В пределах видимости';
  if (s === 'Unlimited') return 'Без ограничений';
  if (s === 'Special') return 'Особая';
  const m = s.match(/^(\d+)\s+(feet|foot|miles?)$/);
  if (m) {
    const n = Number(m[1]);
    return m[2]!.startsWith('mile') ? `${n} ${plural(n, 'миля', 'мили', 'миль')}` : `${n} ${plural(n, 'фут', 'фута', 'футов')}`;
  }
  return s;
}

const dice = (s: string) => s.replace(/(\d*)d(\d+)/g, '$1к$2');

export function fromO5eSpell(o: O5eSpell, ruName: string | undefined, ru: RuSpellText | undefined) {
  const f = o.fields;
  const slug = o.pk.replace(/^srd-2024_/, '');
  const classes = f.classes.map((c) => c.replace(/^srd-2024_/, ''));
  const en = `${f.desc} ${f.higher_level ?? ''}`;
  const perSlot = f.higher_level?.match(/increases? by (\d+d\d+)[^.]*?for each (?:spell )?slot level above/i)?.[1];
  const damageType = f.damage_types?.[0];
  const heal = f.desc.match(/regains? (?:a number of )?Hit Points equal to (\d+d\d+)/i)?.[1] ?? f.desc.match(/regains? (\d+d\d+) Hit Points/i)?.[1];
  const healPer = f.higher_level?.match(/healing increases by (\d+d\d+)/i)?.[1];
  const attack = f.attack_roll ? (/melee spell attack/i.test(f.desc) ? 'melee' : 'ranged') : undefined;
  const save = f.saving_throw_ability ? ABILITY[f.saving_throw_ability] : undefined;
  const castingTime = CASTING[f.casting_time] ?? f.casting_time;
  return {
    kind: 'spell' as const,
    id: `srd24-spell-${slug}`,
    name: ru?.name ?? (ruName ?? f.name).replace(/\s*\[.*\]\s*$/, ''),
    nameEn: f.name,
    source: 'srd',
    book: 'SRD 5.2',
    edition: '2024' as const,
    level: f.level,
    school: f.school,
    castingTime: f.casting_time === 'reaction' && REACTION_RU[slug] ? `${castingTime}, ${REACTION_RU[slug]}` : castingTime,
    range: rangeRu(f.range_text),
    components: { v: f.verbal, s: f.somatic, ...(f.material ? { m: ru?.material ?? f.material_specified ?? '' } : {}) },
    duration: DURATION[f.duration] ?? f.duration,
    concentration: f.concentration,
    ritual: f.ritual,
    classes: classes.map((c) => `srd24-class-${c}`),
    classNames: classes.map((c) => CLASS_RU[c] ?? c),
    description: ru?.description ?? f.desc,
    ...(ru?.higherLevels || f.higher_level ? { higherLevels: ru?.higherLevels ?? f.higher_level! } : {}),
    ...(f.damage_roll && /^\d+d\d+$/.test(f.damage_roll) && !heal
      ? { damage: { dice: dice(f.damage_roll), ...(damageType ? { type: damageType } : {}), ...(perSlot ? { perSlotAbove: dice(perSlot) } : {}), ...(f.level === 0 && /levels? 5/i.test(en) ? { cantripScaling: true } : {}) } }
      : {}),
    ...(heal ? { heal: { dice: dice(heal), ...(healPer ? { perSlotAbove: dice(healPer) } : {}) } } : {}),
    ...(save ? { save } : {}),
    ...(attack ? { attack } : {}),
  };
}

/** Кости, упомянутые в тексте: чтобы сверить перевод с оригиналом */
export const diceIn = (s: string) => [...new Set(s.replace(/(\d*)[dк](\d+)/g, ' $1d$2 ').match(/\b\d+d\d+\b/g) ?? [])].sort();

// ---------- Оружие 2024: приёмы оружия (mastery) ----------

export const MASTERY_RU: Record<string, { name: string; text: string }> = {
  cleave: { name: 'Рассечение', text: 'Попав по существу рукопашной атакой этим оружием, вы можете совершить им рукопашную атаку по второму существу в пределах 5 футов от первого и в пределах вашей досягаемости. При попадании второе существо получает урон оружия, но модификатор характеристики к нему не добавляется, если он не отрицательный. Не чаще раза за ход.' },
  graze: { name: 'Задевание', text: 'Если ваша атака этим оружием промахивается по существу, вы можете нанести ему урон, равный модификатору характеристики, использованной для броска атаки. Вид урона тот же, что у оружия; увеличить этот урон можно только увеличив модификатор.' },
  nick: { name: 'Подрезание', text: 'Дополнительную атаку от свойства «лёгкое» можно совершить как часть действия Атака, а не бонусным действием. Не чаще раза за ход.' },
  push: { name: 'Толчок', text: 'Попав по существу Большого или меньшего размера этим оружием, вы можете оттолкнуть его на расстояние до 10 футов прямо от себя.' },
  sap: { name: 'Ослабление', text: 'Существо, по которому вы попали этим оружием, совершает свой следующий бросок атаки до начала вашего следующего хода с помехой.' },
  slow: { name: 'Замедление', text: 'Попав по существу этим оружием и нанеся урон, вы можете уменьшить его скорость на 10 футов до начала вашего следующего хода. От нескольких попаданий оружием с этим приёмом скорость уменьшается не больше чем на 10 футов.' },
  topple: { name: 'Опрокидывание', text: 'Попав по существу этим оружием, вы можете заставить его совершить спасбросок Телосложения (Сл 8 + модификатор характеристики атаки + бонус мастерства). При провале оно получает состояние Сбитый с ног.' },
  vex: { name: 'Изматывание', text: 'Попав по существу этим оружием и нанеся урон, вы совершаете свой следующий бросок атаки по нему до конца вашего следующего хода с преимуществом.' },
};

const WEAPON_RU: Record<string, string> = {
  battleaxe: 'Боевой топор', blowgun: 'Духовая трубка', club: 'Дубинка', dagger: 'Кинжал', dart: 'Дротик', flail: 'Цеп', glaive: 'Глефа',
  greataxe: 'Секира', greatclub: 'Палица', greatsword: 'Двуручный меч', halberd: 'Алебарда', 'hand-crossbow': 'Арбалет, ручной', handaxe: 'Ручной топор',
  'heavy-crossbow': 'Арбалет, тяжёлый', javelin: 'Метательное копьё', lance: 'Длинное копьё', 'light-crossbow': 'Арбалет, лёгкий', 'light-hammer': 'Лёгкий молот',
  longbow: 'Длинный лук', longsword: 'Длинный меч', mace: 'Булава', maul: 'Молот', morningstar: 'Моргенштерн', musket: 'Мушкет', pike: 'Пика',
  pistol: 'Пистолет', quarterstaff: 'Боевой посох', rapier: 'Рапира', scimitar: 'Скимитар', shortbow: 'Короткий лук', shortsword: 'Короткий меч',
  sickle: 'Серп', sling: 'Праща', spear: 'Копьё', trident: 'Трезубец', 'war-pick': 'Боевая кирка', warhammer: 'Боевой молот', whip: 'Кнут',
};

export interface O5eRow<T> { pk: string; fields: T }

function cost(gp: number) {
  if (gp >= 1 && Number.isInteger(gp)) return { amount: gp, coin: 'gp' as const };
  if (Number.isInteger(gp * 10)) return { amount: Math.round(gp * 10), coin: 'sp' as const };
  return { amount: Math.round(gp * 100), coin: 'cp' as const };
}

export function weapons2024(
  weapons: O5eRow<{ name: string; damage_dice: string; damage_type: string; is_simple: boolean; range: number; long_range: number }>[],
  props: O5eRow<{ property: string; weapon: string; detail: string | null }>[],
  items: O5eRow<{ cost: string; weight: string; weapon: string | null }>[],
) {
  return weapons.map((w) => {
    const slug = w.pk.replace(/^srd-2024_/, '');
    const f = w.fields;
    const mine = props.filter((p) => p.fields.weapon === w.pk).map((p) => ({ key: p.fields.property.replace(/^srd-2024_/, '').replace(/-(wp|mastery)$/, ''), detail: p.fields.detail }));
    const range = f.range ? `${f.range}/${f.long_range}` : undefined;
    const versatile = mine.find((p) => p.key === 'versatile')?.detail;
    const mastery = mine.find((p) => MASTERY_RU[p.key]);
    const names: Record<string, string> = {
      ammunition: `Боеприпас (дис. ${range})`, finesse: 'Фехтовальное', heavy: 'Тяжёлое', light: 'Лёгкое', loading: 'Перезарядка', reach: 'Досягаемость',
      thrown: `Метательное (дис. ${range})`, 'two-handed': 'Двуручное', versatile: `Универсальное (${dice(versatile ?? '')})`,
    };
    const properties = mine.filter((p) => names[p.key]).map((p) => (p.key === 'two-handed' && p.detail ? 'Двуручное, если не верхом' : names[p.key]!));
    const item = items.find((i) => i.fields.weapon === w.pk);
    return {
      kind: 'item' as const,
      id: `srd24-item-${slug}`,
      name: WEAPON_RU[slug] ?? f.name,
      nameEn: f.name,
      source: 'srd',
      book: 'SRD 5.2',
      edition: '2024' as const,
      category: 'weapon' as const,
      ...(item ? { cost: cost(Number(item.fields.cost)), weight: Number(item.fields.weight) } : {}),
      weapon: {
        damage: /d/.test(f.damage_dice) ? dice(f.damage_dice) : f.damage_dice,
        damageType: f.damage_type,
        ...(versatile ? { versatile: dice(versatile) } : {}),
        properties: mastery ? [...properties, `Приём: ${MASTERY_RU[mastery.key]!.name}`] : properties,
        ...(range ? { range } : {}),
        martial: !f.is_simple,
        ranged: mine.some((p) => p.key === 'ammunition'),
      },
      ...(mastery ? { description: `Приём оружия «${MASTERY_RU[mastery.key]!.name}». ${MASTERY_RU[mastery.key]!.text}` } : {}),
    };
  });
}
