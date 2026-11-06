import { CONDITIONS, type Condition } from '@dnd/rules-engine';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { CharacterView, Command } from '../../api/client';
import { conditionName, damageName as damageLabel, signed } from '../../lib/format';
import { Modal } from '../ui';

type Roll = (formula: string, label: string) => unknown;

export function HpBar({ hp, max, temp = 0 }: { hp: number; max: number; temp?: number }) {
  const total = Math.max(max, hp + temp, 1);
  const pct = hp / total;
  const color = hp / Math.max(max, 1) > 0.5 ? 'var(--good)' : hp / Math.max(max, 1) > 0.25 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div className="hp-bar" aria-hidden>
      <i style={{ width: `${pct * 100}%`, background: color }} />
      {temp > 0 && <i style={{ width: `${(temp / total) * 100}%`, background: 'var(--mana)' }} />}
    </div>
  );
}

export function Vitals({ view, canEdit, cmd, roll }: { view: CharacterView; canEdit: boolean; cmd: (c: Command) => void; roll: Roll }) {
  const { data: c, sheet } = view;
  const s = c.state;
  const [amount, setAmount] = useState('');
  const [condOpen, setCondOpen] = useState(false);
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const apply = (type: 'damage' | 'heal' | 'temp_hp') => {
    if (!n) return;
    cmd({ type, amount: n });
    setAmount('');
  };
  const ov = (k: string) => (sheet.overridden.includes(k) ? ' overridden' : '');
  const hitDiceLeft = sheet.hitDice.map((h) => `${h.total - h.used}к${h.die}`).join(' + ') || '—';

  return (
    <>
      <div className="vitals">
        <div className={`vital hp${s.hp === 0 && sheet.maxHp > 0 ? ' down' : ''}`}>
          <div className="hp-top">
            <div className="hp-num num">
              {s.hp}
              <small> / {sheet.maxHp}</small>
            </div>
            <div className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
              {s.tempHp > 0 && <span className="hp-temp">+{s.tempHp} врем.</span>}
              <span className="caps">Хиты</span>
            </div>
          </div>
          <HpBar hp={s.hp} max={sheet.maxHp} temp={s.tempHp} />
          {s.dead ? (
            <div className="chip danger" style={{ alignSelf: 'flex-start' }}>Персонаж погиб</div>
          ) : s.hp === 0 && sheet.maxHp > 0 ? (
            <div className="death-saves">
              <span className="row">
                Успехи{' '}
                <span className="pips">
                  {[0, 1, 2].map((i) => (
                    <i key={i} className={`pip good ${i < s.deathSaves.success ? 'on' : ''}`} />
                  ))}
                </span>
              </span>
              <span className="row">
                Провалы{' '}
                <span className="pips">
                  {[0, 1, 2].map((i) => (
                    <i key={i} className={`pip bad ${i < s.deathSaves.failure ? 'on' : ''}`} />
                  ))}
                </span>
              </span>
              {canEdit && (
                <button className="btn sm" onClick={() => cmd({ type: 'death_save' })}>
                  Бросить
                </button>
              )}
            </div>
          ) : null}
          {canEdit && (
            <div className="hp-controls" style={{ marginTop: s.hp === 0 ? 8 : 0 }}>
              <input
                className="input num"
                inputMode="numeric"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && apply('damage')}
                aria-label="Сколько"
              />
              <button className="btn sm danger" disabled={!n} onClick={() => apply('damage')}>
                Урон
              </button>
              <button className="btn sm good" disabled={!n} onClick={() => apply('heal')}>
                Лечение
              </button>
              <button className="btn sm" disabled={!n} onClick={() => apply('temp_hp')} title="Временные хиты">
                Врем.
              </button>
            </div>
          )}
        </div>
        <div className={`vital${ov('ac')}`} title={sheet.acSource}>
          <div className="v">{sheet.ac}</div>
          <div className="l">Класс доспеха</div>
          <div className="s">{sheet.acSource}</div>
        </div>
        <button className={`vital${ov('initiative')}`} onClick={() => roll(`1к20${signed(sheet.initiative).replace('−', '-')}`, 'Инициатива')}>
          <div className="v">{signed(sheet.initiative)}</div>
          <div className="l">Инициатива</div>
        </button>
        <div className="vital">
          <div className="v">{sheet.speed.walk}</div>
          <div className="l">Скорость, фт</div>
          <div className="s">
            {[sheet.speed.fly && `полёт ${sheet.speed.fly}`, sheet.speed.swim && `плав. ${sheet.speed.swim}`, sheet.speed.climb && `лаз. ${sheet.speed.climb}`].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="vital">
          <div className="v">{signed(sheet.proficiencyBonus)}</div>
          <div className="l">Мастерство</div>
        </div>
        <div className="vital">
          <div className="v" style={{ fontSize: 24 }}>{hitDiceLeft}</div>
          <div className="l">Кости хитов</div>
          <div className="s">Восприятие {sheet.passivePerception}{sheet.darkvision ? ` · тёмн. ${sheet.darkvision}` : ''}</div>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 18, gap: 6 }}>
        {s.conditions.map((cond) => (
          <span key={cond} className="chip danger">
            {conditionName(cond)}
            {canEdit && (
              <button className="btn ghost xs icon" style={{ height: 18, width: 18, marginRight: -6 }} onClick={() => cmd({ type: 'condition', condition: cond, on: false })} aria-label="Снять">
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {s.exhaustion > 0 && <span className="chip danger">Истощение {s.exhaustion}</span>}
        {s.concentration && (
          <span className="chip mana">
            Концентрация: {s.concentration}
            {canEdit && (
              <button className="btn ghost xs icon" style={{ height: 18, width: 18, marginRight: -6 }} onClick={() => cmd({ type: 'concentration', spell: null })} aria-label="Прервать">
                <X size={12} />
              </button>
            )}
          </span>
        )}
        {sheet.resistances.length > 0 && <span className="chip">Сопротивление: {sheet.resistances.map((d) => damageLabel(d)).join(', ')}</span>}
        {canEdit && (
          <button className="chip" onClick={() => setCondOpen(true)}>
            <Plus /> Состояние
          </button>
        )}
      </div>

      {condOpen && (
        <Modal title="Состояния" onClose={() => setCondOpen(false)}>
          <div className="row wrap" style={{ gap: 6 }}>
            {(Object.keys(CONDITIONS) as Condition[]).map((k) => {
              const on = s.conditions.includes(k);
              return (
                <button key={k} className={`chip ${on ? 'danger' : ''}`} onClick={() => cmd({ type: 'condition', condition: k, on: !on })}>
                  {CONDITIONS[k]}
                </button>
              );
            })}
          </div>
          <div className="row between">
            <span>Истощение</span>
            <div className="segmented">
              {[0, 1, 2, 3, 4, 5, 6].map((lvl) => (
                <button key={lvl} className={s.exhaustion === lvl ? 'on' : ''} onClick={() => cmd({ type: 'exhaustion', value: lvl })}>
                  {lvl}
                </button>
              ))}
            </div>
          </div>
          <p className="small muted">2: скорость вдвое меньше · 4: максимум хитов вдвое меньше · 5: скорость 0 · 6: смерть. Долгий отдых снимает одну степень.</p>
        </Modal>
      )}
    </>
  );
}

