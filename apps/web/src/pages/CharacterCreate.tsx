import { ABILITIES, ABILITY_NAMES, SKILLS, abilityMod, roll as rollDice, type Ability, type Character, type CharacterClass, type Race } from '@dnd/rules-engine';
import { ArrowLeft, ArrowRight, Check, Dices, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CharacterView } from '../api/client';
import { ChoiceRow, ChosenList } from '../components/sheet/Choices';
import { FeatureList } from '../components/sheet/FeaturesTab';
import { Empty, Field, Loading, Segmented } from '../components/ui';
import { bookShort, profName, searchKey, signed } from '../lib/format';
import { useCharacter, useContentItem, useContentList, useSaveBuild } from '../lib/hooks';

type Save = (u: (c: Character) => Character) => void;
const STEPS = ['Раса', 'Класс', 'Характеристики', 'Навыки и выборы', 'Описание'] as const;

const STANDARD = [15, 14, 13, 12, 10, 8];
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

/** Пошаговое создание: раса → класс → характеристики → выборы → описание. Каждое действие сразу сохраняется. */
export function CharacterCreatePage() {
  const { id = '' } = useParams();
  const q = useCharacter(id);
  const save = useSaveBuild(q.data);
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Empty title="Персонаж не найден" />;
  const view = q.data;
  const c = view.data;
  const done = [!!c.raceId, c.classes.length > 0, true, view.sheet.pendingChoices.length === 0, true];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link to={`/characters/${id}`} className="btn ghost sm" style={{ marginLeft: -10, marginBottom: 6 }}>
            <ArrowLeft /> К листу
          </Link>
          <h1>{c.name}</h1>
          <div className="sub">Создание персонажа: шаг {step + 1} из {STEPS.length}</div>
        </div>
      </div>
      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={`${i === step ? 'on' : ''} ${done[i] && i < step ? 'done' : ''}`}>
            <button onClick={() => setStep(i)}>
              <span className="n">{done[i] && i !== step && (i < step || i <= 1) ? <Check size={14} /> : i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && <RaceStep view={view} save={save} />}
      {step === 1 && <ClassStep view={view} save={save} />}
      {step === 2 && <AbilitiesStep view={view} save={save} />}
      {step === 3 && <ChoicesStep view={view} save={save} />}
      {step === 4 && <DescriptionStep view={view} save={save} />}

      <div className="save-bar">
        {step > 0 && (
          <button className="btn" onClick={() => setStep(step - 1)}>
            <ArrowLeft /> Назад
          </button>
        )}
        <span className="grow" />
        {step < STEPS.length - 1 ? (
          <button className="btn accent" disabled={!done[step]} onClick={() => setStep(step + 1)}>
            Дальше <ArrowRight />
          </button>
        ) : (
          <button className="btn accent" onClick={() => nav(`/characters/${id}`)}>
            <Check /> Готово — открыть лист
          </button>
        )}
      </div>
    </main>
  );
}

function useFilter() {
  const [query, setQuery] = useState('');
  const input = (
    <label className="search-input">
      <Search size={16} />
      <input className="input" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
    </label>
  );
  return { input, match: (name: string) => !query || searchKey(name).includes(searchKey(query)) };
}

function RaceStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const races = useContentList('race');
  const race = useContentItem<Race>(c.raceId);
  const { input, match } = useFilter();
  const items = (races.data?.items ?? []).filter((r) => match(r.name));
  return (
    <div className="wizard-split">
      <div className="stack">
        {input}
        <div className="pick-list">
          {items.map((r) => (
            <button key={r.id} className={`pick-item${c.raceId === r.id ? ' on' : ''}`} onClick={() => save((d) => ({ ...d, raceId: r.id, subraceId: undefined }))}>
              <span>{r.name}</span>
              <span className="small muted">{[r.data?.book && bookShort(r.data.book), r.source_url?.includes('/homebrew/') && 'самодельное'].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {!items.length && <p className="small muted">Ничего не нашлось. Расы добавляются в «Библиотеке».</p>}
        </div>
      </div>
      <div className="panel">
        {race.data ? (
          <>
            <div className="panel-head">
              <h3>{race.data.name}</h3>
              <span className="small muted">скорость {race.data.speed} фт</span>
            </div>
            {!!race.data.subraces?.length && (
              <div className="panel-pad stack" style={{ gap: 6 }}>
                <span className="caps">Разновидность{!c.subraceId && <span className="accent-text"> — выберите, часть особенностей в ней</span>}</span>
                <div className="row wrap" style={{ gap: 6 }}>
                  {race.data.subraces.map((s) => (
                    <button key={s.id} className={`chip${c.subraceId === s.id ? ' accent' : ''}`} onClick={() => save((d) => ({ ...d, subraceId: s.id }))}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <FeatureList features={[...race.data.features, ...(race.data.subraces?.find((s) => s.id === c.subraceId)?.features ?? [])]} />
          </>
        ) : (
          <Empty title="Выберите расу">Особенности расы появятся здесь и сами попадут в лист.</Empty>
        )}
      </div>
    </div>
  );
}

function ClassStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const classes = useContentList('class');
  const current = c.classes[0];
  const cls = useContentItem<CharacterClass>(current?.classId);
  const { input, match } = useFilter();
  const items = (classes.data?.items ?? []).filter((r) => match(r.name));
  const lvl1 = cls.data?.features.filter((f) => (f.level ?? 1) <= 1 && !f.optional) ?? [];
  return (
    <div className="wizard-split">
      <div className="stack">
        {input}
        <div className="pick-list">
          {items.map((r) => (
            <button
              key={r.id}
              className={`pick-item${current?.classId === r.id ? ' on' : ''}`}
              onClick={() => save((d) => ({ ...d, classes: [{ classId: r.id, level: 1 }, ...d.classes.slice(1)], hpRolls: [] }))}
            >
              <span>{r.name}</span>
              <span className="small muted">{r.data?.hitDie ? `к${r.data.hitDie}` : ''}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        {cls.data ? (
          <>
            <div className="panel-head">
              <h3>{cls.data.name}</h3>
              <span className="small muted">кость хитов к{cls.data.hitDie}</span>
            </div>
            <div className="panel-pad stack small" style={{ gap: 6 }}>
              <div><span className="muted">Спасброски:</span> {cls.data.saves.map((a) => ABILITY_NAMES[a].full).join(', ')}</div>
              {cls.data.armor.length > 0 && <div><span className="muted">Доспехи:</span> {cls.data.armor.map(profName).join(', ')}</div>}
              {cls.data.weapons.length > 0 && <div><span className="muted">Оружие:</span> {cls.data.weapons.map(profName).join(', ')}</div>}
              <div>
                <span className="muted">Навыки:</span> {cls.data.skillChoices.pick} из {cls.data.skillChoices.from.map((s) => SKILLS[s]?.name ?? s).join(', ')}
              </div>
              {cls.data.subclasses.length > 0 && (
                <div>
                  <span className="muted">Подкласс:</span> на {cls.data.subclassLevel} уровне — {cls.data.subclasses.map((s) => s.name).join(', ')}
                </div>
              )}
            </div>
            <div className="panel-head" style={{ borderTop: '1px solid var(--line)' }}>
              <span className="caps">Умения 1-го уровня</span>
            </div>
            <FeatureList features={lvl1} />
          </>
        ) : (
          <Empty title="Выберите класс">Умения, хиты и владения подставятся сами; дальше лист сам подскажет, что открывается с уровнем.</Empty>
        )}
      </div>
    </div>
  );
}

function AbilitiesStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const sheet = view.sheet;
  const [method, setMethod] = useState<'standard' | 'points' | 'roll' | 'manual'>('standard');
  const [rolled, setRolled] = useState<number[]>([]);
  const set = (a: Ability, v: number) => save((d) => ({ ...d, baseAbilities: { ...d.baseAbilities, [a]: v } }));
  const points = ABILITIES.reduce((s, a) => s + (POINT_COST[c.baseAbilities[a]] ?? 99), 0);
  const pool = method === 'standard' ? STANDARD : method === 'roll' ? rolled : [];
  const used = (v: number, a: Ability) => {
    // Значение из набора занято, если его уже назначили другой характеристике (с учётом повторов)
    const taken = ABILITIES.filter((x) => x !== a && c.baseAbilities[x] === v).length;
    return taken >= pool.filter((p) => p === v).length;
  };
  const roll4d6 = () =>
    Array.from({ length: 6 }, () => {
      const dice = Array.from({ length: 4 }, () => rollDice('1к6').total);
      return dice.reduce((s, x) => s + x, 0) - Math.min(...dice);
    }).sort((a, b) => b - a);
  const abilityChoices = sheet.pendingChoices.filter((p) => p.kind === 'ability');

  return (
    <div className="stack-lg">
      <div className="row wrap between">
        <Segmented
          options={[
            { id: 'standard', label: 'Стандартный набор' },
            { id: 'points', label: 'Покупка очками' },
            { id: 'roll', label: 'Бросок 4к6' },
            { id: 'manual', label: 'Вручную' },
          ]}
          value={method}
          onChange={(m) => {
            setMethod(m);
            if (m === 'points') save((d) => ({ ...d, baseAbilities: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } }));
            if (m === 'roll' && !rolled.length) setRolled(roll4d6());
          }}
        />
        {method === 'roll' && (
          <button className="btn sm" onClick={() => setRolled(roll4d6())}>
            <Dices /> Перебросить: {rolled.join(', ')}
          </button>
        )}
      </div>
      <p className="small muted">
        {method === 'standard' && 'Раздайте 15, 14, 13, 12, 10 и 8 — каждое значение по одному разу.'}
        {method === 'points' && <span className={points > 27 ? 'error-text' : ''}>Потрачено {points} из 27 очков. До бонусов расы — от 8 до 15.</span>}
        {method === 'roll' && 'Брошено 4к6 шесть раз, худший кубик отброшен. Раздайте результаты.'}
        {method === 'manual' && 'Впишите значения до бонусов расы.'}
        {' '}Бонусы расы и итог считаются сами.
      </p>
      <div className="ability-edit">
        {ABILITIES.map((a) => {
          const base = c.baseAbilities[a];
          const final = sheet.abilities[a].score;
          return (
            <div key={a} className="cell">
              <div className="caps">{ABILITY_NAMES[a].full}</div>
              {pool.length ? (
                <select className="select sm" style={{ margin: '6px 0' }} value={pool.includes(base) ? base : ''} onChange={(e) => set(a, Number(e.target.value))}>
                  <option value="">—</option>
                  {[...new Set(pool)].map((v) => (
                    <option key={v} value={v} disabled={used(v, a) && base !== v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : method === 'points' ? (
                <div className="row" style={{ justifyContent: 'center', margin: '6px 0' }}>
                  <button className="btn xs icon" disabled={base <= 8} onClick={() => set(a, base - 1)}>−</button>
                  <b className="num" style={{ width: 22 }}>{base}</b>
                  <button className="btn xs icon" disabled={base >= 15} onClick={() => set(a, base + 1)}>+</button>
                </div>
              ) : (
                <input className="input num" style={{ margin: '6px 0' }} type="number" min={1} max={30} value={base} onChange={(e) => set(a, Number(e.target.value) || 1)} />
              )}
              <div className="small">
                {final !== base && <span className="accent-text">{signed(final - base)} → </span>}
                <b className="num">{final}</b> <span className="muted">({signed(abilityMod(final))})</span>
              </div>
            </div>
          );
        })}
      </div>
      {abilityChoices.map((p) => (
        <ChoiceRow key={p.id} p={p} sheet={sheet} data={c} update={save} />
      ))}
      <ChosenList data={c} update={save} only={(id) => (c.choices[id] ?? []).every((v) => (ABILITIES as readonly string[]).includes(v))} />
    </div>
  );
}

function ChoicesStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const sheet = view.sheet;
  const pending = sheet.pendingChoices;
  return (
    <div className="stack-lg">
      {pending.length ? (
        pending.map((p) => <ChoiceRow key={p.id} p={p} sheet={sheet} data={c} update={save} />)
      ) : (
        <div className="pending good-soft">Все выборы сделаны.</div>
      )}
      <ChosenList data={c} update={save} />
    </div>
  );
}

function DescriptionStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const text = (key: 'name' | 'background' | 'alignment' | 'appearance' | 'backstory') => ({
    defaultValue: c[key] ?? '',
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => save((d) => ({ ...d, [key]: e.target.value })),
  });
  return (
    <div className="stack">
      <div className="grid grid-3">
        <Field label="Имя">
          <input className="input" {...text('name')} />
        </Field>
        <Field label="Предыстория">
          <input className="input" placeholder="Например, Прислужник" {...text('background')} />
        </Field>
        <Field label="Мировоззрение">
          <input className="input" placeholder="Например, Нейтрально-добрый" {...text('alignment')} />
        </Field>
      </div>
      <Field label="Внешность">
        <textarea className="textarea" rows={3} {...text('appearance')} />
      </Field>
      <Field label="История">
        <textarea className="textarea" rows={5} {...text('backstory')} />
      </Field>
    </div>
  );
}
