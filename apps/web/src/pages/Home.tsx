import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, DoorOpen, Plus, Shield, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Empty, Field, Loading, Modal, Rule, useToast } from '../components/ui';
import { plural, timeAgo } from '../lib/format';

interface CharacterSummary {
  id: string;
  name: string;
  race?: string;
  classes: string;
  level: number;
  hp: number;
  maxHp: number;
  ac: number;
  campaignId: string | null;
  campaignName: string | null;
  updatedAt: string;
}
interface CampaignSummary {
  id: string;
  name: string;
  description: string;
  role: 'dm' | 'player';
  characters: number;
  dm_name: string;
}

export function HomePage() {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const chars = useQuery({ queryKey: ['characters'], queryFn: () => api<{ characters: CharacterSummary[] }>('/characters') });
  const camps = useQuery({ queryKey: ['campaigns'], queryFn: () => api<{ campaigns: CampaignSummary[] }>('/campaigns') });
  const [modal, setModal] = useState<null | 'character' | 'campaign' | 'join'>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [joinChar, setJoinChar] = useState('');

  const close = () => {
    setModal(null);
    setName('');
    setCode('');
  };
  const onError = (e: Error) => toast(e.message, 'error');

  const createChar = useMutation({
    mutationFn: () => api<{ id: string }>('/characters', { body: { name } }),
    onSuccess: (r) => nav(`/characters/${r.id}?tab=build`),
    onError,
  });
  const createCampaign = useMutation({
    mutationFn: () => api<{ campaign: { id: string } }>('/campaigns', { body: { name } }),
    onSuccess: (r) => nav(`/campaigns/${r.campaign.id}`),
    onError,
  });
  const join = useMutation({
    mutationFn: () => api<{ campaign: { id: string } }>('/campaigns/join', { body: { code, characterId: joinChar || undefined } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      nav(`/campaigns/${r.campaign.id}`);
    },
    onError,
  });

  if (chars.isLoading || camps.isLoading) return <Loading />;
  const characters = chars.data?.characters ?? [];
  const campaigns = camps.data?.campaigns ?? [];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Мои герои</h1>
          <div className="sub">
            {characters.length
              ? `${characters.length} ${plural(characters.length, 'персонаж', 'персонажа', 'персонажей')}`
              : 'Пока никого — создайте первого героя'}
          </div>
        </div>
        <button className="btn primary" onClick={() => setModal('character')}>
          <Plus /> Новый персонаж
        </button>
      </div>

      {characters.length === 0 ? (
        <Empty title="Здесь будут ваши листы">
          <p>Выберите расу и класс — характеристики, хиты и навыки посчитаются сами.</p>
          <button className="btn" onClick={() => setModal('character')}>
            <Plus /> Создать персонажа
          </button>
        </Empty>
      ) : (
        <div className="cards">
          {characters.map((c) => (
            <Link key={c.id} to={`/characters/${c.id}`} className="card-link">
              <div className="row between">
                <h3>{c.name}</h3>
                {c.level > 0 && <span className="chip num">{c.level} ур.</span>}
              </div>
              <div className="muted">{[c.race, c.classes].filter(Boolean).join(' · ') || 'Не настроен'}</div>
              <div className="row" style={{ marginTop: 12, gap: 14 }}>
                <span className="row small">
                  <Shield size={14} className="muted" /> <span className="num">{c.ac}</span>
                </span>
                <HpMini hp={c.hp} max={c.maxHp} />
              </div>
              <div className="row between small muted" style={{ marginTop: 10 }}>
                <span>{c.campaignName ? `в «${c.campaignName}»` : 'без кампании'}</span>
                <span>{timeAgo(c.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Rule>Кампании</Rule>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <button className="btn" onClick={() => setModal('campaign')}>
          <Crown /> Стать мастером
        </button>
        <button className="btn" onClick={() => setModal('join')}>
          <DoorOpen /> Войти по коду
        </button>
      </div>
      {campaigns.length === 0 ? (
        <p className="muted">Создайте кампанию как мастер или войдите в чужую по коду приглашения.</p>
      ) : (
        <div className="cards">
          {campaigns.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="card-link">
              <div className="row between">
                <h3>{c.name}</h3>
                <span className={`chip ${c.role === 'dm' ? 'accent' : ''}`}>{c.role === 'dm' ? 'Мастер' : 'Игрок'}</span>
              </div>
              <div className="muted small">Ведёт {c.dm_name}</div>
              <div className="row small muted" style={{ marginTop: 10 }}>
                <Users size={14} /> {c.characters} {plural(c.characters, 'герой', 'героя', 'героев')}
              </div>
            </Link>
          ))}
        </div>
      )}

      {modal === 'character' && (
        <Modal
          title="Новый персонаж"
          onClose={close}
          footer={
            <>
              <button className="btn ghost" onClick={close}>
                Отмена
              </button>
              <button className="btn primary" disabled={!name.trim() || createChar.isPending} onClick={() => createChar.mutate()}>
                Создать
              </button>
            </>
          }
        >
          <Field label="Имя" hint="Расу, класс и характеристики выберете на следующем шаге">
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && createChar.mutate()} />
          </Field>
        </Modal>
      )}
      {modal === 'campaign' && (
        <Modal
          title="Новая кампания"
          onClose={close}
          footer={
            <>
              <button className="btn ghost" onClick={close}>
                Отмена
              </button>
              <button className="btn primary" disabled={!name.trim() || createCampaign.isPending} onClick={() => createCampaign.mutate()}>
                Создать
              </button>
            </>
          }
        >
          <Field label="Название" hint="Игроки войдут по коду приглашения, который появится в комнате">
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </Modal>
      )}
      {modal === 'join' && (
        <Modal
          title="Войти в кампанию"
          onClose={close}
          footer={
            <>
              <button className="btn ghost" onClick={close}>
                Отмена
              </button>
              <button className="btn primary" disabled={code.trim().length < 6 || join.isPending} onClick={() => join.mutate()}>
                Войти
              </button>
            </>
          }
        >
          <Field label="Код приглашения" hint="6 символов, его даёт мастер">
            <input
              className="input"
              autoFocus
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              style={{ letterSpacing: '0.3em', fontWeight: 600, textAlign: 'center', fontSize: 18, height: 44 }}
            />
          </Field>
          <Field label="Каким героем играете">
            <select className="select" value={joinChar} onChange={(e) => setJoinChar(e.target.value)}>
              <option value="">Выберу позже</option>
              {characters
                .filter((c) => !c.campaignId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        </Modal>
      )}
    </main>
  );
}

export function HpMini({ hp, max }: { hp: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  const color = pct > 0.5 ? 'var(--good)' : pct > 0.25 ? 'var(--warn)' : 'var(--danger)';
  return (
    <span className="row small grow" style={{ gap: 8 }}>
      <span style={{ flex: 1, height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden', maxWidth: 120 }}>
        <span style={{ display: 'block', width: `${pct * 100}%`, height: '100%', background: color }} />
      </span>
      <span className="num">
        {hp}/{max}
      </span>
    </span>
  );
}
