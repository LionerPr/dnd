import { useState } from 'react';
import { Logo } from '../components/Logo';
import { Field, Segmented } from '../components/ui';
import { useAuth } from '../lib/auth';

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password, displayName || username);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-box">
        <div className="brand">
          <Logo size={34} />
          Летопись
        </div>
        <p className="tagline">листы героев и комнаты для ваших кампаний</p>
        <form className="panel panel-pad stack" onSubmit={submit}>
          <Segmented
            options={[
              { id: 'login', label: 'Вход' },
              { id: 'register', label: 'Регистрация' },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError('');
            }}
          />
          <Field label="Логин">
            <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </Field>
          {mode === 'register' && (
            <Field label="Как вас называть" hint="Видно мастеру и другим игрокам">
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={username} />
            </Field>
          )}
          <Field label="Пароль">
            <input
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </Field>
          {error && <div className="error-text">{error}</div>}
          <button className="btn primary block" disabled={busy}>
            {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>
      </div>
    </main>
  );
}
