import {
  ABILITIES,
  ABILITY_NAMES,
  CONDITIONS,
  COINS,
  DAMAGE_TYPES,
  SKILLS,
  SKILL_KEYS,
  SPELL_SCHOOLS,
  type Monster,
  type MonsterAction,
  type Spell,
} from '@dnd/rules-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, canAuthor, type ContentRow } from '../api/client';
import { ChipSet, EffectsEditor, FeaturesEditor, uid, type EditableFeature } from '../components/editor/Effects';
import { FeatureList } from '../components/sheet/FeaturesTab';
import { SpellCard } from '../components/sheet/SpellsTab';
import { Statblock } from '../components/Statblock';
import { ConfirmButton, Empty, Field, Loading, NumberInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { KIND_NAMES, levelName } from '../lib/format';
import { useContentList } from '../lib/hooks';

type Kind = ContentRow['kind'];
type Data = Record<string, any>;

const abilityNames = Object.fromEntries(ABILITIES.map((a) => [a, ABILITY_NAMES[a].full])) as Record<string, string>;
const skillNames = Object.fromEntries(SKILL_KEYS.map((k) => [k, SKILLS[k].name])) as Record<string, string>;
const SIZES = { tiny: 'Крошечный', small: 'Маленький', medium: 'Средний', large: 'Большой' };
const ITEM_CATEGORIES = { weapon: 'Оружие', armor: 'Доспех', shield: 'Щит', gear: 'Снаряжение', tool: 'Инструмент', magic: 'Магический предмет', consumable: 'Расходуемый', other: 'Прочее' };
const PROGRESSIONS = { full: 'полный (волшебник, жрец)', half: 'половинный (паладин, следопыт)', third: 'треть (мистический рыцарь)', pact: 'магия договора (колдун)' };

function blank(kind: Kind): Data {
  switch (kind) {
    case 'race':
      return { size: 'medium', speed: 30, description: '', features: [], subraces: [] };
    case 'class':
      return { hitDie: 8, saves: [], armor: [], weapons: [], tools: [], skillChoices: { pick: 2, from: [] }, description: '', features: [], levels: [], subclassLevel: 3, subclasses: [] };
    case 'spell':
      return { level: 1, school: 'evocation', castingTime: '1 действие', range: '60 футов', components: { v: true, s: true }, duration: 'Мгновенная', concentration: false, ritual: false, classes: [], description: '' };
    case 'item':
      return { category: 'gear', weight: 0, description: '' };
    case 'monster':
      return { size: 'Средний', type: 'гуманоид', alignment: '', ac: 12, hp: 11, hpFormula: '2к8+2', speed: '30 фт.', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, cr: '1/4', traits: [], actions: [] };
    case 'feat':
      return { description: '', effects: [] };
  }
}

/** Таблица уровней класса собирается из уровней умений: так редактор не требует заполнять её руками. */
function withLevels(d: Data): Data {
  const columns = new Map<number, Record<string, string> | undefined>((d.levels ?? []).map((l: { level: number; columns?: Record<string, string> }) => [l.level, l.columns]));
  const levels = Array.from({ length: 20 }, (_, i) => i + 1).map((level) => ({
    level,
    features: (d.features as EditableFeature[]).filter((f) => (f.level ?? 1) === level).map((f) => f.id),
    ...(columns.get(level) ? { columns: columns.get(level) } : {}),
  }));
  return { ...d, levels };
}

export function ContentPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const isNew = id === 'new';
  const q = useQuery({ queryKey: ['content-item', id], queryFn: () => api<{ item: ContentRow }>(`/content/${id}`), enabled: !isNew });

  if (!isNew && q.isLoading) return <Loading />;
  if (!isNew && (q.error || !q.data))
    return (
      <main className="page">
        <Empty title="Запись не найдена">{(q.error as Error)?.message}</Empty>
      </main>
    );
  const row = q.data?.item;
  const kind = (row?.kind ?? (params.get('kind') as Kind)) || 'race';
  const author = canAuthor(user);
  if (isNew && !author)
    return (
      <main className="page">
        <Empty title="Нет прав">Создавать записи могут администратор и модераторы.</Empty>
      </main>
    );
  const own = isNew || (author && (row?.owner_id === user?.id || row?.owner_id === null));
  return own ? <Editor key={id} row={row} kind={kind} /> : <Viewer row={row!} />;
}

// ---------- Просмотр чужой/библиотечной записи ----------

function Viewer({ row }: { row: ContentRow }) {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const d = row.data;
  const copy = useMutation({
    mutationFn: () => api<{ item: ContentRow }>(`/content/${row.id}/copy`, { body: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['content'] });
      toast('Копия создана: теперь её можно править');
      nav(`/library/${r.item.id}`);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const del = useMutation({
    mutationFn: () => api(`/content/${row.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content'] });
      nav(`/library?kind=${row.kind}`);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <main className="page">
      <Back kind={row.kind} />
      <div className="page-head">
        <div>
          <div className="caps muted">{KIND_NAMES[row.kind]?.one}</div>
          <h1>{row.name}</h1>
          <div className="sub">
            {row.source_url ? (
              <a href={row.source_url} target="_blank" rel="noreferrer">
                {row.source_url.replace(/^https?:\/\//, '')}
              </a>
            ) : (
              row.source
            )}
          </div>
        </div>
        <div className="row wrap">
          {canAuthor(user) && !row.owner_id && (
            <ConfirmButton onConfirm={() => del.mutate()} confirm="Удалить из библиотеки?">
              <Trash2 /> Удалить
            </ConfirmButton>
          )}
          {canAuthor(user) && (
            <button className="btn primary" disabled={copy.isPending} onClick={() => copy.mutate()}>
              <Copy /> Копия для правки
            </button>
          )}
        </div>
      </div>
      <div className="panel panel-pad">
        {row.kind === 'spell' ? (
          <SpellCard spell={d as Spell} />
        ) : row.kind === 'monster' ? (
          <Statblock m={d as Monster} />
        ) : (
          <div className="stack-lg">
            {row.kind === 'race' && <div className="row wrap"><span className="chip">{SIZES[d.size as keyof typeof SIZES] ?? d.size}</span><span className="chip">Скорость {d.speed} фт</span></div>}
            {row.kind === 'class' && (
              <div className="row wrap">
                <span className="chip">Кость хитов к{d.hitDie}</span>
                <span className="chip">Спасброски: {(d.saves ?? []).map((a: string) => abilityNames[a]).join(', ')}</span>
                <span className="chip">Навыки: {d.skillChoices?.pick} из {(d.skillChoices?.from ?? []).length}</span>
                {d.spellcasting && <span className="chip mana">Заклинатель: {abilityNames[d.spellcasting.ability]}</span>}
              </div>
            )}
            {row.kind === 'item' && (
              <div className="row wrap">
                <span className="chip">{ITEM_CATEGORIES[d.category as keyof typeof ITEM_CATEGORIES]}</span>
                {d.weapon && <span className="chip">{d.weapon.damage} {DAMAGE_TYPES[d.weapon.damageType as keyof typeof DAMAGE_TYPES]}</span>}
                {d.armor && <span className="chip">КД {d.armor.base}{d.armor.dexCap !== 0 ? ' + Лов' : ''}</span>}
                {d.weight ? <span className="chip">{d.weight} фнт</span> : null}
                {d.cost && <span className="chip">{d.cost.amount} {COINS[d.cost.coin as keyof typeof COINS]?.name}</span>}
              </div>
            )}
            {d.description && <div className="pre" style={{ lineHeight: 1.6 }}>{d.description}</div>}
            {d.features?.length > 0 && (
              <div className="panel">
                <FeatureList features={d.features} />
              </div>
            )}
            {(d.subraces ?? d.subclasses ?? []).map((s: { id: string; name: string; description?: string; features: EditableFeature[] }) => (
              <div key={s.id} className="stack">
                <h3>{s.name}</h3>
                {s.description && <div className="pre muted">{s.description}</div>}
                <div className="panel">
                  <FeatureList features={s.features} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Back({ kind }: { kind: Kind }) {
  return (
    <Link to={kind === 'race' ? '/library' : `/library?kind=${kind}`} className="btn ghost sm" style={{ marginLeft: -10, marginBottom: 6 }}>
      <ArrowLeft /> {KIND_NAMES[kind]?.many}
    </Link>
  );
}

// ---------- Редактор своей записи ----------

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="editor-section">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

function Editor({ row, kind }: { row?: ContentRow; kind: Kind }) {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(row?.name ?? '');
  const [d, setD] = useState<Data>(() => ({ ...blank(kind), ...(row?.data ?? {}) }));
  const [visibility, setVisibility] = useState<ContentRow['visibility']>(row?.visibility ?? 'private');
  const [campaignId, setCampaignId] = useState<string | null>(row?.campaign_id ?? null);
  const [dirty, setDirty] = useState(false);
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api<{ campaigns: { id: string; name: string }[] }>('/campaigns') });
  const set = (patch: Data) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => {
      const data = kind === 'class' ? withLevels(d) : d;
      const body = { kind, name: name.trim(), data, visibility, campaignId: visibility === 'campaign' ? campaignId : null };
      return row ? api<{ item: ContentRow }>(`/content/${row.id}`, { method: 'PUT', body }) : api<{ item: ContentRow }>('/content', { body });
    },
    onSuccess: (r) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['content'] });
      qc.invalidateQueries({ queryKey: ['content-item', r.item.id] });
      toast('Сохранено');
      if (!row) nav(`/library/${r.item.id}`, { replace: true });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const del = useMutation({
    mutationFn: () => api(`/content/${row!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content'] });
      nav(`/library?kind=${kind}`);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const canSave = name.trim().length > 0 && (visibility !== 'campaign' || !!campaignId);

  return (
    <main className="page">
      <Back kind={kind} />
      <div className="page-head">
        <div className="grow">
          <div className="caps muted">{row ? KIND_NAMES[kind]?.one : `${KIND_NAMES[kind]?.one}: новая запись`}</div>
          <input className="input serif" style={{ fontSize: 28, height: 48, marginTop: 4 }} autoFocus={!row} placeholder="Название" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        </div>
      </div>

      <div className="panel">
        <Section>
          <div className="grid grid-2">
            <Field label="Кому видно">
              <select className="select" value={visibility} onChange={(e) => { setVisibility(e.target.value as ContentRow['visibility']); setDirty(true); }}>
                <option value="private">Только мне</option>
                <option value="campaign">Участникам кампании</option>
                <option value="public">Всем на сервере</option>
              </select>
            </Field>
            {visibility === 'campaign' && (
              <Field label="Кампания">
                <select className="select" value={campaignId ?? ''} onChange={(e) => { setCampaignId(e.target.value || null); setDirty(true); }}>
                  <option value="">Выберите…</option>
                  {campaigns.data?.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </Section>
        {kind === 'race' && <RaceForm d={d} set={set} />}
        {kind === 'class' && <ClassForm d={d} set={set} />}
        {kind === 'spell' && <SpellForm d={d} set={set} />}
        {kind === 'item' && <ItemForm d={d} set={set} />}
        {kind === 'monster' && <MonsterForm d={d} set={set} />}
        {kind === 'feat' && <FeatForm d={d} set={set} />}
      </div>

      <div className="save-bar">
        {row && (
          <ConfirmButton onConfirm={() => del.mutate()} confirm="Удалить навсегда?">
            <Trash2 /> Удалить
          </ConfirmButton>
        )}
        <div className="grow" />
        {dirty && <span className="small muted">Есть несохранённые изменения</span>}
        <button className="btn primary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
          <Save /> {save.isPending ? 'Сохраняю…' : 'Сохранить'}
        </button>
      </div>
    </main>
  );
}

type FormProps = { d: Data; set: (patch: Data) => void };

const textList = (xs: string[] | undefined) => (xs ?? []).join(', ');
const parseList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function Description({ d, set, label = 'Описание' }: FormProps & { label?: string }) {
  return (
    <Field label={label}>
      <textarea className="textarea" rows={6} value={d.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
    </Field>
  );
}

function RaceForm({ d, set }: FormProps) {
  return (
    <>
      <Section>
        <div className="grid grid-2">
          <Field label="Размер">
            <select className="select" value={d.size} onChange={(e) => set({ size: e.target.value })}>
              {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Скорость, фт">
            <NumberInput value={d.speed} min={0} onChange={(speed) => set({ speed })} />
          </Field>
        </div>
        <Description d={d} set={set} />
      </Section>
      <Section title="Черты расы">
        <p className="small muted" style={{ margin: 0 }}>Эффекты сразу попадают в лист: бонусы характеристик, тёмное зрение, владения, сопротивления.</p>
        <FeaturesEditor features={d.features} onChange={(features) => set({ features })} addLabel="Добавить черту" />
      </Section>
      <Section title="Разновидности">
        <SubList
          items={d.subraces ?? []}
          onChange={(subraces) => set({ subraces })}
          addLabel="Добавить разновидность"
          render={(s, update) => <FeaturesEditor features={s.features} onChange={(features) => update({ features })} addLabel="Добавить черту" />}
        />
      </Section>
    </>
  );
}

interface SubItem { id: string; name: string; description?: string; features: EditableFeature[]; [k: string]: unknown }

function SubList({ items, onChange, addLabel, render, withDescription }: { items: SubItem[]; onChange: (x: SubItem[]) => void; addLabel: string; render: (s: SubItem, update: (p: Partial<SubItem>) => void) => ReactNode; withDescription?: boolean }) {
  return (
    <div className="stack">
      {items.map((s, i) => {
        const update = (p: Partial<SubItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
        return (
          <div key={s.id} className="sub-card">
            <div className="row">
              <input className="input grow" placeholder="Название" value={s.name} onChange={(e) => update({ name: e.target.value })} />
              <ConfirmButton className="btn ghost sm icon" confirm="Да" onConfirm={() => onChange(items.filter((_, j) => j !== i))}>
                <Trash2 />
              </ConfirmButton>
            </div>
            {withDescription && <textarea className="textarea" rows={3} placeholder="Описание" value={s.description ?? ''} onChange={(e) => update({ description: e.target.value })} />}
            {render(s, update)}
          </div>
        );
      })}
      <div>
        <button type="button" className="btn sm" onClick={() => onChange([...items, { id: uid(), name: '', features: [] }])}>
          <Plus /> {addLabel}
        </button>
      </div>
    </div>
  );
}

function ClassForm({ d, set }: FormProps) {
  const sc = d.spellcasting as Data | undefined;
  return (
    <>
      <Section>
        <div className="grid grid-3">
          <Field label="Кость хитов">
            <select className="select" value={d.hitDie} onChange={(e) => set({ hitDie: Number(e.target.value) })}>
              {[6, 8, 10, 12].map((n) => <option key={n} value={n}>к{n}</option>)}
            </select>
          </Field>
          <Field label="Подкласс с уровня">
            <NumberInput value={d.subclassLevel} min={1} max={20} onChange={(subclassLevel) => set({ subclassLevel })} />
          </Field>
          <Field label="Навыков на выбор">
            <NumberInput value={d.skillChoices?.pick ?? 2} min={0} max={6} onChange={(pick) => set({ skillChoices: { ...d.skillChoices, pick } })} />
          </Field>
        </div>
        <Field label="Спасброски">
          <ChipSet options={abilityNames} value={d.saves} onChange={(saves) => set({ saves })} />
        </Field>
        <Field label="Навыки, из которых выбирают">
          <ChipSet options={skillNames} value={d.skillChoices?.from ?? []} onChange={(from) => set({ skillChoices: { ...d.skillChoices, from } })} />
        </Field>
        <div className="grid grid-3">
          <Field label="Доспехи" hint="Через запятую">
            <input className="input" defaultValue={textList(d.armor)} onBlur={(e) => set({ armor: parseList(e.target.value) })} />
          </Field>
          <Field label="Оружие">
            <input className="input" defaultValue={textList(d.weapons)} onBlur={(e) => set({ weapons: parseList(e.target.value) })} />
          </Field>
          <Field label="Инструменты">
            <input className="input" defaultValue={textList(d.tools)} onBlur={(e) => set({ tools: parseList(e.target.value) })} />
          </Field>
        </div>
        <Description d={d} set={set} />
      </Section>
      <Section title="Заклинания">
        <label className="check">
          <input type="checkbox" checked={!!sc} onChange={(e) => set({ spellcasting: e.target.checked ? { ability: 'int', progression: 'full', mode: 'prepared' } : undefined })} /> Класс творит заклинания
        </label>
        {sc && (
          <div className="grid grid-3">
            <Field label="Базовая характеристика">
              <select className="select" value={sc.ability} onChange={(e) => set({ spellcasting: { ...sc, ability: e.target.value } })}>
                {Object.entries(abilityNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Ячейки">
              <select className="select" value={sc.progression} onChange={(e) => set({ spellcasting: { ...sc, progression: e.target.value } })}>
                {Object.entries(PROGRESSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Как получает заклинания">
              <select className="select" value={sc.mode} onChange={(e) => set({ spellcasting: { ...sc, mode: e.target.value } })}>
                <option value="prepared">Готовит из списка</option>
                <option value="known">Знает фиксированные</option>
              </select>
            </Field>
          </div>
        )}
      </Section>
      <Section title="Умения класса">
        <p className="small muted" style={{ margin: 0 }}>Уровень умения определяет, когда оно появится в листе. Ресурсы вроде «Ярости» или «Ки» заводятся эффектом «Ресурс».</p>
        <FeaturesEditor features={d.features} onChange={(features) => set({ features })} withLevel />
      </Section>
      <Section title="Подклассы">
        <SubList
          items={d.subclasses ?? []}
          onChange={(subclasses) => set({ subclasses })}
          addLabel="Добавить подкласс"
          withDescription
          render={(s, update) => <FeaturesEditor features={s.features} onChange={(features) => update({ features })} withLevel />}
        />
      </Section>
    </>
  );
}

function SpellForm({ d, set }: FormProps) {
  const classes = useContentList('class');
  const classOptions = Object.fromEntries((classes.data?.items ?? []).map((c) => [c.id, c.name])) as Record<string, string>;
  return (
    <>
      <Section>
        <div className="grid grid-3">
          <Field label="Уровень">
            <select className="select" value={d.level} onChange={(e) => set({ level: Number(e.target.value) })}>
              {Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{levelName(i)}</option>)}
            </select>
          </Field>
          <Field label="Школа">
            <select className="select" value={d.school} onChange={(e) => set({ school: e.target.value })}>
              {Object.entries(SPELL_SCHOOLS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Время накладывания">
            <input className="input" value={d.castingTime} onChange={(e) => set({ castingTime: e.target.value })} />
          </Field>
          <Field label="Дистанция">
            <input className="input" value={d.range} onChange={(e) => set({ range: e.target.value })} />
          </Field>
          <Field label="Длительность">
            <input className="input" value={d.duration} onChange={(e) => set({ duration: e.target.value })} />
          </Field>
          <Field label="Материальный компонент">
            <input className="input" placeholder="нет" value={d.components?.m ?? ''} onChange={(e) => set({ components: { ...d.components, m: e.target.value || undefined } })} />
          </Field>
        </div>
        <div className="row wrap">
          <label className="check"><input type="checkbox" checked={!!d.components?.v} onChange={(e) => set({ components: { ...d.components, v: e.target.checked } })} /> Вербальный</label>
          <label className="check"><input type="checkbox" checked={!!d.components?.s} onChange={(e) => set({ components: { ...d.components, s: e.target.checked } })} /> Соматический</label>
          <label className="check"><input type="checkbox" checked={d.concentration} onChange={(e) => set({ concentration: e.target.checked })} /> Концентрация</label>
          <label className="check"><input type="checkbox" checked={d.ritual} onChange={(e) => set({ ritual: e.target.checked })} /> Ритуал</label>
        </div>
        <Description d={d} set={set} />
        <Field label="На больших уровнях">
          <textarea className="textarea" rows={2} value={d.higherLevels ?? ''} onChange={(e) => set({ higherLevels: e.target.value || undefined })} />
        </Field>
      </Section>
      <Section title="Кнопка «Сотворить»">
        <p className="small muted" style={{ margin: 0 }}>Что бросать при сотворении. Например, огненный шар: урон 8к6, огонь, +1к6 за уровень ячейки выше третьего.</p>
        <div className="grid grid-3">
          <Field label="Урон">
            <input className="input" placeholder="8к6" value={d.damage?.dice ?? ''} onChange={(e) => set({ damage: e.target.value ? { ...d.damage, dice: e.target.value } : undefined })} />
          </Field>
          <Field label="Тип урона">
            <select className="select" disabled={!d.damage} value={d.damage?.type ?? ''} onChange={(e) => set({ damage: { ...d.damage, type: e.target.value || undefined } })}>
              <option value="">—</option>
              {Object.entries(DAMAGE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="За уровень выше">
            <input className="input" placeholder="1к6" disabled={!d.damage} value={d.damage?.perSlotAbove ?? ''} onChange={(e) => set({ damage: { ...d.damage, perSlotAbove: e.target.value || undefined } })} />
          </Field>
          <Field label="Лечение">
            <input className="input" placeholder="1к8" value={d.heal?.dice ?? ''} onChange={(e) => set({ heal: e.target.value ? { ...d.heal, dice: e.target.value } : undefined })} />
          </Field>
          <Field label="Лечение за уровень выше">
            <input className="input" placeholder="1к8" disabled={!d.heal} value={d.heal?.perSlotAbove ?? ''} onChange={(e) => set({ heal: { ...d.heal, perSlotAbove: e.target.value || undefined } })} />
          </Field>
          <Field label="Проверка">
            <select
              className="select"
              value={d.attack ? `attack:${d.attack}` : d.save ? `save:${d.save}` : ''}
              onChange={(e) => {
                const [t, v] = e.target.value.split(':');
                set({ attack: t === 'attack' ? v : undefined, save: t === 'save' ? v : undefined });
              }}
            >
              <option value="">Нет</option>
              <option value="attack:melee">Атака заклинанием вблизи</option>
              <option value="attack:ranged">Атака заклинанием издалека</option>
              {ABILITIES.map((a) => <option key={a} value={`save:${a}`}>Спасбросок {ABILITY_NAMES[a].full}</option>)}
            </select>
          </Field>
        </div>
      </Section>
      <Section title="Классы">
        {Object.keys(classOptions).length ? (
          <ChipSet options={classOptions} value={d.classes ?? []} onChange={(classes) => set({ classes })} />
        ) : (
          <span className="small muted">Классов в библиотеке пока нет.</span>
        )}
      </Section>
    </>
  );
}

function ItemForm({ d, set }: FormProps) {
  return (
    <>
      <Section>
        <div className="grid grid-3">
          <Field label="Категория">
            <select
              className="select"
              value={d.category}
              onChange={(e) => {
                const category = e.target.value;
                set({
                  category,
                  weapon: category === 'weapon' ? d.weapon ?? { damage: '1к6', damageType: 'slashing', properties: [], martial: false, ranged: false } : undefined,
                  armor: category === 'armor' ? d.armor ?? { base: 11, dexCap: null, type: 'light' } : undefined,
                  shield: category === 'shield' ? d.shield ?? { bonus: 2 } : undefined,
                });
              }}
            >
              {Object.entries(ITEM_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Вес, фнт">
            <NumberInput value={d.weight ?? 0} min={0} onChange={(weight) => set({ weight })} />
          </Field>
          <Field label="Цена">
            <div className="row">
              <NumberInput value={d.cost?.amount ?? 0} min={0} onChange={(amount) => set({ cost: amount ? { coin: d.cost?.coin ?? 'gp', amount } : undefined })} />
              <select className="select" style={{ width: 80 }} value={d.cost?.coin ?? 'gp'} onChange={(e) => set({ cost: { amount: d.cost?.amount ?? 0, coin: e.target.value } })}>
                {Object.entries(COINS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Редкость">
            <input className="input" placeholder="обычный" value={d.rarity ?? ''} onChange={(e) => set({ rarity: e.target.value || undefined })} />
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={!!d.attunement} onChange={(e) => set({ attunement: e.target.checked || undefined })} /> Требует настройки</label>
        <Description d={d} set={set} />
      </Section>
      {d.weapon && (
        <Section title="Оружие">
          <div className="grid grid-3">
            <Field label="Урон"><input className="input" value={d.weapon.damage} onChange={(e) => set({ weapon: { ...d.weapon, damage: e.target.value } })} /></Field>
            <Field label="Тип урона">
              <select className="select" value={d.weapon.damageType} onChange={(e) => set({ weapon: { ...d.weapon, damageType: e.target.value } })}>
                {Object.entries(DAMAGE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Двуручный хват"><input className="input" placeholder="1к10" value={d.weapon.versatile ?? ''} onChange={(e) => set({ weapon: { ...d.weapon, versatile: e.target.value || undefined } })} /></Field>
            <Field label="Дальность"><input className="input" placeholder="80/320" value={d.weapon.range ?? ''} onChange={(e) => set({ weapon: { ...d.weapon, range: e.target.value || undefined } })} /></Field>
            <Field label="Свойства" hint="Через запятую: фехтовальное, лёгкое, метательное">
              <input className="input" defaultValue={textList(d.weapon.properties)} onBlur={(e) => set({ weapon: { ...d.weapon, properties: parseList(e.target.value) } })} />
            </Field>
          </div>
          <div className="row wrap">
            <label className="check"><input type="checkbox" checked={d.weapon.martial} onChange={(e) => set({ weapon: { ...d.weapon, martial: e.target.checked } })} /> Воинское</label>
            <label className="check"><input type="checkbox" checked={d.weapon.ranged} onChange={(e) => set({ weapon: { ...d.weapon, ranged: e.target.checked } })} /> Дальнобойное</label>
          </div>
        </Section>
      )}
      {d.armor && (
        <Section title="Доспех">
          <div className="grid grid-3">
            <Field label="Тип">
              <select className="select" value={d.armor.type} onChange={(e) => { const type = e.target.value; set({ armor: { ...d.armor, type, dexCap: type === 'light' ? null : type === 'medium' ? 2 : 0 } }); }}>
                <option value="light">Лёгкий</option>
                <option value="medium">Средний</option>
                <option value="heavy">Тяжёлый</option>
              </select>
            </Field>
            <Field label="Базовый КД"><NumberInput value={d.armor.base} onChange={(base) => set({ armor: { ...d.armor, base } })} /></Field>
            <Field label="Требует Силы"><NumberInput value={d.armor.strength ?? 0} onChange={(strength) => set({ armor: { ...d.armor, strength: strength || undefined } })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={!!d.armor.stealthDisadvantage} onChange={(e) => set({ armor: { ...d.armor, stealthDisadvantage: e.target.checked || undefined } })} /> Помеха к Скрытности</label>
        </Section>
      )}
      {d.shield && (
        <Section title="Щит">
          <Field label="Бонус к КД"><NumberInput value={d.shield.bonus} onChange={(bonus) => set({ shield: { bonus } })} /></Field>
        </Section>
      )}
      <Section title="Эффекты в листе">
        <p className="small muted" style={{ margin: 0 }}>Действуют, пока предмет надет: например, «Кольцо защиты» даёт +1 к КД.</p>
        <EffectsEditor effects={d.effects ?? []} onChange={(effects) => set({ effects })} />
      </Section>
    </>
  );
}

function ActionsEditor({ list, onChange }: { list: MonsterAction[]; onChange: (l: MonsterAction[]) => void }) {
  const update = (i: number, p: Partial<MonsterAction>) => onChange(list.map((a, j) => (j === i ? { ...a, ...p } : a)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {list.map((a, i) => (
        <div key={i} className="sub-card">
          <div className="row wrap">
            <input className="input grow" style={{ minWidth: 160 }} placeholder="Название" value={a.name} onChange={(e) => update(i, { name: e.target.value })} />
            <label className="row small nowrap" style={{ gap: 6 }}>
              Атака
              <input className="input sm num" style={{ width: 56 }} placeholder="+4" value={a.attackBonus ?? ''} onChange={(e) => { const n = parseInt(e.target.value.replace('−', '-'), 10); update(i, { attackBonus: Number.isFinite(n) ? n : undefined }); }} />
            </label>
            <label className="row small nowrap" style={{ gap: 6 }}>
              Урон
              <input className="input sm" style={{ width: 90 }} placeholder="1к6+2" value={a.damage ?? ''} onChange={(e) => update(i, { damage: e.target.value || undefined })} />
            </label>
            <button type="button" className="btn ghost sm icon" aria-label="Удалить" onClick={() => onChange(list.filter((_, j) => j !== i))}>
              <Trash2 />
            </button>
          </div>
          <textarea className="textarea" rows={2} placeholder="Описание" value={a.description} onChange={(e) => update(i, { description: e.target.value })} />
        </div>
      ))}
      <div>
        <button type="button" className="btn sm" onClick={() => onChange([...list, { name: '', description: '' }])}>
          <Plus /> Добавить
        </button>
      </div>
    </div>
  );
}

function MonsterForm({ d, set }: FormProps) {
  return (
    <>
      <Section>
        <div className="grid grid-3">
          <Field label="Размер"><input className="input" value={d.size} onChange={(e) => set({ size: e.target.value })} /></Field>
          <Field label="Тип"><input className="input" value={d.type} onChange={(e) => set({ type: e.target.value })} /></Field>
          <Field label="Мировоззрение"><input className="input" value={d.alignment ?? ''} onChange={(e) => set({ alignment: e.target.value })} /></Field>
          <Field label="Класс доспеха"><NumberInput value={d.ac} onChange={(ac) => set({ ac })} /></Field>
          <Field label="Доспех"><input className="input" placeholder="кожаный доспех" value={d.acNote ?? ''} onChange={(e) => set({ acNote: e.target.value || undefined })} /></Field>
          <Field label="Скорость"><input className="input" value={d.speed} onChange={(e) => set({ speed: e.target.value })} /></Field>
          <Field label="Хиты"><NumberInput value={d.hp} min={1} onChange={(hp) => set({ hp })} /></Field>
          <Field label="Формула хитов" hint="Для броска хитов при добавлении в бой"><input className="input" placeholder="2к8+2" value={d.hpFormula ?? ''} onChange={(e) => set({ hpFormula: e.target.value || undefined })} /></Field>
          <Field label="Опасность"><input className="input" placeholder="1/4" value={d.cr} onChange={(e) => set({ cr: e.target.value })} /></Field>
        </div>
        <div className="grid grid-6">
          {ABILITIES.map((a) => (
            <Field key={a} label={ABILITY_NAMES[a].short}>
              <NumberInput value={d.abilities?.[a] ?? 10} min={1} max={30} onChange={(n) => set({ abilities: { ...d.abilities, [a]: n } })} />
            </Field>
          ))}
        </div>
        <div className="grid grid-2">
          <Field label="Чувства"><input className="input" placeholder="тёмное зрение 60 фт., пассивное Восприятие 9" value={d.senses ?? ''} onChange={(e) => set({ senses: e.target.value || undefined })} /></Field>
          <Field label="Языки"><input className="input" value={d.languages ?? ''} onChange={(e) => set({ languages: e.target.value || undefined })} /></Field>
        </div>
        <Field label="Сопротивление урону"><ChipSet options={DAMAGE_TYPES} value={d.resistances ?? []} onChange={(resistances) => set({ resistances })} /></Field>
        <Field label="Иммунитет к урону"><ChipSet options={DAMAGE_TYPES} value={d.immunities ?? []} onChange={(immunities) => set({ immunities })} /></Field>
        <Field label="Уязвимость"><ChipSet options={DAMAGE_TYPES} value={d.vulnerabilities ?? []} onChange={(vulnerabilities) => set({ vulnerabilities })} /></Field>
        <Field label="Иммунитет к состояниям"><ChipSet options={CONDITIONS} value={d.conditionImmunities ?? []} onChange={(conditionImmunities) => set({ conditionImmunities })} /></Field>
      </Section>
      <Section title="Особенности"><ActionsEditor list={d.traits ?? []} onChange={(traits) => set({ traits })} /></Section>
      <Section title="Действия"><ActionsEditor list={d.actions ?? []} onChange={(actions) => set({ actions })} /></Section>
      <Section title="Реакции"><ActionsEditor list={d.reactions ?? []} onChange={(reactions) => set({ reactions })} /></Section>
      <Section title="Легендарные действия"><ActionsEditor list={d.legendary ?? []} onChange={(legendary) => set({ legendary })} /></Section>
    </>
  );
}

function FeatForm({ d, set }: FormProps) {
  return (
    <>
      <Section>
        <Field label="Требования"><input className="input" placeholder="нет" value={d.prerequisite ?? ''} onChange={(e) => set({ prerequisite: e.target.value || undefined })} /></Field>
        <Description d={d} set={set} />
      </Section>
      <Section title="Эффекты в листе">
        <EffectsEditor effects={d.effects ?? []} onChange={(effects) => set({ effects })} />
      </Section>
    </>
  );
}
