/**
 * Маленький маршрутизатор в духе Fastify: обработчик получает req и reply, возвращает объект — он уходит JSON-ом.
 * Нужен, чтобы маршруты остались простыми и не зависели от Node.
 */
import { ZodError } from 'zod';
import type { User } from './auth.js';
import { HttpError } from './errors.js';

export interface Req {
  method: string;
  url: URL;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  cookies: Record<string, string>;
  headers: Headers;
  user: User | null;
}

interface CookieOpts {
  path?: string;
  httpOnly?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  maxAge?: number;
}

export class Reply {
  statusCode = 200;
  headers = new Headers();
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setCookie(name: string, value: string, o: CookieOpts = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`];
    if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
    if (o.httpOnly) parts.push('HttpOnly');
    if (o.secure) parts.push('Secure');
    if (o.sameSite) parts.push(`SameSite=${o.sameSite[0]!.toUpperCase()}${o.sameSite.slice(1)}`);
    this.headers.append('Set-Cookie', parts.join('; '));
    return this;
  }
  clearCookie(name: string, o: CookieOpts = {}) {
    return this.setCookie(name, '', { ...o, maxAge: 0 });
  }
}

type Handler = (req: Req, reply: Reply) => Promise<unknown> | unknown;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

export class Api {
  private routes: Route[] = [];
  private add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}/?$`);
    this.routes.push({ method, re, keys, handler });
  }
  get(path: string, h: Handler) {
    this.add('GET', path, h);
  }
  post(path: string, h: Handler) {
    this.add('POST', path, h);
  }
  put(path: string, h: Handler) {
    this.add('PUT', path, h);
  }
  delete(path: string, h: Handler) {
    this.add('DELETE', path, h);
  }

  match(method: string, path: string) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])) };
    }
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export const json = (data: unknown, status = 200, headers?: Headers) => {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers: h });
};

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  if (err instanceof ZodError) {
    return json({ error: 'Неверные данные', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);
  }
  console.error(err);
  return json({ error: 'Ошибка сервера' }, 500);
}

const MAX_BODY = 5 * 1024 * 1024;

/** Выполнить запрос маршрутизатором. Путь — уже без префикса /api. */
export async function handle(api: Api, request: Request, path: string, user: (cookies: Record<string, string>) => Promise<User | null>) {
  const url = new URL(request.url);
  const m = api.match(request.method, path);
  if (!m) return json({ error: 'Не найдено' }, 404);
  try {
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      const text = await request.text();
      if (text.length > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос');
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new HttpError(400, 'Неверный JSON');
        }
      }
    }
    const cookies = parseCookies(request.headers.get('Cookie'));
    const req: Req = {
      method: request.method, url, params: m.params, query: Object.fromEntries(url.searchParams), body, cookies,
      headers: request.headers, user: await user(cookies),
    };
    const reply = new Reply();
    const result = await m.handler(req, reply);
    if (result instanceof Response) return result;
    return json(result ?? null, reply.statusCode, reply.headers);
  } catch (e) {
    return errorResponse(e);
  }
}
