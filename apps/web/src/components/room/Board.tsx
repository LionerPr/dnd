import { Eraser, EyeOff, Grid3x3, Hand, ImageUp, Minus, MousePointer2, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterView, Npc } from '../../api/client';
import { useBoard, useBoardOps, type Board as BoardT, type Token } from '../../lib/board';
import { fileUrl, imageSize, uploadFile } from '../../lib/files';
import { ConfirmButton, Loading, useToast } from '../ui';

type Tool = 'move' | 'pen' | 'erase' | 'hand';
const COLORS = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#ecf0f1', '#1b1b1b'];
const WIDTHS = [3, 6, 12];
const TOKEN_COLORS = ['#3a6db3', '#b33a3a', '#3a8f5a', '#8a5bb3', '#b3893a', '#555555'];

interface View { x: number; y: number; scale: number }

/** Упростить линию: выкинуть точки ближе 2 пикселей доски к предыдущей */
function simplify(points: number[], min = 3) {
  const out: number[] = [points[0]!, points[1]!];
  for (let i = 2; i < points.length; i += 2) {
    const dx = points[i]! - out[out.length - 2]!;
    const dy = points[i + 1]! - out[out.length - 1]!;
    if (dx * dx + dy * dy >= min * min) out.push(points[i]!, points[i + 1]!);
  }
  return out.slice(0, 1200);
}

export function BoardView({ campaignId, dm, userId, characters, npcs }: { campaignId: string; dm: boolean; userId: string; characters: CharacterView[]; npcs: Npc[] }) {
  const q = useBoard(campaignId);
  if (!q.data) return <Loading />;
  return <BoardCanvas campaignId={campaignId} board={q.data} dm={dm} userId={userId} characters={characters} npcs={npcs} />;
}

function BoardCanvas({ campaignId, board, dm, userId, characters, npcs }: { campaignId: string; board: BoardT; dm: boolean; userId: string; characters: CharacterView[]; npcs: Npc[] }) {
  const toast = useToast();
  const send = useBoardOps(campaignId);
  const svg = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(WIDTHS[1]!);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 0 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const run = (ops: unknown[]) => send(ops).catch((e: Error) => toast(e.message, 'error'));

  const mine = useMemo(() => new Set(characters.filter((c) => c.ownerId === userId).map((c) => c.id)), [characters, userId]);
  const canMove = (t: Token) => dm || (t.kind === 'character' && !!t.refId && mine.has(t.refId)) || t.ownerId === userId;
  const canDraw = dm || board.playersDraw;

  // Вписать доску в окно при первом показе и при смене карты
  const fit = () => {
    const el = wrap.current;
    if (!el) return;
    const s = Math.min(el.clientWidth / board.width, el.clientHeight / board.height);
    setView({ scale: s, x: (el.clientWidth - board.width * s) / 2, y: (el.clientHeight - board.height * s) / 2 });
  };
  useEffect(fit, [board.mapFileId, board.width, board.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const toBoard = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.scale, y: (clientY - r.top - view.y) / view.scale };
  };

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = wrap.current!;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    setView((v) => {
      const scale = Math.min(6, Math.max(0.05, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 1 || tool === 'hand' || (tool === 'move' && e.target === e.currentTarget) || (tool === 'move' && (e.target as Element).closest('[data-bg]'))) {
      pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      setSelected(null);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'pen' && canDraw) {
      const p = toBoard(e.clientX, e.clientY);
      setDraft([p.x, p.y]);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (pan.current) {
      const p = pan.current;
      setView((v) => ({ ...v, x: p.vx + e.clientX - p.sx, y: p.vy + e.clientY - p.sy }));
      return;
    }
    if (drag) {
      const p = toBoard(e.clientX, e.clientY);
      setDrag({ ...drag, x: p.x, y: p.y });
      return;
    }
    if (draft) {
      const p = toBoard(e.clientX, e.clientY);
      setDraft((d) => (d ? [...d, p.x, p.y] : d));
    }
  };
  const onUp = () => {
    pan.current = null;
    if (drag) {
      const snap = (v: number) => (board.showGrid ? Math.round(v / (board.grid / 2)) * (board.grid / 2) : v);
      const x = snap(drag.x);
      const y = snap(drag.y);
      setDrag(null);
      run([{ t: 'token-move', id: drag.id, x, y }]);
    }
    if (draft) {
      const pts = draft.length >= 4 ? simplify(draft) : [...draft, draft[0]! + 0.5, draft[1]! + 0.5];
      setDraft(null);
      run([{ t: 'stroke', stroke: { color, width, points: pts } }]);
    }
  };

  const center = () => {
    const el = wrap.current!;
    const p = { x: (el.clientWidth / 2 - view.x) / view.scale, y: (el.clientHeight / 2 - view.y) / view.scale };
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };

  const onBoard = new Set(board.tokens.map((t) => `${t.kind}:${t.refId}`));
  const missingHeroes = characters.filter((c) => (dm || mine.has(c.id)) && !onBoard.has(`character:${c.id}`));
  const missingNpcs = dm ? npcs.filter((n) => !onBoard.has(`npc:${n.id}`)) : [];

  const addTokens = (list: { kind: Token['kind']; refId?: string; label: string; color?: string; hidden?: boolean }[]) => {
    const c = center();
    const step = board.grid;
    const perRow = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    run(list.map((t, i) => ({ t: 'token-add', token: { ...t, x: c.x + ((i % perRow) - (perRow - 1) / 2) * step, y: c.y + (Math.floor(i / perRow) - 0.5) * step } })));
  };

  const uploadMap = async (file: File) => {
    try {
      setUploading(0);
      const f = await uploadFile(campaignId, file, 'map', setUploading);
      const size = f.width && f.height ? { width: f.width, height: f.height } : await imageSize(f.id);
      // Клетка ~ 1/25 ширины карты, если сетку ещё не подгоняли
      await send([{ t: 'settings', mapFileId: f.id, width: size.width, height: size.height, grid: Math.max(20, Math.round(size.width / 25)) }]);
      toast('Карта на доске');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploading(null);
    }
  };

  const sel = board.tokens.find((t) => t.id === selected);
  const cursor = tool === 'pen' ? 'crosshair' : tool === 'hand' ? 'grab' : tool === 'erase' ? 'cell' : 'default';

  return (
    <div className="board">
      <div className="board-bar">
        <div className="seg-tools">
          <button className={`btn sm icon${tool === 'move' ? ' accent' : ''}`} title="Двигать фишки" onClick={() => setTool('move')}><MousePointer2 /></button>
          <button className={`btn sm icon${tool === 'hand' ? ' accent' : ''}`} title="Двигать доску" onClick={() => setTool('hand')}><Hand /></button>
          {canDraw && <button className={`btn sm icon${tool === 'pen' ? ' accent' : ''}`} title="Рисовать" onClick={() => setTool('pen')}><Pencil /></button>}
          {canDraw && <button className={`btn sm icon${tool === 'erase' ? ' accent' : ''}`} title="Стереть линию (нажмите на неё)" onClick={() => setTool('erase')}><Eraser /></button>}
        </div>
        {tool === 'pen' && (
          <div className="row" style={{ gap: 4 }}>
            {COLORS.map((c) => (
              <button key={c} className={`swatch${c === color ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => setColor(c)} />
            ))}
            {WIDTHS.map((w) => (
              <button key={w} className={`btn xs${w === width ? ' accent' : ''}`} onClick={() => setWidth(w)} title="Толщина">
                <i className="dot-w" style={{ width: w / 1.5 + 2, height: w / 1.5 + 2, background: color }} />
              </button>
            ))}
          </div>
        )}
        <div className="grow" />
        <button className="btn sm icon" title="Отдалить" onClick={() => zoomAt(1 / 1.25)}><Minus /></button>
        <button className="btn sm" title="Вписать в окно" onClick={fit}>{Math.round(view.scale * 100)}%</button>
        <button className="btn sm icon" title="Приблизить" onClick={() => zoomAt(1.25)}><Plus /></button>
        {missingHeroes.length > 0 && (
          <button className="btn sm" onClick={() => addTokens(missingHeroes.map((c) => ({ kind: 'character', refId: c.id, label: c.data.name, color: '#3a6db3' })))}>
            <Users /> {dm ? 'Поставить героев' : 'Поставить героя'}
          </button>
        )}
        {dm && missingNpcs.length > 0 && (
          <button className="btn sm" onClick={() => addTokens(missingNpcs.map((n) => ({ kind: 'npc', refId: n.id, label: n.data.name, color: n.data.ally ? '#3a8f5a' : '#b33a3a', hidden: n.data.hidden })))}>
            <UserPlus /> Существа ({missingNpcs.length})
          </button>
        )}
        {dm && (
          <button className="btn sm" onClick={() => addTokens([{ kind: 'custom', label: 'Метка', color: '#b3893a' }])} title="Метка без привязки: ловушка, сундук, дверь">
            <Plus /> Метка
          </button>
        )}
        {dm && (
          <label className="btn sm" title="Загрузить карту (картинку)">
            <ImageUp /> {uploading !== null ? `${Math.round(uploading * 100)}%` : 'Карта'}
            <input type="file" accept="image/*" hidden disabled={uploading !== null} onChange={(e) => e.target.files?.[0] && uploadMap(e.target.files[0])} />
          </label>
        )}
      </div>

      {dm && (
        <div className="board-bar small">
          <label className="check">
            <input type="checkbox" checked={board.showGrid} onChange={(e) => run([{ t: 'settings', showGrid: e.target.checked }])} /> <Grid3x3 size={14} /> Сетка
          </label>
          {board.showGrid && (
            <label className="row" style={{ gap: 6 }}>
              клетка
              <input className="input sm num" type="number" min={10} max={400} value={board.grid} style={{ width: 70 }} onChange={(e) => Number(e.target.value) >= 10 && run([{ t: 'settings', grid: Number(e.target.value) }])} />
              пикс.
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={board.playersDraw} onChange={(e) => run([{ t: 'settings', playersDraw: e.target.checked }])} /> Игроки рисуют
          </label>
          {board.mapFileId && (
            <button className="btn ghost xs" onClick={() => run([{ t: 'settings', mapFileId: null }])}>Убрать карту</button>
          )}
          <div className="grow" />
          {board.strokes.length > 0 && (
            <ConfirmButton className="btn ghost xs" confirm="Стереть всё?" onConfirm={() => run([{ t: 'strokes-clear' }])}>
              <Eraser size={14} /> Стереть рисунки
            </ConfirmButton>
          )}
        </div>
      )}

      <div className="board-stage" ref={wrap}>
        <svg ref={svg} className="board-svg" style={{ cursor }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <defs>
            <pattern id={`grid-${campaignId}`} width={board.grid} height={board.grid} patternUnits="userSpaceOnUse">
              <path d={`M ${board.grid} 0 L 0 0 0 ${board.grid}`} fill="none" stroke="rgba(0,0,0,.28)" strokeWidth={1 / Math.max(view.scale, 0.2)} />
            </pattern>
            {board.tokens.filter((t) => t.imageFileId).map((t) => (
              <clipPath key={t.id} id={`clip-${t.id}`}>
                <circle r={(board.grid * t.size) / 2 - 2} />
              </clipPath>
            ))}
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale || 1})`}>
            <rect data-bg width={board.width} height={board.height} className="board-paper" />
            {board.mapFileId && <image data-bg href={fileUrl(board.mapFileId)} width={board.width} height={board.height} preserveAspectRatio="none" />}
            {board.showGrid && <rect data-bg width={board.width} height={board.height} fill={`url(#grid-${campaignId})`} pointerEvents="none" />}
            {board.strokes.map((s) => (
              <polyline
                key={s.id}
                points={s.points.join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={tool === 'erase' && (dm || s.authorId === userId) ? 'erasable' : undefined}
                pointerEvents={tool === 'erase' ? 'stroke' : 'none'}
                onPointerDown={(e) => {
                  if (tool !== 'erase' || !(dm || s.authorId === userId)) return;
                  e.stopPropagation();
                  run([{ t: 'stroke-remove', id: s.id }]);
                }}
              />
            ))}
            {draft && <polyline points={draft.join(' ')} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />}
            {board.tokens.map((t) => {
              const pos = drag?.id === t.id ? drag : t;
              const r = (board.grid * t.size) / 2;
              const movable = tool === 'move' && canMove(t);
              return (
                <g
                  key={t.id}
                  className={`token${drag?.id === t.id ? ' dragging' : ''}${t.hidden ? ' hidden-token' : ''}${selected === t.id ? ' selected' : ''}`}
                  style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, cursor: movable ? 'grab' : undefined }}
                  onPointerDown={(e) => {
                    if (tool !== 'move') return;
                    e.stopPropagation();
                    setSelected(t.id);
                    if (!movable) return;
                    (svg.current as Element).setPointerCapture(e.pointerId);
                    setDrag({ id: t.id, x: t.x, y: t.y });
                  }}
                >
                  <circle r={r} fill={t.color} stroke="#fff" strokeWidth={Math.max(2, r * 0.08)} />
                  {t.imageFileId ? (
                    <image href={fileUrl(t.imageFileId)} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#clip-${t.id})`} preserveAspectRatio="xMidYMid slice" />
                  ) : (
                    <text className="token-initial" fontSize={r * 0.9} dy={r * 0.32}>{t.label.trim().charAt(0).toUpperCase()}</text>
                  )}
                  <text className="token-label" y={r + Math.max(12, r * 0.45)} fontSize={Math.max(11, r * 0.42)}>{t.label}</text>
                </g>
              );
            })}
          </g>
        </svg>
        {!board.mapFileId && board.tokens.length === 0 && board.strokes.length === 0 && (
          <div className="board-hint">
            {dm ? 'Загрузите карту кнопкой «Карта» и поставьте героев. Колёсико мыши — масштаб, перетаскивание пустого места — сдвиг доски.' : 'Мастер ещё не выложил карту. Можно поставить своего героя и рисовать, если мастер разрешил.'}
          </div>
        )}
      </div>

      {sel && (dm || canMove(sel)) && (
        <div className="board-bar small">
          <b>{sel.label}</b>
          <input className="input sm" style={{ width: 140 }} defaultValue={sel.label} key={sel.id} onBlur={(e) => e.target.value.trim() && e.target.value !== sel.label && run([{ t: 'token-update', id: sel.id, patch: { label: e.target.value.trim() } }])} />
          <label className="row" style={{ gap: 4 }}>
            размер
            <select className="select sm" value={sel.size} onChange={(e) => run([{ t: 'token-update', id: sel.id, patch: { size: Number(e.target.value) } }])}>
              <option value={0.5}>крошечный</option>
              <option value={1}>средний</option>
              <option value={2}>большой</option>
              <option value={3}>огромный</option>
              <option value={4}>громадный</option>
            </select>
          </label>
          <div className="row" style={{ gap: 3 }}>
            {TOKEN_COLORS.map((c) => (
              <button key={c} className={`swatch${c === sel.color ? ' on' : ''}`} style={{ background: c }} onClick={() => run([{ t: 'token-update', id: sel.id, patch: { color: c } }])} />
            ))}
          </div>
          {dm && (
            <label className="check">
              <input type="checkbox" checked={!!sel.hidden} onChange={(e) => run([{ t: 'token-update', id: sel.id, patch: { hidden: e.target.checked } }])} /> <EyeOff size={14} /> скрыта от игроков
            </label>
          )}
          <div className="grow" />
          <button className="btn ghost xs" onClick={() => { run([{ t: 'token-remove', id: sel.id }]); setSelected(null); }}>
            <Trash2 size={14} /> Убрать с доски
          </button>
        </div>
      )}
    </div>
  );
}
