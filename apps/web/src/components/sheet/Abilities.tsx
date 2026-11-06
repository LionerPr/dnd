import { ABILITY_NAMES, type Ability, type Character, type Sheet } from '@dnd/rules-engine';
import { profName, signed } from '../../lib/format';
import { NumberInput } from '../ui';

/** Режим правки листа: значения характеристик и владения навыками меняются прямо здесь */
export interface SheetEdit {
  c: Character;
  save: (u: (c: Character) => Character) => void;
}

const without = (list: string[] | undefined, k: string) => (list ?? []).filter((x) => x !== k);
const withK = (list: string[] | undefined, k: string) => [...without(list, k), k];

/** Нет владения → владение → компетентность → нет владения */
function cycleSkill(d: Character, key: string, state: 'none' | 'prof' | 'exp'): Character {
  const ch = { ...d.choices };
  if (state === 'none') {
    ch['manual.skills'] = withK(ch['manual.skills'], key);
    ch['manual.skillsOff'] = without(ch['manual.skillsOff'], key);
  } else if (state === 'prof') {
    ch['manual.expertise'] = withK(ch['manual.expertise'], key);
  } else {
    ch['manual.skills'] = without(ch['manual.skills'], key);
    ch['manual.expertise'] = without(ch['manual.expertise'], key);
    ch['manual.skillsOff'] = withK(ch['manual.skillsOff'], key);
  }
  const overrides = { ...d.overrides };
  delete overrides[`skill.${key}`];
  return { ...d, choices: ch, overrides };
}

function toggleSave(d: Character, a: string, on: boolean): Character {
  const ch = { ...d.choices };
  if (on) {
    ch['manual.saves'] = without(ch['manual.saves'], a);
    ch['manual.savesOff'] = withK(ch['manual.savesOff'], a);
  } else {
    ch['manual.saves'] = withK(ch['manual.saves'], a);
    ch['manual.savesOff'] = without(ch['manual.savesOff'], a);
  }
  const overrides = { ...d.overrides };
  delete overrides[`save.${a}`];
  return { ...d, choices: ch, overrides };
}

type Roll = (formula: string, label: string) => unknown;
const f = (bonus: number) => `1к20${bonus >= 0 ? '+' : ''}${bonus}`;

/** Как на бумажном листе: характеристики с навыками под каждой; колонки уравновешены по числу навыков */
const COLUMNS: Ability[][] = [
  ['str', 'con', 'int', 'cha'],
  ['dex', 'wis'],
];

const ARMOR = [
  ['light', 'Лёгкие'],
  ['medium', 'Средние'],
  ['heavy', 'Тяжёлые'],
  ['shield', 'Щит'],
] as const;
const WEAPON = [
  ['simple', 'Простое'],
  ['martial', 'Воинское'],
] as const;

function AbilityBlock({ a, sheet, roll, edit }: { a: Ability; sheet: Sheet; roll: Roll; edit?: SheetEdit }) {
  const v = sheet.abilities[a];
  const name = ABILITY_NAMES[a].full;
  const skills = sheet.skills.filter((s) => s.ability === a);
  return (
    <section className="ab-block">
      <header>
        <h3>{name}</h3>
        <i />
        {edit ? (
          <NumberInput
            value={v.score}
            min={1}
            max={30}
            style={{ width: 64 }}
            aria-label={name}
            // Итог = основа + бонусы; меняем основу на ту же разницу
            onChange={(n) => edit.save((d) => ({ ...d, baseAbilities: { ...d.baseAbilities, [a]: Math.max(1, d.baseAbilities[a] + n - v.score) } }))}
          />
        ) : (
          <span className="score num">{v.score}</span>
        )}
      </header>
      <div className="ab-rolls">
        <button className="ab-roll" onClick={() => roll(f(v.mod), `Проверка: ${name}`)}>
          <span>Проверка</span>
          <b>{signed(v.mod)}</b>
        </button>
        <button
          className={`ab-roll${edit ? ' editing' : ''}`}
          title={edit ? 'Нажмите, чтобы добавить или убрать владение спасброском' : undefined}
          onClick={() => (edit ? edit.save((d) => toggleSave(d, a, v.saveProficient)) : roll(f(v.save), `Спасбросок: ${name}`))}
        >
          <span>
            <i className={`prof-dot ${v.saveProficient ? 'on' : ''}`} title={v.saveProficient ? 'Владение' : undefined} /> Спасбросок
          </span>
          <b>{signed(v.save)}</b>
        </button>
      </div>
      {skills.map((s) => (
        <button
          key={s.key}
          className={`ab-skill${s.proficient ? ' on' : ''}${edit ? ' editing' : ''}`}
          title={edit ? 'Нажмите: владение → компетентность → без владения' : undefined}
          onClick={() => (edit ? edit.save((d) => cycleSkill(d, s.key, s.expertise ? 'exp' : s.proficient ? 'prof' : 'none')) : roll(f(s.bonus), s.name))}
        >
          <i className={`prof-dot ${s.expertise ? 'exp' : s.proficient ? 'on' : ''}`} title={s.expertise ? 'Компетентность' : s.proficient ? 'Владение' : undefined} />
          <span>{s.name}</span>
          <b>{signed(s.bonus)}</b>
        </button>
      ))}
    </section>
  );
}

function Proficiencies({ sheet }: { sheet: Sheet }) {
  const p = sheet.proficiencies;
  const skill = (k: string) => sheet.skills.find((s) => s.key === k)?.bonus ?? 0;
  const otherWeapons = p.weapon.filter((w) => w !== 'simple' && w !== 'martial');
  return (
    <section className="ab-extra">
      <div className="caps">Пассивные чувства</div>
      <div className="senses">
        <span title="Пассивная Мудрость (Восприятие)">Восприятие <b>{sheet.passivePerception}</b></span>
        <span title="Пассивная Мудрость (Проницательность)">Проницательность <b>{10 + skill('insight')}</b></span>
        <span title="Пассивный Интеллект (Анализ)">Анализ <b>{10 + skill('investigation')}</b></span>
        {sheet.darkvision > 0 && <span>Тёмное зрение <b>{sheet.darkvision} фт</b></span>}
      </div>

      <div className="caps">Доспехи</div>
      <div className="row wrap" style={{ gap: 4 }}>
        {ARMOR.map(([k, label]) => (
          <span key={k} className={`chip small${p.armor.includes(k) ? ' accent' : ' off'}`}>{label}</span>
        ))}
      </div>
      <div className="caps">Оружие</div>
      <div className="row wrap" style={{ gap: 4 }}>
        {WEAPON.map(([k, label]) => (
          <span key={k} className={`chip small${p.weapon.includes(k) ? ' accent' : ' off'}`}>{label}</span>
        ))}
        {otherWeapons.map((w) => (
          <span key={w} className="chip small accent">{w}</span>
        ))}
      </div>
      {p.tool.length > 0 && (
        <>
          <div className="caps">Инструменты</div>
          <div className="row wrap" style={{ gap: 4 }}>
            {p.tool.map((t) => (
              <span key={t} className="chip small accent">{profName(t)}</span>
            ))}
          </div>
        </>
      )}
      <div className="caps">Языки</div>
      <div className="row wrap" style={{ gap: 4 }}>
        {p.language.length ? p.language.map((l) => <span key={l} className="chip small accent">{l}</span>) : <span className="small muted">Не выбраны</span>}
        {sheet.pendingChoices.some((c) => c.kind === 'language') && <span className="chip small dim">+ на выбор в конструкторе</span>}
      </div>
    </section>
  );
}

export function Abilities({ sheet, roll, edit }: { sheet: Sheet; roll: Roll; edit?: SheetEdit }) {
  return (
    <div className="ab-grid">
      {COLUMNS.map((col, i) => (
        <div key={i} className="ab-col">
          {col.map((a) => (
            <AbilityBlock key={a} a={a} sheet={sheet} roll={roll} edit={edit} />
          ))}
          {i === 1 && <Proficiencies sheet={sheet} />}
        </div>
      ))}
    </div>
  );
}
