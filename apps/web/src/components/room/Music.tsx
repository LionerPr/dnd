import { Music2, Pause, Play, Repeat, Trash2, Upload, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useBoard, useBoardOps, useFiles, type MusicState } from '../../lib/board';
import { formatSize, trackName, uploadFile } from '../../lib/files';
import { music, useMusicStatus } from '../../lib/music';
import { ConfirmButton, Empty, Loading, useToast } from '../ui';

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

/** Держит звук в согласии с мастером, пока открыта комната (на любой вкладке) */
export function MusicEngineMount({ campaignId }: { campaignId: string }) {
  const q = useBoard(campaignId);
  const m = q.data?.music;
  useEffect(() => {
    if (m) music.apply(m);
  }, [m]);
  useEffect(() => () => music.stop(), []);
  return null;
}

/** Плашка «включить звук», если браузер заблокировал автозапуск */
export function SoundUnlock() {
  const s = useMusicStatus();
  if (!s.blocked) return null;
  return (
    <button className="btn accent sound-unlock" onClick={() => music.unlock()}>
      <Volume2 /> Мастер включил музыку — нажмите, чтобы слышать
    </button>
  );
}

function LocalVolume() {
  useMusicStatus();
  const { volume, muted } = music.local;
  return (
    <div className="row" style={{ gap: 6 }} title="Громкость у вас — на других не влияет">
      <button className="btn ghost sm icon" onClick={() => music.setLocal(volume, !muted)} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
        {muted ? <VolumeX /> : <Volume2 />}
      </button>
      <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume} onChange={(e) => music.setLocal(Number(e.target.value), false)} style={{ width: 110 }} />
    </div>
  );
}

function Progress({ m }: { m: MusicState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  const d = music.duration();
  const c = music.currentTime();
  const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '—');
  if (!m.trackId || !d) return null;
  return (
    <div className="row small muted" style={{ gap: 8 }}>
      <span className="num">{fmt(c)}</span>
      <div className="hp-bar grow" style={{ height: 4 }}>
        <i style={{ width: `${(c / d) * 100}%`, background: 'var(--accent)' }} />
      </div>
      <span className="num">{fmt(d)}</span>
    </div>
  );
}

export function MusicView({ campaignId, dm }: { campaignId: string; dm: boolean }) {
  const toast = useToast();
  const board = useBoard(campaignId);
  const files = useFiles(campaignId);
  const send = useBoardOps(campaignId);
  const status = useMusicStatus();
  const [progress, setProgress] = useState<{ name: string; p: number } | null>(null);
  const run = (op: Record<string, unknown>) => send([{ t: 'music', ...op }]).catch((e: Error) => toast(e.message, 'error'));

  if (!board.data || !files.data) return <Loading />;
  const m = board.data.music;
  const tracks = files.data.files.filter((f) => f.kind === 'audio').sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  const current = tracks.find((t) => t.id === m.trackId);

  const upload = async (list: FileList) => {
    try {
      for (const file of [...list]) {
        setProgress({ name: file.name, p: 0 });
        await uploadFile(campaignId, file, 'audio', (p) => setProgress({ name: file.name, p }));
      }
      toast(list.length > 1 ? `Загружено треков: ${list.length}` : 'Трек загружен');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="stack">
      <div className="panel panel-pad stack now-playing">
        <div className="row" style={{ gap: 12 }}>
          <div className={`np-disc${m.playing ? ' spinning' : ''}`}>
            <Music2 />
          </div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="caps muted">{m.playing ? 'Играет' : current ? 'На паузе' : 'Тишина'}</div>
            <div className="np-title">{current ? trackName(current.name) : dm ? 'Выберите трек из списка' : 'Мастер пока ничего не включил'}</div>
            {status.loading && <div className="small muted">Загружается…</div>}
            {status.error && <div className="small error-text">{status.error}</div>}
          </div>
          {dm && current && (
            <button className="btn primary icon lg" onClick={() => run({ playing: !m.playing })} aria-label={m.playing ? 'Пауза' : 'Играть'} title={m.playing ? 'Пауза (плавно затихнет)' : 'Играть (плавно нарастёт)'}>
              {m.playing ? <Pause /> : <Play />}
            </button>
          )}
        </div>
        <Progress m={m} />
        <div className="row wrap" style={{ gap: 14 }}>
          <LocalVolume />
          {dm && (
            <>
              <label className="row small" style={{ gap: 6 }} title="Громкость для всех">
                для всех
                <input type="range" min={0} max={1} step={0.05} value={m.volume} onChange={(e) => run({ volume: Number(e.target.value) })} style={{ width: 90 }} />
              </label>
              <label className="row small" style={{ gap: 6 }}>
                скорость
                <select className="select sm" value={m.speed} onChange={(e) => run({ speed: Number(e.target.value) })}>
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>×{s}</option>
                  ))}
                </select>
              </label>
              <label className="row small" style={{ gap: 6 }} title="Затухание и нарастание при смене трека и паузе">
                переход
                <select className="select sm" value={m.fade} onChange={(e) => run({ fade: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 5, 8].map((s) => (
                    <option key={s} value={s}>{s ? `${s} с` : 'сразу'}</option>
                  ))}
                </select>
              </label>
              <span className="small muted row" style={{ gap: 4 }}><Repeat size={14} /> по кругу</span>
            </>
          )}
        </div>
      </div>

      {dm && (
        <div className="row wrap between">
          <label className="btn">
            <Upload /> {progress ? `${trackName(progress.name)}: ${Math.round(progress.p * 100)}%` : 'Загрузить треки'}
            <input type="file" accept="audio/*" multiple hidden disabled={!!progress} onChange={(e) => e.target.files?.length && upload(e.target.files)} />
          </label>
          <span className="small muted">Названия — как у файлов. Занято {formatSize(files.data.used)} из {formatSize(files.data.quota)}</span>
        </div>
      )}

      {tracks.length === 0 ? (
        <Empty title="Плейлист пуст">{dm ? 'Загрузите mp3 или ogg — их услышат все в комнате. При выборе трека музыка сменится плавно.' : 'Мастер ещё не загрузил музыку.'}</Empty>
      ) : (
        <div className="panel list">
          {tracks.map((t, i) => {
            const on = t.id === m.trackId;
            return (
              <div key={t.id} className={`list-item track${on ? ' on' : ''}`}>
                <span className="num muted" style={{ width: 22 }}>{on && m.playing ? '♪' : i + 1}</span>
                {dm ? (
                  <button className="track-name grow" onClick={() => run({ trackId: t.id, playing: true })} title="Сменить трек плавно">
                    {trackName(t.name)}
                  </button>
                ) : (
                  <span className="grow">{trackName(t.name)}</span>
                )}
                <span className="small muted">{formatSize(t.size)}</span>
                {dm && (
                  <ConfirmButton className="btn ghost xs icon" confirm="✕" onConfirm={() => api(`/files/${t.id}`, { method: 'DELETE' }).then(() => { if (on) run({ trackId: null, playing: false }); }).catch((e: Error) => toast(e.message, 'error'))}>
                    <Trash2 />
                  </ConfirmButton>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
