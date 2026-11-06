import type { Api } from '../http.js';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { COOKIE, createSession, destroySession, login, register, requireUser, setSessionCookie } from '../auth.js';
import { forbidden } from '../errors.js';

const Credentials = z.object({ username: z.string().max(64), password: z.string().max(200), displayName: z.string().max(64).optional() });

export function authRoutes(api: Api, { db, secureCookies }: AppDeps) {
  api.post('/auth/register', async (req, reply) => {
    const body = Credentials.parse(req.body);
    const user = await register(db, body.username, body.displayName ?? body.username, body.password);
    setSessionCookie(reply, await createSession(db, user.id), secureCookies);
    return { user };
  });

  api.post('/auth/login', async (req, reply) => {
    const body = Credentials.parse(req.body);
    const user = await login(db, body.username, body.password);
    setSessionCookie(reply, await createSession(db, user.id), secureCookies);
    return { user };
  });

  api.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await destroySession(db, token);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  api.get('/auth/me', async (req) => ({ user: req.user }));

  /** Пользователи и их права — только администратору */
  api.get('/admin/users', async (req) => {
    const user = requireUser(req);
    if (!user.isAdmin) throw forbidden('Только для администратора');
    const rows = await db.query<{ id: string; username: string; display_name: string; is_admin: boolean; is_moderator: boolean; created_at: string }>(
      `SELECT id, username, display_name, is_admin, is_moderator, created_at FROM users ORDER BY created_at`,
    );
    return { users: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, isAdmin: r.is_admin, isModerator: !!r.is_moderator, createdAt: r.created_at })) };
  });

  api.put('/admin/users/:id', async (req) => {
    const user = requireUser(req);
    if (!user.isAdmin) throw forbidden('Только для администратора');
    const { isModerator } = z.object({ isModerator: z.boolean() }).parse(req.body);
    await db.query(`UPDATE users SET is_moderator = $2 WHERE id = $1`, [(req.params as { id: string }).id, isModerator]);
    return { ok: true };
  });

  api.put('/auth/me', async (req) => {
    const user = requireUser(req);
    const { displayName } = z.object({ displayName: z.string().min(1).max(64) }).parse(req.body);
    await db.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [user.id, displayName]);
    return { user: { ...user, displayName } };
  });
}
