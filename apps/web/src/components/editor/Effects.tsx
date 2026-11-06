import { ABILITIES, ABILITY_NAMES, CONDITIONS, DAMAGE_TYPES, SKILLS, SKILL_KEYS, type Effect } from '@dnd/rules-engine';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { NumberInput } from '../ui';

const uid = () => Math.random().toString(36).slice(2, 10);

export const EFFECT_LABELS: Record<Effect['type'], string> = {
  ability_bonus: 'Бонус к характеристике',
  ability_choice: 'Бонус к характеристике на выбор',
  speed: 'Скорость',
  darkvision: 'Тёмное зрение',
  resistance: 'Сопротивление урону',
  immunity: 'Иммунитет к урону',
  vulnerability: 'Уязвимость к урону',
  condition_immunity: 'Иммунитет к состоянию',
  proficiency: 'Владение',
  choice: 'Владение на выбор',
  expertise: 'Компетентность',
  expertise_choice: 'Компетентность на выбор',
  hp_per_level: 'Хиты за уровень',
  ac_bonus: 'Бонус к КД',
  ac_formula: 'КД без доспехов',
  initiative_bonus: 'Бонус к инициативе',
  formula_bonus: 'Бонус по формуле',
  resource: 'Ресурс (заряды)',
};

const PROF_KINDS = { skill: 'навык', save: 'спасбросок', armor: 'доспехи', weapon: 'оружие', tool: 'инструменты', language: 'язык' } as const;

function blank(type: Effect['type']): Effect {
  switch (type) {
    case 'ability_bonus': return { type, ability: 'str', value: 1 };
    case 'ability_choice': return { type, id: uid(), pick: 1, value: 1 };
    case 'speed': return { type, walk: 30 };
    case 'darkvision': return { type, range: 60 };
    case 'resistance': case 'immunity': case 'vulnerability': return { type, damage: 'fire' };
    case 'condition_immunity': return { type, condition: 'charmed' };
    case 'proficiency': return { type, kind: 'skill', ids: [] };
    case 'choice': return { type, id: uid(), kind: 'skill', pick: 1, of: 'any' };
    case 'expertise': return { type, skills: [] };
    case 'expertise_choice': return { type, id: uid(), pick: 2 };
    case 'hp_per_level': return { type, value: 1 };
    case 'ac_bonus': return { type, value: 1 };
    case 'ac_formula': return { type, base: 10, abilities: ['dex'], allowShield: true };
    case 'initiative_bonus': return { type, value: 1 };
    case 'formula_bonus': return { type, target: 'initiative', expr: '[PROF]' };
    case 'resource': return { type, id: uid(), name: '', max: 1, recharge: 'long' };
  }
}

/** Переключатели-фишки для выбора нескольких значений из словаря */
export function ChipSet<T extends string>({ options, value, onChange }: { options: Record<T, string>; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="row wrap" style={{ gap: 4 }}>
      {(Object.keys(options) as T[]).map((k) => {
        const on = value.includes(k);
        return (
          <button key={k} type="button" className={`chip small${on ? ' accent' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}>
            {options[k]}
          </button>
        );
      })}
    </div>
  );
}

const skillNames = Object.fromEntries(SKILL_KEYS.map((k) => [k, SKILLS[k].name])) as Record<string, string>;
const abilityNames = Object.fromEntries(ABILITIES.map((a) => [a, ABILITY_NAMES[a].full])) as Record<string, string>;
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function Num({ label, value, onChange }: { label: string; value: number | undefined; onChange: (n: number) => void }) {
  return (
    <label className="row small" style={{ gap: 6 }}>
      {label}
      <NumberInput value={value ?? 0} onChange={onChange} style={{ width: 64 }} aria-label={label} />
    </label>
  );
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: Record<string, string>; onChange: (v: T) => void }) {
  return (
    <select className="select sm" style={{ width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

function EffectBody({ e, set }: { e: Effect; set: (e: Effect) => void }): ReactNode {
  switch (e.type) {
    case 'ability_bonus':
      return (
        <div className="row wrap">
          <Select value={e.ability} options={abilityNames} onChange={(ability) => set({ ...e, ability })} />
          <Num label="на" value={e.value} onChange={(value) => set({ ...e, value })} />
        </div>
      );
    case 'ability_choice':
      return (
        <div className="row wrap">
          <Num label="Сколько характеристик" value={e.pick} onChange={(pick) => set({ ...e, pick })} />
          <Num label="по" value={e.value} onChange={(value) => set({ ...e, value })} />
        </div>
      );
    case 'speed':
      return (
        <div className="row wrap">
          <Num label="Ходьба" value={e.walk} onChange={(walk) => set({ ...e, walk: walk || undefined })} />
          <Num label="Полёт" value={e.fly} onChange={(fly) => set({ ...e, fly: fly || undefined })} />
          <Num label="Плавание" value={e.swim} onChange={(swim) => set({ ...e, swim: swim || undefined })} />
          <Num label="Лазание" value={e.climb} onChange={(climb) => set({ ...e, climb: climb || undefined })} />
        </div>
      );
    case 'darkvision':
      return <Num label="Дальность, фт" value={e.range} onChange={(range) => set({ ...e, range })} />;
    case 'resistance':
    case 'immunity':
    case 'vulnerability':
      return <Select value={e.damage} options={DAMAGE_TYPES} onChange={(damage) => set({ ...e, damage })} />;
    case 'condition_immunity':
      return <Select value={e.condition} options={CONDITIONS} onChange={(condition) => set({ ...e, condition })} />;
    case 'proficiency':
      return (
        <div className="stack" style={{ gap: 6 }}>
          <Select value={e.kind} options={PROF_KINDS} onChange={(kind) => set({ ...e, kind, ids: [] })} />
          {e.kind === 'skill' ? (
            <ChipSet options={skillNames} value={e.ids} onChange={(ids) => set({ ...e, ids })} />
          ) : e.kind === 'save' ? (
            <ChipSet options={abilityNames} value={e.ids} onChange={(ids) => set({ ...e, ids })} />
          ) : (
            <input className="input sm" placeholder="Через запятую: лёгкие доспехи, щиты" defaultValue={e.ids.join(', ')} onBlur={(ev) => set({ ...e, ids: list(ev.target.value) })} />
          )}
        </div>
      );
    case 'choice':
      return (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row wrap">
            <Select value={e.kind} options={PROF_KINDS} onChange={(kind) => set({ ...e, kind, of: 'any' })} />
            <Num label="Сколько" value={e.pick} onChange={(pick) => set({ ...e, pick })} />
            <label className="check small">
              <input type="checkbox" checked={e.of === 'any'} onChange={(ev) => set({ ...e, of: ev.target.checked ? 'any' : [] })} /> любые
            </label>
          </div>
          {e.of !== 'any' &&
            (e.kind === 'skill' ? (
              <ChipSet options={skillNames} value={e.of} onChange={(of) => set({ ...e, of })} />
            ) : (
              <input className="input sm" placeholder="Варианты через запятую" defaultValue={e.of.join(', ')} onBlur={(ev) => set({ ...e, of: list(ev.target.value) })} />
            ))}
        </div>
      );
    case 'expertise':
      return <ChipSet options={skillNames} value={e.skills} onChange={(skills) => set({ ...e, skills: skills as typeof e.skills })} />;
    case 'expertise_choice':
      return <Num label="Сколько навыков" value={typeof e.pick === 'number' ? e.pick : 2} onChange={(pick) => set({ ...e, pick })} />;
    case 'hp_per_level':
    case 'ac_bonus':
    case 'initiative_bonus':
      return <Num label="Значение" value={e.value} onChange={(value) => set({ ...e, value })} />;
    case 'formula_bonus':
      return (
        <div className="row wrap">
          <Select value={e.target} options={{ initiative: 'к инициативе', hp: 'к максимуму хитов' }} onChange={(target) => set({ ...e, target })} />
          <input className="input sm" style={{ width: 200 }} value={e.expr} onChange={(ev) => set({ ...e, expr: ev.target.value })} title="[LVL] — уровень, [PROF] — бонус мастерства, [STR]…[CHA] — модификаторы" />
        </div>
      );
    case 'ac_formula':
      return (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row wrap">
            <Num label="Основа" value={e.base} onChange={(base) => set({ ...e, base })} />
            <label className="check small">
              <input type="checkbox" checked={e.allowShield} onChange={(ev) => set({ ...e, allowShield: ev.target.checked })} /> со щитом
            </label>
          </div>
          <ChipSet options={abilityNames} value={e.abilities} onChange={(abilities) => set({ ...e, abilities: abilities as typeof e.abilities })} />
        </div>
      );
    case 'resource':
      return (
        <div className="row wrap">
          <input className="input sm" placeholder="Название, например «Ярость»" value={e.name} onChange={(ev) => set({ ...e, name: ev.target.value })} style={{ width: 200 }} />
          {typeof e.max === 'number' ? (
            <Num label="Зарядов" value={e.max} onChange={(max) => set({ ...e, max })} />
          ) : (
            <span className="small muted">зарядов по уровням: {Object.entries(e.max).map(([l, n]) => `${l}→${n}`).join(', ')}</span>
          )}
          <Select value={e.recharge} options={{ short: 'короткий отдых', long: 'долгий отдых', none: 'не восстанавливается' }} onChange={(recharge) => set({ ...e, recharge })} />
        </div>
      );
  }
}

export function EffectsEditor({ effects, onChange }: { effects: Effect[]; onChange: (e: Effect[]) => void }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {effects.map((e, i) => (
        <div key={i} className="effect-row">
          <div className="row between">
            <b className="small">{EFFECT_LABELS[e.type]}</b>
            <button type="button" className="btn ghost xs icon" aria-label="Убрать эффект" onClick={() => onChange(effects.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </button>
          </div>
          <EffectBody e={e} set={(n) => onChange(effects.map((x, j) => (j === i ? n : x)))} />
        </div>
      ))}
      <div className="row">
        <select
          className="select sm"
          style={{ width: 'auto' }}
          value=""
          onChange={(ev) => ev.target.value && onChange([...effects, blank(ev.target.value as Effect['type'])])}
          aria-label="Добавить эффект"
        >
          <option value="">+ Эффект в листе…</option>
          {Object.entries(EFFECT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export interface EditableFeature {
  id: string;
  name: string;
  description: string;
  level?: number;
  effects?: Effect[];
  optional?: boolean;
}

export function FeaturesEditor({ features, onChange, withLevel, addLabel = 'Добавить умение' }: { features: EditableFeature[]; onChange: (f: EditableFeature[]) => void; withLevel?: boolean; addLabel?: string }) {
  const set = (i: number, patch: Partial<EditableFeature>) => onChange(features.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const sorted = withLevel ? features.map((f, i) => ({ f, i })).sort((a, b) => (a.f.level ?? 1) - (b.f.level ?? 1)) : features.map((f, i) => ({ f, i }));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {sorted.map(({ f, i }) => (
        <details key={f.id} className="feature-edit" open={!f.name}>
          <summary>
            <ChevronDown size={16} className="chev" />
            <span className="grow">{f.name || <span className="muted">Без названия</span>}</span>
            {withLevel && <span className="small muted">{f.level ?? 1} ур.</span>}
            {!!f.effects?.length && <span className="chip small good">{f.effects.length} эфф.</span>}
          </summary>
          <div className="stack" style={{ padding: '10px 12px 12px' }}>
            <div className="row">
              <input className="input grow" placeholder="Название" value={f.name} onChange={(e) => set(i, { name: e.target.value })} />
              {withLevel && (
                <label className="row small nowrap" style={{ gap: 6 }}>
                  Уровень
                  <NumberInput value={f.level ?? 1} min={1} max={20} onChange={(level) => set(i, { level })} style={{ width: 60 }} />
                </label>
              )}
            </div>
            <textarea className="textarea" placeholder="Описание" rows={4} value={f.description} onChange={(e) => set(i, { description: e.target.value })} />
            <EffectsEditor effects={f.effects ?? []} onChange={(effects) => set(i, { effects })} />
            <div className="row between">
              <label className="check small">
                <input type="checkbox" checked={!!f.optional} onChange={(e) => set(i, { optional: e.target.checked || undefined })} /> необязательное правило
              </label>
              <button type="button" className="btn ghost sm danger-text" onClick={() => onChange(features.filter((_, j) => j !== i))}>
                <Trash2 /> Удалить
              </button>
            </div>
          </div>
        </details>
      ))}
      <div>
        <button type="button" className="btn sm" onClick={() => onChange([...features, { id: uid(), name: '', description: '', ...(withLevel ? { level: 1 } : {}) }])}>
          <Plus /> {addLabel}
        </button>
      </div>
    </div>
  );
}

export { uid };
