import type { Character, Spell } from '@dnd/rules-engine';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShieldQuestion, Trash2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, type CharacterView, type Command, type ContentRow } from '../../api/client';
import { levelName, schoolName, signed } from '../../lib/format';
import { ContentPicker } from '../ContentPicker';
import { Empty, Modal } from '../ui';
import { Trackers } from './CombatTab';
import { RichText, useSpellIndex, norm } from './RichText';
import { countSpells, isSubclassSpell, SpellChooser, useEditionSpells } from './SpellChooser';

function Limit({ n, max, label }: { n: number; max: number; label: string }) {
  return (
    <span className={`sc-count ${n > max ? 'over' : n === max ? 'full' : 'left'}`}>
      {label} <b>{n}</b>/{max}
    </span>
  );
}

type Roll = (formula: string, label: string) => unknown;

/** «8к6» + «1к6» за каждый уровень ячейки выше базового */
function scaledDice(base: string, per: string | undefined, extraLevels: number) {
  if (!per || extraLevels <= 0) return base;
  const b = base.match(/^(\d+)[кd](\d+)(.*)$/);
  const p = per.match(/^(\d+)[кd](\d+)$/);
  if (b && p && b[2] === p[2]) return `${Number(b[1]) + Number(p[1]) * extraLevels}к${b[2]}${b[3]}`;
  return `${base}+${Array.from({ length: extraLevels }, () => per).join('+')}`;
}

/** Заговоры: 2 кости с 5 уровня, 3 — с 11, 4 — с 17 */
function cantripDice(dice: string, charLevel: number) {
  const tier = charLevel >= 17 ? 4 : charLevel >= 11 ? 3 : charLevel >= 5 ? 2 : 1;
  const m = dice.match(/^(\d+)([кd]\d+)(.*)$/);
  return m && tier > 1 ? `${Number(m[1]) * tier}${m[2]}${m[3]}` : dice;
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
      {(spell.classNames?.length || spell.subclassNames?.length) ? (
        <div className="small muted">
          {spell.classNames?.length ? <div>Классы: {spell.classNames.join(', ')}</div> : null}
          {spell.subclassNames?.length ? <div>Подклассы: {spell.subclassNames.join(', ')}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function SpellsTab({ view, canEdit, cmd, roll, save }: { view: CharacterView; canEdit: boolean; cmd: (c: Command) => void; roll: Roll; save: (u: (c: Character) => Character) => void }) {
  const { data: c, sheet } = view;
  const [picker, setPicker] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [open, setOpen] = useState<Spell | null>(null);
  const [slotLevel, setSlotLevel] = useState(1);
  const judge = !!view.access?.dm || !view.campaignId;
  const requests = c.spellRequests ?? [];
  const bonus = new Set(c.spellsBonus ?? []);
  const ed = c.edition ?? '2014';
  const editionSpells = useEditionSpells(ed);
  const counts = useMemo(() => countSpells(c, sheet, editionSpells.rows), [c, sheet, editionSpells.rows]);
  const outside = new Set(counts.outside.map((r) => r.id));
  const bookCaster = counts.per.find((p) => p.book);
  const preparedCount = c.spellsPrepared.filter((id) => c.spellsKnown.includes(id)).length;
  // Заклинания клятвы, домена, круга: всегда подготовлены, в лимит не входят
  const grantedFrom = useMemo(() => {
    const m = new Map<string, string>();
    for (const cs of sheet.casters) for (const r of editionSpells.rows) {
      const hit = cs.granted?.find((g) => isSubclassSpell(r, [g]));
      if (hit && !m.has(r.id)) m.set(r.id, hit.origin);
    }
    return m;
  }, [sheet.casters, editionSpells.rows]);
  // Заклинания, которые упоминают умения (техника тени монаха, «наложить без ячейки» и т.п.): показываем отдельно, ячейки не тратят
  const spellIndex = useSpellIndex();
  const fromFeatures = useMemo(() => {
    const m = new Map<string, { row: ContentRow; origins: Set<string> }>();
    for (const f of sheet.features) {
      const text = [f.description, ...(f.parts ?? []).filter((p) => !f.chosenParts || f.choose === undefined || f.chosenParts.includes(p.name)).map((p) => p.description)].join('\n');
      for (const mm of text.matchAll(/\[([^\]\n]{2,60})\]/g)) {
        const row = spellIndex.en.get(norm(mm[1]));
        if (!row) continue;
        const e = m.get(row.name) ?? { row, origins: new Set<string>() };
        e.origins.add(f.name);
        m.set(row.name, e);
      }
    }
    return m;
  }, [sheet.features, spellIndex]);
  const ids = [...new Set([...c.spellsKnown, ...requests, ...grantedFrom.keys()])];
  const known = new Set([...c.spellsKnown, ...grantedFrom.keys()]);
  const q = useQuery({
    queryKey: ['batch', ids.join(',')],
    queryFn: () => api<{ items: ContentRow[] }>(`/content/batch?ids=${ids.join(',')}`),
    enabled: ids.length > 0,
  });
  const spells = (q.data?.items ?? []).map((r) => r.data as Spell).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const byLevel = new Map<number, Spell[]>();
  for (const s of spells) if (known.has(s.id)) byLevel.set(s.level, [...(byLevel.get(s.level) ?? []), s]);
  // Отмечать подготовленные нужно только волшебнику: остальные готовят всё, что взяли
  const prepares = !!bookCaster;
  const approve = (id: string) => save((d) => ({ ...d, spellRequests: (d.spellRequests ?? []).filter((x) => x !== id), spellsKnown: d.spellsKnown.includes(id) ? d.spellsKnown : [...d.spellsKnown, id], spellsBonus: [...new Set([...(d.spellsBonus ?? []), id])] }));
  const reject = (id: string) => save((d) => ({ ...d, spellRequests: (d.spellRequests ?? []).filter((x) => x !== id) }));

  const caster = sheet.casters[0];
  const slotFor = (lvl: number) => sheet.spellSlots.find((s) => s.level === lvl);
  const pactOk = (lvl: number) => sheet.pactSlots && sheet.pactSlots.level >= lvl && sheet.pactSlots.used < sheet.pactSlots.max;

  const cast = (spell: Spell, level: number, pact: boolean) => {
    if (spell.level > 0) cmd({ type: 'slot', level, pact, delta: 1 });
    if (spell.concentration) cmd({ type: 'concentration', spell: spell.name });
    const extra = level - spell.level;
    if (spell.attack && caster) roll(`1к20${caster.attackBonus >= 0 ? '+' : ''}${caster.attackBonus}`, `${spell.name}: атака`);
    if (spell.damage) roll(spell.level === 0 && spell.damage.cantripScaling ? cantripDice(spell.damage.dice, sheet.level) : scaledDice(spell.damage.dice, spell.damage.perSlotAbove, extra), `${spell.name}: урон`);
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
              <button className="btn sm accent" onClick={() => setChooser(true)}>
                <Plus /> Выбрать по правилам
              </button>
            )}
            {(canEdit || judge) && (
              <button className="btn sm" onClick={() => setPicker(true)} title={judge ? 'Любое заклинание, не считается в лимит' : 'Мастер увидит просьбу и решит'}>
                <ShieldQuestion /> {judge ? 'Сверх правил' : 'Попросить у мастера'}
              </button>
            )}
          </div>
        </div>
        {counts.per.some((p) => p.caster.cantripsMax || p.spellsCap !== undefined) && (
          <div className="spell-limits">
            {counts.per.map((p) => (
              <span key={p.caster.classId} className="row wrap" style={{ gap: 8 }}>
                {counts.per.length > 1 && <b className="small">{p.caster.className}:</b>}
                {p.caster.cantripsMax ? <Limit n={p.cantrips.length} max={p.caster.cantripsMax} label="заговоры" /> : null}
                {p.spellsCap !== undefined && <Limit n={p.spells.length} max={p.spellsCap} label={p.book ? 'в книге' : 'заклинания'} />}
                {p.book && p.caster.spellsMax !== undefined && <Limit n={preparedCount} max={p.caster.spellsMax} label="подготовлено" />}
              </span>
            ))}
            {bonus.size > 0 && <span className="small muted">+ {bonus.size} от мастера</span>}
          </div>
        )}
        {requests.length > 0 && (
          <div className="spell-requests">
            <b className="small">{judge ? 'Просьбы игрока — решите:' : 'Ждут решения мастера:'}</b>
            {requests.map((id) => {
              const sp = spells.find((x) => x.id === id);
              return (
                <span key={id} className="chip">
                  {sp ? <span className="link" onClick={() => setOpen(sp)}>{sp.name}</span> : '…'}
                  {judge ? (
                    <>
                      <button className="btn xs accent" onClick={() => approve(id)}>Разрешить</button>
                      <button className="btn xs ghost" onClick={() => reject(id)}>Нет</button>
                    </>
                  ) : (
                    canEdit && <button className="btn xs ghost" onClick={() => reject(id)}>Отозвать</button>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {known.size === 0 ? (
          <div className="panel-pad">
            <Empty title="Заклинаний пока нет">Нажмите «Выбрать по правилам»: там только заклинания вашего класса и доступных кругов, а счётчики подскажут, сколько можно взять.</Empty>
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
                    {prepares && lvl > 0 && !grantedFrom.has(s.id) ? (
                      <input
                        type="checkbox"
                        title="Подготовлено"
                        checked={prepared}
                        disabled={!canEdit || (!prepared && bookCaster?.caster.spellsMax !== undefined && preparedCount >= bookCaster.caster.spellsMax)}
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
                      {grantedFrom.has(s.id) && <span className="tag" title="Всегда подготовлено, не входит в лимит">{grantedFrom.get(s.id)}</span>}
                      {bonus.has(s.id) && <span className="tag" title="Мастер разрешил сверх правил">от мастера</span>}
                      {!bonus.has(s.id) && outside.has(s.id) && <span className="tag warn" title="Нет в списке вашего класса. Попросите мастера одобрить или замените.">вне списка класса</span>}
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
                      {canEdit && c.spellsKnown.includes(s.id) && (
                        <button className="btn ghost sm icon" aria-label="Убрать" onClick={() => save((d) => ({ ...d, spellsKnown: d.spellsKnown.filter((x) => x !== s.id), spellsPrepared: d.spellsPrepared.filter((x) => x !== s.id), spellsBonus: (d.spellsBonus ?? []).filter((x) => x !== s.id) }))}>
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

      {[...fromFeatures.values()].some((x) => !known.has(x.row.id)) && (
        <div className="panel">
          <div className="panel-head">
            <h3>Заклинания из умений</h3>
            <span className="small muted">нажмите на название, чтобы прочитать</span>
          </div>
          <div className="panel-pad stack small" style={{ gap: 6 }}>
            {[...fromFeatures.values()]
              .filter((x) => !known.has(x.row.id))
              .sort((a, b) => Number(a.row.data?.level ?? 0) - Number(b.row.data?.level ?? 0) || a.row.name.localeCompare(b.row.name, 'ru'))
              .map(({ row, origins }) => (
                <div key={row.id} className="row wrap" style={{ gap: 8 }}>
                  <RichText text={`${row.name} [${row.data?.nameEn ?? ''}]`} />
                  <span className="muted">{levelName(Number(row.data?.level ?? 0))}</span>
                  <span className="tag">{[...origins].join(', ')}</span>
                </div>
              ))}
          </div>
        </div>
      )}

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

      {chooser && (
        <Modal title="Заклинания по правилам класса" wide onClose={() => setChooser(false)} footer={<button className="btn accent" onClick={() => setChooser(false)}>Готово</button>}>
          <SpellChooser data={c} sheet={sheet} update={save} />
        </Modal>
      )}

      {picker && (
        <ContentPicker
          kind="spell"
          title={judge ? 'Заклинание сверх правил (не считается в лимит)' : 'Попросить у мастера заклинание'}
          keepOpen
          edition={ed}
          filter={(r) => !c.spellsKnown.includes(r.id) && !requests.includes(r.id)}
          toolbar={<span className="small muted nowrap">{judge ? 'добавится сразу' : 'мастер разрешит или откажет'}</span>}
          onClose={() => setPicker(false)}
          onPick={(row) => {
            if (!row) return;
            if (judge) approve(row.id);
            else save((d) => ({ ...d, spellRequests: [...new Set([...(d.spellRequests ?? []), row.id])] }));
          }}
        />
      )}
    </div>
  );
}
