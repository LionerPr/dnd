// Предыстории из Книги игрока 5e (2014): только игровые числа — навыки, инструменты, языки, снаряжение, золото.
// Описания умений — краткий пересказ своими словами.
import type { Ability, Skill } from './data.js';
import type { Edition } from './types.js';
import srd2024 from './backgrounds-2024.json' with { type: 'json' };

export interface Background {
  id: string;
  name: string;
  skills: Skill[];
  tools?: string[];
  /** Инструмент на выбор: «один игровой набор», «инструменты ремесленника» */
  toolChoice?: { pick: number; of: string[] };
  /** Сколько языков на выбор */
  languages?: number;
  equipment: string[];
  gold: number;
  feature: { name: string; description: string };
  edition?: Edition;
  /** 2024: +3 к характеристикам из трёх (+2/+1 или +1/+1/+1) */
  abilityPool?: { total: number; max: number; options: Ability[] };
  /** 2024: черта происхождения (id в общей библиотеке) */
  featId?: string;
  /** 2024: вместо снаряжения — золото */
  goldInstead?: number;
}

export const ARTISAN_TOOLS = [
  'tools.alchemist', 'tools.brewer', 'tools.calligrapher', 'tools.carpenter', 'tools.cartographer', 'tools.cobbler', 'tools.cook',
  'tools.glassblower', 'tools.jeweler', 'tools.leatherworker', 'tools.mason', 'tools.painter', 'tools.potter', 'tools.smith',
  'tools.tinker', 'tools.weaver', 'tools.woodcarver',
];
export const GAMING_SETS = ['tools.dice', 'tools.chess', 'tools.cards', 'tools.threedragon'];

export const BACKGROUNDS: Background[] = [
  {
    id: 'acolyte', name: 'Прислужник', skills: ['insight', 'religion'], languages: 2,
    equipment: ['Священный символ', 'Молитвенник', '5 палочек благовоний', 'Облачение', 'Обычная одежда'], gold: 15,
    feature: { name: 'Приют для верующих', description: 'Храмы вашей веры дают вам и спутникам кров, лечение и поддержку.' },
  },
  {
    id: 'charlatan', name: 'Шарлатан', skills: ['deception', 'sleightOfHand'], tools: ['tools.disguise', 'tools.forgery'],
    equipment: ['Отличная одежда', 'Набор для грима', 'Инструменты для мошенничества'], gold: 15,
    feature: { name: 'Фальшивая личность', description: 'У вас есть вторая личность с документами и знакомствами.' },
  },
  {
    id: 'criminal', name: 'Преступник', skills: ['deception', 'stealth'], tools: ['tools.thieves'], toolChoice: { pick: 1, of: GAMING_SETS },
    equipment: ['Ломик', 'Тёмная обычная одежда с капюшоном'], gold: 15,
    feature: { name: 'Криминальные связи', description: 'У вас есть надёжный связной в преступном мире.' },
  },
  {
    id: 'entertainer', name: 'Артист', skills: ['acrobatics', 'performance'], tools: ['tools.disguise', 'tools.musical'],
    equipment: ['Музыкальный инструмент', 'Подарок от поклонника', 'Костюм'], gold: 15,
    feature: { name: 'По просьбе публики', description: 'За выступления вам дают ночлег и еду, а в городе вас узнают.' },
  },
  {
    id: 'folk-hero', name: 'Народный герой', skills: ['animalHandling', 'survival'], tools: ['tools.vehicles.land'], toolChoice: { pick: 1, of: ARTISAN_TOOLS },
    equipment: ['Инструменты ремесленника', 'Лопата', 'Железный горшок', 'Обычная одежда'], gold: 10,
    feature: { name: 'Деревенское гостеприимство', description: 'Простые люди укроют вас от погони и помогут, если это не опасно для них.' },
  },
  {
    id: 'guild-artisan', name: 'Гильдейский ремесленник', skills: ['insight', 'persuasion'], toolChoice: { pick: 1, of: ARTISAN_TOOLS }, languages: 1,
    equipment: ['Инструменты ремесленника', 'Рекомендательное письмо гильдии', 'Одежда путешественника'], gold: 15,
    feature: { name: 'Членство в гильдии', description: 'Гильдия даст кров, а при нужде поможет с законом и знакомствами.' },
  },
  {
    id: 'hermit', name: 'Отшельник', skills: ['medicine', 'religion'], tools: ['tools.herbalism'], languages: 1,
    equipment: ['Футляр для свитков с записями', 'Зимнее одеяло', 'Обычная одежда', 'Набор травника'], gold: 5,
    feature: { name: 'Открытие', description: 'В уединении вы узнали важную тайну — какую, решите с мастером.' },
  },
  {
    id: 'noble', name: 'Благородный', skills: ['history', 'persuasion'], toolChoice: { pick: 1, of: GAMING_SETS }, languages: 1,
    equipment: ['Отличная одежда', 'Кольцо-печатка', 'Свиток с родословной'], gold: 25,
    feature: { name: 'Привилегированность', description: 'Знать принимает вас как равного, простые люди стараются угодить.' },
  },
  {
    id: 'outlander', name: 'Чужеземец', skills: ['athletics', 'survival'], tools: ['tools.musical'], languages: 1,
    equipment: ['Посох', 'Охотничья ловушка', 'Трофей с убитого зверя', 'Одежда путешественника'], gold: 10,
    feature: { name: 'Странник', description: 'Вы хорошо помните местность и всегда найдёте пищу и воду для отряда.' },
  },
  {
    id: 'sage', name: 'Мудрец', skills: ['arcana', 'history'], languages: 2,
    equipment: ['Бутылочка чернил', 'Перо', 'Небольшой нож', 'Письмо от коллеги с вопросом', 'Обычная одежда'], gold: 10,
    feature: { name: 'Исследователь', description: 'Если вы чего-то не знаете, то обычно знаете, где и у кого это узнать.' },
  },
  {
    id: 'sailor', name: 'Моряк', skills: ['athletics', 'perception'], tools: ['tools.navigator', 'tools.vehicles.water'],
    equipment: ['Нагель (дубинка)', 'Шёлковая верёвка (50 футов)', 'Талисман', 'Обычная одежда'], gold: 10,
    feature: { name: 'Место на корабле', description: 'Вас с отрядом бесплатно возьмут на борт корабля, если вы поможете команде.' },
  },
  {
    id: 'soldier', name: 'Солдат', skills: ['athletics', 'intimidation'], tools: ['tools.vehicles.land'], toolChoice: { pick: 1, of: GAMING_SETS },
    equipment: ['Знак отличия', 'Трофей с павшего врага', 'Игральные кости', 'Обычная одежда'], gold: 10,
    feature: { name: 'Воинское звание', description: 'Солдаты вашей бывшей армии признают ваше звание.' },
  },
  {
    id: 'urchin', name: 'Беспризорник', skills: ['sleightOfHand', 'stealth'], tools: ['tools.disguise', 'tools.thieves'],
    equipment: ['Небольшой нож', 'Карта родного города', 'Ручная мышь', 'Памятная вещица родителей', 'Обычная одежда'], gold: 10,
    feature: { name: 'Городские тайны', description: 'В городе вы найдёте короткие пути и проведёте отряд вдвое быстрее.' },
  },
];

/** Предыстории SRD 5.2 (2024), русский перевод из открытого набора Long Story Short, CC-BY 4.0 */
BACKGROUNDS.push(...(srd2024 as Background[]));

export const backgroundById = (id: string | undefined) => (id ? BACKGROUNDS.find((b) => b.id === id) : undefined);

// ---------- Стартовое снаряжение класса ----------

export interface KitLine {
  /** Варианты на выбор; одна строка без вариантов — просто выдаётся */
  options: string[];
}

/**
 * Текст «Снаряжение» со страницы класса → строки с вариантами «а) … или б) …» и формула золота
 * («2к4 × 10 зм»), которое можно взять вместо снаряжения.
 */
export function parseKit(text: string | undefined): { lines: KitLine[]; gold?: { dice: string; times: number } } {
  if (!text) return { lines: [] };
  const goldMatch = text.match(/(\d+к\d+)\s*(?:[×x*]\s*(\d+))?\s*зм/i);
  const gold = goldMatch ? { dice: goldMatch[1]!, times: Number(goldMatch[2] ?? 1) } : undefined;
  const body = text.replace(/^[^:]*:\s*/, '').replace(/\s*Если вы откажетесь[\s\S]*$/i, '');
  // Без маркеров списка (как у монаха) — режем перед каждым «а)»
  const raw = body.includes('•') ? body.split(/\s*•\s*/) : body.split(/\s+(?=а\)\s)/);
  const lines: KitLine[] = [];
  for (const part of raw.map((s) => s.trim()).filter(Boolean)) {
    if (/^а\)/.test(part)) {
      const options = part.split(/(?:^|\s*,\s*|\s+или\s+)[а-г]\)\s*/).map((s) => s.trim()).filter(Boolean);
      // Без маркеров следующий предмет прилипает к последнему варианту: «набор путешественника 10 дротиков»
      const tail = !body.includes('•') ? options[options.length - 1]!.match(/^(.*?)\s+(\d+\s+\S.*)$/) : null;
      if (tail) options[options.length - 1] = tail[1]!;
      lines.push({ options });
      if (tail) lines.push({ options: [tail[2]!] });
    } else lines.push({ options: [part] });
  }
  return { lines, gold };
}

const NUMBER_WORDS: Record<string, number> = { два: 2, две: 2, двух: 2, три: 3, четыре: 4, пять: 5, шесть: 6, десять: 10, двадцать: 20 };

/** «лёгкий арбалет и 20 болтов» → [{ name: 'лёгкий арбалет', qty: 1 }, { name: '20 болтов', qty: 1 }]; «два кинжала» → qty 2 */
export function kitItems(option: string): { name: string; qty: number }[] {
  return option
    .split(/\s*,\s*|\s+и\s+/)
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter(Boolean)
    .map((s) => {
      const word = s.match(/^(\S+)\s+(.+)$/);
      const n = word && NUMBER_WORDS[word[1]!.toLowerCase()];
      if (n) return { name: word![2]!, qty: n };
      // «20 болтов», «10 дротиков» — боеприпасы считаем одной связкой, остальное — штуками
      const num = s.match(/^(\d+)\s+(.+)$/);
      if (num && !/болт|стрел|игл|снаряд/i.test(num[2]!)) return { name: num[2]!, qty: Number(num[1]) };
      return { name: s.charAt(0).toUpperCase() + s.slice(1), qty: 1 };
    });
}
