import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Empty, Loading, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';

interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  isModerator: boolean;
  createdAt: string;
}

/** Пользователи и права: администратор выдаёт и снимает права модератора */
export function AdminPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-users'], queryFn: () => api<{ users: AdminUser[] }>('/admin/users'), enabled: !!user?.isAdmin });
  const set = useMutation({
    mutationFn: ({ id, isModerator }: { id: string; isModerator: boolean }) => api(`/admin/users/${id}`, { method: 'PUT', body: { isModerator } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e: Error) => toast(e.message, 'error'),
  });
  if (!user?.isAdmin)
    return (
      <main className="page">
        <Empty title="Только для администратора" />
      </main>
    );
  if (q.isLoading) return <Loading />;
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Пользователи</h1>
          <div className="sub">Модераторы, как и администратор, создают и правят расы, классы, заклинания, предметы, существа и черты библиотеки и загружают их с dnd.su.</div>
        </div>
      </div>
      <div className="panel list">
        {(q.data?.users ?? []).map((u) => (
          <div key={u.id} className="list-item">
            <span className="grow">
              <b>{u.displayName}</b>
              <div className="small muted">
                {u.username} · зарегистрирован {timeAgo(u.createdAt)}
              </div>
            </span>
            {u.isAdmin ? (
              <span className="chip small accent">администратор</span>
            ) : (
              <label className="check small">
                <input type="checkbox" checked={u.isModerator} disabled={set.isPending} onChange={(e) => set.mutate({ id: u.id, isModerator: e.target.checked })} /> модератор
              </label>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
