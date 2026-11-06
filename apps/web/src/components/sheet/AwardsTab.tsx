import type { CharacterView } from '../../api/client';
import { AchievementIcon } from '../AchievementIcon';
import { Empty } from '../ui';

export function AwardsTab({ view }: { view: CharacterView }) {
  const awards = view.awards ?? [];
  if (!awards.length) return <Empty title="Достижений пока нет">Их выдаёт мастер за особые моменты в игре.</Empty>;
  return (
    <div className="panel">
      {awards.map((a) => (
        <div key={a.id} className="award">
          <div className="award-icon">
            <AchievementIcon name={a.icon} />
          </div>
          <div>
            <h4>{a.title}</h4>
            {a.description && <div className="muted">{a.description}</div>}
            <div className="small muted" style={{ marginTop: 4 }}>
              {new Date(a.awarded_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              {a.note && ` · ${a.note}`}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
