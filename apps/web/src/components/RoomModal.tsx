import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Crown, Plus, Swords } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Field, Modal, useToast } from './ui';

export interface OwnCharacter {
  id: string;
  name: string;
  race?: string;
  classes: string;
  level: number;
  campaignId: string | null;
  campaignName: string | null;
}

type Role = 'dm' | 'player';

/**
 * Вход в комнату: сначала роль — мастер или приключенец.
 * Мастер называет новую кампанию. Приключенец вводит код и выбирает героя из своих или заводит нового.
 */
export function RoomModal({ characters, initialRole, onClose }: { characters: OwnCharacter[]; initialRole?: Role; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [role, setRole] = useState<Role | null>(initialRole ?? null);
  const [campaignName, setCampaignName] = useState('');
  const [code, setCode] = useState('');
  const free = characters.filter((c) => !c.campaignId);
  const busy = characters.filter((c) => c.campaignId);
  // 'new' — завести нового героя; иначе id выбранного
  const [hero, setHero] = useState<string>(free[0]?.id ?? 'new');
  const [heroName, setHeroName] = useState('');
  const onError = (e: Error) => toast(e.message, 'error');

  const create = useMutation({
    mutationFn: () => api<{ campaign: { id: string } }>('/campaigns', { body: { name: campaignName.trim() } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      nav(`/campaigns/${r.campaign.id}`);
    },
    onError,
  });

  const join = useMutation({
    mutationFn: () =>
      api<{ campaign: { id: string }; characterId: string | null }>('/campaigns/join', {
        body: { code, ...(hero === 'new' ? { newCharacter: heroName.trim() } : { characterId: hero }) },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['characters'] });
      // Новому герою сразу нужны раса и класс — открываем его лист на вкладке сборки
      if (hero === 'new' && r.characterId) nav(`/characters/${r.characterId}/create`);
      else nav(`/campaigns/${r.campaign.id}`);
    },
    onError,
  });

  const canJoin = code.trim().length === 6 && (hero !== 'new' || heroName.trim().length > 0);
  const back = (
    <button className="btn ghost" onClick={() => setRole(null)}>
      <ArrowLeft /> Назад
    </button>
  );

  if (!role) {
    return (
      <Modal title="Комната" onClose={onClose}>
        <p className="muted" style={{ marginTop: 0 }}>Кем вы будете в этой игре?</p>
        <div className="role-pick">
          <button className="role-card" onClick={() => setRole('dm')}>
            <Crown />
            <b>Мастер</b>
            <span>Создаёт кампанию, ведёт врагов и бой, выдаёт награды</span>
          </button>
          <button className="role-card" onClick={() => setRole('player')}>
            <Swords />
            <b>Приключенец</b>
            <span>Входит по коду мастера с готовым или новым героем</span>
          </button>
        </div>
      </Modal>
    );
  }

  if (role === 'dm') {
    return (
      <Modal
        title="Новая кампания"
        onClose={onClose}
        footer={
          <>
            {back}
            <button className="btn primary" disabled={!campaignName.trim() || create.isPending} onClick={() => create.mutate()}>
              Создать комнату
            </button>
          </>
        }
      >
        <Field label="Название" hint="Код приглашения для игроков появится в комнате">
          <input
            className="input"
            autoFocus
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && campaignName.trim() && create.mutate()}
          />
        </Field>
      </Modal>
    );
  }

  return (
    <Modal
      title="Войти приключенцем"
      onClose={onClose}
      footer={
        <>
          {back}
          <button className="btn primary" disabled={!canJoin || join.isPending} onClick={() => join.mutate()}>
            Войти
          </button>
        </>
      }
    >
      <Field label="Код приглашения" hint="6 символов, его даёт мастер">
        <input
          className="input code-input"
          autoFocus
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </Field>
      <Field label="Герой">
        <div className="hero-pick">
          {free.map((c) => (
            <label key={c.id} className={`hero-option ${hero === c.id ? 'on' : ''}`}>
              <input type="radio" name="hero" checked={hero === c.id} onChange={() => setHero(c.id)} />
              <span>
                <b>{c.name}</b>
                <span className="muted small">{[c.race, c.classes, c.level ? `${c.level} ур.` : ''].filter(Boolean).join(' · ') || 'не настроен'}</span>
              </span>
            </label>
          ))}
          <label className={`hero-option ${hero === 'new' ? 'on' : ''}`}>
            <input type="radio" name="hero" checked={hero === 'new'} onChange={() => setHero('new')} />
            <span className="grow">
              <b className="row" style={{ gap: 6 }}>
                <Plus size={14} /> Новый герой
              </b>
              {hero === 'new' && (
                <input
                  className="input"
                  placeholder="Имя"
                  value={heroName}
                  onChange={(e) => setHeroName(e.target.value)}
                  style={{ marginTop: 8 }}
                />
              )}
            </span>
          </label>
        </div>
        {busy.length > 0 && (
          <div className="hint">
            {busy.map((c) => c.name).join(', ')} {busy.length === 1 ? 'уже играет' : 'уже играют'} в других кампаниях — их можно открепить на странице кампании.
          </div>
        )}
      </Field>
    </Modal>
  );
}
