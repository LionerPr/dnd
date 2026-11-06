import { ABILITY_NAMES, editionOf, totalLevel, type Character, type CharacterClass, type Sheet } from '@dnd/rules-engine';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Dices } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, type CharacterView } from '../../api/client';
import { signed } from '../../lib/format';
import { useContentItem, useContentList } from '../../lib/hooks';
import { Modal, NumberInput, Segmented, Spinner } from '../ui';
import { ChoiceRow } from './Choices';
import { FeatureList } from './FeaturesTab';

type HpMode = 'average' | 'roll' | 'manual';

/** Персонаж с +1 уровнем в выбранном классе (или новым классом 1-го уровня) */
function bump(c: Character, index: number, newClassId?: string): Character {
  if (index < 0 && newClassId) return { ...c, classes: [...c.classes, { classId: newClassId, level: 1 }] };
  return { ...c, classes: c.classes.map((x, i) => (i === index ? { ...x, level: x.level + 1 } : x)) };
}

/** Бросок хитов нового уровня встаёт на своё место: hpRolls идут по классам в порядке списка */
function withHp(c: Character, index: number, roll: number): Character {
  const i = index < 0 ? c.classes.length - 1 : index;
  const pos = c.classes.slice(0, i).reduce((s, x) => s + x.level, 0) + c.classes[i]!.level - 1;
  const hpRolls = [...c.hpRolls];
  while (hpRolls.length < pos) hpRolls.push(undefined as never);
  hpRolls.splice(pos, 0, roll);
  return { ...c, hpRolls };
}

function Diff({ label, from, to, fmt = String }: { label: string; from: number | string | undefined; to: number | string | undefined; fmt?: (v: any) => string }) {
  if (from === to || to === undefined) return null;
  return (
    <div className="lu-diff">
      <span className="muted">{label}</span>
      <span>
        {from !== undefined && from !== '' && from !== 0 ? <s className="muted">{fmt(from)}</s> : <span className="tag">новое</span>}
        <ArrowRight size={14} />
        <b>{fmt(to)}</b>
      </span>
    </div>
  );
}

export function LevelUpModal({ view, onClose, onSave }: { view: CharacterView; onClose: () => void; onSave: (c: Character) => void }) {
  const c = view.data;
  const before = view.sheet;
  const [index, setIndex] = useState(0);
  const [newClassId, setNewClassId] = useState('');
  const [hpMode, setHpMode] = useState<HpMode>('average');
  const [rolled, setRolled] = useState<number | null>(null);
  const [manual, setManual] = useState(0);
  const classes = useContentList('class');
  const [draft, setDraft] = useState<Character>(() => bump(c, 0));

  const pick = (i: number, cls?: string) => {
    setIndex(i);
    setNewClassId(cls ?? '');
    setRolled(null);
    setDraft(bump(c, i, cls));
  };

  const entry = index < 0 ? draft.classes[draft.classes.length - 1] : draft.classes[index];
  const cls = useContentItem<CharacterClass>(entry?.classId);
  const die = cls.data?.hitDie ?? 8;
  const average = die / 2 + 1;
  const firstLevel = totalLevel(c) === 0;
  const hpValue = firstLevel ? die : hpMode === 'average' ? average : hpMode === 'roll' ? rolled : manual;
  const final = useMemo(() => (entry && !firstLevel && hpValue ? withHp(draft, index, hpValue) : draft), [draft, index, hpValue, entry, firstLevel]);

  const preview = useQuery({
    queryKey: ['preview', view.id, final],
    queryFn: () => api<{ sheet: Sheet }>(`/characters/${view.id}/preview`, { body: { data: final } }),
    placeholderData: keepPreviousData,
    enabled: !!entry,
  });
  const after = preview.data?.sheet;
  const update = (u: (d: Character) => Character) => setDraft((d) => u(d));

  const newLevel = entry?.level ?? 1;
  const beforeIds = new Set(before.features.map((f) => f.id));
  const newFeatures = after?.features.filter((f) => !beforeIds.has(f.id)) ?? [];
  const beforePending = new Map(before.pendingChoices.map((p) => [p.id, p.pick]));
  const choices = after?.pendingChoices.filter((p) => (beforePending.get(p.id) ?? 0) < p.pick) ?? [];
  const original = index < 0 ? undefined : c.classes[index];
  const needsSubclass = !!cls.data && cls.data.subclasses.length > 0 && newLevel >= cls.data.subclassLevel && !original?.subclassId;
  const optional = cls.data?.features.filter((f) => f.optional && f.level === newLevel) ?? [];

  const row = (lvl: number) => cls.data?.levels.find((l) => l.level === lvl)?.columns ?? {};
  const prevRow = row(newLevel - 1);
  const nextRow = row(newLevel);
  const columnDiffs = Object.keys(nextRow).filter((k) => nextRow[k] !== prevRow[k] && nextRow[k] !== '—' && nextRow[k] !== '-');

  const resources = after?.resources.filter((r) => before.resources.find((x) => x.id === r.id)?.max !== r.max) ?? [];
  const slots = after?.spellSlots.filter((s) => s.max !== (before.spellSlots.find((x) => x.level === s.level)?.max ?? 0)) ?? [];
  const ownClasses = new Set(c.classes.map((x) => x.classId));
  const className = (id: string) => classes.data?.items.find((x) => x.id === id)?.name ?? '…';

  return (
    <Modal
      wide
      title={entry ? `${className(entry.classId)}: ${newLevel} уровень` : 'Повышение уровня'}
      onClose={onClose}
      footer={
        <>
          {choices.length > 0 && <span className="small muted grow">Несделанные выборы можно закончить позже в конструкторе.</span>}
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn accent" disabled={!entry || !hpValue} onClick={() => onSave(final)}>
            Повысить до {totalLevel(final)} уровня
          </button>
        </>
      }
    >
      {/* Какой класс растёт */}
      <div className="row wrap" style={{ gap: 6 }}>
        {c.classes.map((x, i) => (
          <button key={x.classId} className={`chip${index === i ? ' accent' : ''}`} onClick={() => pick(i)}>
            {className(x.classId)} {x.level} → {x.level + 1}
          </button>
        ))}
        <select
          className="select sm"
          style={{ width: 'auto' }}
          value={index < 0 ? newClassId : ''}
          onChange={(e) => (e.target.value ? pick(-1, e.target.value) : pick(0))}
          aria-label="Мультикласс"
        >
          <option value="">{c.classes.length ? 'Мультикласс: другой класс…' : 'Выберите класс…'}</option>
          {(classes.data?.items ?? []).filter((x) => !ownClasses.has(x.id) && editionOf(x.data) === editionOf(c)).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        {preview.isFetching && <Spinner />}
      </div>

      {after && (
        <div className="lu-summary">
          <Diff label="Уровень персонажа" from={before.level} to={after.level} />
          <Diff label="Максимум хитов" from={before.maxHp} to={after.maxHp} />
          <Diff label="Бонус мастерства" from={before.proficiencyBonus} to={after.proficiencyBonus} fmt={signed} />
          {resources.map((r) => (
            <Diff key={r.id} label={r.name} from={before.resources.find((x) => x.id === r.id)?.max} to={r.max} />
          ))}
          {columnDiffs
            .filter((k) => !resources.some((r) => k.toLowerCase().includes(r.name.toLowerCase().slice(0, 4))))
            .map((k) => (
              <Diff key={k} label={k} from={prevRow[k] === '—' ? '' : prevRow[k]} to={nextRow[k]} />
            ))}
          {slots.map((s) => (
            <Diff key={s.level} label={`Ячейки ${s.level} круга`} from={before.spellSlots.find((x) => x.level === s.level)?.max ?? 0} to={s.max} />
          ))}
        </div>
      )}

      {/* Хиты */}
      {!firstLevel && (
        <section className="lu-section">
          <h4>Хиты</h4>
          <div className="row wrap" style={{ gap: 10 }}>
            <Segmented
              options={[
                { id: 'average', label: `Среднее: ${average}` },
                { id: 'roll', label: 'Бросить' },
                { id: 'manual', label: 'Вручную' },
              ]}
              value={hpMode}
              onChange={(m) => {
                setHpMode(m);
                if (m === 'roll' && rolled === null) setRolled(1 + Math.floor(Math.random() * die));
              }}
            />
            {hpMode === 'roll' && (
              <button className="btn sm" onClick={() => setRolled(1 + Math.floor(Math.random() * die))}>
                <Dices /> {rolled ?? '—'} на к{die}
              </button>
            )}
            {hpMode === 'manual' && <NumberInput value={manual} min={1} max={die} style={{ width: 72 }} onChange={setManual} aria-label="Хиты за уровень" />}
            <span className="small muted">
              + {ABILITY_NAMES.con.short} {signed(after?.abilities.con.mod ?? before.abilities.con.mod)} добавится само
            </span>
          </div>
        </section>
      )}

      {/* Подкласс */}
      {cls.data && needsSubclass && (
        <section className="lu-section">
          <h4>Подкласс</h4>
          <div className="part-options">
            {cls.data.subclasses.map((s) => (
              <details key={s.id} className={`part-option${entry?.subclassId === s.id ? ' picked' : ''}`}>
                <summary>
                  <span className="t">{s.name}</span>
                  <button
                    className={`btn xs ${entry?.subclassId === s.id ? 'primary' : 'accent'}`}
                    onClick={(e) => {
                      e.preventDefault();
                      update((d) => ({ ...d, classes: d.classes.map((x) => (x.classId === entry!.classId ? { ...x, subclassId: s.id } : x)) }));
                    }}
                  >
                    {entry?.subclassId === s.id ? 'Выбрано' : 'Выбрать'}
                  </button>
                </summary>
                <div className="body">
                  {s.description}
                  <FeatureList features={s.features.filter((f) => (f.level ?? 0) <= newLevel)} />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Выборы этого уровня */}
      {after && choices.length > 0 && (
        <section className="lu-section">
          <h4>Выберите</h4>
          <div className="stack">
            {choices.map((p) => (
              <ChoiceRow key={p.id} p={p} sheet={after} data={draft} update={update} />
            ))}
          </div>
        </section>
      )}

      {/* Новые умения */}
      <section className="lu-section">
        <h4>Новые умения</h4>
        {newFeatures.length ? (
          <div className="panel">
            <FeatureList features={newFeatures} open />
          </div>
        ) : (
          <p className="small muted">{preview.isLoading ? 'Считаю…' : 'На этом уровне новых умений нет.'}</p>
        )}
      </section>

      {optional.length > 0 && (
        <section className="lu-section">
          <h4>Опциональные умения (Котёл Таши)</h4>
          <div className="stack" style={{ gap: 6 }}>
            {optional.map((f) => {
              const on = draft.optionalFeatures.includes(f.id);
              return (
                <label key={f.id} className="check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => update((d) => ({ ...d, optionalFeatures: on ? d.optionalFeatures.filter((x) => x !== f.id) : [...d.optionalFeatures, f.id] }))}
                  />
                  <span>
                    <b>{f.name}</b> <span className="small muted">{f.description.slice(0, 160)}{f.description.length > 160 ? '…' : ''}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      )}
    </Modal>
  );
}
