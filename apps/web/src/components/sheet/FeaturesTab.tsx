import type { FeaturePart } from '@dnd/rules-engine';
import type { CharacterView } from '../../api/client';
import { profName } from '../../lib/format';
import { Empty } from '../ui';
import { RichText } from './RichText';

type FeatureLike = { id: string; name: string; description: string; level?: number; origin?: string; parts?: FeaturePart[]; choose?: unknown; chosenParts?: string[] };

/** Части умения: у умения с выбором — только выбранные, иначе все (техники ци и т.п.) */
export function visibleParts(f: FeatureLike) {
  if (!f.parts?.length) return [];
  return f.choose !== undefined ? f.parts.filter((p) => f.chosenParts?.includes(p.name)) : f.parts;
}

export function FeatureList({ features, open }: { features: FeatureLike[]; open?: boolean }) {
  return (
    <div>
      {features.map((f) => {
        const parts = visibleParts(f);
        const chosen = f.choose !== undefined && parts.length ? `: ${parts.map((p) => p.name).join(', ')}` : '';
        return (
          <details key={f.id} className="feature" open={open}>
            <summary>
              <span className="t">
                {f.name}
                {chosen && <span className="accent-text">{chosen}</span>}
              </span>
              {f.level !== undefined && <span className="small muted">{f.level} ур.</span>}
            </summary>
            <div className="body">
              {f.description ? <RichText text={f.description} /> : !parts.length && <span className="muted">Без описания</span>}
              {parts.length > 0 && (
                <div className="feature-parts">
                  {parts.map((p) => (
                    <div key={p.name} className="feature-part">
                      <b>{p.name}</b>
                      <div><RichText text={p.description} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function FeaturesTab({ view }: { view: CharacterView }) {
  const groups = new Map<string, CharacterView['sheet']['features']>();
  for (const f of view.sheet.features) {
    const key = f.origin.replace(/\s\d+$/, '');
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  if (!groups.size) return <Empty title="Умений пока нет">Выберите расу и класс в конструкторе.</Empty>;
  const profs = view.sheet.proficiencies;
  const list = (xs: string[]) => xs.map(profName).join(', ');
  return (
    <div className="stack-lg">
      {[...groups].map(([origin, features]) => (
        <div key={origin} className="panel">
          <div className="panel-head">
            <h3>{origin}</h3>
            <span className="small muted">{features.length}</span>
          </div>
          <FeatureList features={features} />
        </div>
      ))}
      <div className="panel panel-pad stack small">
        <h3>Владения</h3>
        {profs.armor.length > 0 && <div><span className="muted">Доспехи:</span> {list(profs.armor)}</div>}
        {profs.weapon.length > 0 && <div><span className="muted">Оружие:</span> {list(profs.weapon)}</div>}
        {profs.tool.length > 0 && <div><span className="muted">Инструменты:</span> {list(profs.tool)}</div>}
        {profs.language.length > 0 && <div><span className="muted">Языки:</span> {list(profs.language)}</div>}
      </div>
    </div>
  );
}
