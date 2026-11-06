import { roll as rollDice, type Character } from '@dnd/rules-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { api, type CharacterView, type Command, type ContentRow } from '../api/client';
import { useToast } from '../components/ui';
import { RollToast } from '../components/RollToast';
import { subscribe } from './socket';

export function useCharacter(id: string) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['character', id], queryFn: () => api<CharacterView>(`/characters/${id}`) });
  useEffect(
    () =>
      subscribe(`character/${id}`, {
        character: (view: CharacterView) => {
          if (view.id !== id) return;
          qc.setQueryData<CharacterView>(['character', id], (old) => (old ? { ...old, ...view } : old));
        },
        // После обрыва связи — перечитать лист
        connect: () => qc.invalidateQueries({ queryKey: ['character', id] }),
      }),
    [id, qc],
  );
  return q;
}

export function useCommand(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (command: Command) => api<CharacterView>(`/characters/${id}/command`, { body: { command } }),
    onSuccess: (view) => qc.setQueryData<CharacterView>(['character', id], (old) => (old ? { ...old, ...view } : old)),
    onError: (e: Error) => toast(e.message, 'error'),
  });
}

/** Сохранение «конструктора»: собирает изменения и отправляет одним запросом через 600 мс. */
export function useSaveBuild(view: CharacterView | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  const pending = useRef<Character | null>(null);
  const timer = useRef<number>();
  const inflight = useRef(false);

  const flush = useCallback(async () => {
    if (!view || !pending.current || inflight.current) return;
    const data = pending.current;
    pending.current = null;
    inflight.current = true;
    try {
      const current = qc.getQueryData<CharacterView>(['character', view.id]);
      const saved = await api<CharacterView>(`/characters/${view.id}`, { method: 'PUT', body: { data, version: current?.version } });
      qc.setQueryData<CharacterView>(['character', view.id], (old) => (old ? { ...old, ...saved, data: pending.current ? old.data : saved.data } : old));
      qc.invalidateQueries({ queryKey: ['characters'] });
    } catch (e) {
      toast((e as Error).message, 'error');
      qc.invalidateQueries({ queryKey: ['character', view.id] });
    } finally {
      inflight.current = false;
      if (pending.current) void flush();
    }
  }, [view, qc, toast]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return useCallback(
    (update: (c: Character) => Character) => {
      if (!view) return;
      const current = qc.getQueryData<CharacterView>(['character', view.id]);
      if (!current) return;
      const next = update(structuredClone(current.data));
      pending.current = next;
      // Оптимистично: пересчёт листа придёт с сервера, данные показываем сразу
      qc.setQueryData<CharacterView>(['character', view.id], { ...current, data: next });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 600);
    },
    [view, qc, flush],
  );
}

/** Бросок: в кампании — через сервер (виден всем в журнале), вне кампании — локально. */
export function useRoller(campaignId: string | null | undefined, characterId?: string) {
  const toast = useToast();
  return useCallback(
    async (formula: string, label: string) => {
      try {
        const r = campaignId
          ? (await api<{ roll: ReturnType<typeof rollDice> }>(`/campaigns/${campaignId}/roll`, { body: { formula, label, characterId } })).roll
          : rollDice(formula);
        toast(<RollToast label={label} roll={r} />);
        return r;
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },
    [campaignId, characterId, toast],
  );
}

export function useContentList(kind: string, extra: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams({ kind, limit: '3000' });
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
  return useQuery({ queryKey: ['content', kind, extra], queryFn: () => api<{ items: ContentRow[] }>(`/content?${params}`) });
}
