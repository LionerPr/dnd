import { editionOf, type Character, type Sheet, type Spell } from '@dnd/rules-engine';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ContentRow } from '../../api/client';
import { schoolName, searchKey } from '../../lib/format';
import { useContentItem, useContentList } from '../../lib/hooks';
import { Loading } from '../ui';
import { SpellCard } from './SpellsTab';

type Update = (u: (c: Character) => Character) => void;
export type Caster = Sheet['casters'][number];

/** Мистический рыцарь и ловкач берут заклинания из списка волшебника */
const listName = (c: Caster) => (/^(воин|плут)$/i.test(c.className) ? 'волшебник' : c.className.toLowerCase());

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[’'`]/g, "'").replace(/\s+/g, ' ').trim();

/** Строка библиотеки — это заклинание из таблицы подкласса? Сверяем по английскому названию, иначе по русскому */
export function isSubclassSpell(r: ContentRow | { id: string; name?: string; data: any }, list: { name: string; nameEn?: string }[] | undefined) {
  if (!list?.length) return false;
  const en = norm(r.data?.nameEn);
  const ru = norm(r.data?.name ?? (r as ContentRow).name);
  return list.some((x) => (x.nameEn && en ? norm(x.nameEn) === en : norm(x.name) === ru));
}

export function spellFits(r: ContentRow | { id: string; data: any }, c: Caster) {
  const d = r.data ?? {};
  return (d.classes ?? []).includes(c.classId) || (d.classNames ?? []).some((n: string) => n.toLowerCase() === listName(c)) || isSubclassSpell(r, c.extraList);
}

/** Заклинания нужного издания: для 2024 — ещё и заклинания 2014, у которых нет версии 2024 */
export function useEditionSpells(ed: '2014' | '2024') {
  const list = useContentList('spell');
  const rows = useMemo(() => {
    const all = list.data?.items ?? [];
    const has2024 = new Set(all.filter((r) => r.data?.edition === '2024').map((r) => String(r.data?.nameEn ?? r.name).toLowerCase()));
    return all.filter((r) => {
      const e = editionOf(r.data);
      return e === ed || (ed === '2024' && !has2024.has(String(r.data?.nameEn ?? r.name).toLowerCase()));
    });
  }, [list.data, ed]);
  return { rows, loading: list.isLoading };
}

export interface CasterCount {
  caster: Caster;
  cantrips: ContentRow[];
  spells: ContentRow[];
  arcanum: ContentRow[];
  /** Сколько можно заклинаний 1+ круга: книга волшебника или известные/подготовленные */
  spellsCap?: number;
  book: boolean;
}

/** Разложить заклинания персонажа по классам и посчитать, сколько ещё можно взять */
export function countSpells(c: Character, sheet: Sheet, rows: ContentRow[]): { per: CasterCount[]; outside: ContentRow[] } {
  const bonus = new Set(c.spellsBonus ?? []);
  const mine = rows.filter((r) => c.spellsKnown.includes(r.id) && !bonus.has(r.id));
  const per: CasterCount[] = sheet.casters.map((caster) => ({
    caster,
    cantrips: [],
    spells: [],
    arcanum: [],
    spellsCap: caster.bookMax ?? caster.spellsMax,
    book: caster.bookMax !== undefined,
  }));
  const outside: ContentRow[] = [];
  for (const r of mine) {
    const slot = per.find((p) => spellFits(r, p.caster));
    if (!slot) {
      outside.push(r);
      continue;
    }
    const lvl = Number(r.data?.level ?? 0);
    if (lvl === 0) slot.cantrips.push(r);
    else if (slot.caster.arcanum?.includes(lvl) && lvl > slot.caster.maxSpellLevel) slot.arcanum.push(r);
    else slot.spells.push(r);
  }
  return { per, outside };
}

function Count({ n, max, label }: { n: number; max: number; label: string }) {
  const cls = n > max ? 'over' : n === max ? 'full' : 'left';
  return (
    <span className={`sc-count ${cls}`}>
      {label} <b>{n}</b>/{max}
    </span>
  );
}

function SpellRow({ r, on, disabled, onToggle, why }: { r: ContentRow; on: boolean; disabled: boolean; onToggle: () => void; why?: string }) {
  const [open, setOpen] = useState(false);
  const full = useContentItem<Spell>(open ? r.id : undefined);
  const d = r.data ?? {};
  return (
    <div className={`sc-row${on ? ' on' : ''}`}>
      <button className={`sc-pick${on ? ' on' : ''}`} disabled={disabled && !on} onClick={onToggle} title={disabled && !on ? why : on ? 'Убрать' : 'Взять'} aria-label={on ? 'Убрать' : 'Взять'}>
        {on ? <Check size={15} /> : <Plus size={15} />}
      </button>
      <div className="sc-body">
        <button className="sc-name" onClick={() => setOpen(!open)}>
          {r.name}
          <ChevronDown size={14} className={open ? 'flip' : ''} />
        </button>
        <div className="small muted">
          {[schoolName(d.school ?? ''), d.castingTime, d.range, d.concentration && 'концентрация', d.ritual && 'ритуал'].filter(Boolean).join(' · ')}
        </div>
        {open && <div className="sc-desc">{full.data ? <SpellCard spell={full.data} /> : <Loading />}</div>}
      </div>
    </div>
  );
}

/**
 * Выбор заклинаний по правилам класса: только свой список, только доступные круги,
 * не больше, чем положено на уровне. Счётчики сверху показывают, сколько осталось.
 */
export function SpellChooser({ data, sheet, update, compact }: { data: Character; sheet: Sheet; update: Update; compact?: boolean }) {
  const ed = editionOf(data);
  const { rows, loading } = useEditionSpells(ed);
  const { per } = useMemo(() => countSpells(data, sheet, rows), [data, sheet, rows]);
  const casters = per.filter((p) => p.caster.cantripsMax || p.spellsCap !== undefined);
  const [ci, setCi] = useState(0);
  const [tab, setTab] = useState<number | null>(null);
  const [q, setQ] = useState('');
  if (loading) return <Loading />;
  if (!casters.length) return <p className="muted small">У этого класса нет заклинаний (или в библиотеке нет его таблицы).</p>;
  const p = casters[Math.min(ci, casters.length - 1)]!;
  const c = p.caster;
  const levels = [
    ...(c.cantripsMax ? [0] : []),
    ...Array.from({ length: c.maxSpellLevel }, (_, i) => i + 1),
    ...(c.arcanum ?? []).filter((l) => l > c.maxSpellLevel),
  ];
  const level = tab !== null && levels.includes(tab) ? tab : levels[0];
  const bonus = new Set(data.spellsBonus ?? []);
  const isArcanum = (l: number) => !!c.arcanum?.includes(l) && l > c.maxSpellLevel;

  const toggle = (r: ContentRow, on: boolean) =>
    update((d) => ({
      ...d,
      spellsKnown: on ? d.spellsKnown.filter((x) => x !== r.id) : [...d.spellsKnown, r.id],
      spellsPrepared: on ? d.spellsPrepared.filter((x) => x !== r.id) : d.spellsPrepared,
    }));

  const fullFor = (l: number) => {
    if (l === 0) return p.cantrips.length >= (c.cantripsMax ?? 0);
    if (isArcanum(l)) return p.arcanum.some((r) => Number(r.data?.level) === l);
    return p.spellsCap !== undefined && p.spells.length >= p.spellsCap;
  };
  const why = (l: number) => (l === 0 ? 'Все заговоры уже выбраны' : isArcanum(l) ? 'Арканум этого круга уже выбран' : 'Лимит заклинаний на этом уровне');

  const list =
    level === undefined
      ? []
      : rows
          .filter((r) => Number(r.data?.level ?? 0) === level && spellFits(r, c) && !bonus.has(r.id) && !isSubclassSpell(r, c.granted) && searchKey(r.name).includes(searchKey(q)))
          .sort((a, b) => Number(data.spellsKnown.includes(b.id)) - Number(data.spellsKnown.includes(a.id)) || a.name.localeCompare(b.name, 'ru'));

  return (
    <div className={`spell-chooser${compact ? ' compact' : ''}`}>
      {casters.length > 1 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {casters.map((x, i) => (
            <button key={x.caster.classId} className={`chip${i === ci ? ' accent' : ''}`} onClick={() => { setCi(i); setTab(null); }}>
              {x.caster.className}
            </button>
          ))}
        </div>
      )}
      <div className="sc-head">
        {c.cantripsMax ? <Count n={p.cantrips.length} max={c.cantripsMax} label="Заговоры" /> : null}
        {p.spellsCap !== undefined && <Count n={p.spells.length} max={p.spellsCap} label={p.book ? 'В книге' : c.mode === 'known' ? 'Известные' : 'Заклинания'} />}
        {p.book && c.spellsMax !== undefined && <span className="small muted">готовить можно {c.spellsMax} в день — отметьте на вкладке «Заклинания»</span>}
        <span className="small muted">
          {c.maxSpellLevel ? `круги до ${c.maxSpellLevel}-го` : p.spellsCap ? '' : 'заклинания 1 круга появятся позже'}
          {c.arcanum?.length ? `, арканум: ${c.arcanum.join(', ')} круг` : ''}
        </span>
      </div>
      {levels.length > 0 && (
        <div className="sc-tabs">
          {levels.map((l) => {
            const left = fullFor(l) ? 0 : l === 0 ? (c.cantripsMax ?? 0) - p.cantrips.length : isArcanum(l) ? 1 : p.spellsCap !== undefined ? p.spellsCap - p.spells.length : 0;
            const n = l === 0 ? p.cantrips.length : isArcanum(l) ? p.arcanum.filter((r) => Number(r.data?.level) === l).length : p.spells.filter((r) => Number(r.data?.level) === l).length;
            return (
              <button key={l} className={l === level ? 'on' : ''} onClick={() => setTab(l)}>
                {l === 0 ? 'Заговоры' : isArcanum(l) ? `Арканум ${l}` : `${l} круг`}
                {n > 0 && <span className="sc-n">{n}</span>}
                {left > 0 && <span className="sc-left" title="Можно взять ещё">+{left}</span>}
              </button>
            );
          })}
        </div>
      )}
      {level !== undefined && (
        <p className="sc-hint small">
          {level === 0
            ? `Заговоры: взято ${p.cantrips.length} из ${c.cantripsMax ?? 0}, можно ещё ${Math.max(0, (c.cantripsMax ?? 0) - p.cantrips.length)}.`
            : isArcanum(level)
              ? `Арканум ${level} круга: одно заклинание${p.arcanum.some((r) => Number(r.data?.level) === level) ? ', уже выбрано' : ', ещё не выбрано'}.`
              : p.spellsCap !== undefined
                ? (() => {
                    const here = p.spells.filter((r) => Number(r.data?.level) === level).length;
                    const left = Math.max(0, p.spellsCap - p.spells.length);
                    return `${level} круг: взято ${here}. Можно взять ещё ${left}. Лимит ${p.spellsCap} ${p.book ? 'в книге' : 'заклинаний'} общий для кругов 1–${c.maxSpellLevel}, по кругам его можно делить как угодно.`;
                  })()
                : null}
        </p>
      )}
      <label className="search-input">
        <Search size={16} />
        <input className="input" placeholder={`Поиск в списке: ${c.className.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="sc-list">
        {level === undefined ? (
          <p className="muted small">На этом уровне класс ещё не знает заклинаний.</p>
        ) : list.length === 0 ? (
          <p className="muted small">Нет заклинаний этого круга в списке класса. Импортируйте заклинания в Библиотеке.</p>
        ) : (
          list.map((r) => {
            const on = data.spellsKnown.includes(r.id);
            return <SpellRow key={r.id} r={r} on={on} disabled={fullFor(level)} why={why(level)} onToggle={() => toggle(r, on)} />;
          })
        )}
      </div>
    </div>
  );
}
