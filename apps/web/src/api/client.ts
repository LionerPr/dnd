import type { Character, Sheet } from '@dnd/rules-engine';

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: string[]) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Ошибка ${res.status}`, data?.issues);
  return data as T;
}

export interface User { id: string; username: string; displayName: string; isAdmin: boolean; isModerator?: boolean }
/** Создавать и править записи библиотеки могут администратор и модераторы */
export const canAuthor = (u: User | null | undefined) => !!u && (u.isAdmin || !!u.isModerator);

export interface CharacterView {
  id: string;
  ownerId: string;
  campaignId: string | null;
  version: number;
  data: Character;
  sheet: Sheet;
  names?: { race?: string; subrace?: string; classes: { id: string; name: string; level: number; subclass?: string }[] };
  access?: { owner: boolean; dm: boolean; member: boolean; canView: boolean; canEdit: boolean };
  awards?: { id: string; note: string; awarded_at: string; title: string; description: string; icon: string }[];
}

export interface ContentRow {
  id: string;
  kind: 'race' | 'class' | 'spell' | 'item' | 'monster' | 'feat';
  name: string;
  owner_id: string | null;
  campaign_id: string | null;
  visibility: 'private' | 'campaign' | 'public';
  source: string;
  source_url: string | null;
  data: any;
  updated_at: string;
}

export interface NpcData {
  name: string;
  monsterId?: string;
  ac: number;
  maxHp: number;
  hp: number;
  tempHp: number;
  conditions: string[];
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
  initiativeBonus: number;
  hidden: boolean;
  ally: boolean;
  notes: string;
  statblock?: any;
  status?: 'healthy' | 'hurt' | 'bloodied' | 'critical' | 'down';
}
export interface Npc { id: string; campaign_id: string; data: NpcData }

export interface Combat { round: number; turn: number; order: { id: string; kind: 'character' | 'npc'; name: string; initiative: number }[] }

export interface EventRow {
  id: string;
  campaign_id: string | null;
  actor_id: string | null;
  target_kind: string;
  target_id: string;
  type: string;
  summary: string;
  payload: any;
  undone: boolean;
  hidden: boolean;
  created_at: string;
}

export interface Achievement { id: string; campaign_id: string; title: string; description: string; icon: string }
export interface Award { id: string; achievement_id: string; character_id: string; note: string; awarded_at: string }

export interface CampaignSettings { playersEditHp: boolean; playersEditMoney: boolean; showEnemyHp: boolean; allowedRaces: string[]; allowedClasses: string[] }

export interface Snapshot {
  campaign: { id: string; name: string; description: string; dmId: string; settings: CampaignSettings; combat: Combat | null; inviteCode?: string };
  role: 'dm' | 'player';
  members: { userId: string; role: string; displayName: string }[];
  characters: CharacterView[];
  npcs: Npc[];
  achievements: Achievement[];
  awards: Award[];
  events: EventRow[];
}

export type Command = { type: string; [k: string]: unknown };
