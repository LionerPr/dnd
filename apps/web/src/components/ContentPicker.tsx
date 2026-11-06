import { Search } from 'lucide-react';
import { useState } from 'react';
import type { ContentRow } from '../api/client';
import { bookShort, KIND_NAMES, levelName, schoolName, searchKey } from '../lib/format';
import { useContentList } from '../lib/hooks';
import { Loading, Modal } from './ui';

export function ContentPicker({
  kind,
  title,
  onPick,
  onClose,
  allowCustom,
  filter,
  extra,
  keepOpen,
  toolbar,
}: {
  kind: string;
  title: string;
  onPick: (row: ContentRow | null, customName?: string) => void;
  onClose: () => void;
  allowCustom?: boolean;
  filter?: (r: ContentRow) => boolean;
  extra?: Record<string, string | number | undefined>;
  keepOpen?: boolean;
  toolbar?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const list = useContentList(kind, extra);
  const rows = (list.data?.items ?? []).filter((r) => (!filter || filter(r)) && searchKey(r.name).includes(searchKey(q))).slice(0, 200);
  const pick = (r: ContentRow | null, custom?: string) => {
    onPick(r, custom);
    if (!keepOpen) onClose();
  };
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="row">
        <Search size={16} className="muted" />
        <input className="input" autoFocus placeholder="Поиск по названию" value={q} onChange={(e) => setQ(e.target.value)} />
        {toolbar}
      </div>
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="panel list" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          {allowCustom && q.trim() && (
            <button className="list-item" onClick={() => pick(null, q.trim())}>
              <span className="grow">Добавить «{q.trim()}» как свой предмет</span>
            </button>
          )}
          {rows.length === 0 && !q && (
            <div className="panel-pad muted">
              В библиотеке пока нет записей раздела «{KIND_NAMES[kind]?.many}». Создайте свою или импортируйте с dnd.su в разделе «Библиотека».
            </div>
          )}
          {rows.map((r) => (
            <button key={r.id} className="list-item" onClick={() => pick(r)}>
              <span className="grow">
                <b>{r.name}</b>
                {r.data?.book && <span className="muted small"> · {bookShort(r.data.book)}</span>}
                {kind === 'spell' && <span className="muted small"> · {levelName(r.data.level ?? 0)}, {schoolName(r.data.school)}</span>}
                {kind === 'monster' && <span className="muted small"> · ПО {r.data.cr}, {r.data.type}</span>}
              </span>
              <span className="chip small">{r.owner_id ? 'своё' : r.source}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
