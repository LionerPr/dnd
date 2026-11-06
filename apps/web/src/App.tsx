import { LogOut, Moon, Sun, SunMoon } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Logo } from './components/Logo';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { applyTheme, getTheme, type Theme } from './lib/theme';
import { AuthPage } from './pages/Auth';
import { CampaignPage } from './pages/Campaign';
import { CharacterPage } from './pages/Character';
import { ContentPage } from './pages/ContentEditor';
import { HomePage } from './pages/Home';
import { LibraryPage } from './pages/Library';

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme());
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon;
  const label = theme === 'light' ? 'Светлая тема' : theme === 'dark' ? 'Тёмная тема' : 'Как в системе';
  return (
    <button
      className="btn ghost icon"
      title={label}
      aria-label={label}
      onClick={() => {
        const t = next[theme];
        setTheme(t);
        applyTheme(t);
      }}
    >
      <Icon />
    </button>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <Logo />
          <span>Летопись</span>
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Мои герои
          </NavLink>
          <NavLink to="/library">Библиотека</NavLink>
        </nav>
        <div className="spacer" />
        <ThemeToggle />
        <span className="muted small nowrap user-name" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {user?.displayName}
        </span>
        <button className="btn ghost icon" onClick={logout} title="Выйти" aria-label="Выйти">
          <LogOut />
        </button>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/characters/:id" element={<CharacterPage />} />
        <Route path="/campaigns/:id" element={<CampaignPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/library/:id" element={<ContentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export function App() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) {
    if (loc.pathname !== '/login') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
    return <AuthPage />;
  }
  if (loc.pathname === '/login') return <Navigate to={new URLSearchParams(loc.search).get('next') || '/'} replace />;
  return <Shell />;
}
