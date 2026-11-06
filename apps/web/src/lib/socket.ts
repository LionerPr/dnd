import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], withCredentials: true });
  return socket;
}

export function resetSocket() {
  socket?.close();
  socket = null;
}
