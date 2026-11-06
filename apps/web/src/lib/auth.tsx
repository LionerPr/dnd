import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api, type User } from '../api/client';
import { resetSocket } from './socket';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: User | null }>('/auth/me'), staleTime: Infinity });
  const set = (user: User | null) => {
    resetSocket();
    // qc.clear() would drop the ['me'] query the hook is subscribed to, so the
    // new user would land in a fresh cache entry nobody watches. Keep ['me'].
    qc.cancelQueries();
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    qc.setQueryData(['me'], { user });
  };
  const value: AuthState = {
    user: me.data?.user ?? null,
    loading: me.isLoading,
    async login(username, password) {
      set((await api<{ user: User }>('/auth/login', { body: { username, password } })).user);
    },
    async register(username, password, displayName) {
      set((await api<{ user: User }>('/auth/register', { body: { username, password, displayName } })).user);
    },
    async logout() {
      await api('/auth/logout', { body: {} });
      set(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
