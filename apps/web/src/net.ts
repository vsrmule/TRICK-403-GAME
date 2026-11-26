import { useSyncExternalStore } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RoomUpdate } from '@g304/engine';
import { sessionToken } from './prefs';

/** Server URL: same origin by default; set VITE_SERVER_URL for native (Capacitor) builds. */
const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined) || undefined;

export const socket: Socket = io(SERVER ?? '/', {
  auth: { token: sessionToken() },
  transports: ['websocket', 'polling'],
});

interface NetState {
  connected: boolean;
  update: RoomUpdate | null;
  /** Increments on each server push, so effects can react to repeated identical payloads. */
  seq: number;
}

let state: NetState = { connected: false, update: null, seq: 0 };
const listeners = new Set<() => void>();
const updateHandlers = new Set<(u: RoomUpdate | null) => void>();

function set(patch: Partial<NetState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

socket.on('connect', () => set({ connected: true }));
socket.on('disconnect', () => set({ connected: false }));
socket.on('room', (u: RoomUpdate | null) => {
  set({ update: u, seq: state.seq + 1 });
  updateHandlers.forEach((h) => h(u));
});

export function onRoomUpdate(h: (u: RoomUpdate | null) => void) {
  updateHandlers.add(h);
  return () => {
    updateHandlers.delete(h);
  };
}

export function useNet(): NetState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export type CallResult<T> = { ok: true; data?: T } | { ok: false; error: string };

export function call<T = unknown>(event: string, payload: object = {}): Promise<CallResult<T>> {
  return new Promise((res) => {
    if (!socket.connected) {
      res({ ok: false, error: 'Not connected to the server. Retrying…' });
      return;
    }
    socket.timeout(8000).emit(event, payload, (err: unknown, r: CallResult<T>) => {
      res(err ? { ok: false, error: 'The server did not respond' } : r);
    });
  });
}
