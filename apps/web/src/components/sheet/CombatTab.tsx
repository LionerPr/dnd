import { Hand, Swords } from 'lucide-react';
import type { CharacterView, Command } from '../../api/client';
import { damageName, signed } from '../../lib/format';

type Roll = (formula: string, label: string) => unknown;

export function Trackers({ view, canEdit, cmd }: { view: CharacterView; canEdit: boolean; cmd: (c: Command) => void }) {
  const { sheet } = view;
  const recharge = { short: 'короткий отдых', long: 'долгий отдых', none: '' } as const;
  if (!sheet.resources.length && !sheet.spellSlots.length && !sheet.pactSlots) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Ресурсы</h3>
        <span className="small muted">нажмите на клетку, чтобы потратить</span>
      </div>
      {sheet.resources.map((r) => (
        <div key={r.id} className="tracker">
          <div>
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div className="small muted">
              {r.max - r.used} из {r.max}
              {recharge[r.recharge] && ` · ${recharge[r.recharge]}`}
            </div>
          </div>
          {r.max <= 20 ? (
            <div className="boxes">
              {Array.from({ length: r.max }, (_, i) => (
                <button
                  key={i}
                  className={`box ${i < r.used ? 'used' : ''}`}
                  disabled={!canEdit}
                  aria-label={i < r.used ? 'Вернуть' : 'Потратить'}
                  onClick={() => cmd({ type: 'resource', id: r.id, delta: i < r.used ? -1 : 1 })}
                />
              ))}
            </div>
          ) : (
            <div className="row">
              <button className="btn sm" disabled={!canEdit || r.used >= r.max} onClick={() => cmd({ type: 'resource', id: r.id, delta: 5 })}>−5</button>
              <button className="btn sm" disabled={!canEdit || r.used >= r.max} onClick={() => cmd({ type: 'resource', id: r.id, delta: 1 })}>−1</button>
              <button className="btn sm" disabled={!canEdit || r.used <= 0} onClick={() => cmd({ type: 'resource', id: r.id, delta: -1 })}>+1</button>
            </div>
          )}
        </div>
      ))}
      {sheet.spellSlots.map((sl) => (
        <div key={sl.level} className="tracker">
          <div>
            <div style={{ fontWeight: 600 }}>Ячейки {sl.level} уровня</div>
            <div className="small muted">{sl.max - sl.used} из {sl.max}</div>
          </div>
          <div className="boxes">
            {Array.from({ length: sl.max }, (_, i) => (
              <button key={i} className={`box ${i < sl.used ? 'used' : ''}`} disabled={!canEdit} onClick={() => cmd({ type: 'slot', level: sl.level, delta: i < sl.used ? -1 : 1 })} />
            ))}
          </div>
        </div>
      ))}
      {sheet.pactSlots && (
        <div className="tracker">
          <div>
            <div style={{ fontWeight: 600 }}>Ячейки договора ({sheet.pactSlots.level} ур.)</div>
            <div className="small muted">короткий отдых</div>
          </div>
          <div className="boxes">
            {Array.from({ length: sheet.pactSlots.max }, (_, i) => (
              <button key={i} className={`box ${i < sheet.pactSlots!.used ? 'used' : ''}`} disabled={!canEdit} onClick={() => cmd({ type: 'slot', level: 1, pact: true, delta: i < sheet.pactSlots!.used ? -1 : 1 })} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CombatTab({ view, canEdit, cmd, roll }: { view: CharacterView; canEdit: boolean; cmd: (c: Command) => void; roll: Roll }) {
  const { sheet } = view;
  const dmg = (d: string) => d.replace(/−/g, '-');
  return (
    <div className="stack-lg">
      <div className="panel">
        <div className="panel-head">
          <h3>Атаки</h3>
          <span className="small muted">экипируйте оружие во вкладке «Снаряжение»</span>
        </div>
        {sheet.attacks.length === 0 ? (
          <div className="panel-pad muted">
            <Swords size={16} style={{ verticalAlign: -3 }} /> Нет экипированного оружия. Безоружный удар: {signed(sheet.abilities.str.mod + sheet.proficiencyBonus)} к попаданию, {Math.max(1, 1 + sheet.abilities.str.mod)} дробящего.
          </div>
        ) : (
          <>
          <div className="attack attack-head small muted">
            <span />
            <span>к попаданию</span>
            <span>урон</span>
            <span>{sheet.attacks.some((a) => a.versatile) ? 'двумя руками' : ''}</span>
          </div>
          {sheet.attacks.map((a) => (
            <div key={a.id} className="attack">
              <div>
                <div className="name">{a.name}</div>
                <div className="small muted">{[a.damageType && damageName(a.damageType), a.range, ...a.properties].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="btn sm" title="Бонус к броску атаки: к20 + это число против КД цели" onClick={() => roll(`1к20${a.bonus >= 0 ? '+' : ''}${a.bonus}`, `${a.name}: атака`)}>
                {signed(a.bonus)}
              </button>
              <button className="btn sm" onClick={() => roll(dmg(a.damage), `${a.name}: урон`)}>
                {a.damage}
              </button>
              {a.versatile && (
                <button
                  className="btn sm"
                  disabled={a.versatileBlocked}
                  title={a.versatileBlocked ? 'В другой руке щит' : 'Двумя руками'}
                  onClick={() => roll(dmg(a.versatile!), `${a.name}: урон двумя руками`)}
                >
                  <Hand size={14} /> {a.versatile}
                </button>
              )}
            </div>
          ))}
          </>
        )}
      </div>
      <Trackers view={view} canEdit={canEdit} cmd={cmd} />
      {sheet.casters.length > 0 && (
        <div className="panel panel-pad row wrap" style={{ gap: 24 }}>
          {sheet.casters.map((c) => (
            <div key={c.classId} className="row" style={{ gap: 18 }}>
              <span className="caps">{c.className}</span>
              <span>Сл спасброска <b className="num">{c.saveDc}</b></span>
              <button className="btn sm" onClick={() => roll(`1к20${c.attackBonus >= 0 ? '+' : ''}${c.attackBonus}`, 'Атака заклинанием')}>
                Атака заклинанием {signed(c.attackBonus)}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
