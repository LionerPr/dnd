import { ABILITIES, ABILITY_NAMES, LANGUAGES, abilityMod, type Ability, type Character, type CharacterClass, type Race } from '@dnd/rules-engine';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type CharacterView, type ContentRow } from '../../api/client';
import { bookShort, signed } from '../../lib/format';
import { useContentList, useSubclassOptions } from '../../lib/hooks';
import { ChoiceRow, ChosenList } from './Choices';
import { Field, NumberInput, Segmented } from '../ui';

type Save = (u: (c: Character) => Character) => void;

const STANDARD = [15, 14, 13, 12, 10, 8];
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

function useFull<T>(id: string | undefined) {
  return useQuery({ queryKey: ['content-item', id], queryFn: () => api<{ item: ContentRow }>(`/content/${id}`).then((r) => r.item.data as T), enabled: !!id });
}


export function BuildTab({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const sheet = view.sheet;
  const races = useContentList('race');
  const classes = useContentList('class');
  const race = useFull<Race>(c.raceId);
  const [method, setMethod] = useState<'manual' | 'standard' | 'points'>('manual');
  const [newFeature, setNewFeature] = useState({ name: '', description: '' });

  const points = ABILITIES.reduce((s, a) => s + (POINT_COST[c.baseAbilities[a]] ?? 99), 0);
  const setAbility = (a: Ability, v: number) => save((d) => ({ ...d, baseAbilities: { ...d.baseAbilities, [a]: v } }));

  return (
    <div className="panel">
      <div className="build-section">
        <h3>Раса</h3>
        <div className="grid grid-2">
          <Field label="Раса" hint={<Link to="/library?kind=race">Создать свою или импортировать с dnd.su</Link>}>
            <select className="select" value={c.raceId ?? ''} onChange={(e) => save((d) => ({ ...d, raceId: e.target.value || undefined, subraceId: undefined }))}>
              <option value="">Не выбрана</option>
              {(races.data?.items ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.data?.book ? ` (${bookShort(r.data.book)})` : ''}
                </option>
              ))}
            </select>
          </Field>
          {!!race.data?.subraces?.length && (
            <Field label="Разновидность">
              <select className="select" value={c.subraceId ?? ''} onChange={(e) => save((d) => ({ ...d, subraceId: e.target.value || undefined }))}>
                <option value="">Не выбрана</option>
                {race.data.subraces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </div>

      <div className="build-section">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Класс и уровень</h3>
          <span className="small muted">уровень персонажа: {sheet.level}</span>
        </div>
        <div className="stack">
          {c.classes.map((entry, i) => (
            <ClassRow key={i} index={i} entry={entry} options={classes.data?.items ?? []} save={save} />
          ))}
          <div className="row">
            <button
              className="btn sm"
              disabled={!classes.data?.items.length}
              onClick={() => save((d) => ({ ...d, classes: [...d.classes, { classId: classes.data!.items[0]!.id, level: 1 }] }))}
            >
              <Plus /> {c.classes.length ? 'Мультикласс' : 'Выбрать класс'}
            </button>
            {!classes.data?.items.length && (
              <span className="small muted">
                Классов в библиотеке нет — <Link to="/library?kind=class">добавьте</Link>.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="build-section">
        <div className="row between wrap" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Характеристики</h3>
          <Segmented
            options={[
              { id: 'manual', label: 'Вручную' },
              { id: 'standard', label: 'Стандартный набор' },
              { id: 'points', label: 'Покупка очками' },
            ]}
            value={method}
            onChange={(m) => {
              setMethod(m);
              if (m === 'points') save((d) => ({ ...d, baseAbilities: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } }));
            }}
          />
        </div>
        {method === 'points' && (
          <p className={`small ${points > 27 ? 'error-text' : 'muted'}`}>
            Потрачено {points} из 27 очков. Значения от 8 до 15 до бонусов расы.
          </p>
        )}
        {method === 'standard' && <p className="small muted">Раздайте значения 15, 14, 13, 12, 10, 8 — каждое по одному разу.</p>}
        <div className="ability-edit">
          {ABILITIES.map((a) => {
            const base = c.baseAbilities[a];
            const final = sheet.abilities[a].score;
            return (
              <div key={a} className="cell">
                <div className="caps">{ABILITY_NAMES[a].short}</div>
                {method === 'standard' ? (
                  <select className="select sm" style={{ margin: '6px 0' }} value={base} onChange={(e) => setAbility(a, Number(e.target.value))}>
                    {STANDARD.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : method === 'points' ? (
                  <div className="row" style={{ justifyContent: 'center', margin: '6px 0' }}>
                    <button className="btn xs icon" disabled={base <= 8} onClick={() => setAbility(a, base - 1)}>−</button>
                    <b className="num" style={{ width: 22 }}>{base}</b>
                    <button className="btn xs icon" disabled={base >= 15} onClick={() => setAbility(a, base + 1)}>+</button>
                  </div>
                ) : (
                  <NumberInput value={base} min={1} max={30} onChange={(v) => setAbility(a, v)} aria-label={ABILITY_NAMES[a].full} />
                )}
                <div className="small">
                  итог <b className="num">{final}</b> <span className="muted">({signed(abilityMod(final))})</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {sheet.pendingChoices.length > 0 || Object.keys(c.choices).length > 0 ? (
        <div className="build-section">
          <h3>Выборы</h3>
          <div className="stack">
            {sheet.pendingChoices.map((p) => (
              <ChoiceRow key={p.id} p={p} sheet={sheet} data={c} update={save} />
            ))}
            <ChosenList data={c} update={save} />
          </div>
        </div>
      ) : null}

      {sheet.level > 1 && (
        <div className="build-section">
          <h3>Хиты по уровням</h3>
          <p className="small muted">1-й уровень — максимум кости. Дальше — результат броска или среднее (по умолчанию). Телосложение добавится само.</p>
          <div className="row wrap">
            {Array.from({ length: sheet.level - 1 }, (_, i) => i + 1).map((lvl) => (
              <Field key={lvl} label={`${lvl + 1} ур.`}>
                <NumberInput
                  value={c.hpRolls[lvl] ?? 0}
                  min={0}
                  max={20}
                  style={{ width: 64 }}
                  onChange={(v) =>
                    save((d) => {
                      const hpRolls = [...d.hpRolls];
                      hpRolls[lvl] = v || (undefined as never);
                      return { ...d, hpRolls };
                    })
                  }
                />
              </Field>
            ))}
          </div>
        </div>
      )}

      <div className="build-section">
        <h3>Ручные правки</h3>
        <p className="small muted">Если правило не учтено автоматически, впишите итоговое значение. Пустое поле — считать само.</p>
        <div className="row wrap">
          {[
            ['ac', 'Класс доспеха'],
            ['maxHp', 'Макс. хиты (без Тел.)'],
            ['initiative', 'Инициатива'],
            ['passivePerception', 'Пасс. восприятие'],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                className="input num"
                style={{ width: 120 }}
                defaultValue={c.overrides[key!] ?? ''}
                placeholder="авто"
                onBlur={(e) =>
                  save((d) => {
                    const overrides = { ...d.overrides };
                    const v = e.target.value.trim();
                    if (v === '' || Number.isNaN(Number(v))) delete overrides[key!];
                    else overrides[key!] = Number(v);
                    return { ...d, overrides };
                  })
                }
              />
            </Field>
          ))}
        </div>
        <Field label="Дополнительные языки" hint="Языки расы и класса добавляются сами — здесь выученные сверх них">
          <LanguagePicker value={c.languages} known={sheet.proficiencies.language} onChange={(languages) => save((d) => ({ ...d, languages }))} />
        </Field>
      </div>

      <div className="build-section">
        <h3>Свои умения и черты</h3>
        <div className="stack">
          {c.extraFeatures.map((f) => (
            <div key={f.id} className="row between">
              <div>
                <b>{f.name}</b>
                <div className="small muted">{f.description.slice(0, 140)}</div>
              </div>
              <button className="btn ghost sm icon" onClick={() => save((d) => ({ ...d, extraFeatures: d.extraFeatures.filter((x) => x.id !== f.id) }))} aria-label="Удалить">
                <Trash2 />
              </button>
            </div>
          ))}
          <div className="grid grid-2">
            <input className="input" placeholder="Название" value={newFeature.name} onChange={(e) => setNewFeature({ ...newFeature, name: e.target.value })} />
            <button
              className="btn"
              disabled={!newFeature.name.trim()}
              onClick={() => {
                save((d) => ({ ...d, extraFeatures: [...d.extraFeatures, { id: `own-${Date.now()}`, name: newFeature.name.trim(), description: newFeature.description }] }));
                setNewFeature({ name: '', description: '' });
              }}
            >
              <Plus /> Добавить умение
            </button>
          </div>
          <textarea className="textarea" placeholder="Описание" rows={3} value={newFeature.description} onChange={(e) => setNewFeature({ ...newFeature, description: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

function ClassRow({ index, entry, options, save }: { index: number; entry: Character['classes'][number]; options: ContentRow[]; save: Save }) {
  const cls = useFull<CharacterClass>(entry.classId);
  const subs = useSubclassOptions(entry.classId);
  const update = (patch: Partial<Character['classes'][number]>) => save((d) => ({ ...d, classes: d.classes.map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
  return (
    <div className="row wrap" style={{ alignItems: 'flex-end' }}>
      <Field label="Класс" className="grow">
        <select className="select" value={entry.classId} onChange={(e) => update({ classId: e.target.value, subclassId: undefined, subclassFrom: undefined })}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Уровень">
        <NumberInput value={entry.level} min={1} max={20} style={{ width: 72 }} onChange={(v) => update({ level: v })} />
      </Field>
      {cls.data && entry.level >= cls.data.subclassLevel && subs.options.length > 0 && (
        <Field label="Подкласс" className="grow">
          <select
            className="select"
            value={entry.subclassId ? `${entry.subclassFrom ?? ''}|${entry.subclassId}` : ''}
            onChange={(e) => {
              const [from, id] = e.target.value.split('|');
              update({ subclassId: id || undefined, subclassFrom: from || undefined });
            }}
          >
            <option value="">Не выбран</option>
            {subs.options.map(({ sub: s, from, legacy }) => (
              <option key={`${from ?? ''}|${s.id}`} value={`${from ?? ''}|${s.id}`}>
                {s.name}{legacy ? ' (5e 2014)' : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
      <button className="btn ghost icon" aria-label="Убрать класс" onClick={() => save((d) => ({ ...d, classes: d.classes.filter((_, i) => i !== index) }))}>
        <Trash2 />
      </button>
    </div>
  );
}

/** Языки чипами: известные от расы — отмечены и не снимаются, остальные — по нажатию */
export function LanguagePicker({ value, known, onChange }: { value: string[]; known: string[]; onChange: (v: string[]) => void }) {
  const [custom, setCustom] = useState('');
  const fromRules = new Set(known.filter((k) => !value.includes(k)));
  const all = [...new Set([...LANGUAGES.map((l) => l.name), ...value])];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        {all.map((name) => {
          const on = value.includes(name) || fromRules.has(name);
          return (
            <button
              key={name}
              type="button"
              className={`chip${on ? ' accent' : ''}`}
              disabled={fromRules.has(name)}
              title={fromRules.has(name) ? 'От расы или класса' : undefined}
              onClick={() => onChange(on ? value.filter((v) => v !== name) : [...value, name])}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Другой язык" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button
          type="button"
          className="btn sm"
          disabled={!custom.trim()}
          onClick={() => {
            onChange([...value, custom.trim()]);
            setCustom('');
          }}
        >
          <Plus /> Добавить
        </button>
      </div>
    </div>
  );
}
