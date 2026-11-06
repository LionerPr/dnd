/** Ссылки карты сайта dnd.su по разделам: { race: [...], class: [...], spells: [...] } */
export function groupSitemap(xml: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of xml.matchAll(/<loc>(https:\/\/dnd\.su\/([a-z_]+)\/\d+-[^<]+)<\/loc>/g)) (out[m[2]!] ??= []).push(m[1]!);
  return out;
}

export const SECTION_FOR = { race: 'race', class: 'class', spell: 'spells', item: 'items', monster: 'bestiary' } as const;
export type ImportKind = keyof typeof SECTION_FOR;
/** Порядок: заклинаниям нужны уже загруженные классы, чтобы связаться с ними */
export const IMPORT_ORDER: ImportKind[] = ['race', 'class', 'spell', 'item', 'monster'];

/** Ссылки для полной загрузки, без «напарников» из Основных правил */
/** Монстры «Monster Manual» 2014 на dnd.su занимают первые номера статей (до ~460) */
export const MM_MAX_ID = 460;

export function catalogUrls(xml: string, kinds: ImportKind[], opts: { mmOnly?: boolean } = {}): { kind: ImportKind; url: string }[] {
  const map = groupSitemap(xml);
  const idOf = (u: string) => Number(u.match(/\/(\d+)-/)?.[1] ?? 0);
  return IMPORT_ORDER.filter((k) => kinds.includes(k)).flatMap((k) =>
    (map[SECTION_FOR[k]] ?? [])
      .filter((u) => !/sidekick/.test(u) && !(k === 'monster' && opts.mmOnly && idOf(u) > MM_MAX_ID))
      .sort((a, b) => (k === 'monster' ? idOf(a) - idOf(b) : 0))
      .map((url) => ({ kind: k, url })),
  );
}

export function assertDndSuUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('Это не ссылка');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Нужна ссылка https://dnd.su/…');
  if (u.hostname !== 'dnd.su' && u.hostname !== 'www.dnd.su') throw new Error('Импорт работает только со страницами dnd.su');
  if (/^\/piece/.test(u.pathname)) throw new Error('Этот раздел dnd.su закрыт для программ');
  u.protocol = 'https:';
  u.hostname = 'dnd.su';
  u.hash = '';
  u.search = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}
