/** Броски кубиков. Формулы в русской записи («2к6+3») и английской («2d6+3»). */

export type Rng = () => number;

export interface DiceRoll {
  formula: string;
  rolls: { die: number; value: number; dropped?: boolean }[];
  modifier: number;
  total: number;
}

const TERM = /([+-]?)\s*(?:(\d*)\s*[кdкД]\s*(\d+)(?:\s*(kh|kl)(\d+))?|(\d+))/giu;

export function parseDice(formula: string) {
  const terms: { sign: 1 | -1; count: number; die: number; keep?: { mode: 'kh' | 'kl'; n: number } }[] = [];
  let modifier = 0;
  const clean = formula.replace(/\s+/g, '');
  if (!clean) throw new Error('Пустая формула');
  let consumed = 0;
  for (const m of clean.matchAll(TERM)) {
    consumed += m[0].length;
    const sign = m[1] === '-' ? -1 : 1;
    if (m[6] !== undefined) {
      modifier += sign * Number(m[6]);
      continue;
    }
    const count = m[2] ? Number(m[2]) : 1;
    const die = Number(m[3]);
    if (count > 100 || die > 1000 || die < 1) throw new Error('Слишком большая формула');
    terms.push({ sign, count, die, keep: m[4] ? { mode: m[4].toLowerCase() as 'kh' | 'kl', n: Number(m[5]) } : undefined });
  }
  if (consumed !== clean.length) throw new Error(`Не понимаю формулу «${formula}»`);
  return { terms, modifier };
}

export function roll(formula: string, rng: Rng = Math.random): DiceRoll {
  const { terms, modifier } = parseDice(formula);
  const rolls: DiceRoll['rolls'] = [];
  let total = modifier;
  for (const t of terms) {
    const values = Array.from({ length: t.count }, () => 1 + Math.floor(rng() * t.die));
    let kept = values.map((v, i) => ({ v, i }));
    if (t.keep) {
      kept = [...kept].sort((a, b) => (t.keep!.mode === 'kh' ? b.v - a.v : a.v - b.v)).slice(0, t.keep.n);
    }
    const keptIdx = new Set(kept.map((k) => k.i));
    values.forEach((v, i) => {
      rolls.push({ die: t.die, value: v, dropped: !keptIdx.has(i) || undefined });
      if (keptIdx.has(i)) total += t.sign * v;
    });
  }
  return { formula, rolls, modifier, total };
}

/** Средний результат формулы: «4к8+4» → 22 (для хитов монстров). */
export function average(formula: string): number {
  const { terms, modifier } = parseDice(formula);
  return Math.floor(terms.reduce((s, t) => s + t.sign * t.count * ((t.die + 1) / 2), modifier));
}

/** d20 с преимуществом/помехой. */
export function rollD20(bonus: number, mode: 'normal' | 'advantage' | 'disadvantage' = 'normal', rng: Rng = Math.random): DiceRoll {
  const sign = bonus >= 0 ? `+${bonus}` : `${bonus}`;
  const f = mode === 'normal' ? `1к20${sign}` : `2к20${mode === 'advantage' ? 'kh1' : 'kl1'}${sign}`;
  return roll(f, rng);
}

export const formatBonus = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
