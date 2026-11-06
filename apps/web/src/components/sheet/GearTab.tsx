import { COINS, COIN_ORDER, type Character, type Coin } from '@dnd/rules-engine';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type CharacterView, type Command, type ContentRow } from '../../api/client';
import { ContentPicker } from '../ContentPicker';
import { Field, Modal, NumberInput, Segmented } from '../ui';

const COIN_LABEL: Record<Coin, string> = { cp: 'медные', sp: 'серебряные', ep: 'электрумовые', gp: 'золотые', pp: 'платиновые' };

export function GearTab({ view, canEdit, cmd, save }: { view: CharacterView; canEdit: boolean; cmd: (c: Command) => void; save: (u: (c: Character) => Character) => void }) {
  const { data: c, sheet } = view;
  const [money, setMoney] = useState<null | 'add' | 'spend'>(null);
  const [picker, setPicker] = useState(false);
  const itemIds = c.inventory.map((i) => i.itemId).filter(Boolean) as string[];
  const items = useQuery({
    queryKey: ['batch', itemIds.join(',')],
    queryFn: () => api<{ items: ContentRow[] }>(`/content/batch?ids=${itemIds.join(',')}`),
    enabled: itemIds.length > 0,
  });
  const byId = new Map((items.data?.items ?? []).map((i) => [i.id, i]));
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="stack-lg">
      <div className="panel">
        <div className="panel-head">
          <h3>Кошелёк</h3>
          {canEdit && (
            <div className="row">
              <button className="btn sm" onClick={() => setMoney('spend')}>
                <Minus /> Потратить
              </button>
              <button className="btn sm" onClick={() => setMoney('add')}>
                <Plus /> Получить
              </button>
            </div>
          )}
        </div>
        <div className="panel-pad">
          <div className="coins">
            {[...COIN_ORDER].reverse().map((k) => (
              <div key={k} className={`coin ${k}`}>
                <div className="n">{c.state.money[k]}</div>
                <div className="c">{COINS[k].name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Снаряжение</h3>
          <div className="row">
            <span className="small muted num">
              {sheet.carried.weight} / {sheet.carried.capacity} фнт
            </span>
            {canEdit && (
              <button className="btn sm" onClick={() => setPicker(true)}>
                <Plus /> Добавить
              </button>
            )}
          </div>
        </div>
        {c.inventory.length === 0 && <div className="panel-pad muted">Пусто. Добавьте предметы из библиотеки или впишите свои.</div>}
        {c.inventory.map((inv) => {
          const item = inv.itemId ? byId.get(inv.itemId) : undefined;
          const name = item?.name ?? inv.name ?? 'Предмет';
          const equippable = !!(item?.data.weapon || item?.data.armor || item?.data.shield || item?.data.effects?.length);
          return (
            <div key={inv.id} className="feature">
              <div className="row" style={{ padding: '8px 14px', gap: 10 }}>
                {equippable && (
                  <label className="check" title="Надето / в руках">
                    <input
                      type="checkbox"
                      checked={!!inv.equipped}
                      disabled={!canEdit}
                      onChange={(e) => save((d) => ({ ...d, inventory: d.inventory.map((x) => (x.id === inv.id ? { ...x, equipped: e.target.checked } : x)) }))}
                    />
                  </label>
                )}
                <button className="btn ghost sm grow" style={{ justifyContent: 'flex-start', fontWeight: 600 }} onClick={() => setOpen(open === inv.id ? null : inv.id)}>
                  {name}
                </button>
                {item?.data.attunement && (
                  <label className="check small">
                    <input
                      type="checkbox"
                      checked={!!inv.attuned}
                      disabled={!canEdit}
                      onChange={(e) => save((d) => ({ ...d, inventory: d.inventory.map((x) => (x.id === inv.id ? { ...x, attuned: e.target.checked } : x)) }))}
                    />
                    настроен
                  </label>
                )}
                <span className="small muted num" style={{ width: 52, textAlign: 'right' }}>{item?.data.weight ? `${item.data.weight * inv.qty} фнт` : ''}</span>
                {canEdit ? (
                  <NumberInput
                    className="input num sm"
                    style={{ width: 56 }}
                    value={inv.qty}
                    min={0}
                    aria-label="Количество"
                    onChange={(q) => save((d) => ({ ...d, inventory: d.inventory.map((x) => (x.id === inv.id ? { ...x, qty: q } : x)).filter((x) => x.qty > 0) }))}
                  />
                ) : (
                  <span className="num">×{inv.qty}</span>
                )}
                {canEdit && (
                  <button className="btn ghost sm icon" aria-label="Убрать" onClick={() => save((d) => ({ ...d, inventory: d.inventory.filter((x) => x.id !== inv.id) }))}>
                    <Trash2 />
                  </button>
                )}
              </div>
              {open === inv.id && (
                <div className="body">
                  {item?.data.weapon && <div className="muted">Урон {item.data.weapon.damage} · {(item.data.weapon.properties ?? []).join(', ')}</div>}
                  {item?.data.armor && <div className="muted">КД {item.data.armor.base}{item.data.armor.dexCap === null ? ' + Лов' : item.data.armor.dexCap > 0 ? ` + Лов (макс. ${item.data.armor.dexCap})` : ''}</div>}
                  {item?.data.description || inv.notes || <span className="muted">Без описания</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {money && <MoneyModal mode={money} onClose={() => setMoney(null)} cmd={cmd} />}
      {picker && (
        <ContentPicker
          kind="item"
          title="Добавить предмет"
          edition={c.edition ?? '2014'}
          allowCustom
          onClose={() => setPicker(false)}
          onPick={(row, customName) => {
            save((d) => {
              const inventory = [...d.inventory];
              const same = row ? inventory.find((i) => i.itemId === row.id) : inventory.find((i) => !i.itemId && i.name === customName);
              if (same) same.qty += 1;
              else inventory.push({ id: Math.random().toString(36).slice(2, 10), itemId: row?.id, name: row ? undefined : customName, qty: 1 });
              return { ...d, inventory };
            });
          }}
        />
      )}
    </div>
  );
}

function MoneyModal({ mode, onClose, cmd }: { mode: 'add' | 'spend'; onClose: () => void; cmd: (c: Command) => void }) {
  const [m, setM] = useState(mode);
  const [delta, setDelta] = useState<Record<Coin, number>>({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  const [amount, setAmount] = useState(0);
  const [coin, setCoin] = useState<Coin>('gp');
  const submit = () => {
    if (m === 'add') {
      const d = Object.fromEntries(Object.entries(delta).filter(([, v]) => v));
      if (Object.keys(d).length) cmd({ type: 'money', delta: d });
    } else if (amount > 0) cmd({ type: 'spend', amount, coin });
    onClose();
  };
  return (
    <Modal
      title="Деньги"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={submit}>Готово</button>
        </>
      }
    >
      <Segmented options={[{ id: 'add', label: 'Получить' }, { id: 'spend', label: 'Потратить' }]} value={m} onChange={setM} />
      {m === 'add' ? (
        <div className="grid grid-3">
          {[...COIN_ORDER].reverse().map((k) => (
            <Field key={k} label={COIN_LABEL[k]}>
              <NumberInput value={delta[k]} onChange={(v) => setDelta({ ...delta, [k]: v })} />
            </Field>
          ))}
          <p className="small muted" style={{ gridColumn: '1 / -1' }}>Отрицательное число — забрать именно эти монеты.</p>
        </div>
      ) : (
        <div className="row">
          <NumberInput value={amount} min={0} onChange={setAmount} style={{ width: 100 }} />
          <select className="select" value={coin} onChange={(e) => setCoin(e.target.value as Coin)} style={{ width: 160 }}>
            {[...COIN_ORDER].reverse().map((k) => (
              <option key={k} value={k}>{COIN_LABEL[k]}</option>
            ))}
          </select>
          <span className="small muted">сдача посчитается сама</span>
        </div>
      )}
    </Modal>
  );
}
