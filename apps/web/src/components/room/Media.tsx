import { ImagePlus, Maximize2, MonitorUp, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import { setShown, useBoard, useBoardOps, useShown } from '../../lib/board';
import { fileUrl, uploadFile } from '../../lib/files';
import { Empty, Loading, useToast } from '../ui';

/** Лента картинок кампании: раздаточные материалы, портреты, находки. Мастер может показать любую всем на весь экран. */
export function MediaView({ campaignId, dm, userId }: { campaignId: string; dm: boolean; userId: string }) {
  const toast = useToast();
  const q = useBoard(campaignId);
  const send = useBoardOps(campaignId);
  const [caption, setCaption] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  const upload = async (files: FileList) => {
    try {
      for (const [i, file] of [...files].entries()) {
        setProgress(0);
        const f = await uploadFile(campaignId, file, 'image', (p) => setProgress((i + p) / files.length));
        await send([{ t: 'media-add', fileId: f.id, caption: caption.trim() || undefined }]);
      }
      setCaption('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProgress(null);
    }
  };
  const showAll = (fileId: string, caption?: string) => api(`/campaigns/${campaignId}/board/show`, { body: { fileId, caption } }).then(() => toast('Показано всем')).catch((e: Error) => toast(e.message, 'error'));

  if (!q.data) return <Loading />;
  const media = q.data.media;
  return (
    <div className="stack">
      <div className="panel panel-pad row wrap" style={{ gap: 8 }}>
        <input className="input grow" placeholder="Подпись (необязательно)" value={caption} maxLength={300} onChange={(e) => setCaption(e.target.value)} />
        <label className="btn primary">
          <ImagePlus /> {progress !== null ? `Загрузка ${Math.round(progress * 100)}%` : 'Добавить картинки'}
          <input type="file" accept="image/*" multiple hidden disabled={progress !== null} onChange={(e) => e.target.files?.length && upload(e.target.files)} />
        </label>
      </div>
      {media.length === 0 ? (
        <Empty title="Пока пусто">Сюда кидают карты местности, портреты, письма и всё, что нашли герои. Картинки видят все участники кампании.</Empty>
      ) : (
        <div className="media-grid">
          {media.map((m) => (
            <figure key={m.id} className="media-card">
              <button className="media-img" onClick={() => setShown({ fileId: m.fileId, caption: m.caption })} title="Открыть">
                <img src={fileUrl(m.fileId)} alt={m.caption ?? ''} loading="lazy" />
              </button>
              <figcaption>
                <div className="grow" style={{ minWidth: 0 }}>
                  {m.caption && <div className="media-caption">{m.caption}</div>}
                  <div className="small muted">{m.authorName} · {new Date(m.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                {dm && (
                  <button className="btn ghost xs icon" title="Показать всем на весь экран" onClick={() => showAll(m.fileId, m.caption)}>
                    <MonitorUp />
                  </button>
                )}
                {(dm || m.authorId === userId) && (
                  <button className="btn ghost xs icon" title="Убрать" onClick={() => send([{ t: 'media-remove', id: m.id }]).catch((e: Error) => toast(e.message, 'error'))}>
                    <Trash2 />
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

/** Картинка на весь экран — по нажатию или когда мастер показывает всем */
export function Lightbox() {
  const s = useShown();
  if (!s) return null;
  return (
    <div className="lightbox" onClick={() => setShown(null)} role="dialog" aria-label="Картинка">
      <button className="btn icon lightbox-close" aria-label="Закрыть" onClick={() => setShown(null)}>
        <X />
      </button>
      <img src={fileUrl(s.fileId)} alt={s.caption ?? ''} onClick={(e) => e.stopPropagation()} />
      {s.caption && <div className="lightbox-caption">{s.caption}</div>}
      <a className="btn sm lightbox-open" href={fileUrl(s.fileId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        <Maximize2 /> В полном размере
      </a>
    </div>
  );
}
