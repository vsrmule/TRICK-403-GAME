import { useEffect, useId, useRef, useState } from 'react';
import { announcer } from '../announcer';
import { usePrefs } from '../prefs';

/**
 * The video tutorial in How to Play (Issue 11).
 *
 * Videos ship with the website and inside the Android app, one folder per language:
 *   public/media/<lang>/tutorial.json   { "title", "file", "minutes", "captions"? }
 *   public/media/<lang>/tutorial.mp4    (and an optional captions file, WebVTT)
 * The player's language is used if that folder exists, otherwise English. Adding a
 * language = adding its folder; no code changes.
 *
 * The controls are our own buttons and sliders (not the browser's built-in ones, which
 * differ by browser and are announced inconsistently), so every screen reader finds the
 * same labelled Play/Pause, Back/Forward 10 seconds, Position, Mute, Volume and Full screen.
 */
interface TutorialInfo {
  title: string;
  file: string;
  minutes?: number;
  captions?: string;
  captionsLang?: string;
}

const BASE = `${import.meta.env.BASE_URL}media/`;

async function findTutorial(lang: string): Promise<{ info: TutorialInfo; dir: string; lang: string } | null> {
  for (const l of [...new Set([lang, 'en'])]) {
    try {
      const r = await fetch(`${BASE}${l}/tutorial.json`);
      if (r.ok) return { info: (await r.json()) as TutorialInfo, dir: `${BASE}${l}/`, lang: l };
    } catch {
      /* try the next language */
    }
  }
  return null;
}

/** "3 minutes 5 seconds" for screen readers; "3:05" on screen. */
function spoken(t: number) {
  const s = Math.max(0, Math.floor(t));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const mm = m ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : '';
  const ss = `${r} ${r === 1 ? 'second' : 'seconds'}`;
  return m ? (r ? `${mm} ${ss}` : mm) : ss;
}
const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function TutorialVideo() {
  const p = usePrefs();
  const [found, setFound] = useState<Awaited<ReturnType<typeof findTutorial>> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void findTutorial(p.lang).then((f) => live && setFound(f));
    return () => {
      live = false;
    };
  }, [p.lang]);

  const headingId = useId();
  if (found === undefined) return null;
  if (!found) return null; // no tutorial shipped in this build
  const { info } = found;
  return (
    <section className="tutorial" aria-labelledby={headingId}>
      <h3 id={headingId}>Video tutorial</h3>
      <p>
        {info.title}
        {info.minutes ? `, about ${info.minutes} minutes` : ''}. It plays right here, with no internet connection needed.
      </p>
      {open ? (
        <Player found={found} />
      ) : (
        <button type="button" className="btn primary big" onClick={() => setOpen(true)}>
          ▶ Play the video tutorial
        </button>
      )}
    </section>
  );
}

function Player({ found }: { found: NonNullable<Awaited<ReturnType<typeof findTutorial>>> }) {
  const { info, dir, lang } = found;
  const v = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const playBtn = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(info.minutes ? info.minutes * 60 : 0);
  const [muted, setMuted] = useState(false);
  const [vol, setVol] = useState(100);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  // Start right away: the player opened because "Play the video tutorial" was chosen.
  useEffect(() => {
    playBtn.current?.focus();
    const el = v.current;
    if (!el) return;
    announcer.cancelAll(); // don't talk over the video
    el.play().catch(() => setStatus('Choose Play to start the video.'));
    return () => el.pause();
  }, []);

  const el = () => v.current!;
  const toggle = () => (el().paused ? void el().play() : el().pause());
  const skip = (d: number) => {
    el().currentTime = Math.max(0, Math.min((el().duration || dur) - 0.5, el().currentTime + d));
    setStatus(`${d < 0 ? 'Back' : 'Forward'} 10 seconds. ${spoken(el().currentTime)} of ${spoken(el().duration || dur)}.`);
  };
  const fullscreen = () => {
    const box = wrap.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const video = v.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (box?.requestFullscreen) void box.requestFullscreen().catch(() => video?.webkitEnterFullscreen?.());
    else video?.webkitEnterFullscreen?.(); // iPhone: the system's own full-screen player
  };

  const posLabel = `${spoken(time)} of ${spoken(dur)}`;
  return (
    <div className="tutorial-player" ref={wrap}>
      <video
        ref={v}
        src={dir + info.file}
        preload="metadata"
        playsInline
        aria-label={`Video: ${info.title}`}
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          setStatus('Playing.');
        }}
        onPause={() => {
          setPlaying(false);
          setStatus(el().ended ? 'Video finished.' : `Paused at ${spoken(el().currentTime)}.`);
        }}
        onTimeUpdate={() => setTime(el().currentTime)}
        onLoadedMetadata={() => setDur(el().duration)}
        onDurationChange={() => Number.isFinite(el().duration) && setDur(el().duration)}
        onVolumeChange={() => {
          setMuted(el().muted);
          setVol(Math.round(el().volume * 100));
        }}
        onError={() => setError('The video could not be played on this device.')}
      >
        {info.captions && <track kind="captions" src={dir + info.captions} srcLang={info.captionsLang ?? lang} label="Captions" default />}
      </video>
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
      <div className="tutorial-controls" role="group" aria-label="Video controls">
        <button ref={playBtn} type="button" className="btn primary" onClick={toggle} aria-label={playing ? 'Pause video' : 'Play video'}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button type="button" className="btn" onClick={() => skip(-10)} aria-label="Back 10 seconds">
          « 10 s
        </button>
        <button type="button" className="btn" onClick={() => skip(10)} aria-label="Forward 10 seconds">
          10 s »
        </button>
        <label className="tutorial-seek">
          <span className="sr-only">Position</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(dur))}
            step={1}
            value={Math.floor(time)}
            aria-valuetext={posLabel}
            onChange={(e) => {
              el().currentTime = Number(e.target.value);
              setTime(Number(e.target.value));
            }}
          />
          <span aria-hidden="true">
            {clock(time)} / {clock(dur)}
          </span>
        </label>
        <button type="button" className="btn" aria-pressed={muted} onClick={() => (el().muted = !el().muted)}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <label className="tutorial-vol">
          Volume
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={vol}
            aria-valuetext={`${vol} percent`}
            onChange={(e) => {
              el().volume = Number(e.target.value) / 100;
              if (el().muted && Number(e.target.value) > 0) el().muted = false;
            }}
          />
        </label>
        <button type="button" className="btn" onClick={fullscreen}>
          Full screen
        </button>
      </div>
      {/* Play / pause / position changes, said once by the screen reader (not by the game voice, which stays quiet during the video). */}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
