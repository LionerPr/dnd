import { useState } from 'react';
import type { CharacterView } from '../../api/client';
import { Modal } from '../ui';

export function RestModal({ view, onClose, onRest }: { view: CharacterView; onClose: () => void; onRest: (dice: number[]) => void }) {
  const pools = view.sheet.hitDice;
  const [spend, setSpend] = useState<Record<number, number>>({});
  const dice = Object.entries(spend).flatMap(([die, n]) => Array.from({ length: n }, () => Number(die)));
  const con = view.sheet.abilities.con.mod;
  return (
    <Modal
      title="Короткий отдых"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={() => onRest(dice)}>
            Отдохнуть{dice.length ? ` и бросить ${dice.length}` : ''}
          </button>
        </>
      }
    >
      <p className="muted">
        Час отдыха. Можно потратить кости хитов: каждая лечит бросок кости {con >= 0 ? '+' : '−'} {Math.abs(con)} (Телосложение). Восстановятся умения «до короткого отдыха».
      </p>
      {pools.map((p) => {
        const left = p.total - p.used;
        const n = spend[p.die] ?? 0;
        return (
          <div key={p.die} className="row between">
            <span>
              к{p.die}: осталось <b>{left}</b> из {p.total}
            </span>
            <div className="row">
              <button className="btn sm icon" disabled={n <= 0} onClick={() => setSpend({ ...spend, [p.die]: n - 1 })}>−</button>
              <span className="num" style={{ width: 24, textAlign: 'center' }}>{n}</span>
              <button className="btn sm icon" disabled={n >= left} onClick={() => setSpend({ ...spend, [p.die]: n + 1 })}>+</button>
            </div>
          </div>
        );
      })}
      <p className="small muted">Сейчас {view.data.state.hp} из {view.sheet.maxHp} хитов.</p>
    </Modal>
  );
}
