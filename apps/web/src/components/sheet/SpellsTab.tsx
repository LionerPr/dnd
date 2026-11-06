import type { Character, Spell } from '@dnd/rules-engine';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { api, type CharacterView, type Command, type ContentRow } from '../../api/client';
import { levelName, schoolName, signed } from '../../lib/format';
import { ContentPicker } from '../ContentPicker';
import { Empty, Modal } from '../ui';
import { Trackers } from './CombatTab';

type Roll = (formula: string, label: string) => unknown;

/** «8к6» + «1к6» за каждый уровень ячейки выше базового */
function scaledDice(base: string, per: string | undefined, extraLevels: number) {
  if (!per || extraLevels <= 0) return base;
  const b = base.match(/^(\d+)[кd](\d+)(.*)$/);
  const p = per.match(/^(\d+)[кd](\d+)$/);
  if (b && p && b[2] === p[2]) return `${Number(b[1]) + Number(p[1]) * extraLevels}к${b[2]}${b[3]}`;
  return `${base}+${Array.from({ length: extraLevels }, () => per).join('+')}`;
}

export function SpellCard({ spell }: { spell: Spell }) {
  const comps = [spell.components?.v && 'В', spell.components?.s && 'С', spell.components?.m && `М (${spell.components.m})`].filter(Boolean).join(', ');
  return (
    <div className="stack">
      <div className="muted">
        {levelName(spell.level)}, {schoolName(spell.school)}
        {spell.ritual && ' (ритуал)'}
      </div>
      <div className="spell-meta">
        <div><b>Время</b>{spell.castingTime}</div>
        <div><b>Дистанция</b>{spell.range}</div>
        <div><b>Компоненты</b>{comps || '—'}</div>
        <div><b>Длительность</b>{spell.concentration ? 'Концентрация, ' : ''}{spell.duration}</div>
      </div>
      <div className="pre" style={{ lineHeight: 1.6 }}>{spell.description}</div>
      {spell.higherLevels && (
        <div className="pre">
          <b>На больших уровнях. </b>
          {spell.higherLevels}
        </div>
      )}
    </div>
  );
}

export function SpellsTab({ view, canEdit, cmd, roll, save }: { view: CharacterView; canEdit: boolean; cmd: (c: Command) => void; roll: Roll; save: (u: (c: Character) => Character) => void }) {
  const { data: c, sheet } = view;
  const [picker, setPicker] = useState(false);
  const [open, setOpen] = useState<Spell | null>(null);
  const [slotLevel, setSlotLevel] = useState(1);
  const ids = c.spellsKnown;
  const q = useQuery({
    queryKey: ['batch', ids.join(',')],
    queryFn: () => api<{ items: ContentRow[] }>(`/content/batch?ids=${ids.join(',')}`),
    enabled: ids.length > 0,
  });
  const spells = (q.data?.items ?? []).map((r) => r.data as Spell).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const byLevel = new Map<number, Spell[]>();
  for (const s of spells) byLevel.set(s.level, [...(byLevel.get(s.level) ?? []), s]);
  const prepares = sheet.casters.some((x) => x.mode === 'prepared');
  const caster = sheet.casters[0];
  const slotFor = (lvl: number) => sheet.spellSlots.find((s) => s.level === lvl);
  const pactOk = (lvl: number) => sheet.pactSlots && sheet.pactSlots.level >= lvl && sheet.pactSlots.used < sheet.pactSlots.max;

  const cast = (spell: Spell, level: number, pact: boolean) => {
    if (spell.level > 0) cmd({ type: 'slot', level, pact, delta: 1 });
    if (spell.concentration) cmd({ type: 'concentration', spell: spell.name });
    const extra = level - spell.level;
    if (spell.attack && caster) roll(`1к20${caster.attackBonus >= 0 ? '+' : ''}${caster.attackBonus}`, `${spell.name}: атака`);
    if (spell.damage) roll(scaledDice(spell.damage.dice, spell.damage.perSlotAbove, extra), `${spell.name}: урон`);
    if (spell.heal) roll(scaledDice(spell.heal.dice, spell.heal.perSlotAbove, extra), `${spell.name}: лечение`);
    setOpen(null);
  };

  return (
    <div className="stack-lg">
      <Trackers view={view} canEdit={canEdit} cmd={cmd} />
      <div className="panel">
        <div className="panel-head">
          <h3>Книга заклинаний</h3>
          <div className="row">
            {caster && (
              <span className="small muted">
                Сл {caster.saveDc} · атака {signed(caster.attackBonus)}
              </span>
            )}
            {canEdit && (
              <button className="btn sm" onClick={() => setPicker(true)}>
                <Plus /> Добавить
              </button>
            )}
          </div>
        </div>
        {ids.length === 0 ? (
          <div className="panel-pad">
            <Empty title="Заклинаний пока нет">Добавьте их из библиотеки — описания, дистанция и урон подтянутся сами.</Empty>
          </div>
        ) : (
          [...byLevel].map(([lvl, list]) => (
            <div key={lvl}>
              <div className="spell-level-head">
                <span className="caps" style={{ color: 'var(--ink-2)' }}>{levelName(lvl)}</span>
                {lvl > 0 && slotFor(lvl) && (
                  <span className="small muted">
                    ячеек {slotFor(lvl)!.max - slotFor(lvl)!.used} из {slotFor(lvl)!.max}
                  </span>
                )}
              </div>
              {list.map((s) => {
                const prepared = c.spellsPrepared.includes(s.id);
                return (
                  <div key={s.id} className="spell-row">
                    {prepares && lvl > 0 ? (
                      <input
                        type="checkbox"
                        title="Подготовлено"
                        checked={prepared}
                        disabled={!canEdit}
                        onChange={(e) =>
                          save((d) => ({ ...d, spellsPrepared: e.target.checked ? [...d.spellsPrepared, s.id] : d.spellsPrepared.filter((x) => x !== s.id) }))
                        }
                        style={{ accentColor: 'var(--accent)' }}
                      />
                    ) : (
                      <span />
                    )}
                    <div>
                      <span
                        className="name"
                        onClick={() => {
                          setOpen(s);
                          setSlotLevel(Math.max(1, s.level));
                        }}
                      >
                        {s.name}
                      </span>
                      <div className="small muted">
                        {[s.castingTime, s.range, s.concentration && 'концентрация', s.ritual && 'ритуал', s.damage?.dice].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="row">
                      {canEdit && (
                        <button
                          className="btn sm"
                          onClick={() => {
                            setOpen(s);
                            setSlotLevel(Math.max(1, s.level));
                          }}
                        >
                          <Wand2 /> Сотворить
                        </button>
                      )}
                      {canEdit && (
                        <button className="btn ghost sm icon" aria-label="Убрать" onClick={() => save((d) => ({ ...d, spellsKnown: d.spellsKnown.filter((x) => x !== s.id), spellsPrepared: d.spellsPrepared.filter((x) => x !== s.id) }))}>
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {open && (
        <Modal
          title={open.name}
          onClose={() => setOpen(null)}
          wide
          footer={
            canEdit ? (
              <>
                {open.level > 0 && (
                  <select className="select sm" style={{ width: 'auto' }} value={slotLevel} onChange={(e) => setSlotLevel(Number(e.target.value))}>
                    {sheet.spellSlots
                      .filter((s) => s.level >= open.level)
                      .map((s) => (
                        <option key={s.level} value={s.level} disabled={s.used >= s.max}>
                          Ячейка {s.level} ур. ({s.max - s.used})
                        </option>
                      ))}
                  </select>
                )}
                {open.level > 0 && pactOk(open.level) && (
                  <button className="btn" onClick={() => cast(open, sheet.pactSlots!.level, true)}>
                    Ячейкой договора
                  </button>
                )}
                <button
                  className="btn primary"
                  disabled={open.level > 0 && !(slotFor(slotLevel) && slotFor(slotLevel)!.used < slotFor(slotLevel)!.max)}
                  onClick={() => cast(open, slotLevel, false)}
                >
                  <Wand2 /> {open.level === 0 ? 'Сотворить заговор' : 'Сотворить'}
                </button>
              </>
            ) : undefined
          }
        >
          <SpellCard spell={open} />
        </Modal>
      )}

      {picker && (
        <ContentPicker
          kind="spell"
          title="Добавить заклинание"
          keepOpen
          filter={(r) => !c.spellsKnown.includes(r.id)}
          onClose={() => setPicker(false)}
          onPick={(row) => row && save((d) => ({ ...d, spellsKnown: [...d.spellsKnown, row.id] }))}
        />
      )}
    </div>
  );
}
