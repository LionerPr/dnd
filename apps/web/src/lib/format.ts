import { ABILITY_NAMES, CONDITIONS, DAMAGE_TYPES, SPELL_SCHOOLS, type Ability } from '@dnd/rules-engine';

export const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
export const abilityShort = (a: Ability) => ABILITY_NAMES[a].short;
export const conditionName = (c: string) => (CONDITIONS as Record<string, string>)[c] ?? c;
export const damageName = (d: string) => (DAMAGE_TYPES as Record<string, string>)[d] ?? d;
export const schoolName = (s: string) => (SPELL_SCHOOLS as Record<string, string>)[s] ?? s;

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export const KIND_NAMES: Record<string, { one: string; many: string }> = {
  race: { one: 'Раса', many: 'Расы' },
  class: { one: 'Класс', many: 'Классы' },
  spell: { one: 'Заклинание', many: 'Заклинания' },
  item: { one: 'Предмет', many: 'Предметы' },
  monster: { one: 'Существо', many: 'Бестиарий' },
  feat: { one: 'Черта', many: 'Черты' },
};

export const levelName = (l: number) => (l === 0 ? 'Заговор' : `${l} уровень`);

/** Ключ для поиска: без регистра и без разницы между «ё» и «е». */
export const searchKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

const BOOKS: Record<string, string> = {
  "Player's Handbook": 'PHB',
  "Player's Handbook 2024": 'PHB 2024',
  'Mordenkainen Presents: Monsters of the Multiverse': 'MPMM',
  "Volo's Guide to Monsters": 'VGM',
  "Xanathar's Guide to Everything": 'XGE',
  "Tasha's Cauldron of Everything": 'TCE',
  'Mordenkainen’s Tome of Foes': 'MTF',
  "Mordenkainen's Tome of Foes": 'MTF',
  'Eberron: Rising from the Last War': 'ERLW',
  "Guildmasters' Guide to Ravnica": 'GGR',
  'Elemental Evil Player’s Companion': 'EEPC',
  "Elemental Evil Player's Companion": 'EEPC',
  "Sword Coast Adventurer's Guide": 'SCAG',
  'Mythic Odysseys of Theros': 'MOT',
  'Spelljammer: Adventures in Space': 'AAG',
  "Fizban's Treasury of Dragons": 'FTD',
  'The Wild Beyond the Witchlight': 'WBW',
  'Dragonlance: Shadow of the Dragon Queen': 'DSotDQ',
  "Dungeon Master's Guide": 'DMG',
  'Monster Manual': 'MM',
};

/** Короткое имя книги-источника: PHB, MPMM… Помогает различать одноимённые расы из разных книг. */
export function bookShort(book?: string) {
  if (!book) return undefined;
  if (BOOKS[book]) return BOOKS[book];
  const caps = book.replace(/[’']s\b/g, '').match(/\b[A-Z0-9]/g)?.join('');
  return caps && caps.length >= 2 && caps.length <= 6 ? caps : book;
}

const PROF_NAMES: Record<string, string> = {
  light: 'лёгкие доспехи', medium: 'средние доспехи', heavy: 'тяжёлые доспехи', shield: 'щиты',
  simple: 'простое оружие', martial: 'воинское оружие',
  'tools.blacksmith': 'инструменты кузнеца', 'tools.smith': 'инструменты кузнеца', 'tools.brewer': 'инструменты пивовара', 'tools.mason': 'инструменты каменщика',
  'tools.thieves': 'воровские инструменты', 'tools.thief': 'воровские инструменты', 'tools.herbalism': 'набор травника',
  'tools.disguise': 'набор для грима', 'tools.forgery': 'набор для фальсификации', 'tools.poisoner': 'инструменты отравителя',
  'tools.navigator': 'инструменты навигатора', 'tools.tinker': 'инструменты ремонтника', 'tools.carpenter': 'инструменты плотника',
  'tools.cook': 'инструменты повара', 'tools.jeweler': 'инструменты ювелира', 'tools.leatherworker': 'инструменты кожевника',
  'tools.alchemist': 'инструменты алхимика', 'tools.calligrapher': 'инструменты каллиграфа', 'tools.cartographer': 'инструменты картографа',
  'tools.cobbler': 'инструменты сапожника', 'tools.glassblower': 'инструменты стеклодува', 'tools.painter': 'инструменты художника',
  'tools.potter': 'инструменты гончара', 'tools.weaver': 'инструменты ткача', 'tools.woodcarver': 'инструменты резчика по дереву',
  'tools.musical': 'музыкальный инструмент', 'tools.gaming': 'игровой набор', 'tools.vehicles': 'транспорт',
};
export const profName = (k: string) => PROF_NAMES[k] ?? k.replace(/^tools\./, '');
