import type { Character } from '@dnd/rules-engine';
import type { CharacterView } from '../../api/client';
import { Field } from '../ui';

const FIELDS: { key: 'backstory' | 'appearance' | 'notes'; label: string; rows: number }[] = [
  { key: 'appearance', label: 'Внешность и характер', rows: 4 },
  { key: 'backstory', label: 'Предыстория', rows: 8 },
  { key: 'notes', label: 'Заметки', rows: 8 },
];

export function NotesTab({ view, canEdit, save }: { view: CharacterView; canEdit: boolean; save: (u: (c: Character) => Character) => void }) {
  const c = view.data;
  return (
    <div className="panel panel-pad stack-lg">
      <div className="grid grid-2">
        <Field label="Предыстория (название)">
          <input className="input" disabled={!canEdit} defaultValue={c.background ?? ''} onBlur={(e) => save((d) => ({ ...d, background: e.target.value }))} placeholder="Народный герой, Мудрец…" />
        </Field>
        <Field label="Мировоззрение">
          <input className="input" disabled={!canEdit} defaultValue={c.alignment ?? ''} onBlur={(e) => save((d) => ({ ...d, alignment: e.target.value }))} placeholder="Хаотично-добрый" />
        </Field>
      </div>
      {FIELDS.map((f) => (
        <Field key={f.key} label={f.label}>
          <textarea className="textarea" rows={f.rows} disabled={!canEdit} defaultValue={c[f.key] ?? ''} onBlur={(e) => save((d) => ({ ...d, [f.key]: e.target.value }))} />
        </Field>
      ))}
    </div>
  );
}
