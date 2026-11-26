import { FormEvent, useEffect, useState } from 'react';
import type { PublicRoomInfo } from '@g304/engine';
import { call } from '../net';
import { prefs, usePrefs } from '../prefs';
import { BrandMark, Icon, act, inNativeApp } from './ui';

function codeFromUrl(): string {
  const u = new URL(window.location.href);
  const q = u.searchParams.get('room');
  const m = u.pathname.match(/\/r\/(\d{6})/);
  return (q && /^\d{6}$/.test(q) ? q : m?.[1]) ?? '';
}

export function Home({ connected }: { connected: boolean }) {
  const p = usePrefs();
  const [name, setName] = useState(p.name);
  const [code, setCode] = useState(codeFromUrl());
  const [rooms, setRooms] = useState<PublicRoomInfo[] | null>(null);
  const [error, setError] = useState('');
  const invited = codeFromUrl();

  const refresh = async () => {
    const r = await call<PublicRoomInfo[]>('listPublic');
    if (r.ok) setRooms(r.data ?? []);
  };
  useEffect(() => {
    if (connected) void refresh();
  }, [connected]);

  const needName = () => {
    const n = name.trim();
    if (!n) {
      setError('Please enter your name first.');
      document.getElementById('name-input')?.focus();
      return null;
    }
    prefs.set({ name: n });
    setError('');
    return n;
  };

  const go = async (event: string, payload: object) => {
    const r = await act(event, payload);
    if (!r.ok) setError(r.error);
    else window.history.replaceState(null, '', '/');
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const n = needName();
    if (!n) return;
    if (!/^\d{6}$/.test(code)) {
      setError('Room codes are 6 digits.');
      document.getElementById('code-input')?.focus();
      return;
    }
    void go('joinRoom', { code, name: n });
  };

  const create = () => {
    const n = needName();
    if (n) void go('createRoom', { name: n, isPublic: false });
  };
  const quick = () => {
    const n = needName();
    if (n) void go('quickJoin', { name: n });
  };

  return (
    <main id="main" className="home">
      <section className="hero" aria-labelledby="home-h">
        <div className="hero-copy">
          <span className="eyebrow">Trick-taking for everyone · by ear or by eye</span>
          <h1 id="home-h" className="hero-title">
            <BrandMark size={56} /> Trick <b>304</b>
          </h1>
          <p className="hero-lede">Gather your table from anywhere. Talk, bid, hide trump and play together on any phone or computer.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          {['J♠', '9♥', 'A♣', '10♦'].map((c, i) => (
            <span key={c} className={`hero-card h${i}${c.includes('♥') || c.includes('♦') ? ' red' : ''}`}>
              <b>{c.slice(0, -1)}</b>
              <i>{c.slice(-1)}</i>
            </span>
          ))}
        </div>
      </section>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <section className="card-surface you" aria-labelledby="you-h">
        <h2 id="you-h" className="section-k">
          Your name
        </h2>
        <label htmlFor="name-input" className="sr-only">
          Name shown to other players
        </label>
        <input
          id="name-input"
          className="input big-input"
          value={name}
          maxLength={20}
          autoComplete="nickname"
          placeholder="Name shown to other players"
          aria-label="Name shown to other players"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && prefs.set({ name: name.trim() })}
        />
      </section>

      <div className="home-actions">
        <section className="card-surface join-card" aria-labelledby="join-h">
          <h2 id="join-h">{invited ? `You're invited to room ${invited}` : 'Join a friend'}</h2>
          <p className="muted">Enter the 6-digit room code they shared.</p>
          <form onSubmit={join} className="join-form">
            <label htmlFor="code-input" className="sr-only">
              6-digit room code
            </label>
            <input
              id="code-input"
              className="input code-input"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              placeholder="••••••"
              autoComplete="off"
              aria-label="6-digit room code"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <button className="btn primary big" type="submit" disabled={!connected}>
              Join room
            </button>
          </form>
        </section>

        <button className="tile" onClick={create} disabled={!connected}>
          <span className="tile-icon">
            <Icon name="plus" size={26} />
          </span>
          <span className="tile-title">Create private room</span>
          <span className="tile-sub">Get a code to share. Fill empty seats with bots.</span>
        </button>
        <button className="tile" onClick={quick} disabled={!connected}>
          <span className="tile-icon">
            <Icon name="bolt" size={26} />
          </span>
          <span className="tile-title">Quick play</span>
          <span className="tile-sub">Join an open public table, or open one.</span>
        </button>
      </div>

      {!inNativeApp() && (
        <section className="card-surface app-card" aria-labelledby="app-h">
          <span className="tile-icon" aria-hidden="true">
            <Icon name="android" size={28} />
          </span>
          <div className="app-copy">
            <h2 id="app-h">Get the Android app</h2>
            <p className="muted small">Install Trick 304 on your Android phone: voice and video chat built in, works with TalkBack. On iPhone, open this website in Safari or Chrome.</p>
          </div>
          <a className="btn primary" href="/downloads/trick304.apk" download="Trick304.apk">
            <Icon name="download" size={18} /> Download APK
          </a>
        </section>
      )}

      <section className="card-surface" aria-labelledby="pub-h">
        <div className="row spread">
          <h2 id="pub-h">Public tables</h2>
          <button className="btn text" onClick={refresh} disabled={!connected}>
            Refresh
          </button>
        </div>
        {rooms === null ? (
          <p className="muted">Loading…</p>
        ) : rooms.length === 0 ? (
          <p className="muted">No public tables right now. Quick play opens one.</p>
        ) : (
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.code}>
                <span>
                  <strong>{r.hostName}'s table</strong>
                  <span className="muted">
                    {' '}
                    · {r.numPlayers} seats · {r.humans} {r.humans === 1 ? 'player' : 'players'} · {r.openSeats} open
                  </span>
                </span>
                <button
                  className="btn tonal"
                  onClick={() => {
                    const n = needName();
                    if (n) void go('joinRoom', { code: r.code, name: n });
                  }}
                  aria-label={`Join ${r.hostName}'s table, ${r.openSeats} open seats`}
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
