import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import type { Db } from './db.js';
import { HttpError } from './errors.js';

export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

const SESSION_DAYS = 60;
export const COOKIE = 'dnd_sid';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function register(db: Db, username: string, displayName: string, password: string): Promise<User> {
  const name = username.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(name)) throw new HttpError(400, 'Логин: 3–32 символа, латиница, цифры, точка, дефис');
  if (password.length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов');
  const exists = await db.query(`SELECT 1 FROM users WHERE username = $1`, [name]);
  if (exists.length) throw new HttpError(409, 'Такой логин уже занят');
  const [{ count }] = (await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM users`)) as [{ count: string }];
  const user: User = { id: nanoid(), username: name, displayName: displayName.trim() || name, isAdmin: count === '0' };
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5)`, [
    user.id, user.username, user.displayName, await bcrypt.hash(password, 10), user.isAdmin,
  ]);
  return user;
}

export async function login(db: Db, username: string, password: string): Promise<User> {
  const rows = await db.query<{ id: string; username: string; display_name: string; password_hash: string; is_admin: boolean }>(
    `SELECT * FROM users WHERE username = $1`,
    [username.trim().toLowerCase()],
  );
  const row = rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) throw new HttpError(401, 'Неверный логин или пароль');
  return { id: row.id, username: row.username, displayName: row.display_name, isAdmin: row.is_admin };
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [hash(token), userId]);
  return token;
}

export async function destroySession(db: Db, token: string) {
  await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [hash(token)]);
}

export async function userFromToken(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db.query<{ id: string; username: string; display_name: string; is_admin: boolean }>(
    `SELECT u.id, u.username, u.display_name, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash(token)],
  );
  const r = rows[0];
  return r ? { id: r.id, username: r.username, displayName: r.display_name, isAdmin: r.is_admin } : null;
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean) {
  reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 86400 });
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, 'Нужно войти');
  return req.user;
}
