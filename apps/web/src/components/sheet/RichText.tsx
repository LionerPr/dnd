import type { Spell } from '@dnd/rules-engine';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ContentRow } from '../../api/client';
import { useContentItem, useContentList } from '../../lib/hooks';
import { Loading } from '../ui';
import { SpellCard } from './SpellsTab';

export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[’'`]/g, "'").replace(/\s+/g, ' ').trim();

/** Заклинания библиотеки по английскому и русскому названию; при двух изданиях берём 2024 */
export function useSpellIndex() {
  const list = useContentList('spell');
  return useMemo(() => {
    const en = new Map<string, ContentRow>();
    const ru = new Map<string, ContentRow>();
    for (const r of list.data?.items ?? []) {
      const better = (old?: ContentRow) => !old || (r.data?.edition === '2024' && old.data?.edition !== '2024');
      const ke = norm(r.data?.nameEn);
      if (ke && better(en.get(ke))) en.set(ke, r);
      const kr = norm(r.name);
      if (better(ru.get(kr))) ru.set(kr, r);
    }
    return { en, ru };
  }, [list.data]);
}

function SpellLink({ row, children }: { row: ContentRow; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const full = useContentItem<Spell>(open ? row.id : undefined);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <span className="spell-ref" ref={ref}>
      <button type="button" className="spell-link" title={`${row.name}: нажмите, чтобы прочитать`} onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
        {children}
      </button>
      {open && <span className="spell-pop" onClick={(e) => e.stopPropagation()}>{full.data ? <SpellCard spell={full.data} /> : <Loading />}</span>}
    </span>
  );
}

/**
 * Текст умения, где названия заклинаний — ссылки на карточку.
 * Узнаём «бесследное передвижение [pass without trace]» (формат dnd.su) и «Поиск фамильяра» в кавычках.
 */
export function RichText({ text }: { text: string }) {
  const idx = useSpellIndex();
  if (!text || !idx.en.size) return <>{text}</>;
  const out: ReactNode[] = [];
  const re = /\[([^\]\n]{2,60})\]|«([^»\n]{2,60})»/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      const row = idx.en.get(norm(m[1]));
      if (!row) continue;
      // Русское название стоит перед скобкой: берём столько слов, сколько в названии заклинания
      const before = text.slice(last, m.index);
      const words = row.name.trim().split(/\s+/).length;
      const wm = before.match(new RegExp(`((?:[\\p{L}\\-/]+\\s+){${words - 1}}[\\p{L}\\-/]+)\\s*$`, 'u'));
      const label = wm ? wm[1]! : row.name;
      const cut = wm ? m.index - wm[0].length : m.index;
      out.push(text.slice(last, cut));
      out.push(<SpellLink key={m.index} row={row}>{label}</SpellLink>);
      last = m.index + m[0].length;
    } else {
      const row = idx.ru.get(norm(m[2]));
      if (!row) continue;
      out.push(text.slice(last, m.index));
      out.push(<SpellLink key={m.index} row={row}>«{m[2]}»</SpellLink>);
      last = m.index + m[0].length;
    }
  }
  out.push(text.slice(last));
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>;
}
