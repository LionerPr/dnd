import { Statblock } from '../components/Statblock';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Plus, Search, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { parsePage, saveToLibrary, startCatalog, stopCatalog, useCatalogJob, type ImportKind, type Parsed } from '../lib/dndsu';
import { api, canAuthor, type ContentRow } from '../api/client';
import { Empty, Field, Loading, Modal, Segmented, Tabs, useToast } from '../components/ui';
import { bookShort, KIND_NAMES, levelName, plural, schoolName, searchKey } from '../lib/format';
import { SpellCard } from '../components/sheet/SpellsTab';
import { useAuth } from '../lib/auth';
import { useContentList } from '../lib/hooks';

type Kind = 'race' | 'class' | 'spell' | 'item' | 'monster' | 'feat';
const KINDS: Kind[] = ['race', 'class', 'spell', 'item', 'monster', 'feat'];

const ITEM_CATEGORIES: Record<string, string> = {
  weapon: 'оружие', armor: 'доспех', shield: 'щит', gear: 'снаряжение', tool: 'инструмент', magic: 'магический', consumable: 'расходуемый', other: 'прочее',
};

const RARITY_ORDER = (r: string) => ['обычн', 'необычн', 'редк', 'очень редк', 'легендарн', 'артефакт', 'редкость варьируется'].findIndex((x) => r.startsWith(x)) + (r.startsWith('очень') ? 0.5 : 0);

function rowMeta(r: ContentRow) {
  const d = r.data ?? {};
  const book = [d.edition === '2024' && '2024', /\/homebrew\//.test(d.sourceUrl ?? '') && 'самодельное', bookShort(d.book)].filter(Boolean).join(', ');
  const meta = rowKindMeta(r, d);
  return [book, meta].filter(Boolean).join(' · ');
}

function rowKindMeta(r: ContentRow, d: any) {
  switch (r.kind) {
    case 'spell':
      return `${levelName(d.level ?? 0)}, ${schoolName(d.school)}${d.concentration ? ' · концентрация' : ''}${d.ritual ? ' · ритуал' : ''}`;
    case 'monster':
      return [d.size, d.type, d.cr !== undefined && `ПО ${d.cr}`].filter(Boolean).join(' · ');
    case 'class':
      return [d.hitDie && `к${d.hitDie}`, d.subclassCount > 0 && `${d.subclassCount} ${plural(d.subclassCount, 'подкласс', 'подкласса', 'подклассов')}`].filter(Boolean).join(' · ');
    case 'race':
      return [d.speed && `${d.speed} фт`, d.subraceCount > 0 && `${d.subraceCount} ${plural(d.subraceCount, 'разновидность', 'разновидности', 'разновидностей')}`].filter(Boolean).join(' · ');
    case 'item':
      return [ITEM_CATEGORIES[d.category], d.rarity, d.weapon?.damage].filter(Boolean).join(' · ');
    default:
      return '';
  }
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') as Kind) || 'race';
  const { user } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [mine, setMine] = useState<'all' | 'mine'>('all');
  const [level, setLevel] = useState<string>('any');
  const [classId, setClassId] = useState('');
  const [subclass, setSubclass] = useState('');
  const [edition, setEdition] = useState<'all' | '2014' | '2024'>('all');
  const [book, setBook] = useState('');
  const [sort, setSort] = useState<'name' | 'book'>('name');
  const [category, setCategory] = useState('');
  const [rarity, setRarity] = useState('');
  const classList = useContentList('class');
  const [importOpen, setImportOpen] = useState(false);
  const list = useContentList(kind);

  const all = list.data?.items ?? [];
  const hasEditions = all.some((r) => r.data?.edition === '2024');
  const books = [...new Set(all.map((r) => bookShort(r.data?.book)).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ru'));
  const rarities = [...new Set(all.map((r) => r.data?.rarity).filter(Boolean) as string[])].sort((a, b) => RARITY_ORDER(a) - RARITY_ORDER(b));
  const className = classList.data?.items.find((c) => c.id === classId)?.name.toLowerCase();
  // Подклассы, у которых есть свои заклинания («путь четырёх стихий (монах)»), — для выбранного класса
  const subclasses = className
    ? [...new Set(all.flatMap((r) => (r.data?.subclassNames ?? []) as string[]).filter((n) => n.toLowerCase().includes(`(${className})`)))].sort((a, b) => a.localeCompare(b, 'ru'))
    : [];
  const rows = all
    .filter((r) => searchKey(r.name).includes(searchKey(q.trim())))
    .filter((r) => edition === 'all' || (r.data?.edition ?? '2014') === edition)
    .filter((r) => !book || bookShort(r.data?.book) === book)
    .filter((r) => kind !== 'item' || !category || r.data?.category === category)
    .filter((r) => kind !== 'item' || !rarity || r.data?.rarity === rarity)
    .filter((r) => kind !== 'spell' || !subclass || (r.data?.subclassNames ?? []).includes(subclass))
    .filter((r) => mine === 'all' || r.owner_id === user?.id)
    .filter((r) => kind !== 'spell' || level === 'any' || String(r.data?.level ?? 0) === level)
    .filter((r) => kind !== 'spell' || !classId || subclass || (r.data?.classes ?? []).includes(classId))
    .sort(
      (a, b) =>
        (kind === 'spell' ? (a.data.level ?? 0) - (b.data.level ?? 0) : 0) ||
        (sort === 'book' ? (bookShort(a.data?.book) ?? '').localeCompare(bookShort(b.data?.book) ?? '', 'ru') : 0) ||
        a.name.localeCompare(b.name, 'ru'),
    );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Библиотека</h1>
          <div className="sub">Расы, классы, заклинания, предметы и существа: из dnd.su и ваши собственные</div>
        </div>
        {canAuthor(user) && (
        <div className="row wrap">
          <button className="btn" onClick={() => setImportOpen(true)}>
            <Download /> Импорт с dnd.su
          </button>
          <button className="btn primary" onClick={() => nav(`/library/new?kind=${kind}`)}>
            <Plus /> {kind === 'monster' ? 'Новое существо' : kind === 'spell' ? 'Новое заклинание' : kind === 'item' ? 'Новый предмет' : kind === 'race' ? 'Новая раса' : kind === 'feat' ? 'Новая черта' : 'Новый класс'}
          </button>
        </div>
        )}
      </div>

      <Tabs tabs={KINDS.map((k) => ({ id: k, label: KIND_NAMES[k]!.many }))} value={kind} onChange={(k) => setParams(k === 'race' ? {} : { kind: k }, { replace: true })} />

      <div className="row wrap" style={{ margin: '14px 0' }}>
        <div className="row grow" style={{ minWidth: 220 }}>
          <Search size={16} className="muted" />
          <input className="input" placeholder="Поиск по названию" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {kind === 'spell' && (
          <select className="select" style={{ width: 'auto' }} value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Уровень">
            <option value="any">Любой уровень</option>
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i}>
                {levelName(i)}
              </option>
            ))}
          </select>
        )}
        {kind === 'spell' && (
          <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => { setClassId(e.target.value); setSubclass(''); }} aria-label="Класс">
            <option value="">Все классы</option>
            {(classList.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {kind === 'spell' && subclasses.length > 0 && (
          <select className="select" style={{ width: 'auto' }} value={subclass} onChange={(e) => setSubclass(e.target.value)} aria-label="Подкласс">
            <option value="">Все подклассы</option>
            {subclasses.map((n) => (
              <option key={n} value={n}>
                {n.replace(/\s*\([^)]*\)$/, '')}
              </option>
            ))}
          </select>
        )}
        {kind === 'item' && (
          <select className="select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Тип предмета">
            <option value="">Все типы</option>
            {Object.entries(ITEM_CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
        {kind === 'item' && rarities.length > 0 && (
          <select className="select" style={{ width: 'auto' }} value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Редкость">
            <option value="">Любая редкость</option>
            {rarities.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        {books.length > 1 && (
          <select className="select" style={{ width: 'auto' }} value={book} onChange={(e) => setBook(e.target.value)} aria-label="Книга">
            <option value="">Все книги</option>
            {books.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
        {(kind === 'race' || kind === 'class' || kind === 'feat') && (
          <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'book')} aria-label="Сортировка">
            <option value="name">По названию</option>
            <option value="book">По книге</option>
          </select>
        )}
        {hasEditions && (
          <Segmented options={[{ id: 'all', label: 'Все издания' }, { id: '2014', label: '2014' }, { id: '2024', label: '2024' }]} value={edition} onChange={setEdition} />
        )}
        <Segmented options={[{ id: 'all', label: 'Все' }, { id: 'mine', label: 'Мои' }]} value={mine} onChange={setMine} />
      </div>

      {list.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title={q || mine === 'mine' ? 'Ничего не нашлось' : 'Раздел пока пуст'}>
          {q || mine === 'mine' ? 'Попробуйте другое название.' : 'Импортируйте страницу с dnd.su или создайте свою запись.'}
        </Empty>
      ) : (
        <div className="panel list">
          {rows.map((r) => (
            <Link key={r.id} to={`/library/${r.id}`} className="list-item">
              <span className="grow">
                <b>{r.name}</b>
                <div className="small muted">{rowMeta(r)}</div>
              </span>
              <span className={`chip small${r.owner_id === user?.id ? ' accent' : ''}`}>{r.owner_id === user?.id ? 'моё' : r.owner_id ? 'общее' : r.source}</span>
            </Link>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="small muted" style={{ marginTop: 10 }}>
          {rows.length} {plural(rows.length, 'запись', 'записи', 'записей')}
        </div>
      )}

      {canAuthor(user) && <CatalogPanel />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
    </main>
  );
}

// ---------- Импорт одной страницы ----------

type Preview = Parsed;

function ImportModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState<string | undefined>();
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onError = (e: Error) => toast(e.message, 'error');

  const load = useMutation({ mutationFn: () => parsePage(url.trim(), html), onSuccess: setPreview, onError });
  const saveMine = useMutation({
    mutationFn: (p: Preview) => api<{ item: ContentRow }>('/content', { body: { kind: p.kind, name: p.data.name, data: p.data, source: 'dnd.su', sourceUrl: p.url } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['content'] });
      nav(`/library/${r.item.id}`);
    },
    onError,
  });
  const saveLibrary = useMutation({
    mutationFn: (p: Preview) => saveToLibrary(p),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['content'] });
      toast('Добавлено в общую библиотеку');
      nav(`/library/${r.id}`);
    },
    onError,
  });

  const d = preview?.data;
  return (
    <Modal
      title="Импорт с dnd.su"
      onClose={onClose}
      wide
      footer={
        preview ? (
          <>
            <button className="btn ghost" onClick={() => setPreview(null)}>
              Назад
            </button>
            {canAuthor(user) && (
              <button className="btn" disabled={saveLibrary.isPending} onClick={() => saveLibrary.mutate(preview)}>
                В общую библиотеку
              </button>
            )}
            <button className="btn primary" disabled={saveMine.isPending} onClick={() => saveMine.mutate(preview)}>
              Сохранить себе
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={!url.trim() || load.isPending} onClick={() => load.mutate()}>
            {load.isPending ? 'Читаю страницу…' : 'Разобрать'}
          </button>
        )
      }
    >
      {!preview ? (
        <>
          <Field label="Ссылка на страницу" hint="Например, https://dnd.su/race/86-dwarf/ или https://dnd.su/class/88-barbarian/">
            <input className="input" autoFocus placeholder="https://dnd.su/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && load.mutate()} />
          </Field>
          <Field label="Если сайт не отвечает серверу" hint="Откройте страницу в браузере, сохраните её (Ctrl+S, «только HTML») и загрузите файл: разбор будет тот же.">
            <div className="row">
              <button className="btn sm" type="button" onClick={() => fileRef.current?.click()}>
                <FileUp /> {fileName || 'Выбрать файл'}
              </button>
              {html && (
                <button className="btn ghost sm" onClick={() => { setHtml(undefined); setFileName(''); }}>
                  Убрать
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".html,.htm,text/html"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setHtml(await f.text());
                  setFileName(f.name);
                }}
              />
            </div>
          </Field>
          <p className="small muted">Разбираются расы, классы (с подклассами) и заклинания. Существ и предметы пока можно завести вручную.</p>
        </>
      ) : (
        <div className="stack">
          <div>
            <div className="caps muted">{KIND_NAMES[preview.kind]?.one}</div>
            <h2 style={{ margin: '2px 0 0' }}>{d.name}</h2>
            <a className="small muted" href={preview.url} target="_blank" rel="noreferrer">
              {preview.url}
            </a>
          </div>
          {preview.kind === 'race' && (
            <>
              <div className="row wrap">
                <span className="chip">Скорость {d.speed} фт</span>
                <span className="chip">{d.features.length} {plural(d.features.length, 'черта', 'черты', 'черт')}</span>
                {d.subraces?.length > 0 && <span className="chip">{d.subraces.length} {plural(d.subraces.length, 'разновидность', 'разновидности', 'разновидностей')}</span>}
              </div>
              <PreviewFeatures features={d.features} />
              {d.subraces?.length > 0 && <div className="small muted">Разновидности: {d.subraces.map((s: { name: string }) => s.name).join(', ')}</div>}
            </>
          )}
          {preview.kind === 'monster' && (
            <div className="panel panel-pad">
              <Statblock m={d} />
            </div>
          )}
          {preview.kind === 'spell' && (
            <div className="panel panel-pad">
              <SpellCard spell={d} />
            </div>
          )}
          {preview.kind === 'class' && (
            <>
              <div className="row wrap">
                <span className="chip">Кость хитов к{d.hitDie}</span>
                <span className="chip">{d.features.length} {plural(d.features.length, 'умение', 'умения', 'умений')}</span>
                {d.spellcasting && <span className="chip mana">Заклинатель</span>}
              </div>
              <PreviewFeatures features={d.features} />
              {d.subclasses?.length > 0 && <div className="small muted">Подклассы: {d.subclasses.map((s: { name: string }) => s.name).join(', ')}</div>}
            </>
          )}
          <p className="small muted">После сохранения запись можно поправить в редакторе: описания, эффекты, уровни.</p>
        </div>
      )}
    </Modal>
  );
}

function PreviewFeatures({ features }: { features: { id: string; name: string; level?: number; effects?: unknown[] }[] }) {
  return (
    <div className="panel list" style={{ maxHeight: 280, overflowY: 'auto' }}>
      {features.map((f) => (
        <div key={f.id} className="list-item">
          <span className="grow">{f.name}</span>
          {!!f.effects?.length && <span className="chip small good">в листе: {f.effects.length}</span>}
          {f.level !== undefined && <span className="small muted">{f.level} ур.</span>}
        </div>
      ))}
    </div>
  );
}

// ---------- Загрузка разделов целиком (администратор) ----------

function CatalogPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const j = useCatalogJob();
  const running = j?.status === 'running';
  const start = useMutation({
    mutationFn: ({ kinds, homebrew, mmOnly }: { kinds: ImportKind[]; homebrew?: boolean; mmOnly?: boolean }) =>
      startCatalog(kinds, () => qc.invalidateQueries({ queryKey: ['content'] }), homebrew, mmOnly),
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const stop = { mutate: stopCatalog };

  return (
    <div className="panel" style={{ marginTop: 32 }}>
      <div className="panel-head">
        <h3>Загрузить разделы dnd.su целиком</h3>
        <span className="small muted">видно только администратору</span>
      </div>
      <div className="panel-pad stack">
        <p className="small muted" style={{ margin: 0 }}>
          Браузер обходит карту сайта и забирает страницы по одной, не чаще раза в полторы секунды, — держите вкладку открытой до конца. Уже загруженные записи обновляются, а не дублируются.
        </p>
        {j && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="hp-bar">
              <i style={{ width: `${j.total ? (j.done / j.total) * 100 : 0}%`, background: 'var(--accent)' }} />
            </div>
            <div className="small">
              {running ? 'Идёт загрузка' : j.status === 'stopped' ? 'Остановлено' : 'Готово'}: {j.done} из {j.total}
              {j.failed.length > 0 && <span className="muted"> · не удалось {j.failed.length}</span>}
            </div>
            {j.failed.length > 0 && (
              <details className="small muted">
                <summary>Что не загрузилось</summary>
                {j.failed.slice(0, 30).map((f) => (
                  <div key={f.url}>
                    {f.url}: {f.error}
                  </div>
                ))}
              </details>
            )}
          </div>
        )}
        <div className="row wrap">
          {running ? (
            <button className="btn" onClick={() => stop.mutate()}>
              <Square /> Остановить
            </button>
          ) : (
            <>
              <button className="btn" disabled={start.isPending} onClick={() => start.mutate({ kinds: ['race'] })}>
                Все расы
              </button>
              <button className="btn" disabled={start.isPending} onClick={() => start.mutate({ kinds: ['class'] })}>
                Все классы
              </button>
              <button className="btn" disabled={start.isPending} onClick={() => start.mutate({ kinds: ['spell'] })}>
                Все заклинания
              </button>
              <button className="btn" disabled={start.isPending} onClick={() => start.mutate({ kinds: ['item'] })}>
                Все магические предметы
              </button>
              <button className="btn" disabled={start.isPending} title="Около 460 страниц, примерно 12 минут" onClick={() => start.mutate({ kinds: ['monster'], mmOnly: true })}>
                Бестиарий: Monster Manual
              </button>
              <button className="btn" disabled={start.isPending} title="Все книги: около 2700 страниц, больше часа" onClick={() => start.mutate({ kinds: ['monster'] })}>
                Весь бестиарий
              </button>
              <button className="btn primary" disabled={start.isPending} onClick={() => start.mutate({ kinds: ['race', 'class', 'spell', 'item'] })}>
                Всё сразу
              </button>
              <button className="btn" disabled={start.isPending} onClick={() => start.mutate({ kinds: ['race', 'class'], homebrew: true })}>
                Самодельные расы и классы
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
