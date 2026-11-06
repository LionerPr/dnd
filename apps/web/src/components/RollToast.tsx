import type { DiceRoll } from '@dnd/rules-engine';

export function RollToast({ label, roll }: { label: string; roll: DiceRoll }) {
  const d20 = roll.rolls.filter((r) => r.die === 20 && !r.dropped);
  const crit = d20.length === 1 && d20[0]!.value === 20;
  const fumble = d20.length === 1 && d20[0]!.value === 1;
  const parts = roll.rolls.map((r) => (r.dropped ? `(${r.value})` : String(r.value))).join(' + ');
  return (
    <div>
      <div className="small" style={{ opacity: 0.75 }}>{label}</div>
      <div className="roll-result">
        <span className={`total ${crit ? 'crit' : fumble ? 'fumble' : ''}`}>{roll.total}</span>
        <span className="small" style={{ opacity: 0.75 }}>
          {parts}
          {roll.modifier ? ` ${roll.modifier > 0 ? '+' : '−'} ${Math.abs(roll.modifier)}` : ''}
          {crit ? ' · критический успех' : fumble ? ' · провал' : ''}
        </span>
      </div>
    </div>
  );
}
