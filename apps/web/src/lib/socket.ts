/**
 * Живые обновления: по одному WebSocket на канал (кампания или персонаж).
 * Сервер шлёт сообщения вида {event, payload}. При обрыве — переподключение с растущей паузой,
 * после него вызывается обработчик 'connect', чтобы страница перечитала данные.
 */
type Handler = (payload: any) => void;
type Handlers = Record<string, Handler>;

interface Channel {
  ws: WebSocket | null;
  connected: boolean;
  listeners: Set<Handlers>;
  retry: number;
  timer: ReturnType<typeof setTimeout> | null;
  ping: ReturnType<typeof setInterval> | null;
  closed: boolean;
}

const channels = new Map<string, Channel>();

function open(path: string, ch: Channel) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws/${path}`);
  ch.ws = ws;
  ws.onopen = () => {
    ch.connected = true;
    ch.retry = 0;
    ch.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 30000);
    for (const l of ch.listeners) l.connect?.(undefined);
  };
  ws.onmessage = (e) => {
    if (e.data === 'pong') return;
    let msg: { event: string; payload: unknown };
    try {
      msg = JSON.parse(e.data as string);
    } catch {
      return;
    }
    for (const l of ch.listeners) l[msg.event]?.(msg.payload);
  };
  ws.onclose = () => {
    ch.connected = false;
    if (ch.ping) clearInterval(ch.ping);
    ch.ping = null;
    if (ch.closed) return;
    const delay = Math.min(30000, 1000 * 2 ** ch.retry++);
    ch.timer = setTimeout(() => !ch.closed && open(path, ch), delay);
  };
}

/** Подписаться на канал, например `campaign/abc` или `character/xyz`. Возвращает отписку. */
export function subscribe(path: string, handlers: Handlers): () => void {
  let ch = channels.get(path);
  if (!ch) {
    ch = { ws: null, connected: false, listeners: new Set(), retry: 0, timer: null, ping: null, closed: false };
    channels.set(path, ch);
    open(path, ch);
  }
  ch.listeners.add(handlers);
  const current = ch;
  return () => {
    current.listeners.delete(handlers);
    if (current.listeners.size) return;
    // Небольшая задержка: при переходе между страницами того же канала соединение не рвётся
    setTimeout(() => {
      if (current.listeners.size || channels.get(path) !== current) return;
      close(path, current);
    }, 2000);
  };
}

function close(path: string, ch: Channel) {
  ch.closed = true;
  if (ch.timer) clearTimeout(ch.timer);
  if (ch.ping) clearInterval(ch.ping);
  ch.ws?.close();
  channels.delete(path);
}

export function isConnected(path: string) {
  return !!channels.get(path)?.connected;
}

/** После выхода из аккаунта — закрыть все соединения. */
export function resetSocket() {
  for (const [path, ch] of channels) close(path, ch);
}
