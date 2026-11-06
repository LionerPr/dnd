/** Ссылки карты сайта dnd.su по разделам: { race: [...], class: [...], spells: [...] } */
export function groupSitemap(xml: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of xml.matchAll(/<loc>(https:\/\/dnd\.su\/([a-z_]+)\/\d+-[^<]+)<\/loc>/g)) (out[m[2]!] ??= []).push(m[1]!);
  return out;
}

export const SECTION_FOR = { race: 'race', class: 'class', spell: 'spells' } as const;
export type ImportKind = keyof typeof SECTION_FOR;
/** Порядок: заклинаниям нужны уже загруженные классы, чтобы связаться с ними */
export const IMPORT_ORDER: ImportKind[] = ['race', 'class', 'spell'];

/** Ссылки для полной загрузки, без «напарников» из Основных правил */
export function catalogUrls(xml: string, kinds: ImportKind[]): { kind: ImportKind; url: string }[] {
  const map = groupSitemap(xml);
  return IMPORT_ORDER.filter((k) => kinds.includes(k)).flatMap((k) => (map[SECTION_FOR[k]] ?? []).filter((u) => !/sidekick/.test(u)).map((url) => ({ kind: k, url })));
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
