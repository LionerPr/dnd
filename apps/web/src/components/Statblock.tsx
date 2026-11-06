import { ABILITIES, ABILITY_NAMES, abilityMod, CONDITIONS, DAMAGE_TYPES, SKILLS, type Monster, type MonsterAction } from '@dnd/rules-engine';
import { signed } from '../lib/format';

type Roll = (formula: string, label: string) => unknown;

const names = (xs: string[] | undefined, dict: Record<string, string>) => (xs ?? []).map((x) => dict[x] ?? x).join(', ');

function Actions({ title, list, monster, roll }: { title: string; list?: MonsterAction[]; monster: string; roll?: Roll }) {
  if (!list?.length) return null;
  return (
    <>
      {title && <h4>{title}</h4>}
      {list.map((a, i) => (
        <p key={i} style={{ margin: '4px 0' }}>
          <b>
            <i>{a.name}.</i>
          </b>{' '}
          {a.description}
          {roll && (a.attackBonus !== undefined || a.damage) && (
            <span className="row" style={{ display: 'inline-flex', marginLeft: 6, gap: 4 }}>
              {a.attackBonus !== undefined && (
                <button className="btn xs" onClick={() => roll(`1к20${a.attackBonus! >= 0 ? '+' : ''}${a.attackBonus}`, `${monster}: ${a.name}, атака`)}>
                  {signed(a.attackBonus)}
                </button>
              )}
              {a.damage && (
                <button className="btn xs" onClick={() => roll(a.damage!, `${monster}: ${a.name}, урон`)}>
                  {a.damage}
                </button>
              )}
            </span>
          )}
        </p>
      ))}
    </>
  );
}

export function Statblock({ m, roll }: { m: Monster; roll?: Roll }) {
  const saves = Object.entries(m.saves ?? {}).map(([a, v]) => `${ABILITY_NAMES[a as keyof typeof ABILITY_NAMES]?.short ?? a} ${signed(v as number)}`);
  const skills = Object.entries(m.skills ?? {}).map(([s, v]) => `${SKILLS[s as keyof typeof SKILLS]?.name ?? s} ${signed(v as number)}`);
  return (
    <div className="statblock">
      <div className="muted">
        <i>{[m.size, m.type, m.alignment].filter(Boolean).join(', ')}</i>
      </div>
      <div style={{ marginTop: 8 }}>
        <div><b>Класс доспеха</b> {m.ac}{m.acNote ? ` (${m.acNote})` : ''}</div>
        <div><b>Хиты</b> {m.hp}{m.hpFormula ? ` (${m.hpFormula})` : ''}</div>
        <div><b>Скорость</b> {m.speed}</div>
      </div>
      <div className="abil">
        {ABILITIES.map((a) => (
          <div key={a}>
            <b>{ABILITY_NAMES[a].short.toUpperCase()}</b>
            {m.abilities?.[a] ?? 10} ({signed(abilityMod(m.abilities?.[a] ?? 10))})
          </div>
        ))}
      </div>
      {saves.length > 0 && <div><b>Спасброски</b> {saves.join(', ')}</div>}
      {skills.length > 0 && <div><b>Навыки</b> {skills.join(', ')}</div>}
      {!!m.vulnerabilities?.length && <div><b>Уязвимость</b> {names(m.vulnerabilities, DAMAGE_TYPES)}</div>}
      {!!m.resistances?.length && <div><b>Сопротивление</b> {names(m.resistances, DAMAGE_TYPES)}</div>}
      {!!m.immunities?.length && <div><b>Иммунитет к урону</b> {names(m.immunities, DAMAGE_TYPES)}</div>}
      {!!m.conditionImmunities?.length && <div><b>Иммунитет к состояниям</b> {names(m.conditionImmunities, CONDITIONS)}</div>}
      {m.senses && <div><b>Чувства</b> {m.senses}</div>}
      {m.languages && <div><b>Языки</b> {m.languages}</div>}
      <div><b>Опасность</b> {m.cr}{m.xp ? ` (${m.xp.toLocaleString('ru-RU')} опыта)` : ''}</div>
      {m.habitat && <div><b>Местность</b> {m.habitat}</div>}
      <Actions title="Особенности" list={m.traits} monster={m.name} roll={roll} />
      <Actions title="Действия" list={m.actions} monster={m.name} roll={roll} />
      <Actions title="Бонусные действия" list={m.bonusActions} monster={m.name} roll={roll} />
      <Actions title="Реакции" list={m.reactions} monster={m.name} roll={roll} />
      {m.legendaryIntro && !!m.legendary?.length && (
        <>
          <h4>Легендарные действия</h4>
          <p className="small muted" style={{ margin: '4px 0' }}>{m.legendaryIntro}</p>
        </>
      )}
      <Actions title={m.legendaryIntro ? '' : 'Легендарные действия'} list={m.legendary} monster={m.name} roll={roll} />
      {m.description && (
        <details style={{ marginTop: 10 }}>
          <summary className="small">Описание, логово и прочее</summary>
          <div className="small" style={{ whiteSpace: 'pre-line', marginTop: 6 }}>{m.description}</div>
        </details>
      )}
    </div>
  );
}
