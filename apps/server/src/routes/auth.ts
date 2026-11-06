import type { Api } from '../http.js';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { COOKIE, createSession, destroySession, login, register, requireUser, setSessionCookie } from '../auth.js';

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

  api.put('/auth/me', async (req) => {
    const user = requireUser(req);
    const { displayName } = z.object({ displayName: z.string().min(1).max(64) }).parse(req.body);
    await db.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [user.id, displayName]);
    return { user: { ...user, displayName } };
  });
}
