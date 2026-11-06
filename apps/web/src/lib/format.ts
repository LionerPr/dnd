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
