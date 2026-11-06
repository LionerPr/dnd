import {
  ArrowDownToLine,
  ArrowUpToLine,
  Eraser,
  EyeOff,
  Grid3x3,
  Hand,
  ImagePlus,
  ImageUp,
  Minus,
  MousePointer2,
  Paintbrush,
  Pencil,
  Plus,
  Square,
  StickyNote,
  Trash2,
  Type,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterView, Npc } from '../../api/client';
import { useBoard, useBoardOps, type Board as BoardT, type BoardItem, type Token } from '../../lib/board';
import { fileUrl, imageSize, uploadFile } from '../../lib/files';
import { ConfirmButton, Loading, useToast } from '../ui';

type Tool = 'move' | 'hand' | 'pen' | 'erase' | 'tile' | 'note' | 'text' | 'rect';
const COLORS = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#ecf0f1', '#1b1b1b'];
const WIDTHS = [3, 6, 12];
const TOKEN_COLORS = ['#3a6db3', '#b33a3a', '#3a8f5a', '#8a5bb3', '#b3893a', '#555555'];
/** Сплошные цвета местности для тайлов */
const TILE_COLORS: { c: string; name: string }[] = [
  { c: '#a59a89', name: 'Камень, пол' },
  { c: '#6f6658', name: 'Тёмный камень' },
  { c: '#2a2724', name: 'Стена' },
  { c: '#8b5e34', name: 'Дерево' },
  { c: '#5d8a3c', name: 'Трава' },
  { c: '#355e2b', name: 'Лес' },
  { c: '#d6c28c', name: 'Песок' },
  { c: '#3d78b0', name: 'Вода' },
  { c: '#1f4a75', name: 'Глубокая вода' },
  { c: '#c4501f', name: 'Лава' },
  { c: '#e8eef2', name: 'Снег' },
  { c: '#7b4fa0', name: 'Магия' },
];
const NOTE_COLORS = ['#f7e27a', '#f6b3a6', '#b7e0a5', '#a9d2f2', '#d9c2f0', '#ffffff'];
const SHAPE_COLORS = ['#c0392b', '#e67e22', '#27ae60', '#2980b9', '#8e44ad', '#1b1b1b'];

interface View { x: number; y: number; scale: number }

/** Упростить линию: выкинуть точки ближе 3 пикселей доски к предыдущей */
function simplify(points: number[], min = 3) {
  const out: number[] = [points[0]!, points[1]!];
  for (let i = 2; i < points.length; i += 2) {
    const dx = points[i]! - out[out.length - 2]!;
    const dy = points[i + 1]! - out[out.length - 1]!;
    if (dx * dx + dy * dy >= min * min) out.push(points[i]!, points[i + 1]!);
  }
  return out.slice(0, 1200);
}

/** Клетки на отрезке между двумя клетками — чтобы быстрый мазок не оставлял дыр */
function cellsBetween(a: [number, number], b: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
  for (let i = 0; i <= n; i++) out.push([Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n)]);
  return out;
}

export function BoardView({ campaignId, dm, userId, characters, npcs }: { campaignId: string; dm: boolean; userId: string; characters: CharacterView[]; npcs: Npc[] }) {
  const q = useBoard(campaignId);
  if (!q.data) return <Loading />;
  return <BoardCanvas campaignId={campaignId} board={q.data} dm={dm} userId={userId} characters={characters} npcs={npcs} />;
}

type ItemDrag = { id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; x: number; y: number; w: number; h: number };

function BoardCanvas({ campaignId, board, dm, userId, characters, npcs }: { campaignId: string; board: BoardT; dm: boolean; userId: string; characters: CharacterView[]; npcs: Npc[] }) {
  const toast = useToast();
  const send = useBoardOps(campaignId);
  const svg = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(WIDTHS[1]!);
  const [tileColor, setTileColor] = useState<string | null>(TILE_COLORS[0]!.c);
  const [brush, setBrush] = useState(1);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 0 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [itemDrag, setItemDrag] = useState<ItemDrag | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [painting, setPainting] = useState<Map<string, [number, number]> | null>(null);
  const lastCell = useRef<[number, number] | null>(null);
  const paintingActive = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selItem, setSelItem] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const run = (ops: unknown[]) => send(ops).catch((e: Error) => toast(e.message, 'error'));

  const mine = useMemo(() => new Set(characters.filter((c) => c.ownerId === userId).map((c) => c.id)), [characters, userId]);
  const canMove = (t: Token) => dm || (t.kind === 'character' && !!t.refId && mine.has(t.refId)) || t.ownerId === userId;
  const canDraw = dm || board.playersDraw;
  const canEditItem = (it: BoardItem) => dm || it.authorId === userId;
  const g = board.grid;

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
  const cellAt = (clientX: number, clientY: number): [number, number] => {
    const p = toBoard(clientX, clientY);
    return [Math.floor(p.x / g), Math.floor(p.y / g)];
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

  const center = () => {
    const el = wrap.current!;
    return { x: Math.round((el.clientWidth / 2 - view.x) / view.scale), y: Math.round((el.clientHeight / 2 - view.y) / view.scale) };
  };

  // ---------- Картинки: перетащить файл, вставить из буфера, кнопка ----------
  const addImages = async (files: File[], at?: { x: number; y: number }) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    if (!canDraw) return toast('Мастер выключил рисование для игроков', 'error');
    try {
      let { x, y } = at ?? center();
      for (const [i, file] of imgs.entries()) {
        setUploading(0);
        const f = await uploadFile(campaignId, file, 'image', (p) => setUploading((i + p) / imgs.length));
        const size = f.width && f.height ? { width: f.width, height: f.height } : await imageSize(f.id);
        const maxW = Math.max(g * 3, board.width * 0.3);
        const k = Math.min(1, maxW / size.width);
        const w = Math.round(size.width * k);
        const h = Math.round(size.height * k);
        const ops = await send([{ t: 'item-add', item: { type: 'image', fileId: f.id, x: Math.round(x - w / 2), y: Math.round(y - h / 2), w, h } }]);
        const added = ops.find((o) => o.t === 'item-set');
        if (added && added.t === 'item-set') setSelItem(added.item.id);
        x += 30;
        y += 30;
      }
      setTool('move');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploading(null);
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault();
        addImages(files);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selItem) {
        const it = board.items.find((i) => i.id === selItem);
        if (it && canEditItem(it)) {
          e.preventDefault();
          run([{ t: 'item-remove', id: selItem }]);
          setSelItem(null);
        }
      }
      if (e.key === 'Escape') {
        setSelItem(null);
        setSelected(null);
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  });

  // ---------- Указатель ----------
  const paintAt = (cell: [number, number]) => {
    const from = lastCell.current ?? cell;
    lastCell.current = cell;
    setPainting((prev) => {
      const m = new Map(prev ?? []);
      for (const [cx, cy] of cellsBetween(from, cell)) {
        for (let dx = 0; dx < brush; dx++) for (let dy = 0; dy < brush; dy++) {
          const c: [number, number] = [cx + dx - Math.floor((brush - 1) / 2), cy + dy - Math.floor((brush - 1) / 2)];
          m.set(`${c[0]},${c[1]}`, c);
        }
      }
      return m;
    });
  };

  const onDown = (e: React.PointerEvent) => {
    const onBg = e.target === e.currentTarget || !!(e.target as Element).closest('[data-bg]');
    if (e.button === 1 || tool === 'hand' || (tool === 'move' && onBg)) {
      pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      setSelected(null);
      setSelItem(null);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (!canDraw) return;
    if (tool === 'pen') {
      const p = toBoard(e.clientX, e.clientY);
      setDraft([p.x, p.y]);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } else if (tool === 'tile') {
      lastCell.current = null;
      paintingActive.current = true;
      paintAt(cellAt(e.clientX, e.clientY));
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } else if (tool === 'note' || tool === 'text' || tool === 'rect') {
      const p = toBoard(e.clientX, e.clientY);
      const size = tool === 'note' ? { w: Math.max(180, g * 3), h: Math.max(150, g * 2.5) } : tool === 'text' ? { w: Math.max(260, g * 5), h: Math.max(60, g * 1.1) } : { w: g * 3, h: g * 2 };
      const item = {
        type: tool,
        x: Math.round(p.x),
        y: Math.round(p.y),
        ...size,
        text: tool === 'rect' ? undefined : '',
        color: tool === 'note' ? NOTE_COLORS[0] : tool === 'rect' ? SHAPE_COLORS[0] : '#1b1b1b',
      };
      send([{ t: 'item-add', item }])
        .then((ops) => {
          const added = ops.find((o) => o.t === 'item-set');
          if (added && added.t === 'item-set') {
            setSelItem(added.item.id);
            if (tool !== 'rect') setEditing(added.item.id);
          }
          setTool('move');
        })
        .catch((err: Error) => toast(err.message, 'error'));
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
    if (itemDrag) {
      const p = toBoard(e.clientX, e.clientY);
      const dx = p.x - itemDrag.sx;
      const dy = p.y - itemDrag.sy;
      if (itemDrag.mode === 'move') setItemDrag({ ...itemDrag, x: itemDrag.ox + dx, y: itemDrag.oy + dy });
      else {
        const it = board.items.find((i) => i.id === itemDrag.id);
        // Картинка тянется с сохранением пропорций
        let w = Math.max(20, itemDrag.ow + dx);
        let h = Math.max(20, itemDrag.oh + dy);
        if (it?.type === 'image') h = (w * itemDrag.oh) / itemDrag.ow;
        if (it?.type === 'image' && h < 20) {
          h = 20;
          w = (h * itemDrag.ow) / itemDrag.oh;
        }
        setItemDrag({ ...itemDrag, w, h });
      }
      return;
    }
    if (draft) {
      const p = toBoard(e.clientX, e.clientY);
      setDraft((d) => (d ? [...d, p.x, p.y] : d));
      return;
    }
    if (paintingActive.current) paintAt(cellAt(e.clientX, e.clientY));
  };
  const onUp = () => {
    pan.current = null;
    if (drag) {
      const snap = (v: number) => (board.showGrid ? Math.round(v / (g / 2)) * (g / 2) : v);
      const x = snap(drag.x);
      const y = snap(drag.y);
      setDrag(null);
      run([{ t: 'token-move', id: drag.id, x, y }]);
    }
    if (itemDrag) {
      const d = itemDrag;
      setItemDrag(null);
      const moved = Math.abs(d.x - d.ox) > 0.5 || Math.abs(d.y - d.oy) > 0.5 || Math.abs(d.w - d.ow) > 0.5 || Math.abs(d.h - d.oh) > 0.5;
      if (moved) run([{ t: 'item-update', id: d.id, patch: d.mode === 'move' ? { x: Math.round(d.x), y: Math.round(d.y) } : { w: Math.round(d.w), h: Math.round(d.h) } }]);
    }
    if (draft) {
      const pts = draft.length >= 4 ? simplify(draft) : [...draft, draft[0]! + 0.5, draft[1]! + 0.5];
      setDraft(null);
      run([{ t: 'stroke', stroke: { color, width, points: pts } }]);
    }
    if (paintingActive.current && painting) {
      paintingActive.current = false;
      const cells = [...painting.values()];
      lastCell.current = null;
      // Мазок разом; ответ сервера применит тайлы к доске, а черновик держим до него
      const chunks: [number, number][][] = [];
      for (let i = 0; i < cells.length; i += 4000) chunks.push(cells.slice(i, i + 4000));
      Promise.all(chunks.map((c) => send([{ t: 'tiles', cells: c, color: tileColor }])))
        .catch((e: Error) => toast(e.message, 'error'))
        .finally(() => setPainting(null));
    }
  };

  const onBoard = new Set(board.tokens.map((t) => `${t.kind}:${t.refId}`));
  const missingHeroes = characters.filter((c) => (dm || mine.has(c.id)) && !onBoard.has(`character:${c.id}`));
  const missingNpcs = dm ? npcs.filter((n) => !onBoard.has(`npc:${n.id}`)) : [];

  const addTokens = (list: { kind: Token['kind']; refId?: string; label: string; color?: string; hidden?: boolean }[]) => {
    const c = center();
    const perRow = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    run(list.map((t, i) => ({ t: 'token-add', token: { ...t, x: c.x + ((i % perRow) - (perRow - 1) / 2) * g, y: c.y + (Math.floor(i / perRow) - 0.5) * g } })));
  };

  const uploadMap = async (file: File) => {
    try {
      setUploading(0);
      const f = await uploadFile(campaignId, file, 'map', setUploading);
      const size = f.width && f.height ? { width: f.width, height: f.height } : await imageSize(f.id);
      await send([{ t: 'settings', mapFileId: f.id, width: size.width, height: size.height, grid: Math.max(20, Math.round(size.width / 25)) }]);
      toast('Карта на доске');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploading(null);
    }
  };

  const sel = board.tokens.find((t) => t.id === selected);
  const item = board.items.find((i) => i.id === selItem);
  const cursor = tool === 'pen' || tool === 'tile' ? 'crosshair' : tool === 'hand' ? 'grab' : tool === 'erase' ? 'cell' : tool === 'move' ? 'default' : 'copy';
  const itemsInteractive = tool === 'move';

  // Тайлы: сохранённые плюс текущий мазок
  const tiles = useMemo(() => {
    const all = Object.entries(board.tiles).map(([k, c]) => {
      const [x, y] = k.split(',').map(Number) as [number, number];
      return { k, x, y, c };
    });
    if (!painting) return all;
    const pending = new Set(painting.keys());
    const rest = all.filter((t) => !pending.has(t.k));
    if (tileColor) for (const [k, [x, y]] of painting) rest.push({ k, x, y, c: tileColor });
    return rest;
  }, [board.tiles, painting, tileColor]);

  const editingItem = board.items.find((i) => i.id === editing);
  const itemBox = (it: BoardItem) => (itemDrag?.id === it.id ? { x: itemDrag.x, y: itemDrag.y, w: itemDrag.w, h: itemDrag.h } : it);

  return (
    <div className="board">
      <div className="board-bar">
        <div className="seg-tools">
          <button className={`btn sm icon${tool === 'move' ? ' accent' : ''}`} title="Выбрать и двигать" onClick={() => setTool('move')}><MousePointer2 /></button>
          <button className={`btn sm icon${tool === 'hand' ? ' accent' : ''}`} title="Двигать доску" onClick={() => setTool('hand')}><Hand /></button>
        </div>
        {canDraw && (
          <div className="seg-tools">
            <button className={`btn sm icon${tool === 'tile' ? ' accent' : ''}`} title="Тайлы: закрашивать клетки" onClick={() => setTool('tile')}><Paintbrush /></button>
            <button className={`btn sm icon${tool === 'pen' ? ' accent' : ''}`} title="Ручка" onClick={() => setTool('pen')}><Pencil /></button>
            <button className={`btn sm icon${tool === 'erase' ? ' accent' : ''}`} title="Стереть линию (нажмите на неё)" onClick={() => setTool('erase')}><Eraser /></button>
          </div>
        )}
        {canDraw && (
          <div className="seg-tools">
            <button className={`btn sm icon${tool === 'note' ? ' accent' : ''}`} title="Заметка: нажмите на доску" onClick={() => setTool('note')}><StickyNote /></button>
            <button className={`btn sm icon${tool === 'text' ? ' accent' : ''}`} title="Надпись: нажмите на доску" onClick={() => setTool('text')}><Type /></button>
            <button className={`btn sm icon${tool === 'rect' ? ' accent' : ''}`} title="Прямоугольник: нажмите на доску" onClick={() => setTool('rect')}><Square /></button>
            <label className="btn sm icon" title="Картинка на доску (можно перетащить файл или вставить Ctrl+V)">
              <ImagePlus />
              <input type="file" accept="image/*" multiple hidden disabled={uploading !== null} onChange={(e) => e.target.files?.length && addImages([...e.target.files])} />
            </label>
          </div>
        )}
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
        {uploading !== null && <span className="small muted">Загрузка {Math.round(uploading * 100)}%</span>}
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
          <button className="btn sm" onClick={() => addTokens([{ kind: 'custom', label: 'Метка', color: '#b3893a' }])} title="Фишка без привязки: ловушка, сундук, дверь">
            <Plus /> Метка
          </button>
        )}
        {dm && (
          <label className="btn sm" title="Загрузить карту (картинку) фоном доски">
            <ImageUp /> Карта
            <input type="file" accept="image/*" hidden disabled={uploading !== null} onChange={(e) => e.target.files?.[0] && uploadMap(e.target.files[0])} />
          </label>
        )}
      </div>

      {tool === 'tile' && (
        <div className="board-bar small">
          <span className="muted">Тайлы:</span>
          {TILE_COLORS.map((t) => (
            <button key={t.c} className={`tile-swatch${tileColor === t.c ? ' on' : ''}`} style={{ background: t.c }} title={t.name} aria-label={t.name} onClick={() => setTileColor(t.c)} />
          ))}
          <label className="tile-swatch custom" title="Свой цвет">
            <input type="color" value={tileColor ?? '#888888'} onChange={(e) => setTileColor(e.target.value)} />
          </label>
          <button className={`btn xs${tileColor === null ? ' accent' : ''}`} onClick={() => setTileColor(null)} title="Стирать тайлы">
            <Eraser size={14} /> стирать
          </button>
          <span className="muted" style={{ marginLeft: 8 }}>кисть</span>
          {[1, 2, 3, 5].map((b) => (
            <button key={b} className={`btn xs${brush === b ? ' accent' : ''}`} onClick={() => setBrush(b)}>{b}×{b}</button>
          ))}
          <div className="grow" />
          {dm && Object.keys(board.tiles).length > 0 && (
            <ConfirmButton className="btn ghost xs" confirm="Стереть все тайлы?" onConfirm={() => run([{ t: 'tiles-clear' }])}>
              <Trash2 size={14} /> Все тайлы
            </ConfirmButton>
          )}
        </div>
      )}

      {dm && tool !== 'tile' && (
        <div className="board-bar small">
          <label className="check">
            <input type="checkbox" checked={board.showGrid} onChange={(e) => run([{ t: 'settings', showGrid: e.target.checked }])} /> <Grid3x3 size={14} /> Сетка
          </label>
          <label className="row" style={{ gap: 6 }}>
            клетка
            <input className="input sm num" type="number" min={10} max={400} value={board.grid} style={{ width: 70 }} onChange={(e) => Number(e.target.value) >= 10 && run([{ t: 'settings', grid: Number(e.target.value) }])} />
            пикс.
          </label>
          <label className="check">
            <input type="checkbox" checked={board.playersDraw} onChange={(e) => run([{ t: 'settings', playersDraw: e.target.checked }])} /> Игроки рисуют и строят
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

      <div
        className={`board-stage${dropping ? ' dropping' : ''}`}
        ref={wrap}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          addImages([...e.dataTransfer.files], toBoard(e.clientX, e.clientY));
        }}
      >
        <svg ref={svg} className="board-svg" style={{ cursor }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <defs>
            <pattern id={`grid-${campaignId}`} width={g} height={g} patternUnits="userSpaceOnUse">
              <path d={`M ${g} 0 L 0 0 0 ${g}`} fill="none" stroke="rgba(0,0,0,.28)" strokeWidth={1 / Math.max(view.scale, 0.2)} />
            </pattern>
            {board.tokens.filter((t) => t.imageFileId).map((t) => (
              <clipPath key={t.id} id={`clip-${t.id}`}>
                <circle r={(g * t.size) / 2 - 2} />
              </clipPath>
            ))}
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale || 1})`}>
            <rect data-bg width={board.width} height={board.height} className="board-paper" />
            {board.mapFileId && <image data-bg href={fileUrl(board.mapFileId)} width={board.width} height={board.height} preserveAspectRatio="none" />}
            <g data-bg shapeRendering="crispEdges">
              {tiles.map((t) => (
                <rect key={t.k} x={t.x * g} y={t.y * g} width={g} height={g} fill={t.c} />
              ))}
            </g>
            {board.showGrid && <rect data-bg width={board.width} height={board.height} fill={`url(#grid-${campaignId})`} pointerEvents="none" />}

            {[...board.items].sort((a, b) => a.z - b.z).map((it) => {
              const b = itemBox(it);
              const editable = canEditItem(it);
              const isSel = selItem === it.id;
              return (
                <g
                  key={it.id}
                  className={`board-item${isSel ? ' selected' : ''}`}
                  pointerEvents={itemsInteractive ? 'all' : 'none'}
                  onPointerDown={(e) => {
                    if (tool !== 'move') return;
                    e.stopPropagation();
                    setSelItem(it.id);
                    setSelected(null);
                    if (!editable || editing === it.id) return;
                    const p = toBoard(e.clientX, e.clientY);
                    (svg.current as Element).setPointerCapture(e.pointerId);
                    setItemDrag({ id: it.id, mode: 'move', sx: p.x, sy: p.y, ox: it.x, oy: it.y, ow: it.w, oh: it.h, x: it.x, y: it.y, w: it.w, h: it.h });
                  }}
                  onDoubleClick={() => editable && (it.type === 'note' || it.type === 'text') && setEditing(it.id)}
                  style={{ cursor: itemsInteractive && editable ? 'move' : undefined }}
                >
                  {it.type === 'image' && it.fileId && <image href={fileUrl(it.fileId)} x={b.x} y={b.y} width={b.w} height={b.h} preserveAspectRatio="none" />}
                  {it.type === 'rect' && <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill={it.color} fillOpacity={0.28} stroke={it.color} strokeWidth={Math.max(2, g * 0.06)} />}
                  {it.type === 'note' && <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={it.color ?? NOTE_COLORS[0]} className="note-bg" />}
                  {(it.type === 'note' || it.type === 'text') && editing !== it.id && (
                    <foreignObject x={b.x} y={b.y} width={b.w} height={b.h} pointerEvents="none">
                      <div className={`item-text ${it.type}`} style={{ fontSize: (it.type === 'text' ? b.h * 0.62 : Math.max(10, Math.min(b.w / 9, b.h / 4))), color: it.type === 'text' ? it.color : undefined }}>
                        {it.text || <span className="item-placeholder">{editable ? 'Дважды нажмите, чтобы написать' : ''}</span>}
                      </div>
                    </foreignObject>
                  )}
                  {(it.type === 'note' || it.type === 'text') && editing === it.id && (
                    <foreignObject x={b.x} y={b.y} width={b.w} height={b.h}>
                      <textarea
                        className={`item-edit ${it.type}`}
                        autoFocus
                        defaultValue={it.text ?? ''}
                        maxLength={2000}
                        style={{ fontSize: (it.type === 'text' ? b.h * 0.62 : Math.max(10, Math.min(b.w / 9, b.h / 4))), color: it.type === 'text' ? it.color : undefined }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) (e.target as HTMLTextAreaElement).blur();
                        }}
                        onBlur={(e) => {
                          setEditing(null);
                          if (e.target.value !== (it.text ?? '')) run([{ t: 'item-update', id: it.id, patch: { text: e.target.value } }]);
                        }}
                      />
                    </foreignObject>
                  )}
                  {isSel && <rect x={b.x} y={b.y} width={b.w} height={b.h} className="item-outline" pointerEvents="none" strokeWidth={2 / Math.max(view.scale, 0.1)} />}
                  {isSel && editable && tool === 'move' && (
                    <rect
                      className="item-handle"
                      x={b.x + b.w - 7 / view.scale}
                      y={b.y + b.h - 7 / view.scale}
                      width={14 / view.scale}
                      height={14 / view.scale}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const p = toBoard(e.clientX, e.clientY);
                        (svg.current as Element).setPointerCapture(e.pointerId);
                        setItemDrag({ id: it.id, mode: 'resize', sx: p.x, sy: p.y, ox: it.x, oy: it.y, ow: it.w, oh: it.h, x: it.x, y: it.y, w: it.w, h: it.h });
                      }}
                    />
                  )}
                </g>
              );
            })}

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
              const r = (g * t.size) / 2;
              const movable = tool === 'move' && canMove(t);
              return (
                <g
                  key={t.id}
                  className={`token${drag?.id === t.id ? ' dragging' : ''}${t.hidden ? ' hidden-token' : ''}${selected === t.id ? ' selected' : ''}`}
                  style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, cursor: movable ? 'grab' : undefined }}
                  pointerEvents={tool === 'move' ? 'all' : 'none'}
                  onPointerDown={(e) => {
                    if (tool !== 'move') return;
                    e.stopPropagation();
                    setSelected(t.id);
                    setSelItem(null);
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
        {!board.mapFileId && board.tokens.length === 0 && board.strokes.length === 0 && board.items.length === 0 && Object.keys(board.tiles).length === 0 && (
          <div className="board-hint">
            {canDraw
              ? 'Постройте карту кистью тайлов, перетащите сюда картинки или вставьте их через Ctrl+V. Колёсико мыши — масштаб, перетаскивание пустого места — сдвиг доски.'
              : 'Мастер ещё не выложил карту. Можно поставить своего героя.'}
          </div>
        )}
        {dropping && <div className="board-drop">Отпустите, чтобы положить картинку на доску</div>}
      </div>

      {item && canEditItem(item) && (
        <div className="board-bar small">
          <b>{{ image: 'Картинка', note: 'Заметка', text: 'Надпись', rect: 'Прямоугольник' }[item.type]}</b>
          {item.type !== 'image' && (
            <div className="row" style={{ gap: 3 }}>
              {(item.type === 'note' ? NOTE_COLORS : item.type === 'text' ? ['#1b1b1b', '#ffffff', ...SHAPE_COLORS.slice(0, 5)] : SHAPE_COLORS).map((c) => (
                <button key={c} className={`swatch${c === item.color ? ' on' : ''}`} style={{ background: c }} onClick={() => run([{ t: 'item-update', id: item.id, patch: { color: c } }])} />
              ))}
            </div>
          )}
          {(item.type === 'note' || item.type === 'text') && (
            <button className="btn ghost xs" onClick={() => setEditing(item.id)}><Type size={14} /> Текст</button>
          )}
          <button className="btn ghost xs" onClick={() => run([{ t: 'item-update', id: item.id, patch: { z: 'front' } }])}><ArrowUpToLine size={14} /> Вперёд</button>
          <button className="btn ghost xs" onClick={() => run([{ t: 'item-update', id: item.id, patch: { z: 'back' } }])}><ArrowDownToLine size={14} /> Назад</button>
          <div className="grow" />
          <span className="small muted">Delete — убрать</span>
          <button className="btn ghost xs" onClick={() => { run([{ t: 'item-remove', id: item.id }]); setSelItem(null); }}>
            <Trash2 size={14} /> Убрать
          </button>
        </div>
      )}

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
