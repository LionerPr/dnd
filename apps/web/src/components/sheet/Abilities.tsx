import { ABILITY_NAMES, type Ability, type Sheet } from '@dnd/rules-engine';
import { profName, signed } from '../../lib/format';

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

function AbilityBlock({ a, sheet, roll }: { a: Ability; sheet: Sheet; roll: Roll }) {
  const v = sheet.abilities[a];
  const name = ABILITY_NAMES[a].full;
  const skills = sheet.skills.filter((s) => s.ability === a);
  return (
    <section className="ab-block">
      <header>
        <h3>{name}</h3>
        <i />
        <span className="score num">{v.score}</span>
      </header>
      <div className="ab-rolls">
        <button className="ab-roll" onClick={() => roll(f(v.mod), `Проверка: ${name}`)}>
          <span>Проверка</span>
          <b>{signed(v.mod)}</b>
        </button>
        <button className="ab-roll" onClick={() => roll(f(v.save), `Спасбросок: ${name}`)}>
          <span>
            <i className={`prof-dot ${v.saveProficient ? 'on' : ''}`} title={v.saveProficient ? 'Владение' : undefined} /> Спасбросок
          </span>
          <b>{signed(v.save)}</b>
        </button>
      </div>
      {skills.map((s) => (
        <button key={s.key} className={`ab-skill${s.proficient ? ' on' : ''}`} onClick={() => roll(f(s.bonus), s.name)}>
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

export function Abilities({ sheet, roll }: { sheet: Sheet; roll: Roll }) {
  return (
    <div className="ab-grid">
      {COLUMNS.map((col, i) => (
        <div key={i} className="ab-col">
          {col.map((a) => (
            <AbilityBlock key={a} a={a} sheet={sheet} roll={roll} />
          ))}
          {i === 1 && <Proficiencies sheet={sheet} />}
        </div>
      ))}
    </div>
  );
}
