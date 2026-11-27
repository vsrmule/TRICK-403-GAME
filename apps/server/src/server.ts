import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Server, Socket } from 'socket.io';
import { Ack, GameError, RoomUpdate } from '@g304/engine';
import { ManagerOptions, RoomError, RoomManager } from './rooms';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
};

/** Built-in voice clips are content-addressed (the name is a hash of the words), so they never change. */
const IMMUTABLE = /^\/(assets\/|voice\/[^/]+\/clips\/[^/]+\.mp3$)/;

function staticHandler(root: string | null) {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (!root || !existsSync(root)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Web client not built. Run "npm run build".');
      return;
    }
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = normalize(join(root, urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // A missing file (clip, video…) is a 404; anything else is a page of the app (/r/123456).
      if (extname(urlPath)) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      file = join(root, 'index.html');
    }
    const size = statSync(file).size;
    const headers: Record<string, string> = { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes' };
    if (IMMUTABLE.test(urlPath)) headers['cache-control'] = 'public, max-age=31536000, immutable';
    else if (extname(file) !== '.html') headers['cache-control'] = 'public, max-age=3600';
    if (extname(file) === '.apk') headers['content-disposition'] = 'attachment; filename="Trick304.apk"';
    // Byte ranges: video seeking (and Safari, which won't play media without them).
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) });
      if (req.method === 'HEAD') return void res.end();
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': String(size) });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  };
}

export interface StartOptions extends ManagerOptions {
  port?: number;
  webRoot?: string | null;
}

export function startServer(opts: StartOptions = {}) {
  const webRoot = opts.webRoot === undefined ? resolve(import.meta.dirname, '../../web/dist') : opts.webRoot;
  const http = createServer(staticHandler(webRoot ? resolve(webRoot) : null));
  const io = new Server(http, { cors: { origin: true, credentials: true } });

  const tokenOf = new Map<string, string>(); // socket id -> member token

  const manager = new RoomManager((room, events, notices) => {
    for (const m of room.members.values()) {
      if (m.sockets.size === 0) continue;
      const update: RoomUpdate = {
        room: manager.snapshotFor(room, m.token),
        events: manager.eventsFor(room, m.token, events),
        notices,
      };
      for (const sid of m.sockets) io.to(sid).emit('room', update);
    }
  }, opts);

  const sweeper = setInterval(() => manager.sweep(), 60_000);
  sweeper.unref();

  io.on('connection', (socket: Socket) => {
    const auth = socket.handshake.auth as { token?: unknown };
    const token = typeof auth?.token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(auth.token) ? auth.token : null;
    if (!token) {
      socket.emit('fatal', 'Missing or invalid session token');
      socket.disconnect(true);
      return;
    }
    tokenOf.set(socket.id, token);

    /** Wrap a handler so thrown rule errors become { ok:false } acks instead of crashes. */
    const on = <P>(event: string, fn: (payload: P) => unknown) => {
      socket.on(event, (payload: P, ack?: Ack) => {
        try {
          const data = fn(payload ?? ({} as P));
          if (typeof ack === 'function') ack({ ok: true, data });
        } catch (e) {
          const msg = e instanceof RoomError || e instanceof GameError ? e.message : 'Something went wrong';
          if (!(e instanceof RoomError || e instanceof GameError)) console.error(e);
          if (typeof ack === 'function') ack({ ok: false, error: msg });
        }
      });
    };

    // Resume an existing seat after a reload / network drop.
    const existing = manager.roomOf(token);
    if (existing) manager.joinRoom(existing.code, token, '', socket.id);
    else socket.emit('room', null);

    on<{ name: string; isPublic?: boolean; settings?: object }>('createRoom', (p) => manager.createRoom(token, p.name, socket.id, !!p.isPublic, p.settings ?? {}).code);
    on<{ code: string; name: string }>('joinRoom', (p) => manager.joinRoom(String(p.code ?? '').trim(), token, p.name, socket.id).code);
    on<{ name: string }>('quickJoin', (p) => manager.quickJoin(token, p.name, socket.id).code);
    on('listPublic', () => manager.publicRooms());
    on('leaveRoom', () => {
      manager.leave(token);
      socket.emit('room', null);
    });
    on<{ settings: object }>('updateSettings', (p) => manager.updateSettings(token, p.settings ?? {}));
    on<{ seat: number }>('takeSeat', (p) => manager.takeSeat(token, Number(p.seat)));
    on('leaveSeat', () => manager.leaveSeat(token));
    on<{ seat: number; bot: boolean }>('setBot', (p) => manager.setBot(token, Number(p.seat), !!p.bot));
    on('fillBots', () => manager.fillBots(token));
    on('autoAssign', () => manager.autoAssign(token));
    on<{ isPublic: boolean }>('setPublic', (p) => manager.setPublic(token, !!p.isPublic));
    on('start', () => manager.start(token));
    on('backToLobby', () => manager.backToLobby(token));
    on<{ action: never }>('action', (p) => manager.action(token, p.action));
    on('ready', () => manager.ready(token));
    on<{ wants: boolean }>('wantSeat', (p) => manager.setWantsSeat(token, !!p.wants));
    on<{ muted: boolean }>('mic', (p) => manager.setMic(token, !!p.muted));
    on<{ on: boolean }>('setVideo', (p) => manager.setVideo(token, !!p.on));
    on<{ on: boolean }>('camera', (p) => manager.setCamera(token, !!p.on));
    on<{ on: boolean }>('setChat', (p) => manager.setChat(token, !!p.on));
    on<{ text: string }>('chat', (p) => manager.sendChat(token, p.text));
    on<{ emoji: string }>('react', (p) => manager.react(token, p.emoji));
    on<{ id: number; emoji: string }>('reactMessage', (p) => manager.reactToMessage(token, p.id, p.emoji));

    // ---- Voice: WebRTC mesh signalling, relayed only between members of the same room.
    on<{ on: boolean }>('voice', (p) => manager.setVoice(token, p.on ? socket.id : null));
    socket.on('signal', (p: { to?: string; data?: unknown }) => {
      const room = manager.roomOf(token);
      if (!room || typeof p?.to !== 'string') return;
      if (!manager.isVoicePeer(room, p.to) || !manager.isVoicePeer(room, socket.id)) return;
      io.to(p.to).emit('signal', { from: socket.id, data: p.data });
    });

    // Voice fallback: relay small µ-law audio packets when a direct WebRTC link can't be made.
    socket.on('vrelay', (p: { to?: unknown; d?: unknown }) => {
      const room = manager.roomOf(token);
      if (!room || !Array.isArray(p?.to) || p.to.length > 8) return;
      const d = p.d;
      const size = d instanceof ArrayBuffer ? d.byteLength : Buffer.isBuffer(d) ? d.length : -1;
      if (size <= 0 || size > 8192) return;
      if (!manager.isVoicePeer(room, socket.id)) return;
      for (const to of p.to) {
        if (typeof to === 'string' && to !== socket.id && manager.isVoicePeer(room, to)) io.to(to).emit('vrelay', { from: socket.id, d });
      }
    });

    socket.on('disconnect', () => {
      tokenOf.delete(socket.id);
      manager.disconnectSocket(token, socket.id);
    });
  });

  const port = opts.port ?? Number(process.env.PORT ?? 3304);
  const ready = new Promise<number>((res) => {
    http.listen(port, () => {
      const addr = http.address();
      res(typeof addr === 'object' && addr ? addr.port : port);
    });
  });

  return {
    io,
    http,
    manager,
    ready,
    close: () =>
      new Promise<void>((res) => {
        clearInterval(sweeper);
        for (const r of manager.rooms.values()) if (r.timer) clearTimeout(r.timer);
        io.close(() => res());
      }),
  };
}
