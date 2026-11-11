import { useMutation, useQueryClient } from '@tanstack/react-query';
import { XP_THRESHOLDS } from '@dnd/rules-engine';
import { ArrowLeft, ArrowUpCircle, Check, Copy, Download, Moon, Pencil, Sparkles, Sunrise, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Abilities } from '../components/sheet/Abilities';
import { AwardsTab } from '../components/sheet/AwardsTab';
import { BuildTab } from '../components/sheet/BuildTab';
import { CombatTab } from '../components/sheet/CombatTab';
import { FeaturesTab } from '../components/sheet/FeaturesTab';
import { norm, useSpellIndex } from '../components/sheet/RichText';
import { GearTab } from '../components/sheet/GearTab';
import { LevelUpModal } from '../components/sheet/LevelUp';
import { NotesTab } from '../components/sheet/NotesTab';
import { RestModal } from '../components/sheet/RestModal';
import { SpellsTab } from '../components/sheet/SpellsTab';
import { Vitals } from '../components/sheet/Vitals';
import { ConfirmButton, Empty, Loading, Tabs, useToast } from '../components/ui';
import { useCharacter, useCommand, useRoller, useSaveBuild } from '../lib/hooks';

type Tab = 'combat' | 'spells' | 'features' | 'gear' | 'awards' | 'notes' | 'build';

export function CharacterPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useCharacter(id);
  const cmd = useCommand(id);
  const save = useSaveBuild(q.data);
  const roll = useRoller(q.data?.campaignId, id);
  const [rest, setRest] = useState(false);
  const [levelUp, setLevelUp] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const tab = (params.get('tab') as Tab) || 'combat';
  const setTab = (t: Tab) => setParams(t === 'combat' ? {} : { tab: t }, { replace: true });

  const del = useMutation({
    mutationFn: () => api(`/characters/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      nav('/');
    },
  });
  const dup = useMutation({
    mutationFn: () => api<{ id: string }>(`/characters/${id}/duplicate`, { body: {} }),
    onSuccess: (r) => {
      toast('Копия создана');
      nav(`/characters/${r.id}`);
    },
  });

  const spellIndex = useSpellIndex();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data)
    return (
      <main className="page">
        <Empty title="Персонаж не найден">{(q.error as Error)?.message}</Empty>
      </main>
    );

  const view = q.data;
  const { data: c, sheet } = view;
  const canEdit = view.access?.canEdit ?? true;
  const isOwner = view.access?.owner ?? true;
  // Вкладка нужна и не-заклинателю, если умения дают заклинания (монах пути тени, тифлинг и т.п.)
  const featureSpells = sheet.features.some((f) => [...(f.description ?? '').matchAll(/\[([^\]\n]{2,60})\]/g)].some((m) => spellIndex.en.has(norm(m[1]))));
  const hasSpells = sheet.casters.length > 0 || c.spellsKnown.length > 0 || featureSpells;
  const configured = c.classes.length > 0;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${c.name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'combat', label: 'Бой' },
    ...(hasSpells ? [{ id: 'spells' as Tab, label: 'Заклинания', count: c.spellsKnown.length || undefined }] : []),
    { id: 'features', label: 'Умения', count: sheet.features.length || undefined },
    { id: 'gear', label: 'Снаряжение' },
    { id: 'awards', label: 'Достижения', count: view.awards?.length || undefined },
    { id: 'notes', label: 'Описание' },
    ...(canEdit ? [{ id: 'build' as Tab, label: 'Конструктор' }] : []),
  ];

  const names = view.names;
  const raceName = names?.subrace ? `${names.race} (${names.subrace})` : names?.race;
  const classLine = names?.classes.map((x) => `${x.name} ${x.level}${x.subclass ? ` · ${x.subclass}` : ''}`).join(' / ');

  return (
    <main className="page wide">
      <div className="sheet-head">
        <div>
          {view.campaignId && (
            <Link to={`/campaigns/${view.campaignId}`} className="btn ghost sm" style={{ marginLeft: -10, marginBottom: 6 }}>
              <ArrowLeft /> В комнату кампании
            </Link>
          )}
          {nameDraft !== null ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const n = nameDraft.trim();
                if (n && n !== c.name) save((d) => ({ ...d, name: n }));
                setNameDraft(null);
              }}
            >
              <input className="input name-input" value={nameDraft} maxLength={80} autoFocus onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNameDraft(null)} />
              <button className="btn icon" title="Сохранить имя"><Check /></button>
            </form>
          ) : (
            <h1 className="row" style={{ gap: 8 }}>
              {c.name}
              {canEdit && (
                <button className="btn ghost icon sm" title="Переименовать" onClick={() => setNameDraft(c.name)}>
                  <Pencil />
                </button>
              )}
            </h1>
          )}
          <div className="meta">
            {[raceName, classLine, c.background, c.alignment].filter(Boolean).join(' · ') || 'Раса и класс не выбраны'}
          </div>
          {configured && (
            <div className="level-badge">
              <b>{sheet.level} уровень</b>
              <span className="tag" title="Редакция правил">{c.edition === '2024' ? '5.5e · 2024' : '5e · 2014'}</span>
              {sheet.level < 20 && (
                <>
                  <span className="xp-bar" title="Опыт до следующего уровня">
                    <i style={{ width: `${Math.min(100, Math.max(0, ((c.state.xp - XP_THRESHOLDS[sheet.level]!) / (XP_THRESHOLDS[sheet.level + 1]! - XP_THRESHOLDS[sheet.level]!)) * 100))}%` }} />
                  </span>
                  <span className="small muted num">
                    {c.state.xp} / {XP_THRESHOLDS[sheet.level + 1]} опыта
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        {canEdit && configured && (
          <div className="row wrap">
            {sheet.level < 20 && (
              <button className={`btn ${c.state.xp >= (XP_THRESHOLDS[sheet.level + 1] ?? Infinity) ? 'accent' : ''}`} onClick={() => setLevelUp(true)}>
                <ArrowUpCircle /> Повысить уровень
              </button>
            )}
            <button
              className={`btn ${c.state.inspiration ? 'accent' : ''}`}
              onClick={() => cmd.mutate({ type: 'inspiration', value: !c.state.inspiration })}
              title="Вдохновение"
            >
              <Sparkles /> {c.state.inspiration ? 'Вдохновлён' : 'Вдохновение'}
            </button>
            <button className="btn" onClick={() => setRest(true)}>
              <Moon /> Короткий отдых
            </button>
            <button className="btn" onClick={() => cmd.mutate({ type: 'long_rest' }, { onSuccess: () => toast('Долгий отдых: силы восстановлены') })}>
              <Sunrise /> Долгий отдых
            </button>
          </div>
        )}
      </div>

      {!configured && canEdit && tab !== 'build' && (
        <div className="pending" style={{ marginBottom: 18 }}>
          Лист пока пуст. <Link className="btn sm accent" to={`/characters/${id}/create`}>Создать персонажа по шагам</Link> — раса, класс, характеристики и выборы.
        </div>
      )}

      <Vitals view={view} canEdit={canEdit} cmd={cmd.mutate} roll={roll} />

      <div className="sheet-body">
        <div>
        {canEdit && configured && (
          <button className={`btn sm ${editing ? 'accent' : 'ghost'}`} style={{ marginBottom: 8 }} onClick={() => setEditing(!editing)}>
            {editing ? <><Check /> Готово</> : <><Pencil /> Править характеристики и навыки</>}
          </button>
        )}
        <Abilities sheet={sheet} roll={roll} edit={editing ? { c, save } : undefined} />
        </div>
        <div>
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'combat' && <CombatTab view={view} canEdit={canEdit} cmd={cmd.mutate} roll={roll} />}
          {tab === 'spells' && <SpellsTab view={view} canEdit={canEdit} cmd={cmd.mutate} roll={roll} save={save} />}
          {tab === 'features' && <FeaturesTab view={view} />}
          {tab === 'gear' && <GearTab view={view} canEdit={canEdit} cmd={cmd.mutate} save={save} />}
          {tab === 'awards' && <AwardsTab view={view} />}
          {tab === 'notes' && <NotesTab view={view} canEdit={canEdit} save={save} />}
          {tab === 'build' && canEdit && <BuildTab view={view} save={save} />}

          {isOwner && (
            <div className="row wrap" style={{ marginTop: 32, justifyContent: 'flex-end' }}>
              <button className="btn ghost sm" onClick={exportJson}>
                <Download /> Экспорт JSON
              </button>
              <button className="btn ghost sm" onClick={() => dup.mutate()}>
                <Copy /> Копия
              </button>
              <ConfirmButton onConfirm={() => del.mutate()} confirm="Удалить навсегда?">
                <Trash2 /> Удалить
              </ConfirmButton>
            </div>
          )}
        </div>
      </div>

      {levelUp && (
        <LevelUpModal
          view={view}
          onClose={() => setLevelUp(false)}
          onSave={(next) => {
            save(() => next);
            setLevelUp(false);
            toast(`Новый уровень: ${next.classes.reduce((s, x) => s + x.level, 0)}`);
          }}
        />
      )}
      {rest && <RestModal view={view} onClose={() => setRest(false)} onRest={(hitDice) => cmd.mutate({ type: 'short_rest', hitDice }, { onSuccess: () => setRest(false) })} />}
    </main>
  );
}
