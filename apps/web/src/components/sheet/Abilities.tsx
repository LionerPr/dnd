import { ABILITIES, ABILITY_NAMES, type Sheet } from '@dnd/rules-engine';
import { signed } from '../../lib/format';

type Roll = (formula: string, label: string) => unknown;
const f = (bonus: number) => `1к20${bonus >= 0 ? '+' : ''}${bonus}`;

export function Abilities({ sheet, roll }: { sheet: Sheet; roll: Roll }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="abilities">
        {ABILITIES.map((a) => {
          const v = sheet.abilities[a];
          return (
            <button key={a} className="ability" onClick={() => roll(f(v.mod), `Проверка: ${ABILITY_NAMES[a].full}`)} title={`Проверка ${ABILITY_NAMES[a].full}`}>
              <div className="ab">{ABILITY_NAMES[a].short}</div>
              <div className="mod">{signed(v.mod)}</div>
              <div className="score num">{v.score}</div>
            </button>
          );
        })}
      </div>

      <div className="panel">
        <div className="panel-head" style={{ padding: '10px 14px' }}>
          <span className="caps">Спасброски</span>
        </div>
        <div className="skill-list" style={{ padding: '4px 0' }}>
          {ABILITIES.map((a) => {
            const v = sheet.abilities[a];
            return (
              <button key={a} className="skill" onClick={() => roll(f(v.save), `Спасбросок: ${ABILITY_NAMES[a].full}`)}>
                <i className={`prof-dot ${v.saveProficient ? 'on' : ''}`} />
                <span className="ab">{ABILITY_NAMES[a].short}</span>
                <span>{ABILITY_NAMES[a].full}</span>
                <span className="bonus">{signed(v.save)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head" style={{ padding: '10px 14px' }}>
          <span className="caps">Навыки</span>
          <span className="small muted">пасс. восприятие {sheet.passivePerception}</span>
        </div>
        <div className="skill-list" style={{ padding: '4px 0' }}>
          {sheet.skills.map((s) => (
            <button key={s.key} className="skill" onClick={() => roll(f(s.bonus), s.name)}>
              <i className={`prof-dot ${s.expertise ? 'exp' : s.proficient ? 'on' : ''}`} title={s.expertise ? 'Компетентность' : s.proficient ? 'Владение' : ''} />
              <span className="ab">{ABILITY_NAMES[s.ability].short}</span>
              <span>{s.name}</span>
              <span className="bonus">{signed(s.bonus)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
