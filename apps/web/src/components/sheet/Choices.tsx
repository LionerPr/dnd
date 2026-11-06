import { ABILITIES, ABILITY_NAMES, LANGUAGES, SKILLS, type Ability, type Character, type Sheet } from '@dnd/rules-engine';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { profName } from '../../lib/format';
import { ContentPicker } from '../ContentPicker';

type Update = (u: (c: Character) => Character) => void;
type Pending = Sheet['pendingChoices'][number];

const KIND_LABEL: Record<string, string> = {
  skill: 'навыки',
  tool: 'инструменты',
  language: 'языки',
  ability: 'характеристики',
  expertise: 'компетентность: навыки, которыми вы владеете',
  armor: 'доспехи',
  weapon: 'оружие',
};

export function optionLabel(kind: string, key: string) {
  if (key.startsWith('feat:')) return `Черта: ${key.split(':').slice(2).join(':') || 'без названия'}`;
  if (key in SKILLS) return SKILLS[key as keyof typeof SKILLS].name;
  if ((ABILITIES as readonly string[]).includes(key)) return ABILITY_NAMES[key as Ability].full;
  if (kind === 'feature' || kind === 'language') return key;
  return profName(key);
}

/** Варианты выбора: «любой» раскрываем в список (навыки, языки), уже имеющееся не предлагаем */
function optionsFor(p: Pending, sheet: Sheet): string[] {
  if (p.of !== 'any') return p.of;
  if (p.kind === 'skill') return Object.keys(SKILLS).filter((k) => !sheet.skills.find((s) => s.key === k)?.proficient);
  if (p.kind === 'language') return LANGUAGES.map((l) => l.name).filter((n) => !sheet.proficiencies.language.includes(n));
  return [];
}

/** Один несделанный выбор: чипы вариантов, для частей умения — карточки с описанием. */
export function ChoiceRow({ p, sheet, data, update }: { p: Pending; sheet: Sheet; data: Character; update: Update }) {
  const [featFor, setFeatFor] = useState(false);
  const chosen = data.choices[p.id] ?? [];
  const add = (o: string) => update((d) => ({ ...d, choices: { ...d.choices, [p.id]: [...(d.choices[p.id] ?? []), o] } }));
  const options = optionsFor(p, sheet).filter((o) => p.asi || !chosen.includes(o));
  const feature = p.featureId ? sheet.features.find((f) => f.id === p.featureId) : undefined;
  const exotic = new Set(LANGUAGES.filter((l) => l.exotic).map((l) => l.name));

  return (
    <div className="pending">
      <div className="pending-title">
        <b>{p.origin}</b>
        <span className="muted">
          {p.asi
            ? chosen.length
              ? ' — ещё одна характеристика (та же ещё раз даст +2)'
              : ' — +2 к одной характеристике (нажмите дважды) или по +1 к двум, либо черта'
            : ` — выберите ${p.pick}${p.kind === 'feature' ? '' : `: ${KIND_LABEL[p.kind] ?? p.kind}`}`}
        </span>
      </div>
      {feature?.parts ? (
        <div className="part-options">
          {feature.parts
            .filter((part) => options.includes(part.name))
            .map((part) => (
              <details key={part.name} className="part-option">
                <summary>
                  <span className="t">{part.name}</span>
                  {part.optional && <span className="tag">Таша</span>}
                  {part.minLevel ? <span className="tag">с {part.minLevel} ур.</span> : null}
                  <button
                    className="btn xs accent"
                    onClick={(e) => {
                      e.preventDefault();
                      add(part.name);
                    }}
                  >
                    Выбрать
                  </button>
                </summary>
                <div className="body">{part.description}</div>
              </details>
            ))}
        </div>
      ) : (
        <div className="row wrap" style={{ gap: 6 }}>
          {p.asi && !chosen.length && (
            <button className="chip accent" onClick={() => setFeatFor(true)}>
              <Plus size={12} /> Черта
            </button>
          )}
          {options.map((o) => (
            <button key={o} className={`chip${exotic.has(o) ? ' dim' : ''}`} onClick={() => add(o)}>
              {optionLabel(p.kind, o)}
            </button>
          ))}
        </div>
      )}
      {featFor && (
        <ContentPicker
          kind="feat"
          title="Черта вместо увеличения характеристик"
          onClose={() => setFeatFor(false)}
          onPick={(r) => r && update((d) => ({ ...d, featIds: [...d.featIds, r.id], choices: { ...d.choices, [p.id]: [`feat:${r.id}:${r.name}`] } }))}
        />
      )}
    </div>
  );
}

/** Уже сделанные выборы с кнопкой «убрать». */
export function ChosenList({ data, update, only }: { data: Character; update: Update; only?: (id: string) => boolean }) {
  const entries = Object.entries(data.choices).filter(([id, v]) => v.length && !id.startsWith('kit.') && (!only || only(id)));
  if (!entries.length) return null;
  const label = (id: string) =>
    id.startsWith('class.') ? 'Навыки класса'
    : id.startsWith('asi.') ? `Увеличение характеристик, ${id.split('.').pop()} ур.`
    : id.startsWith('part.') ? 'Выбрано'
    : id.endsWith('.expertise') ? 'Компетентность'
    : id.endsWith('.languages') ? 'Языки'
    : 'Выбрано';
  return (
    <div className="stack" style={{ gap: 8 }}>
      {entries.map(([id, values]) => (
        <div key={id} className="row wrap" style={{ gap: 6 }}>
          <span className="small muted">{label(id)}:</span>
          {values.map((v, i) =>
            id.startsWith('asi.') && values.indexOf(v) !== i ? null : (
              <span key={`${v}-${i}`} className="chip accent">
                {optionLabel(id.startsWith('part.') ? 'feature' : '', v)}
                {id.startsWith('asi.') && values.filter((x) => x === v).length === 2 ? ' +2' : ''}
                <button
                  className="btn ghost xs icon"
                  style={{ height: 18, width: 18, marginRight: -6 }}
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      choices: { ...d.choices, [id]: d.choices[id]!.filter((_, j) => j !== i) },
                      featIds: v.startsWith('feat:') ? d.featIds.filter((f) => f !== v.split(':')[1]) : d.featIds,
                    }))
                  }
                  aria-label="Убрать"
                >
                  <X size={12} />
                </button>
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
