import { nanoid } from 'nanoid';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import type { Reply, Req } from './http.js';

export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  /** Модератор: создаёт и правит расы, классы, заклинания, предметы, существа и черты */
  isModerator: boolean;
}

/** Создавать и править контент библиотеки могут только администратор и модераторы */
export const canAuthor = (u: User) => u.isAdmin || u.isModerator;

const SESSION_DAYS = 60;
export const COOKIE = 'dnd_sid';

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hash = async (token: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(token)));

/**
 * Пароли — PBKDF2-SHA256 средствами WebCrypto. Итераций немного: на бесплатном Cloudflare
 * у запроса ~10 мс процессора, а для закрытой игровой группы этого достаточно.
 */
const ITERATIONS = 10_000;

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, expected] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !salt || !expected) return false;
  const got = new Uint8Array(await derive(password, unb64(salt), Number(iter)));
  const want = unb64(expected);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}

export async function register(db: Db, username: string, displayName: string, password: string): Promise<User> {
  const name = username.trim().toLowerCase();
  if (!/^[a-z0-9_.@+-]{3,64}$/.test(name)) throw new HttpError(400, 'Логин: 3–64 символа — латиница, цифры, точка, дефис; можно почту');
  if (password.length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов');
  const exists = await db.query(`SELECT 1 FROM users WHERE username = $1`, [name]);
  if (exists.length) throw new HttpError(409, 'Такой логин уже занят');
  const [{ count }] = (await db.query<{ count: number }>(`SELECT count(*) AS count FROM users`)) as [{ count: number }];
  const user: User = { id: nanoid(), username: name, displayName: displayName.trim() || name, isAdmin: Number(count) === 0, isModerator: false };
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5)`, [
    user.id, user.username, user.displayName, await hashPassword(password), user.isAdmin,
  ]);
  return user;
}

export async function login(db: Db, username: string, password: string): Promise<User> {
  const rows = await db.query<{ id: string; username: string; display_name: string; password_hash: string; is_admin: boolean; is_moderator: boolean }>(
    `SELECT * FROM users WHERE username = $1`,
    [username.trim().toLowerCase()],
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new HttpError(401, 'Неверный логин или пароль');
  return { id: row.id, username: row.username, displayName: row.display_name, isAdmin: row.is_admin, isModerator: !!row.is_moderator };
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => (c === '+' ? '-' : c === '/' ? '_' : ''));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [await hash(token), userId, expires]);
  return token;
}

export async function destroySession(db: Db, token: string) {
  await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [await hash(token)]);
}

export async function userFromToken(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db.query<{ id: string; username: string; display_name: string; is_admin: boolean; is_moderator: boolean }>(
    `SELECT u.id, u.username, u.display_name, u.is_admin, u.is_moderator FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [await hash(token)],
  );
  const r = rows[0];
  return r ? { id: r.id, username: r.username, displayName: r.display_name, isAdmin: r.is_admin, isModerator: !!r.is_moderator } : null;
}

export function setSessionCookie(reply: Reply, token: string, secure: boolean) {
  reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 86400 });
}

export function requireUser(req: Req): User {
  if (!req.user) throw new HttpError(401, 'Нужно войти');
  return req.user;
}
