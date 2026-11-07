import {
  ABILITIES,
  ABILITY_NAMES,
  ARTISAN_TOOLS,
  BACKGROUNDS,
  EDITIONS,
  editionOf,
  GAMING_SETS,
  LANGUAGES,
  SKILLS,
  abilityMod,
  backgroundById,
  kitItems,
  parseKit,
  roll as rollDice,
  type Ability,
  type Character,
  type CharacterClass,
  type Edition,
  type FeatureFrom,
  type InventoryEntry,
  type Race,
  type Sheet,
  type Skill,
} from '@dnd/rules-engine';
import { ArrowLeft, ArrowRight, Check, Dices, Search } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CharacterView, ContentRow } from '../api/client';
import { ChoiceRow, ChosenList, optionLabel } from '../components/sheet/Choices';
import { FeatureList } from '../components/sheet/FeaturesTab';
import { SpellChooser } from '../components/sheet/SpellChooser';
import { Empty, Field, Loading, Segmented } from '../components/ui';
import { bookShort, profName, searchKey, signed } from '../lib/format';
import { useCharacter, useCommand, useContentItem, useContentList, useSaveBuild } from '../lib/hooks';

type Save = (u: (c: Character) => Character) => void;
const STEPS = ['Правила', 'Класс', 'Раса и предыстория', 'Характеристики', 'Мастерство', 'Снаряжение', 'Заклинания', 'Описание'] as const;

const STANDARD = [15, 14, 13, 12, 10, 8];
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

/** Подсказки для карточек классов: главная характеристика и насколько класс сложен новичку */
const CLASS_HINTS: Record<string, { main: string; level: 1 | 2 | 3 }> = {
  варвар: { main: 'Сила', level: 1 },
  воин: { main: 'Сила или Ловкость', level: 1 },
  плут: { main: 'Ловкость', level: 1 },
  монах: { main: 'Ловкость и Мудрость', level: 2 },
  паладин: { main: 'Сила и Харизма', level: 2 },
  следопыт: { main: 'Ловкость и Мудрость', level: 2 },
  жрец: { main: 'Мудрость', level: 2 },
  бард: { main: 'Харизма', level: 2 },
  друид: { main: 'Мудрость', level: 3 },
  колдун: { main: 'Харизма', level: 3 },
  чародей: { main: 'Харизма', level: 3 },
  волшебник: { main: 'Интеллект', level: 3 },
  изобретатель: { main: 'Интеллект', level: 3 },
};
const LEVEL_NAME = { 1: 'простой', 2: 'средний', 3: 'сложный' } as const;

const ALIGNMENTS = [
  'Законно-добрый', 'Нейтрально-добрый', 'Хаотично-добрый',
  'Законно-нейтральный', 'Истинно нейтральный', 'Хаотично-нейтральный',
  'Законно-злой', 'Нейтрально-злой', 'Хаотично-злой',
];

export const FROM_LABEL: Record<FeatureFrom, string> = {
  class: 'Класс', race: 'Раса', background: 'Предыстория', feat: 'Черта', custom: 'Своё', item: 'Предмет',
};

/** Пошаговое создание: класс → раса и предыстория → характеристики → мастерство → снаряжение → описание. Всё сохраняется сразу. */
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
  const proficiencyLeft = view.sheet.pendingChoices.length;
  const done = [!!c.edition, c.classes.length > 0, !!c.raceId, true, proficiencyLeft === 0, !!c.choices['kit.done'], c.spellsKnown.length > 0 || !view.sheet.casters.length, true];
  const canNext = step === 1 ? done[1] : step === 2 ? done[2] : true;

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
          <li key={s} className={`${i === step ? 'on' : ''} ${done[i] && i !== step ? 'done' : ''}`}>
            <button onClick={() => setStep(i)}>
              <span className="n">{done[i] && i !== step ? <Check size={14} /> : i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && <RulesStep view={view} save={save} />}
      {step === 1 && <ClassStep view={view} save={save} />}
      {step === 2 && <OriginStep view={view} save={save} />}
      {step === 3 && <AbilitiesStep view={view} save={save} />}
      {step === 4 && <MasteryStep view={view} save={save} />}
      {step === 5 && <EquipmentStep view={view} save={save} />}
      {step === 6 && <SpellsStep view={view} save={save} />}
      {step === 7 && <DescriptionStep view={view} save={save} />}

      <div className="save-bar">
        {step > 0 && (
          <button className="btn" onClick={() => setStep(step - 1)}>
            <ArrowLeft /> Назад
          </button>
        )}
        <span className="grow" />
        {step === 4 && proficiencyLeft > 0 && <span className="small muted">Не выбрано: {proficiencyLeft}. Можно закончить позже.</span>}
        {step < STEPS.length - 1 ? (
          <button className="btn accent" disabled={!canNext} onClick={() => setStep(step + 1)}>
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

const short = (a: string) => ABILITY_NAMES[a as Ability]?.short ?? a;

// ---------- Правила ----------

/** Запись подходит изданию персонажа (без поля — 2014) */
export const inEdition = (r: { data?: { edition?: Edition } }, ed: Edition) => editionOf(r.data) === ed;

function RulesStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const ed = editionOf(c);
  const pick = (id: Edition) =>
    save((d) => {
      if (editionOf(d) === id) return { ...d, edition: id };
      // Класс, раса и предыстория другого издания не подходят — начинаем выбор заново
      return { ...d, edition: id, classes: [], raceId: undefined, subraceId: undefined, backgroundId: undefined, choices: {}, hpRolls: [] };
    });
  return (
    <div className="stack-lg">
      <h2 className="step-title">Редакция правил</h2>
      <div className="card-grid wide">
        {EDITIONS.map((e) => (
          <button key={e.id} className={`pick-card edition-card${c.edition && ed === e.id ? ' on' : ''}`} onClick={() => pick(e.id)}>
            <b>{e.name}</b>
            <span className="muted">{e.note}</span>
          </button>
        ))}
      </div>
      <p className="small muted">
        Дальше будут только классы, расы (в 2024 — виды), предыстории и черты выбранного издания. В 2024 характеристики растут от предыстории, а не от вида, и
        предыстория даёт черту происхождения. Классы и виды 2024 — из открытого SRD 5.2 (© Wizards of the Coast, CC-BY 4.0, перевод — открытый набор Long Story Short).
        {(c.classes.length > 0 || c.raceId) && ' Смена издания сбросит уже выбранные класс, расу и предысторию.'}
      </p>
    </div>
  );
}

// ---------- Класс ----------

function ClassStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const classes = useContentList('class');
  const current = c.classes[0];
  const cls = useContentItem<CharacterClass>(current?.classId);
  const lvl1 = cls.data?.features.filter((f) => (f.level ?? 1) <= 1 && !f.optional) ?? [];
  const items = (classes.data?.items ?? []).filter((r) => inEdition(r, editionOf(c)));
  return (
    <div className="stack-lg">
      <div className="card-grid">
        {items.map((r) => {
          const h = r.data?.hint as CharacterClass['hint'];
          const hint = h
            ? { main: h.main.map((g) => g.map((a) => ABILITY_NAMES[a].full).join(' и ')).join(' или '), level: (Math.min(2, h.complexity) + 1) as 1 | 2 | 3 }
            : CLASS_HINTS[r.name.toLowerCase()];
          return (
            <button
              key={r.id}
              className={`pick-card${current?.classId === r.id ? ' on' : ''}`}
              onClick={() => save((d) => ({ ...d, classes: [{ classId: r.id, level: 1 }, ...d.classes.slice(1)], hpRolls: [] }))}
            >
              <span className="pick-card-head">
                <b>{r.name}</b>
                {r.data?.hitDie && <span className="die">к{r.data.hitDie}</span>}
              </span>
              <span className="pick-card-body">
                {hint && <span>★ {hint.main}</span>}
                {r.data?.saves?.length > 0 && <span className="muted">спасброски: {r.data.saves.map(short).join(', ')}</span>}
              </span>
              <span className="pick-card-foot">
                {hint && (
                  <span className={`level-dot l${hint.level}`}>
                    <i /> {LEVEL_NAME[hint.level]}
                  </span>
                )}
                {r.source_url?.includes('/homebrew/') && <span className="tag">самодельный</span>}
              </span>
            </button>
          );
        })}
        {!items.length && <p className="small muted">Классов пока нет. Их добавляют в «Библиотеке».</p>}
      </div>
      {cls.data && (
        <div className="panel">
          <div className="panel-head">
            <h3>{cls.data.name}</h3>
            <span className="small muted">кость хитов к{cls.data.hitDie}</span>
          </div>
          <div className="panel-pad stack small" style={{ gap: 6 }}>
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
        </div>
      )}
    </div>
  );
}

// ---------- Раса, предыстория, мировоззрение ----------

function OriginStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const races = useContentList('race');
  const race = useContentItem<Race>(c.raceId);
  const { input, match } = useFilter();
  const [homebrew, setHomebrew] = useState(false);
  const ed = editionOf(c);
  const allRaces = races.data?.items ?? [];
  const current = allRaces.filter((r) => inEdition(r, ed));
  // В 2024 доступны и расы прошлых книг (кроме тех, что переизданы); их бонусы к характеристикам заменяет предыстория
  const names2024 = new Set(current.map((r) => r.name.toLowerCase().replace(/ё/g, 'е')));
  const legacy = ed === '2024' ? allRaces.filter((r) => !inEdition(r, '2024') && !names2024.has(r.name.toLowerCase().replace(/ё/g, 'е'))) : [];
  const all = [...current, ...legacy];
  const legacyIds = new Set(legacy.map((r) => r.id));
  const items = all.filter((r) => match(r.name) && (homebrew || !r.source_url?.includes('/homebrew/') || r.id === c.raceId));
  const hasHomebrew = all.some((r) => r.source_url?.includes('/homebrew/'));
  const custom = !c.backgroundId && !!c.background;

  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="row wrap between">
          <h2 className="step-title">{ed === '2024' ? 'Вид' : 'Раса'}</h2>
          <div className="row" style={{ gap: 8 }}>
            {hasHomebrew && (
              <label className="check small">
                <input type="checkbox" checked={homebrew} onChange={(e) => setHomebrew(e.target.checked)} /> самодельные
              </label>
            )}
            {input}
          </div>
        </div>
        <div className="card-grid scroll">
          {items.map((r, i) => (
            <Fragment key={r.id}>
              {legacyIds.has(r.id) && !legacyIds.has(items[i - 1]?.id ?? '') && (
                <p className="small muted" style={{ gridColumn: '1 / -1', margin: '8px 0 0' }}>
                  Расы из книг 2014 года. По правилам 2024 их увеличение характеристик не действует — его даёт предыстория.
                </p>
              )}
              <RaceCard r={r} on={c.raceId === r.id} onPick={() => save((d) => ({ ...d, raceId: r.id, subraceId: undefined }))} />
            </Fragment>
          ))}
          {!items.length && <p className="small muted">Ничего не нашлось. Расы добавляются в «Библиотеке».</p>}
        </div>
        {race.data && (
          <div className="panel">
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
          </div>
        )}
      </section>

      <section className="stack">
        <h2 className="step-title">Предыстория</h2>
        <div className="card-grid wide">
          {BACKGROUNDS.filter((b) => (b.edition ?? '2014') === ed).map((b) => (
            <button
              key={b.id}
              className={`pick-card${c.backgroundId === b.id ? ' on' : ''}`}
              onClick={() => save((d) => ({ ...d, backgroundId: b.id, background: b.name }))}
            >
              <span className="pick-card-head">
                <b>{b.name}</b>
              </span>
              <span className="row wrap" style={{ gap: 4 }}>
                {b.skills.map((s) => (
                  <span key={s} className="src-tag src-race on">{SKILLS[s].name}</span>
                ))}
                {(b.tools ?? []).map((t) => (
                  <span key={t} className="src-tag src-class on">{profName(t)}</span>
                ))}
                {b.toolChoice && <span className="src-tag src-class">{b.toolChoice.of === GAMING_SETS ? 'игровой набор' : 'инструменты ремесленника'} на выбор</span>}
                {b.languages ? <span className="src-tag src-class">{b.languages === 1 ? 'язык' : `${b.languages} языка`} на выбор</span> : null}
                {b.abilityPool && <span className="src-tag src-background">+3 к {b.abilityPool.options.map((a) => ABILITY_NAMES[a].short).join(', ')}</span>}
              </span>
              <span className="small muted">{b.feature.name}</span>
            </button>
          ))}
          <button className={`pick-card${custom ? ' on' : ''}`} onClick={() => save((d) => ({ ...d, backgroundId: undefined, background: d.background || 'Своя предыстория' }))}>
            <span className="pick-card-head">
              <b>Своя</b>
            </span>
            <span className="small muted">Без готовых владений: впишите название, навыки добавит мастер или вы сами в конструкторе.</span>
          </button>
        </div>
        {custom && (
          <Field label="Название предыстории">
            <input className="input" defaultValue={c.background} onBlur={(e) => save((d) => ({ ...d, background: e.target.value }))} />
          </Field>
        )}
        {c.backgroundId && <FeatureList features={view.sheet.features.filter((f) => f.from === 'background')} />}
      </section>

      <section className="stack">
        <h2 className="step-title">Мировоззрение</h2>
        <div className="align-grid">
          {ALIGNMENTS.map((a) => (
            <button key={a} className={`btn${c.alignment === a ? ' accent' : ''}`} onClick={() => save((d) => ({ ...d, alignment: d.alignment === a ? undefined : a }))}>
              {a}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function RaceCard({ r, on, onPick }: { r: ContentRow; on: boolean; onPick: () => void }) {
  const d = r.data ?? {};
  return (
    <button className={`pick-card${on ? ' on' : ''}`} onClick={onPick}>
      <span className="pick-card-head">
        <b>{r.name}</b>
        {d.book && <span className="tag">{bookShort(d.book)}</span>}
      </span>
      <span className="small muted">
        {[d.speed && `скорость ${d.speed} фт`, d.subraceCount > 0 && `разновидностей: ${d.subraceCount}`].filter(Boolean).join(' · ')}
      </span>
      {r.source_url?.includes('/homebrew/') && <span className="tag">самодельная</span>}
    </button>
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

// ---------- Мастерство: навыки, инструменты, языки и другие выборы ----------

type Group = Sheet['choiceGroups'][number];

function toggleChoice(save: Save, g: Group, value: string) {
  save((d) => {
    const cur = d.choices[g.id] ?? [];
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : cur.length < g.pick ? [...cur, value] : cur;
    return { ...d, choices: { ...d.choices, [g.id]: next } };
  });
}

function Counter({ g }: { g: Group }) {
  const full = g.chosen.length >= g.pick;
  return (
    <span className={`src-pill src-${g.from}${full ? ' full' : ''}`} title={g.origin}>
      {FROM_LABEL[g.from]}
      {g.from !== 'class' && g.from !== 'background' ? ` · ${g.origin}` : ''} <b>{g.chosen.length} / {g.pick}</b>
    </span>
  );
}

function MasteryStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const sheet = view.sheet;
  const groups = sheet.choiceGroups;
  const skillGroups = groups.filter((g) => g.kind === 'skill');
  const fixed = new Map(sheet.grants.filter((g) => g.kind === 'skill').map((g) => [g.id, g]));
  const chosenBy = new Map<string, Group>();
  for (const g of skillGroups) for (const s of g.chosen) chosenBy.set(s, g);
  const rows = sheet.skills;
  const fixedRows = rows.filter((s) => fixed.has(s.key));
  const otherRows = rows.filter((s) => !fixed.has(s.key));
  const otherGroups = groups.filter((g) => g.kind !== 'skill');
  const rest = sheet.pendingChoices.filter((p) => !['skill', 'tool', 'language', 'armor', 'weapon', 'ability'].includes(p.kind));

  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="row wrap between">
          <h2 className="step-title">Навыки</h2>
          <div className="row wrap" style={{ gap: 6 }}>
            {fixed.size > 0 && <span className="src-pill src-fixed">Даны сразу · <b>{fixed.size}</b></span>}
            {skillGroups.map((g) => (
              <Counter key={g.id} g={g} />
            ))}
          </div>
        </div>
        {!skillGroups.length && !fixed.size && <p className="small muted">Сначала выберите класс, расу и предысторию — тогда здесь появится, сколько навыков от чего можно взять.</p>}
        <div className="mastery">
          {fixedRows.map((s) => {
            const g = fixed.get(s.key)!;
            return (
              <div key={s.key} className="mastery-row fixed">
                <span className="name">
                  {s.name} <small>{short(s.ability)}</small>
                </span>
                <b className="num">{signed(s.bonus)}</b>
                <span className="tags">
                  <span className={`src-tag src-${g.from} on`}>{g.from === 'race' || g.from === 'feat' ? g.origin : FROM_LABEL[g.from]}</span>
                </span>
              </div>
            );
          })}
          {otherRows.map((s) => {
            const owner = chosenBy.get(s.key);
            const offers = skillGroups.filter((g) => g.of === 'any' || g.of.includes(s.key));
            return (
              <div key={s.key} className={`mastery-row${owner ? ' picked' : ''}`}>
                <span className="name">
                  {s.name} <small>{short(s.ability)}</small>
                </span>
                <b className="num">{signed(s.bonus)}</b>
                <span className="tags">
                  {offers.map((g) => {
                    const on = owner === g;
                    const blocked = !on && (!!owner || g.chosen.length >= g.pick);
                    return (
                      <button key={g.id} className={`src-tag src-${g.from}${on ? ' on' : ''}`} disabled={blocked} onClick={() => toggleChoice(save, g, s.key)} title={g.origin}>
                        {on ? '✓ ' : ''}
                        {FROM_LABEL[g.from]}
                      </button>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {otherGroups.length > 0 && (
        <section className="stack">
          <h2 className="step-title">Инструменты и языки</h2>
          {otherGroups.map((g) => (
            <GroupChips key={g.id} g={g} sheet={sheet} save={save} />
          ))}
        </section>
      )}
      <Granted sheet={sheet} />

      {rest.length > 0 && (
        <section className="stack">
          <h2 className="step-title">Другие выборы</h2>
          {rest.map((p) => (
            <ChoiceRow key={p.id} p={p} sheet={sheet} data={c} update={save} />
          ))}
        </section>
      )}
      <ChosenList data={c} update={save} only={(id) => !id.startsWith('kit.') && !groups.some((g) => g.id === id)} />
    </div>
  );
}

function GroupChips({ g, sheet, save }: { g: Group; sheet: Sheet; save: Save }) {
  const have = new Set(sheet.proficiencies[g.kind] ?? []);
  const options =
    g.of !== 'any'
      ? g.of
      : g.kind === 'language'
        ? LANGUAGES.map((l) => l.name)
        : g.kind === 'tool'
          ? [...ARTISAN_TOOLS, ...GAMING_SETS, 'tools.musical', 'tools.thieves', 'tools.herbalism', 'tools.disguise', 'tools.forgery', 'tools.navigator', 'tools.poisoner']
          : [];
  const exotic = new Set(LANGUAGES.filter((l) => l.exotic).map((l) => l.name));
  const full = g.chosen.length >= g.pick;
  return (
    <div className="pending">
      <div className="pending-title row wrap" style={{ gap: 8 }}>
        <b>{g.origin}</b>
        <span className="muted">{g.kind === 'language' ? 'языки' : g.kind === 'tool' ? 'инструменты' : profName(g.kind)}</span>
        <Counter g={g} />
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {options
          .filter((o) => g.chosen.includes(o) || !have.has(o))
          .map((o) => {
            const on = g.chosen.includes(o);
            return (
              <button key={o} className={`chip${on ? ' accent' : exotic.has(o) ? ' dim' : ''}`} disabled={!on && full} onClick={() => toggleChoice(save, g, o)}>
                {on && <Check size={12} />} {optionLabel(g.kind, o)}
              </button>
            );
          })}
      </div>
    </div>
  );
}

/** Что дано без выбора: спасброски, инструменты, языки — с источником */
function Granted({ sheet }: { sheet: Sheet }) {
  const seen = new Set<string>();
  const list = sheet.grants.filter((g) => {
    if (g.kind !== 'tool' && g.kind !== 'language' && g.kind !== 'save') return false;
    const key = `${g.kind}:${optionLabel(g.kind, g.id).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!list.length) return null;
  const label = (g: Sheet['grants'][number]) => (g.kind === 'save' ? `Спасбросок: ${ABILITY_NAMES[g.id as Ability]?.full ?? g.id}` : optionLabel(g.kind, g.id));
  return (
    <section className="stack" style={{ gap: 8 }}>
      <span className="caps">Уже есть</span>
      <div className="row wrap" style={{ gap: 6 }}>
        {list.map((g) => (
          <span key={`${g.kind}.${g.id}.${g.origin}`} className={`src-tag src-${g.from} on`} title={g.origin}>
            {label(g)}
          </span>
        ))}
      </div>
    </section>
  );
}

// ---------- Заклинания ----------

function SpellsStep({ view, save }: { view: CharacterView; save: Save }) {
  const { data: c, sheet } = view;
  if (!sheet.casters.length)
    return (
      <div className="stack-lg">
        <h2 className="step-title">Заклинания</h2>
        <Empty title="Этому классу заклинания не нужны">Если позже появятся заклинания от черты или подкласса, их можно добавить на вкладке «Заклинания» листа.</Empty>
      </div>
    );
  return (
    <div className="stack-lg">
      <div>
        <h2 className="step-title">Заклинания</h2>
        <p className="muted small">
          Здесь только заклинания вашего класса и только тех кругов, которые доступны на этом уровне. Счётчики показывают, сколько ещё можно взять.
          Нажмите на название, чтобы прочитать описание. Что-то сверх правил можно попросить у мастера на вкладке «Заклинания» листа.
        </p>
      </div>
      <SpellChooser data={c} sheet={sheet} update={save} />
    </div>
  );
}

// ---------- Снаряжение ----------

/** «кинжала» → «Кинжал»: ищем в каталоге по началу слова, без окончаний */
function findItem(items: ContentRow[], name: string) {
  const key = searchKey(name).replace(/[^а-яa-z0-9 ]/g, '').trim();
  const exact = items.find((r) => searchKey(r.name) === key);
  if (exact) return exact;
  const words = (t: string) => searchKey(t).split(/[^а-яa-z0-9]+/).filter((w) => w.length > 2);
  const qs = words(name);
  if (!qs.length) return undefined;
  const stem = (w: string) => w.slice(0, Math.max(4, w.length - 2));
  const same = (a: string, b: string) => a.startsWith(stem(b)) || b.startsWith(stem(a));
  // Все слова с обеих сторон должны совпасть по основе: «кинжала» ↔ «Кинжал», но не «набор взломщика» ↔ «Набор травника»
  return items.find((r) => {
    const rs = words(r.name);
    return rs.length > 0 && qs.every((q) => rs.some((x) => same(q, x))) && rs.every((x) => qs.some((q) => same(q, x)));
  });
}

function EquipmentStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const cmd = useCommand(view.id);
  const cls = useContentItem<CharacterClass>(c.classes[0]?.classId);
  const catalog = useContentList('item');
  const kit = useMemo(() => parseKit(cls.data?.equipment), [cls.data?.equipment]);
  const bg = backgroundById(c.backgroundId);
  const [mode, setMode] = useState<'kit' | 'gold'>('kit');
  const [bgGold, setBgGold] = useState(false);
  const fixedKit = cls.data?.kit;
  const [picks, setPicks] = useState<number[]>([]);
  const [gold, setGold] = useState<number | null>(null);
  const items = catalog.data?.items ?? [];

  // 2024: набор класса — готовый список и немного золота, либо только золото
  const fixed = fixedKit ? fixedKit[mode === 'kit' ? 0 : fixedKit.length - 1] : undefined;
  const classLines = fixed ? fixed.items.flatMap(kitItems) : mode === 'kit' ? kit.lines.map((l, i) => l.options[picks[i] ?? 0]!).flatMap(kitItems) : [];
  const bgLines = bgGold ? [] : (bg?.equipment ?? []).flatMap(kitItems);
  const entries = [...classLines, ...bgLines].map((x) => ({ ...x, row: findItem(items, x.name) }));
  const classMoney = fixed ? fixed.gold : mode === 'gold' ? gold ?? 0 : 0;
  const money = classMoney + (bgGold ? bg?.goldInstead ?? 0 : bg?.gold ?? 0);
  const already = !!c.choices['kit.done'];

  const apply = () => {
    const add: InventoryEntry[] = entries.map((e) => ({
      id: Math.random().toString(36).slice(2, 10),
      ...(e.row ? { itemId: e.row.id } : { name: e.name }),
      qty: e.qty,
    }));
    const put = () => save((d) => ({ ...d, inventory: [...d.inventory, ...add], choices: { ...d.choices, 'kit.done': ['1'] } }));
    if (money > 0) cmd.mutate({ type: 'money', delta: { gp: money } }, { onSuccess: put });
    else put();
  };

  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="row wrap between">
          <h2 className="step-title">От класса{cls.data ? `: ${cls.data.name}` : ''}</h2>
          {fixedKit && fixedKit.length > 1 && (
            <Segmented
              options={[
                { id: 'kit', label: `${fixedKit[0]!.label}${fixedKit[0]!.gold ? ` + ${fixedKit[0]!.gold} зм` : ''}` },
                { id: 'gold', label: `${fixedKit[fixedKit.length - 1]!.label}: ${fixedKit[fixedKit.length - 1]!.gold} зм` },
              ]}
              value={mode}
              onChange={setMode}
            />
          )}
          {!fixedKit && kit.gold && (
            <Segmented
              options={[
                { id: 'kit', label: 'Снаряжение' },
                { id: 'gold', label: `Золото: ${kit.gold.dice}${kit.gold.times > 1 ? ` × ${kit.gold.times}` : ''} зм` },
              ]}
              value={mode}
              onChange={(m) => {
                setMode(m);
                if (m === 'gold' && gold === null && kit.gold) setGold(rollDice(kit.gold.dice).total * kit.gold.times);
              }}
            />
          )}
        </div>
        {fixed ? (
          fixed.items.length > 0 && <div className="small">{fixed.items.join(', ')}</div>
        ) : !cls.data?.equipment && <p className="small muted">У класса нет списка снаряжения (импортируйте класс заново) — добавьте вещи во вкладке «Снаряжение» листа.</p>}
        {fixed ? null : mode === 'kit' ? (
          <div className="stack" style={{ gap: 8 }}>
            {kit.lines.map((l, i) =>
              l.options.length > 1 ? (
                <div key={i} className="row wrap" style={{ gap: 6 }}>
                  {l.options.map((o, j) => (
                    <button key={o} className={`chip${(picks[i] ?? 0) === j ? ' accent' : ''}`} onClick={() => setPicks((p) => Object.assign([...p], { [i]: j }))}>
                      {(picks[i] ?? 0) === j && <Check size={12} />} {o}
                    </button>
                  ))}
                </div>
              ) : (
                <div key={i} className="small">• {l.options[0]}</div>
              ),
            )}
          </div>
        ) : (
          kit.gold && (
            <div className="row" style={{ gap: 10 }}>
              <b className="num" style={{ fontSize: 22 }}>{gold ?? '—'} зм</b>
              <button className="btn sm" onClick={() => setGold(rollDice(kit.gold!.dice).total * kit.gold!.times)}>
                <Dices /> Перебросить
              </button>
              <span className="small muted">Вместо снаряжения класса — купите сами во вкладке «Снаряжение».</span>
            </div>
          )
        )}
      </section>

      <section className="stack">
        <div className="row wrap between">
          <h2 className="step-title">От предыстории{bg ? `: ${bg.name}` : ''}</h2>
          {bg?.goldInstead && (
            <Segmented
              options={[
                { id: 'kit', label: `Снаряжение + ${bg.gold} зм` },
                { id: 'gold', label: `Золото: ${bg.goldInstead} зм` },
              ]}
              value={bgGold ? 'gold' : 'kit'}
              onChange={(m) => setBgGold(m === 'gold')}
            />
          )}
        </div>
        {bg ? (
          <div className="small">
            {bg.equipment.join(', ')} <span className="accent-text">+ {bg.gold} зм</span>
          </div>
        ) : (
          <p className="small muted">Выберите предысторию на шаге «Раса и предыстория», чтобы получить её снаряжение.</p>
        )}
      </section>

      {(entries.length > 0 || money > 0) && (
        <section className="panel panel-pad stack" style={{ gap: 10 }}>
          <span className="caps">Попадёт в инвентарь</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {entries.map((e, i) => (
              <span key={i} className={`chip${e.row ? ' good' : ''}`} title={e.row ? `Из каталога: ${e.row.name}` : 'Своя запись — без характеристик'}>
                {e.row ? e.row.name : e.name}
                {e.qty > 1 ? ` × ${e.qty}` : ''}
              </span>
            ))}
            {money > 0 && <span className="chip accent">{money} зм</span>}
          </div>
          <p className="small muted">Зелёные найдены в каталоге — у оружия и доспехов сразу будут урон и КД. «Любое простое оружие» и подобное замените во вкладке «Снаряжение».</p>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn accent" disabled={cmd.isPending} onClick={apply}>
              <Check /> {already ? 'Положить ещё раз' : 'Положить в инвентарь'}
            </button>
            {already && <span className="small good-text">Снаряжение уже в инвентаре.</span>}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------- Описание ----------

function DescriptionStep({ view, save }: { view: CharacterView; save: Save }) {
  const c = view.data;
  const text = (key: 'name' | 'appearance' | 'backstory') => ({
    defaultValue: c[key] ?? '',
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => save((d) => ({ ...d, [key]: e.target.value })),
  });
  return (
    <div className="stack">
      <Field label="Имя">
        <input className="input" {...text('name')} />
      </Field>
      <Field label="Внешность">
        <textarea className="textarea" rows={3} {...text('appearance')} />
      </Field>
      <Field label="История">
        <textarea className="textarea" rows={5} {...text('backstory')} />
      </Field>
    </div>
  );
}
