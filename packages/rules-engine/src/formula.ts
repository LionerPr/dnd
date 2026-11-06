// Небольшой вычислитель формул из наборов данных: «max([CHA],1)», «5*[LVL]», «floor(([LVL]+1)/6)+1», «[LVL]>=7».
// Только числа, + − * /, сравнения, скобки и функции min, max, floor, ceil — никакого eval.

export type FormulaVars = Record<string, number>;

export function evalFormula(expr: string, vars: FormulaVars): number {
  const src = expr.replace(/\[([A-Z]+)\]/g, (_, k: string) => String(vars[k] ?? 0));
  let i = 0;
  const peek = () => src[i];
  const skip = () => {
    while (src[i] === ' ') i++;
  };
  const expect = (ch: string) => {
    skip();
    if (src[i] !== ch) throw new Error(`Ожидалось «${ch}» в «${expr}»`);
    i++;
  };

  function primary(): number {
    skip();
    if (peek() === '(') {
      i++;
      const v = comparison();
      expect(')');
      return v;
    }
    if (peek() === '-') {
      i++;
      return -primary();
    }
    const num = src.slice(i).match(/^\d+(\.\d+)?/);
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const fn = src.slice(i).match(/^(min|max|floor|ceil)\s*\(/);
    if (fn) {
      i += fn[0].length;
      const args = [comparison()];
      skip();
      while (peek() === ',') {
        i++;
        args.push(comparison());
        skip();
      }
      expect(')');
      const name = fn[1]!;
      if (name === 'min') return Math.min(...args);
      if (name === 'max') return Math.max(...args);
      if (name === 'floor') return Math.floor(args[0]!);
      return Math.ceil(args[0]!);
    }
    throw new Error(`Не понимаю формулу «${expr}»`);
  }
  function term(): number {
    let v = primary();
    for (;;) {
      skip();
      if (peek() === '*') { i++; v *= primary(); }
      else if (peek() === '/') { i++; v /= primary(); }
      else return v;
    }
  }
  function sum(): number {
    let v = term();
    for (;;) {
      skip();
      if (peek() === '+') { i++; v += term(); }
      else if (peek() === '-') { i++; v -= term(); }
      else return v;
    }
  }
  function comparison(): number {
    const v = sum();
    skip();
    const op = src.slice(i).match(/^(>=|<=|>|<|==)/);
    if (!op) return v;
    i += op[0].length;
    const r = sum();
    const res = op[0] === '>=' ? v >= r : op[0] === '<=' ? v <= r : op[0] === '>' ? v > r : op[0] === '<' ? v < r : v === r;
    return res ? 1 : 0;
  }

  const v = comparison();
  skip();
  if (i < src.length) throw new Error(`Лишнее в формуле «${expr}»`);
  return v;
}

/** Безопасный вариант: при ошибке — запасное значение */
export function tryFormula(expr: string, vars: FormulaVars, fallback = 0): number {
  try {
    const v = evalFormula(expr, vars);
    return Number.isFinite(v) ? Math.floor(v) : fallback;
  } catch {
    return fallback;
  }
}
