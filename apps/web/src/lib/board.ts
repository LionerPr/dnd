/** Доска кампании на клиенте: состояние в react-query, операции от сервера применяются по сокету. */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api } from '../api/client';
import type { CampaignFile } from './files';

export interface Token {
  id: string;
  kind: 'character' | 'npc' | 'custom';
  refId?: string;
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  imageFileId?: string;
  hidden?: boolean;
  ownerId?: string;
}
export interface Stroke { id: string; color: string; width: number; points: number[]; authorId: string }
export interface MediaPost { id: string; fileId: string; caption?: string; authorId: string; authorName: string; at: string }
export interface MusicState { trackId: string | null; playing: boolean; offset: number; startedAt: number; speed: number; volume: number; fade: number }
export interface Board {
  mapFileId: string | null;
  width: number;
  height: number;
  grid: number;
  showGrid: boolean;
  playersDraw: boolean;
  tokens: Token[];
  strokes: Stroke[];
  media: MediaPost[];
  music: MusicState;
}

export type AppliedOp =
  | { t: 'token-set'; token: Token }
  | { t: 'token-remove'; id: string }
  | { t: 'stroke'; stroke: Stroke }
  | { t: 'stroke-remove'; id: string }
  | { t: 'strokes-clear' }
  | { t: 'settings'; settings: Pick<Board, 'mapFileId' | 'width' | 'height' | 'grid' | 'showGrid' | 'playersDraw'> }
  | { t: 'media-add'; post: MediaPost }
  | { t: 'media-remove'; id: string }
  | { t: 'music'; music: MusicState };

export function applyOps(b: Board, ops: AppliedOp[]): Board {
  let n = b;
  for (const op of ops) {
    switch (op.t) {
      case 'token-set':
        n = { ...n, tokens: n.tokens.some((t) => t.id === op.token.id) ? n.tokens.map((t) => (t.id === op.token.id ? op.token : t)) : [...n.tokens, op.token] };
        break;
      case 'token-remove':
        n = { ...n, tokens: n.tokens.filter((t) => t.id !== op.id) };
        break;
      case 'stroke':
        n = { ...n, strokes: [...n.strokes.filter((s) => s.id !== op.stroke.id), op.stroke] };
        break;
      case 'stroke-remove':
        n = { ...n, strokes: n.strokes.filter((s) => s.id !== op.id) };
        break;
      case 'strokes-clear':
        n = { ...n, strokes: [] };
        break;
      case 'settings':
        n = { ...n, ...op.settings };
        break;
      case 'media-add':
        n = { ...n, media: [op.post, ...n.media.filter((m) => m.id !== op.post.id)] };
        break;
      case 'media-remove':
        n = { ...n, media: n.media.filter((m) => m.id !== op.id) };
        break;
      case 'music':
        n = { ...n, music: op.music };
        break;
    }
  }
  return n;
}

/** Разница часов: серверное время = Date.now() + skew */
let skew = 0;
export const serverNow = () => Date.now() + skew;
const noteServerTime = (t: number | undefined) => {
  if (t) skew = t - Date.now();
};

export const boardKey = (id: string) => ['board', id];
export const filesKey = (id: string) => ['files', id];

export function useBoard(campaignId: string) {
  return useQuery({
    queryKey: boardKey(campaignId),
    queryFn: async () => {
      const r = await api<{ board: Board; serverNow: number }>(`/campaigns/${campaignId}/board`);
      noteServerTime(r.serverNow);
      return r.board;
    },
    staleTime: Infinity,
  });
}

export function useFiles(campaignId: string) {
  return useQuery({
    queryKey: filesKey(campaignId),
    queryFn: () => api<{ files: CampaignFile[]; used: number; quota: number }>(`/campaigns/${campaignId}/files`),
    staleTime: 60_000,
  });
}

export function useBoardOps(campaignId: string) {
  const qc = useQueryClient();
  return async (ops: unknown[]) => {
    const r = await api<{ ops: AppliedOp[]; serverNow: number }>(`/campaigns/${campaignId}/board`, { body: { ops } });
    noteServerTime(r.serverNow);
    qc.setQueryData<Board>(boardKey(campaignId), (b) => (b ? applyOps(b, r.ops) : b));
    return r.ops;
  };
}

/** Обработчики сокета комнаты для доски и файлов */
export function boardSocketHandlers(qc: QueryClient, campaignId: string) {
  return {
    board: ({ ops }: { ops: AppliedOp[]; at?: number }) => qc.setQueryData<Board>(boardKey(campaignId), (b) => (b ? applyOps(b, ops) : b)),
    file: (f: CampaignFile) =>
      qc.setQueryData<{ files: CampaignFile[]; used: number; quota: number }>(filesKey(campaignId), (x) =>
        x ? { ...x, files: x.files.some((y) => y.id === f.id) ? x.files.map((y) => (y.id === f.id ? f : y)) : [...x.files, f], used: x.used + (x.files.some((y) => y.id === f.id) ? 0 : f.size) } : x,
      ),
    'file-removed': ({ id }: { id: string }) =>
      qc.setQueryData<{ files: CampaignFile[]; used: number; quota: number }>(filesKey(campaignId), (x) => (x ? { ...x, files: x.files.filter((y) => y.id !== id) } : x)),
    show: (s: { fileId: string; caption?: string }) => setShown(s),
  };
}

// ---------- «Показать всем»: картинка на весь экран ----------
let shown: { fileId: string; caption?: string } | null = null;
const listeners = new Set<() => void>();
export function setShown(s: typeof shown) {
  shown = s;
  listeners.forEach((l) => l());
}
export function useShown() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shown,
  );
}
