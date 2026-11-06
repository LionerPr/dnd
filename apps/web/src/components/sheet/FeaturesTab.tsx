import type { CharacterView } from '../../api/client';
import { Empty } from '../ui';

export function FeatureList({ features }: { features: { id: string; name: string; description: string; level?: number; origin?: string }[] }) {
  return (
    <div>
      {features.map((f) => (
        <details key={f.id} className="feature">
          <summary>
            <span className="t">{f.name}</span>
            {f.level !== undefined && <span className="small muted">{f.level} ур.</span>}
          </summary>
          <div className="body">{f.description || <span className="muted">Без описания</span>}</div>
        </details>
      ))}
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
  const list = (xs: string[]) => xs.map((x) => PROF_NAMES[x] ?? x.replace(/^tools\./, '')).join(', ');
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

const PROF_NAMES: Record<string, string> = {
  light: 'лёгкие доспехи', medium: 'средние доспехи', heavy: 'тяжёлые доспехи', shield: 'щиты',
  simple: 'простое оружие', martial: 'воинское оружие',
  'tools.blacksmith': 'инструменты кузнеца', 'tools.brewer': 'инструменты пивовара', 'tools.mason': 'инструменты каменщика',
  'tools.thieves': 'воровские инструменты', 'tools.herbalism': 'набор травника',
};
