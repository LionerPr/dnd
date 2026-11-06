import { DurableObject } from 'cloudflare:workers';

/**
 * Живые обновления через Durable Objects: одна «комната» на кампанию (c:<id>) и на персонажа (ch:<id>).
 * Сокеты в комнате кампании помечены тегом dm или players — всё, что видит только мастер
 * (скрытые враги, точные хиты), уходит лишь сокетам мастера.
 * Сокеты «спят» между сообщениями (hibernation), поэтому комната не тратит время, пока все молчат.
 */
export class Room extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    // Пинг клиента отвечается без пробуждения объекта
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** Подключение уже проверено воркером; он же передаёт тег в заголовке. */
  async fetch(request: Request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Нужен WebSocket', { status: 426 });
    const tag = request.headers.get('X-Room-Tag') ?? 'watch';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [tag]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async broadcast(tags: string[], message: string) {
    const seen = new Set<WebSocket>();
    for (const tag of tags) {
      for (const ws of this.ctx.getWebSockets(tag)) {
        if (seen.has(ws)) continue;
        seen.add(ws);
        try {
          ws.send(message);
        } catch {
          // сокет уже закрывается — пропускаем
        }
      }
    }
  }

  async webSocketMessage() {
    // Клиенты ничего не присылают, кроме пинга (на него отвечает autoResponse)
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // уже закрыт
    }
  }
}

export interface RoomEnv {
  ROOMS: DurableObjectNamespace<Room>;
}

/**
 * Рассылка из обработчика запроса. Сообщения уходят по очереди (порядок важен: «персонаж», потом «событие»)
 * и не задерживают ответ — воркер дожидается их через waitUntil.
 */
export class Realtime {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private rooms: DurableObjectNamespace<Room> | null,
    private waitUntil: (p: Promise<unknown>) => void = () => {},
  ) {}

  private send(room: string, tags: string[], event: string, payload: unknown) {
    const rooms = this.rooms;
    if (!rooms) return;
    const message = JSON.stringify({ event, payload });
    this.chain = this.chain
      .then(() => rooms.get(rooms.idFromName(room)).broadcast(tags, message))
      .catch((e) => console.error('broadcast', room, e));
    this.waitUntil(this.chain);
  }

  /** Событие для всех в кампании */
  all(campaignId: string, event: string, payload: unknown) {
    this.send(`c:${campaignId}`, ['dm', 'players'], event, payload);
  }

  dm(campaignId: string, event: string, payload: unknown) {
    this.send(`c:${campaignId}`, ['dm'], event, payload);
  }

  players(campaignId: string, event: string, payload: unknown) {
    this.send(`c:${campaignId}`, ['players'], event, payload);
  }

  /** Открытые листы персонажа (например, на другом устройстве) */
  character(id: string, event: string, payload: unknown) {
    this.send(`ch:${id}`, ['watch'], event, payload);
  }
}
