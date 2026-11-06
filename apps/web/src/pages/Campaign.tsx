import { CONDITIONS, COINS, COIN_ORDER, DAMAGE_TYPES, type Coin, type Condition, type Monster } from '@dnd/rules-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  Copy,
  Dices,
  Eye,
  EyeOff,
  Flag,
  Gift,
  Heart,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  Skull,
  Sunrise,
  Swords,
  Trash2,
  Undo2,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Achievement, type CharacterView, type Combat, type ContentRow, type EventRow, type Npc, type Snapshot } from '../api/client';
import { ACHIEVEMENT_ICONS, AchievementIcon } from '../components/AchievementIcon';
import { ContentPicker } from '../components/ContentPicker';
import { HpBar } from '../components/sheet/Vitals';
import { Statblock } from '../components/Statblock';
import { ConfirmButton, Empty, Field, Loading, Modal, NumberInput, Segmented, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { conditionName, plural, signed, timeAgo } from '../lib/format';
import { useRoller } from '../lib/hooks';
import { isConnected, subscribe } from '../lib/socket';

type Target = { kind: 'character' | 'npc'; id: string };
type Cmd = { type: string; [k: string]: unknown };

const STATUS: Record<string, string> = { healthy: 'Цел', hurt: 'Ранен', bloodied: 'Сильно ранен', critical: 'При смерти', down: 'Повержен' };

// ---------- Живое состояние комнаты ----------

function useRoom(id: string) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const key = ['campaign', id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Snapshot>(`/campaigns/${id}`) });

  useEffect(() => {
    const patch = (fn: (s: Snapshot) => Snapshot) => qc.setQueryData<Snapshot>(key, (old) => (old ? fn(old) : old));
    let first = true;
    const handlers: Record<string, (p: any) => void> = {
      // Первое подключение — данные уже грузятся запросом; после обрыва — перечитать всё
      connect: () => {
        if (!first) qc.invalidateQueries({ queryKey: key });
        first = false;
      },
      character: (view: CharacterView) =>
        patch((x) => {
          const rest = x.characters.filter((c) => c.id !== view.id);
          if (view.campaignId !== id) return { ...x, characters: rest };
          const exists = x.characters.some((c) => c.id === view.id);
          return { ...x, characters: exists ? x.characters.map((c) => (c.id === view.id ? { ...c, ...view } : c)) : [...x.characters, view] };
        }),
      'character-removed': ({ id: cid }: { id: string }) => patch((x) => ({ ...x, characters: x.characters.filter((c) => c.id !== cid) })),
      npc: (npc: Npc) =>
        patch((x) => ({ ...x, npcs: x.npcs.some((n) => n.id === npc.id) ? x.npcs.map((n) => (n.id === npc.id ? npc : n)) : [...x.npcs, npc] })),
      'npc-removed': ({ id: nid }: { id: string }) => patch((x) => ({ ...x, npcs: x.npcs.filter((n) => n.id !== nid) })),
      combat: (combat: Combat | null) => patch((x) => ({ ...x, campaign: { ...x.campaign, combat } })),
      event: (ev: EventRow) => patch((x) => ({ ...x, events: [ev, ...x.events.filter((e) => e.id !== ev.id)].slice(0, 200) })),
      'event-undone': ({ id: eid }: { id: string }) => patch((x) => ({ ...x, events: x.events.map((e) => (e.id === eid ? { ...e, undone: true } : e)) })),
      achievement: (a: Achievement) =>
        patch((x) => ({ ...x, achievements: x.achievements.some((y) => y.id === a.id) ? x.achievements.map((y) => (y.id === a.id ? a : y)) : [...x.achievements, a] })),
      award: (a: Snapshot['awards'][number]) => patch((x) => ({ ...x, awards: [a, ...x.awards.filter((y) => y.id !== a.id)] })),
      'campaign-changed': () => qc.invalidateQueries({ queryKey: key }),
      'campaign-deleted': () => {
        toast('Кампания удалена');
        nav('/');
      },
    };
    return subscribe(`campaign/${id}`, handlers);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return q;
}

export function CampaignPage() {
  const { id = '' } = useParams();
  const q = useRoom(id);
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [selected, setSelected] = useState<Target[]>([]);
  const [modal, setModal] = useState<null | { type: 'settings' } | { type: 'npc' } | { type: 'achievement'; a?: Achievement } | { type: 'award'; a: Achievement } | { type: 'character'; id: string } | { type: 'statblock'; npc: Npc } | { type: 'attach' }>(null);
  const onError = (e: Error) => toast(e.message, 'error');
  const refresh = () => {
    if (!isConnected(`campaign/${id}`)) qc.invalidateQueries({ queryKey: ['campaign', id] });
  };

  const command = useMutation({
    mutationFn: ({ targets, command }: { targets: Target[]; command: Cmd }) =>
      api<{ results: { ok: boolean; error?: string; summary?: string }[] }>(`/campaigns/${id}/command`, { body: { targets, command } }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) toast(failed.map((f) => f.error).join('; '), 'error');
      refresh();
    },
    onError,
  });
  const combat = useMutation({ mutationFn: (body: Record<string, unknown>) => api(`/campaigns/${id}/combat`, { body }), onSuccess: refresh, onError });
  const roll = useRoller(id);

  const snap = q.data;
  const combatState = snap?.campaign.combat ?? null;
  const currentTurn = combatState?.order[combatState.turn]?.id;
  const run = (targets: Target[], cmd: Cmd) => targets.length && command.mutate({ targets, command: cmd });

  if (q.isLoading) return <Loading />;
  if (q.error || !snap)
    return (
      <main className="page">
        <Empty title="Кампания не найдена">{(q.error as Error)?.message}</Empty>
      </main>
    );

  const dm = snap.role === 'dm';
  const isSel = (t: Target) => selected.some((s) => s.id === t.id);
  const toggleSel = (t: Target) => setSelected((x) => (isSel(t) ? x.filter((s) => s.id !== t.id) : [...x, t]));
  const allChars = snap.characters.map((c) => ({ kind: 'character' as const, id: c.id }));
  const enemies = snap.npcs.filter((n) => !n.data.ally);
  const allies = snap.npcs.filter((n) => n.data.ally);
  const myChars = snap.characters.filter((c) => c.ownerId === user?.id);
  const charModal = modal?.type === 'character' ? snap.characters.find((c) => c.id === modal.id) : undefined;

  return (
    <main className="page wide">
      <div className="sheet-head">
        <div>
          <div className="caps muted">{dm ? 'Вы мастер' : `Мастер: ${snap.members.find((m) => m.role === 'dm')?.displayName ?? '—'}`}</div>
          <h1>{snap.campaign.name}</h1>
          {snap.campaign.description && <div className="meta">{snap.campaign.description}</div>}
        </div>
        <div className="row wrap">
          {dm && snap.campaign.inviteCode && <InviteCode id={id} code={snap.campaign.inviteCode} />}
          {!dm && (
            <button className="btn" onClick={() => setModal({ type: 'attach' })}>
              <UserPlus /> Мой персонаж
            </button>
          )}
          {dm && (
            <button className="btn" onClick={() => setModal({ type: 'settings' })}>
              <Settings /> Настройки
            </button>
          )}
        </div>
      </div>

      <div className="room">
        <div className="stack-lg">
          {/* ---------- Отряд ---------- */}
          <section>
            <div className="row between" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Отряд</h2>
              {dm && snap.characters.length > 0 && (
                <button className="btn ghost sm" onClick={() => setSelected((x) => (allChars.every(isSel) ? x.filter((s) => s.kind !== 'character') : [...x.filter((s) => s.kind !== 'character'), ...allChars]))}>
                  {allChars.every(isSel) ? 'Снять выбор' : 'Выбрать всех'}
                </button>
              )}
            </div>
            {snap.characters.length === 0 ? (
              <Empty title="В отряде пока никого">{dm ? 'Отправьте игрокам код приглашения: они присоединятся со своими персонажами.' : 'Прикрепите своего персонажа к кампании.'}</Empty>
            ) : (
              <div className="party">
                {snap.characters.map((c) => (
                  <CharacterCard
                    key={c.id}
                    c={c}
                    dm={dm}
                    mine={c.ownerId === user?.id}
                    selected={isSel({ kind: 'character', id: c.id })}
                    turn={currentTurn === c.id}
                    onSelect={() => toggleSel({ kind: 'character', id: c.id })}
                    run={(cmd) => run([{ kind: 'character', id: c.id }], cmd)}
                    onMore={() => setModal({ type: 'character', id: c.id })}
                  />
                ))}
              </div>
            )}
          </section>

          {dm && selected.length > 0 && <MassBar count={selected.length} run={(cmd) => run(selected, cmd)} onClear={() => setSelected([])} hasNpc={selected.some((s) => s.kind === 'npc')} />}

          {/* ---------- Враги и союзники ---------- */}
          <section>
            <div className="row between" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Противники</h2>
              {dm && (
                <div className="row">
                  {enemies.length > 0 && (
                    <button
                      className="btn ghost sm"
                      onClick={() => {
                        const ts = enemies.map((n) => ({ kind: 'npc' as const, id: n.id }));
                        setSelected((x) => (ts.every(isSel) ? x.filter((s) => s.kind !== 'npc') : [...x.filter((s) => s.kind !== 'npc'), ...ts]));
                      }}
                    >
                      Выбрать всех
                    </button>
                  )}
                  <button className="btn sm" onClick={() => setModal({ type: 'npc' })}>
                    <Plus /> Добавить
                  </button>
                </div>
              )}
            </div>
            {snap.npcs.length === 0 ? (
              <Empty title="Пока тихо">{dm ? 'Добавьте существ из бестиария или опишите своих: хиты будут считаться здесь, а не в блокноте.' : 'Мастер ещё не выставил противников.'}</Empty>
            ) : (
              <div className="party">
                {[...enemies, ...allies].map((n) => (
                  <NpcCard
                    key={n.id}
                    npc={n}
                    dm={dm}
                    selected={isSel({ kind: 'npc', id: n.id })}
                    turn={currentTurn === n.id}
                    inCombat={!!combatState?.order.some((o) => o.id === n.id)}
                    combatOn={!!combatState}
                    onSelect={() => toggleSel({ kind: 'npc', id: n.id })}
                    run={(cmd) => run([{ kind: 'npc', id: n.id }], cmd)}
                    onStatblock={() => setModal({ type: 'statblock', npc: n })}
                    onCombat={(add) => combat.mutate(add ? { action: 'add', kind: 'npc', targetId: n.id } : { action: 'remove', targetId: n.id })}
                    onChanged={refresh}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ---------- Достижения ---------- */}
          <section>
            <div className="row between" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Достижения</h2>
              {dm && (
                <button className="btn sm" onClick={() => setModal({ type: 'achievement' })}>
                  <Plus /> Придумать
                </button>
              )}
            </div>
            {snap.achievements.length === 0 ? (
              <Empty title="Достижений пока нет">{dm ? 'Например: «Сыграть в гольф» — нанести дробящий удар в голову. Выдавайте их игрокам по своему усмотрению.' : 'Мастер ещё ничего не придумал.'}</Empty>
            ) : (
              <div className="panel list">
                {snap.achievements.map((a) => {
                  const got = snap.awards.filter((w) => w.achievement_id === a.id);
                  return (
                    <div key={a.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                      <span className="award-icon">
                        <AchievementIcon name={a.icon} />
                      </span>
                      <span className="grow">
                        <b>{a.title}</b>
                        {a.description && <div className="small muted">{a.description}</div>}
                        {got.length > 0 && (
                          <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
                            {got.map((w) => (
                              <span key={w.id} className="chip small accent" title={w.note || undefined}>
                                {snap.characters.find((c) => c.id === w.character_id)?.data.name ?? 'выбыл'}
                                {dm && (
                                  <ConfirmButton className="btn ghost xs icon" confirm="✕" onConfirm={() => api(`/awards/${w.id}`, { method: 'DELETE' }).catch(onError)}>
                                    <Trash2 size={12} />
                                  </ConfirmButton>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </span>
                      {dm && (
                        <span className="row">
                          <button className="btn sm" disabled={!snap.characters.length} onClick={() => setModal({ type: 'award', a })}>
                            <Gift /> Выдать
                          </button>
                          <button className="btn ghost sm icon" aria-label="Изменить" onClick={() => setModal({ type: 'achievement', a })}>
                            <MoreHorizontal />
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* ---------- Боковая колонка ---------- */}
        <aside className="room-side">
          <InitiativePanel combat={combatState} allies={new Set(allies.map((n) => n.id))} dm={dm} act={(b) => combat.mutate(b)} busy={combat.isPending} />
          <DiceBox dm={dm} roll={(formula, label, hidden) => api(`/campaigns/${id}/roll`, { body: { formula, label, hidden } }).then(refresh).catch(onError)} />
          <EventLog events={snap.events} dm={dm} userId={user?.id} onUndo={(ev) => api(`/events/${ev.id}/undo`, { body: {} }).then(refresh).catch(onError)} />
        </aside>
      </div>

      {modal?.type === 'settings' && <SettingsModal snap={snap} onClose={() => setModal(null)} />}
      {modal?.type === 'npc' && <AddNpcModal campaignId={id} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.type === 'achievement' && <AchievementModal campaignId={id} a={modal.a} onClose={() => setModal(null)} />}
      {modal?.type === 'award' && <AwardModal a={modal.a} characters={snap.characters} onClose={() => setModal(null)} />}
      {modal?.type === 'statblock' && <StatblockModal npc={modal.npc} onClose={() => setModal(null)} roll={(f, l) => roll(f, l)} />}
      {modal?.type === 'attach' && <AttachModal campaignId={id} attached={myChars} onClose={() => setModal(null)} />}
      {charModal && <CharacterActions c={charModal} campaignId={id} run={(cmd) => run([{ kind: 'character', id: charModal.id }], cmd)} onClose={() => setModal(null)} />}
    </main>
  );
}

// ---------- Карточки ----------

function QuickHp({ run, allowTemp }: { run: (c: Cmd) => void; allowTemp?: boolean }) {
  const [v, setV] = useState('');
  const n = Math.floor(Number(v) || 0);
  const go = (type: string) => {
    if (!n) return;
    run({ type, amount: n });
    setV('');
  };
  return (
    <div className="quick">
      <input className="input num" inputMode="numeric" placeholder="0" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && go('damage')} aria-label="Сколько" />
      <button className="btn xs danger" disabled={!n} onClick={() => go('damage')}>
        Урон
      </button>
      <button className="btn xs good" disabled={!n} onClick={() => go('heal')}>
        Лечение
      </button>
      {allowTemp && (
        <button className="btn xs" disabled={!n} onClick={() => go('temp_hp')}>
          Врем.
        </button>
      )}
    </div>
  );
}

function CharacterCard({ c, dm, mine, selected, turn, onSelect, run, onMore }: { c: CharacterView; dm: boolean; mine: boolean; selected: boolean; turn: boolean; onSelect: () => void; run: (c: Cmd) => void; onMore: () => void }) {
  const s = c.data.state;
  const classLine = c.names?.classes.map((x) => `${x.name} ${x.level}`).join(' / ');
  const down = s.hp === 0 && c.sheet.maxHp > 0;
  return (
    <div className={`member${selected ? ' selected' : ''}${turn ? ' turn' : ''}${down ? ' down' : ''}`}>
      <div className="top">
        {dm && <input type="checkbox" checked={selected} onChange={onSelect} aria-label="Выбрать" style={{ accentColor: 'var(--accent)' }} />}
        <div className="grow" style={{ minWidth: 0 }}>
          <h4>
            {dm || mine ? <Link to={`/characters/${c.id}`}>{c.data.name}</Link> : c.data.name}
            {s.inspiration && <span title="Вдохновение" style={{ color: 'var(--accent)', marginLeft: 6 }}>✦</span>}
          </h4>
          <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[c.names?.race, classLine].filter(Boolean).join(' · ') || 'без класса'}
          </div>
        </div>
        {dm && (
          <button className="btn ghost sm icon" aria-label="Действия мастера" onClick={onMore}>
            <MoreHorizontal />
          </button>
        )}
      </div>
      <div className="row" style={{ gap: 10 }}>
        <span className="num" style={{ fontWeight: 600, minWidth: 64 }}>
          {s.hp}/{c.sheet.maxHp}
          {s.tempHp > 0 && <span className="small" style={{ color: 'var(--mana)' }}> +{s.tempHp}</span>}
        </span>
        <div className="grow">
          <HpBar hp={s.hp} max={c.sheet.maxHp} temp={s.tempHp} />
        </div>
      </div>
      <div className="stats">
        <span>КД <b>{c.sheet.ac}</b></span>
        <span>Вним. <b>{c.sheet.passivePerception}</b></span>
        <span>Иниц. <b>{signed(c.sheet.initiative)}</b></span>
        {dm && <span>Опыт <b>{s.xp}</b></span>}
      </div>
      {(s.conditions.length > 0 || s.concentration || s.exhaustion > 0 || s.dead || down) && (
        <div className="row wrap" style={{ gap: 4 }}>
          {s.dead ? <span className="chip small danger">Погиб</span> : down && <span className="chip small danger">Без сознания · {s.deathSaves.success}✓ {s.deathSaves.failure}✗</span>}
          {s.conditions.map((x) => <span key={x} className="chip small danger">{conditionName(x)}</span>)}
          {s.exhaustion > 0 && <span className="chip small danger">Истощение {s.exhaustion}</span>}
          {s.concentration && <span className="chip small mana">◈ {s.concentration}</span>}
        </div>
      )}
      {dm && <QuickHp run={run} allowTemp />}
    </div>
  );
}

function NpcCard({
  npc, dm, selected, turn, inCombat, combatOn, onSelect, run, onStatblock, onCombat, onChanged,
}: {
  npc: Npc; dm: boolean; selected: boolean; turn: boolean; inCombat: boolean; combatOn: boolean; onSelect: () => void; run: (c: Cmd) => void; onStatblock: () => void; onCombat: (add: boolean) => void; onChanged: () => void;
}) {
  const toast = useToast();
  const d = npc.data;
  const exact = d.hp !== undefined && d.maxHp !== undefined;
  const down = exact ? d.hp <= 0 : d.status === 'down';
  const patch = (p: Partial<typeof d>) => api(`/npcs/${npc.id}`, { method: 'PUT', body: p }).then(onChanged).catch((e: Error) => toast(e.message, 'error'));
  return (
    <div className={`member npc${d.ally ? ' ally' : ''}${d.hidden ? ' hidden-npc' : ''}${selected ? ' selected' : ''}${turn ? ' turn' : ''}${down ? ' down' : ''}`}>
      <div className="top">
        {dm && <input type="checkbox" checked={selected} onChange={onSelect} aria-label="Выбрать" style={{ accentColor: 'var(--accent)' }} />}
        <div className="grow" style={{ minWidth: 0 }}>
          <h4>
            {down && <Skull size={15} style={{ marginRight: 4, verticalAlign: -2 }} />}
            {d.name}
          </h4>
          <div className="small muted">
            {d.ally ? 'союзник' : 'противник'}
            {dm && d.hidden && ' · скрыт от игроков'}
          </div>
        </div>
        {dm && (
          <div className="row" style={{ gap: 2 }}>
            {(d.statblock || d.monsterId) && (
              <button className="btn ghost sm icon" title="Статблок" aria-label="Статблок" onClick={onStatblock}>
                <Flag />
              </button>
            )}
            <button className="btn ghost sm icon" title={d.hidden ? 'Показать игрокам' : 'Скрыть от игроков'} aria-label="Видимость" onClick={() => patch({ hidden: !d.hidden })}>
              {d.hidden ? <EyeOff /> : <Eye />}
            </button>
            {combatOn && (
              <button className={`btn ghost sm icon${inCombat ? ' accent-text' : ''}`} title={inCombat ? 'Убрать из боя' : 'Добавить в бой'} aria-label="Бой" onClick={() => onCombat(!inCombat)}>
                <Swords />
              </button>
            )}
            <ConfirmButton className="btn ghost sm icon" confirm="✕" onConfirm={() => api(`/npcs/${npc.id}`, { method: 'DELETE' }).then(onChanged).catch((e: Error) => toast(e.message, 'error'))}>
              <Trash2 />
            </ConfirmButton>
          </div>
        )}
      </div>
      {exact ? (
        <div className="row" style={{ gap: 10 }}>
          <span className="num" style={{ fontWeight: 600, minWidth: 64 }}>
            {d.hp}/{d.maxHp}
            {d.tempHp > 0 && <span className="small" style={{ color: 'var(--mana)' }}> +{d.tempHp}</span>}
          </span>
          <div className="grow">
            <HpBar hp={d.hp} max={d.maxHp} temp={d.tempHp} />
          </div>
        </div>
      ) : (
        <div className={`chip small${d.status === 'healthy' ? '' : d.status === 'hurt' ? '' : ' danger'}`} style={{ alignSelf: 'flex-start' }}>
          {STATUS[d.status ?? 'healthy']}
        </div>
      )}
      {(d.ac !== undefined || dm) && (
        <div className="stats">
          {d.ac !== undefined && <span>КД <b>{d.ac}</b></span>}
          {dm && <span>Иниц. <b>{signed(d.initiativeBonus ?? 0)}</b></span>}
          {dm && !!d.resistances?.length && <span title={d.resistances.map((r) => DAMAGE_TYPES[r as keyof typeof DAMAGE_TYPES] ?? r).join(', ')}>сопр. <b>{d.resistances.length}</b></span>}
        </div>
      )}
      {d.conditions?.length > 0 && (
        <div className="row wrap" style={{ gap: 4 }}>
          {d.conditions.map((x) => (
            <span key={x} className="chip small danger">
              {conditionName(x)}
              {dm && (
                <button className="btn ghost xs icon" style={{ height: 16, width: 16, marginRight: -6 }} aria-label="Снять" onClick={() => run({ type: 'condition', condition: x, on: false })}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {dm && (
        <div className="stack" style={{ gap: 6 }}>
          <QuickHp run={run} />
          <select className="select sm" style={{ width: 'auto', alignSelf: 'flex-start' }} value="" aria-label="Состояние" onChange={(e) => e.target.value && run({ type: 'condition', condition: e.target.value, on: true })}>
            <option value="">+ состояние</option>
            {(Object.keys(CONDITIONS) as Condition[]).filter((k) => !d.conditions?.includes(k)).map((k) => <option key={k} value={k}>{CONDITIONS[k]}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// ---------- Действия над несколькими целями ----------

function MassBar({ count, run, onClear, hasNpc }: { count: number; run: (c: Cmd) => void; onClear: () => void; hasNpc: boolean }) {
  const [v, setV] = useState('');
  const [coin, setCoin] = useState<Coin>('gp');
  const n = Math.floor(Number(v) || 0);
  return (
    <div className="panel panel-pad mass-bar">
      <div className="row wrap" style={{ gap: 8 }}>
        <b>Выбрано: {count}</b>
        <input className="input num" style={{ width: 72, height: 30 }} inputMode="numeric" placeholder="0" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))} aria-label="Сколько" />
        <button className="btn sm danger" disabled={!n} onClick={() => run({ type: 'damage', amount: n })}>Урон</button>
        <button className="btn sm good" disabled={!n} onClick={() => run({ type: 'heal', amount: n })}>Лечение</button>
        {!hasNpc && (
          <>
            <span className="row" style={{ gap: 4 }}>
              <button className="btn sm" disabled={!n} onClick={() => run({ type: 'money', delta: { [coin]: n } })}>
                <Coins /> +
              </button>
              <button className="btn sm" disabled={!n} onClick={() => run({ type: 'money', delta: { [coin]: -n } })}>−</button>
              <select className="select sm" style={{ width: 'auto' }} value={coin} onChange={(e) => setCoin(e.target.value as Coin)}>
                {COIN_ORDER.map((c) => <option key={c} value={c}>{COINS[c].name}</option>)}
              </select>
            </span>
            <button className="btn sm" disabled={!n} onClick={() => run({ type: 'xp', amount: n })}>+ опыт</button>
            <button className="btn sm" onClick={() => run({ type: 'long_rest' })}><Sunrise /> Долгий отдых</button>
          </>
        )}
        <div className="grow" />
        <button className="btn ghost sm" onClick={onClear}>Снять выбор</button>
      </div>
    </div>
  );
}

function CharacterActions({ c, run, onClose }: { c: CharacterView; campaignId: string; run: (c: Cmd) => void; onClose: () => void }) {
  const s = c.data.state;
  const [money, setMoney] = useState<Partial<Record<Coin, number>>>({});
  const [xp, setXp] = useState(0);
  const [item, setItem] = useState('');
  const [itemQty, setItemQty] = useState(1);
  const [lvlClass, setLvlClass] = useState(c.data.classes[0]?.classId ?? '');
  const [lvlHp, setLvlHp] = useState<'average' | 'roll'>('average');
  const [picker, setPicker] = useState(false);
  const moneyDelta = Object.fromEntries(Object.entries(money).filter(([, v]) => v)) as Partial<Record<Coin, number>>;
  return (
    <Modal title={c.data.name} onClose={onClose} wide>
      <div className="stack-lg">
        <div className="stack">
          <h4 style={{ margin: 0 }}>Состояния</h4>
          <div className="row wrap" style={{ gap: 6 }}>
            {(Object.keys(CONDITIONS) as Condition[]).map((k) => {
              const on = s.conditions.includes(k);
              return (
                <button key={k} className={`chip${on ? ' danger' : ''}`} onClick={() => run({ type: 'condition', condition: k, on: !on })}>
                  {CONDITIONS[k]}
                </button>
              );
            })}
          </div>
          <div className="row between wrap">
            <span>Истощение</span>
            <div className="segmented">
              {[0, 1, 2, 3, 4, 5, 6].map((l) => (
                <button key={l} className={s.exhaustion === l ? 'on' : ''} onClick={() => run({ type: 'exhaustion', value: l })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="row wrap">
            <button className={`btn sm${s.inspiration ? ' accent' : ''}`} onClick={() => run({ type: 'inspiration', value: !s.inspiration })}>
              ✦ {s.inspiration ? 'Забрать вдохновение' : 'Дать вдохновение'}
            </button>
            <button className="btn sm" onClick={() => run({ type: 'long_rest' })}><Sunrise /> Долгий отдых</button>
            <button className="btn sm" onClick={() => run({ type: 'set_hp', hp: c.sheet.maxHp })}><Heart /> Полные хиты</button>
          </div>
        </div>

        <div className="stack">
          <h4 style={{ margin: 0 }}>Деньги</h4>
          <div className="small muted">Сейчас: {COIN_ORDER.filter((k) => s.money[k]).map((k) => `${s.money[k]} ${COINS[k].name}`).join(', ') || 'пусто'}</div>
          <div className="row wrap">
            {COIN_ORDER.map((k) => (
              <label key={k} className="row small" style={{ gap: 4 }}>
                <NumberInput value={money[k] ?? 0} onChange={(n) => setMoney((m) => ({ ...m, [k]: n }))} style={{ width: 64 }} aria-label={COINS[k].name} />
                {COINS[k].name}
              </label>
            ))}
          </div>
          <div className="row">
            <button className="btn sm" disabled={!Object.keys(moneyDelta).length} onClick={() => { run({ type: 'money', delta: moneyDelta }); setMoney({}); }}>Выдать</button>
            <button className="btn sm" disabled={!Object.keys(moneyDelta).length} onClick={() => { run({ type: 'money', delta: Object.fromEntries(Object.entries(moneyDelta).map(([k, v]) => [k, -v!])) }); setMoney({}); }}>Забрать</button>
            <span className="small muted">Отрицательное число в поле тоже забирает.</span>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="stack">
            <h4 style={{ margin: 0 }}>Опыт</h4>
            <div className="row">
              <NumberInput value={xp} onChange={setXp} style={{ width: 90 }} aria-label="Опыт" />
              <button className="btn sm" disabled={!xp} onClick={() => { run({ type: 'xp', amount: xp }); setXp(0); }}>Начислить</button>
            </div>
            <div className="small muted">Сейчас {s.xp}</div>
          </div>
          <div className="stack">
            <h4 style={{ margin: 0 }}>Повысить уровень</h4>
            {c.data.classes.length ? (
              <div className="row wrap">
                {c.data.classes.length > 1 && (
                  <select className="select sm" style={{ width: 'auto' }} value={lvlClass} onChange={(e) => setLvlClass(e.target.value)}>
                    {c.data.classes.map((k, i) => <option key={k.classId} value={k.classId}>{c.names?.classes[i]?.name ?? k.classId}</option>)}
                  </select>
                )}
                <Segmented options={[{ id: 'average', label: 'Среднее' }, { id: 'roll', label: 'Бросок' }]} value={lvlHp} onChange={setLvlHp} />
                <button className="btn sm primary" onClick={() => run({ type: 'level_up', classId: lvlClass, hp: lvlHp })}>+1 уровень</button>
              </div>
            ) : (
              <span className="small muted">Класс не выбран</span>
            )}
          </div>
        </div>

        <div className="stack">
          <h4 style={{ margin: 0 }}>Выдать предмет</h4>
          <div className="row">
            <input className="input" placeholder="Название, например «Зелье лечения»" value={item} onChange={(e) => setItem(e.target.value)} />
            <NumberInput value={itemQty} min={1} onChange={setItemQty} style={{ width: 60 }} aria-label="Количество" />
            <button className="btn sm" disabled={!item.trim()} onClick={() => { run({ type: 'give_item', name: item.trim(), qty: itemQty }); setItem(''); setItemQty(1); }}>Выдать</button>
            <button className="btn ghost sm" onClick={() => setPicker(true)}>Из каталога</button>
          </div>
        </div>
      </div>
      {picker && (
        <ContentPicker
          kind="item"
          title="Выдать предмет"
          allowCustom
          onClose={() => setPicker(false)}
          onPick={(r, custom) => run({ type: 'give_item', name: r?.name ?? custom ?? '', itemId: r?.id, qty: 1 })}
        />
      )}
    </Modal>
  );
}

// ---------- Боковая колонка ----------

function InviteCode({ id, code }: { id: string; code: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const regen = useMutation({ mutationFn: () => api(`/campaigns/${id}/new-invite`, { body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['campaign', id] }) });
  return (
    <div className="row" style={{ gap: 4 }} title="Код приглашения для игроков">
      <span className="chip" style={{ height: 36, paddingInline: 14 }}>
        <span className="small muted">код</span> <span className="invite" style={{ fontSize: 16 }}>{code}</span>
      </span>
      <button className="btn ghost icon" aria-label="Скопировать код" onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Код скопирован'))}>
        <Copy />
      </button>
      <ConfirmButton className="btn ghost icon" confirm="Сменить?" onConfirm={() => regen.mutate()}>
        <RefreshCw />
      </ConfirmButton>
    </div>
  );
}

function InitiativePanel({ combat, allies, dm, act, busy }: { combat: Combat | null; allies: Set<string>; dm: boolean; act: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [edit, setEdit] = useState<string | null>(null);
  if (!combat)
    return dm ? (
      <div className="panel panel-pad stack" style={{ alignItems: 'flex-start' }}>
        <div className="small muted">Бой не идёт. Инициатива бросится за всех персонажей и живых противников.</div>
        <button className="btn primary" disabled={busy} onClick={() => act({ action: 'start' })}>
          <Swords /> Начать бой
        </button>
      </div>
    ) : null;
  return (
    <div className="panel initiative">
      <div className="panel-head">
        <h3>Раунд {combat.round}</h3>
        {dm && (
          <div className="row" style={{ gap: 2 }}>
            <button className="btn ghost sm icon" aria-label="Предыдущий ход" disabled={busy} onClick={() => act({ action: 'prev' })}><ChevronLeft /></button>
            <button className="btn sm primary" disabled={busy} onClick={() => act({ action: 'next' })}>Следующий <ChevronRight /></button>
            <ConfirmButton className="btn ghost sm" confirm="Завершить?" onConfirm={() => act({ action: 'end' })}>Конец</ConfirmButton>
          </div>
        )}
      </div>
      {combat.order.map((o, i) => (
        <div key={o.id} className={`init-row${i === combat.turn ? ' on' : ''}`}>
          {dm && edit === o.id ? (
            <input
              className="input sm num"
              autoFocus
              defaultValue={o.initiative}
              onBlur={(e) => { setEdit(null); const n = parseInt(e.target.value, 10); if (Number.isFinite(n) && n !== o.initiative) act({ action: 'set_initiative', targetId: o.id, initiative: n }); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <span className="n" onClick={() => dm && setEdit(o.id)} style={{ cursor: dm ? 'pointer' : undefined }} title={dm ? 'Изменить инициативу' : undefined}>
              {o.initiative}
            </span>
          )}
          <span style={{ color: o.kind === 'npc' && !allies.has(o.id) ? 'var(--danger)' : undefined }}>{o.name}</span>
          {dm ? (
            <button className="btn ghost xs icon" aria-label="Убрать из боя" onClick={() => act({ action: 'remove', targetId: o.id })}>×</button>
          ) : <span />}
        </div>
      ))}
    </div>
  );
}

function DiceBox({ dm, roll }: { dm: boolean; roll: (formula: string, label: string | undefined, hidden: boolean) => void }) {
  const [f, setF] = useState('');
  const [hidden, setHidden] = useState(false);
  const go = (formula: string) => formula.trim() && roll(formula.trim(), undefined, hidden);
  return (
    <div className="panel panel-pad stack" style={{ gap: 8 }}>
      <div className="row">
        <Dices size={18} className="muted" />
        <input className="input sm" placeholder="2к6+3" value={f} onChange={(e) => setF(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { go(f); setF(''); } }} aria-label="Формула броска" />
        <button className="btn sm" disabled={!f.trim()} onClick={() => { go(f); setF(''); }}>Бросить</button>
      </div>
      <div className="row wrap" style={{ gap: 4 }}>
        {[4, 6, 8, 10, 12, 20, 100].map((d) => (
          <button key={d} className="btn xs" onClick={() => go(`1к${d}`)}>к{d}</button>
        ))}
        {dm && (
          <label className="check small" style={{ marginLeft: 'auto' }} title="Бросок увидите только вы">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> тайно
          </label>
        )}
      </div>
    </div>
  );
}

function EventLog({ events, dm, userId, onUndo }: { events: EventRow[]; dm: boolean; userId?: string; onUndo: (e: EventRow) => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30000);
    return () => window.clearInterval(t);
  }, []);
  const undoable = (e: EventRow) => !e.undone && e.type !== 'roll' && e.type !== 'combat' && e.type !== 'achievement' && (dm || e.actor_id === userId);
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className="panel-head">
        <h3>Журнал</h3>
      </div>
      <div className="log">
        {events.length === 0 && <div className="panel-pad small muted">Здесь появятся урон, лечение, броски и награды.</div>}
        {events.map((e) => (
          <div key={e.id} className={`log-item${e.undone ? ' undone' : ''}${e.hidden ? ' hidden' : ''}${e.type === 'roll' ? ' roll' : ''}`}>
            <span className="sum">
              {e.hidden && <EyeOff size={12} style={{ marginRight: 4, verticalAlign: -1 }} />}
              {e.summary}
              {e.type === 'roll' && e.payload?.roll?.detail && <span className="small muted" style={{ fontWeight: 400 }}> · {e.payload.roll.detail}</span>}
            </span>
            <span className="row" style={{ gap: 2 }}>
              <span className="when">{timeAgo(e.created_at)}</span>
              {undoable(e) && (
                <button className="btn ghost xs icon" title="Отменить" aria-label="Отменить" onClick={() => onUndo(e)}>
                  <Undo2 size={13} />
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Модальные окна ----------

function SettingsModal({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const c = snap.campaign;
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  const [st, setSt] = useState(c.settings);
  const save = useMutation({
    mutationFn: () => api<Snapshot>(`/campaigns/${c.id}`, { method: 'PUT', body: { name, description, settings: st } }),
    onSuccess: (r) => {
      qc.setQueryData(['campaign', c.id], r);
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      onClose();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const del = useMutation({
    mutationFn: () => api(`/campaigns/${c.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      nav('/');
    },
  });
  const kick = (userId: string) => api(`/campaigns/${c.id}/members/${userId}`, { method: 'DELETE' }).then(() => qc.invalidateQueries({ queryKey: ['campaign', c.id] })).catch((e: Error) => toast(e.message, 'error'));
  const toggle = (k: 'playersEditHp' | 'playersEditMoney' | 'showEnemyHp', label: string, hint: string) => (
    <label className="check" style={{ alignItems: 'flex-start' }}>
      <input type="checkbox" checked={st[k]} onChange={(e) => setSt({ ...st, [k]: e.target.checked })} style={{ marginTop: 3 }} />
      <span>
        {label}
        <div className="small muted">{hint}</div>
      </span>
    </label>
  );
  return (
    <Modal
      title="Настройки кампании"
      onClose={onClose}
      footer={
        <>
          <ConfirmButton onConfirm={() => del.mutate()} confirm="Удалить кампанию?">
            <Trash2 /> Удалить
          </ConfirmButton>
          <div className="grow" />
          <button className="btn primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </button>
        </>
      }
    >
      <Field label="Название">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Описание">
        <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="stack">
        {toggle('playersEditHp', 'Игроки сами меняют хиты', 'Иначе урон и лечение персонажам вносит только мастер')}
        {toggle('playersEditMoney', 'Игроки сами меняют деньги', 'Иначе кошелёк меняет только мастер')}
        {toggle('showEnemyHp', 'Показывать игрокам точные хиты противников', 'Иначе игроки видят только «ранен», «при смерти»')}
      </div>
      <div className="stack">
        <h4 style={{ margin: 0 }}>Участники</h4>
        <div className="panel list">
          {snap.members.map((m) => (
            <div key={m.userId} className="list-item">
              <span className="grow">{m.displayName}</span>
              <span className="small muted">{m.role === 'dm' ? 'мастер' : `${snap.characters.filter((ch) => ch.ownerId === m.userId).length} перс.`}</span>
              {m.role !== 'dm' && (
                <ConfirmButton className="btn ghost sm" confirm="Исключить?" onConfirm={() => kick(m.userId)}>
                  Исключить
                </ConfirmButton>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function AddNpcModal({ campaignId, onClose, onDone }: { campaignId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'bestiary' | 'custom'>('bestiary');
  const [monster, setMonster] = useState<ContentRow | null>(null);
  const [picker, setPicker] = useState(false);
  const [count, setCount] = useState(1);
  const [rollHp, setRollHp] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [npc, setNpc] = useState({ name: '', ac: 12, maxHp: 10, initiativeBonus: 0, ally: false, notes: '' });
  const add = useMutation({
    mutationFn: () =>
      api(`/campaigns/${campaignId}/npcs`, {
        body: mode === 'bestiary' ? { monsterId: monster!.id, count, rollHp, hidden } : { npc: { ...npc, name: npc.name.trim(), hidden }, count },
      }),
    onSuccess: () => {
      toast(count > 1 ? `Добавлено: ${count}` : 'Добавлено');
      onDone();
      onClose();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const ok = mode === 'bestiary' ? !!monster : !!npc.name.trim() && npc.maxHp > 0;
  return (
    <Modal
      title="Добавить существо"
      onClose={onClose}
      wide
      footer={
        <button className="btn primary" disabled={!ok || add.isPending} onClick={() => add.mutate()}>
          <Plus /> Добавить{count > 1 ? ` ×${count}` : ''}
        </button>
      }
    >
      <Segmented options={[{ id: 'bestiary', label: 'Из бестиария' }, { id: 'custom', label: 'Своё существо' }]} value={mode} onChange={setMode} />
      {mode === 'bestiary' ? (
        <div className="stack">
          <button className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => setPicker(true)}>
            {monster ? (
              <>
                <b>{monster.name}</b>
                <span className="muted small">ПО {monster.data.cr} · КД {monster.data.ac} · {monster.data.hp} хитов</span>
              </>
            ) : (
              'Выбрать из бестиария…'
            )}
          </button>
          <label className="check">
            <input type="checkbox" checked={rollHp} onChange={(e) => setRollHp(e.target.checked)} /> Бросить хиты по формуле, а не среднее
          </label>
        </div>
      ) : (
        <div className="grid grid-2">
          <Field label="Имя">
            <input className="input" autoFocus value={npc.name} placeholder="Бандит" onChange={(e) => setNpc({ ...npc, name: e.target.value })} />
          </Field>
          <Field label="Класс доспеха">
            <NumberInput value={npc.ac} min={0} onChange={(ac) => setNpc({ ...npc, ac })} />
          </Field>
          <Field label="Хиты">
            <NumberInput value={npc.maxHp} min={1} onChange={(maxHp) => setNpc({ ...npc, maxHp })} />
          </Field>
          <Field label="Бонус инициативы">
            <NumberInput value={npc.initiativeBonus} onChange={(initiativeBonus) => setNpc({ ...npc, initiativeBonus })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={npc.ally} onChange={(e) => setNpc({ ...npc, ally: e.target.checked })} /> Союзник отряда
          </label>
        </div>
      )}
      <div className="row wrap">
        <label className="row" style={{ gap: 8 }}>
          Сколько
          <NumberInput value={count} min={1} max={30} onChange={setCount} style={{ width: 64 }} />
        </label>
        <label className="check">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Скрыть от игроков (засада)
        </label>
      </div>
      {count > 1 && <div className="small muted">Получат номера: «{(mode === 'bestiary' ? monster?.name : npc.name) || 'Существо'} 1», «… 2» и так далее.</div>}
      {picker && <ContentPicker kind="monster" title="Бестиарий" onClose={() => setPicker(false)} onPick={(r) => r && setMonster(r)} />}
    </Modal>
  );
}

function StatblockModal({ npc, onClose, roll }: { npc: Npc; onClose: () => void; roll: (f: string, l: string) => unknown }) {
  const q = useQuery({
    queryKey: ['content-item', npc.data.monsterId],
    queryFn: () => api<{ item: ContentRow }>(`/content/${npc.data.monsterId}`),
    enabled: !npc.data.statblock && !!npc.data.monsterId,
  });
  const m = (npc.data.statblock ?? q.data?.item.data) as Monster | undefined;
  return (
    <Modal title={npc.data.name} onClose={onClose} wide>
      {m ? <Statblock m={{ ...m, name: npc.data.name }} roll={roll} /> : <Loading />}
      {npc.data.notes && <div className="pre small muted">{npc.data.notes}</div>}
    </Modal>
  );
}

function AchievementModal({ campaignId, a, onClose }: { campaignId: string; a?: Achievement; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(a?.title ?? '');
  const [description, setDescription] = useState(a?.description ?? '');
  const [icon, setIcon] = useState(a?.icon ?? 'star');
  const save = useMutation({
    mutationFn: () => (a ? api(`/achievements/${a.id}`, { method: 'PUT', body: { title, description, icon } }) : api(`/campaigns/${campaignId}/achievements`, { body: { title, description, icon } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', campaignId] });
      onClose();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const del = useMutation({ mutationFn: () => api(`/achievements/${a!.id}`, { method: 'DELETE' }), onSuccess: onClose });
  return (
    <Modal
      title={a ? 'Достижение' : 'Новое достижение'}
      onClose={onClose}
      footer={
        <>
          {a && (
            <ConfirmButton onConfirm={() => del.mutate()} confirm="Удалить?">
              <Trash2 /> Удалить
            </ConfirmButton>
          )}
          <div className="grow" />
          <button className="btn primary" disabled={!title.trim() || save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </button>
        </>
      }
    >
      <Field label="Название">
        <input className="input" autoFocus value={title} placeholder="Сыграть в гольф" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="За что">
        <textarea className="textarea" rows={3} value={description} placeholder="Нанести дробящий удар в голову" onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Знак">
        <div className="row wrap" style={{ gap: 6 }}>
          {Object.keys(ACHIEVEMENT_ICONS).map((k) => (
            <button key={k} type="button" className={`btn icon${icon === k ? ' accent' : ' ghost'}`} aria-label={k} onClick={() => setIcon(k)}>
              <AchievementIcon name={k} size={18} />
            </button>
          ))}
        </div>
      </Field>
    </Modal>
  );
}

function AwardModal({ a, characters, onClose }: { a: Achievement; characters: CharacterView[]; onClose: () => void }) {
  const toast = useToast();
  const [ids, setIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const give = useMutation({
    mutationFn: () => Promise.all(ids.map((characterId) => api(`/achievements/${a.id}/award`, { body: { characterId, note: note || undefined } }))),
    onSuccess: () => {
      toast(`«${a.title}» выдано`, 'award');
      onClose();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <Modal
      title={`Выдать «${a.title}»`}
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!ids.length || give.isPending} onClick={() => give.mutate()}>
          <Gift /> Выдать{ids.length > 1 ? ` (${ids.length})` : ''}
        </button>
      }
    >
      <div className="panel list">
        {characters.map((c) => (
          <label key={c.id} className="list-item check" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={ids.includes(c.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} />
            <span className="grow">{c.data.name}</span>
          </label>
        ))}
      </div>
      <Field label="Подпись" hint="Необязательно: например, «гоблин-вожак, сессия 4»">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

interface CharacterSummary { id: string; name: string; campaignId: string | null; campaignName: string | null; level: number; classes: string }

function AttachModal({ campaignId, attached, onClose }: { campaignId: string; attached: CharacterView[]; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useAuth();
  const chars = useQuery({ queryKey: ['characters'], queryFn: () => api<{ characters: CharacterSummary[] }>('/characters') });
  const free = useMemo(() => (chars.data?.characters ?? []).filter((c) => c.campaignId !== campaignId), [chars.data, campaignId]);
  const done = () => {
    qc.invalidateQueries({ queryKey: ['campaign', campaignId] });
    qc.invalidateQueries({ queryKey: ['characters'] });
  };
  const attach = (characterId: string) => api(`/campaigns/${campaignId}/characters`, { body: { characterId } }).then(done).catch((e: Error) => toast(e.message, 'error'));
  const detach = (characterId: string) => api(`/campaigns/${campaignId}/characters/${characterId}`, { method: 'DELETE' }).then(done).catch((e: Error) => toast(e.message, 'error'));
  const leave = () => api(`/campaigns/${campaignId}/members/${user!.id}`, { method: 'DELETE' }).then(() => { qc.invalidateQueries({ queryKey: ['campaigns'] }); nav('/'); }).catch((e: Error) => toast(e.message, 'error'));
  return (
    <Modal
      title="Мои персонажи в кампании"
      onClose={onClose}
      footer={
        <ConfirmButton onConfirm={leave} confirm="Покинуть кампанию?">
          Покинуть кампанию
        </ConfirmButton>
      }
    >
      {attached.length > 0 && (
        <div className="panel list">
          {attached.map((c) => (
            <div key={c.id} className="list-item">
              <span className="grow"><b>{c.data.name}</b></span>
              <ConfirmButton className="btn ghost sm" confirm="Убрать?" onConfirm={() => detach(c.id)}>
                Убрать из кампании
              </ConfirmButton>
            </div>
          ))}
        </div>
      )}
      <h4 style={{ margin: 0 }}>Прикрепить</h4>
      {chars.isLoading ? (
        <Loading />
      ) : free.length === 0 ? (
        <div className="small muted">Свободных персонажей нет. <Link to="/">Создайте нового</Link> на главной.</div>
      ) : (
        <div className="panel list">
          {free.map((c) => (
            <div key={c.id} className="list-item">
              <span className="grow">
                <b>{c.name}</b>
                <div className="small muted">
                  {c.classes || 'без класса'}
                  {c.campaignName ? ` · сейчас в «${c.campaignName}»` : ''}
                </div>
              </span>
              <button className="btn sm" onClick={() => attach(c.id)}>
                Прикрепить
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="small muted">{plural(attached.length, 'Прикреплён', 'Прикреплено', 'Прикреплено')} {attached.length}.</div>
    </Modal>
  );
}
