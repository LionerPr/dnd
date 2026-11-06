import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { COOKIE, userFromToken } from './auth.js';
import type { Db } from './db.js';
import { memberRole } from './repo.js';

/**
 * Комнаты сокетов: c:<id>:dm — мастер, c:<id>:players — игроки.
 * Всё, что видят только мастера (скрытые враги, точные хиты), уходит в комнату мастера.
 */
export class Realtime {
  io: Server | null = null;

  attach(server: HttpServer, db: Db) {
    const io = new Server(server, { path: '/socket.io', serveClient: false });
    this.io = io;
    io.use(async (socket, next) => {
      const cookie = socket.handshake.headers.cookie ?? '';
      const token = cookie.split(';').map((p) => p.trim().split('=')).find(([k]) => k === COOKIE)?.[1];
      const user = await userFromToken(db, token ? decodeURIComponent(token) : undefined);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    });
    io.on('connection', (socket) => {
      socket.on('join', async (campaignId: string, ack?: (r: { ok: boolean; role?: string }) => void) => {
        if (typeof campaignId !== 'string') return ack?.({ ok: false });
        const role = await memberRole(db, campaignId, socket.data.user.id);
        if (!role) return ack?.({ ok: false });
        for (const room of socket.rooms) if (room.startsWith('c:')) socket.leave(room);
        socket.join(`c:${campaignId}:${role === 'dm' ? 'dm' : 'players'}`);
        socket.join(`u:${socket.data.user.id}`);
        ack?.({ ok: true, role });
      });
      socket.on('watch-character', (id: string) => {
        if (typeof id === 'string') socket.join(`ch:${id}`);
      });
    });
  }

  /** Событие для всех в кампании */
  all(campaignId: string, event: string, payload: unknown) {
    this.io?.to([`c:${campaignId}:dm`, `c:${campaignId}:players`]).emit(event, payload);
  }

  dm(campaignId: string, event: string, payload: unknown) {
    this.io?.to(`c:${campaignId}:dm`).emit(event, payload);
  }

  players(campaignId: string, event: string, payload: unknown) {
    this.io?.to(`c:${campaignId}:players`).emit(event, payload);
  }

  /** Персонаж вне кампании: обновить его открытые листы (например, на другом устройстве) */
  character(id: string, event: string, payload: unknown) {
    this.io?.to(`ch:${id}`).emit(event, payload);
  }
}
