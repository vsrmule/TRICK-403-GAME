import { useEffect, useRef, useState } from 'react';
import { catalog } from '@g304/engine';
import { announcer } from '../announcer';
import { music } from '../music';
import { prefs, usePrefs } from '../prefs';
import { SFX_LENGTH, sfx } from '../sfx';

/** Credits play in a different order each launch: rotate the data-driven list by a launch counter. */
function creditOrder<T>(list: T[]): T[] {
  let n = 0;
  try {
    n = Number(localStorage.getItem('g304.launches') ?? '0');
    localStorage.setItem('g304.launches', String(n + 1));
  } catch {
    n = Math.floor(Math.random() * list.length);
  }
  const k = n % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Start sequence: "Trick 304" with a sound logo, then three credit clips one after
 * another (never overlapping, order rotates each launch), then a short opening
 * narration with an animation. Everything is skippable and has a text version.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const p = usePrefs();
  const L = catalog(p.lang);
  const [stage, setStage] = useState<'ready' | 'title' | 'credits' | 'narration'>('ready');
  const [line, setLine] = useState('');
  const cancelled = useRef(false);
  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    startRef.current?.focus();
  }, []);

  const skip = () => {
    cancelled.current = true;
    announcer.cancelAll();
    onDone();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && skip();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    sfx.unlock();
    music.sync();
    setStage('title');
    setLine(L.gameName);
    sfx.play('logo');
    await wait(SFX_LENGTH.logo ?? 1200);
    if (cancelled.current) return;
    await announcer.sayAndWait({ text: L.gameName, voice: L.gameName, clips: [{ t: 'gameName' }] }, { kind: 'system', always: true });
    setStage('credits');
    for (const c of creditOrder(L.credits)) {
      if (cancelled.current) return;
      setLine(c.text);
      await announcer.sayAndWait({ text: c.text, voice: c.text, clips: [{ t: `credit-${c.id}` }] }, { kind: 'system', always: true });
    }
    if (cancelled.current) return;
    setStage('narration');
    setLine(L.intro.narration);
    await announcer.sayAndWait({ text: L.intro.narration, voice: L.intro.narration, clips: [{ t: 'introNarration' }] }, { kind: 'system', always: true });
    if (!cancelled.current) onDone();
  };

  return (
    <main id="main" className="intro" aria-labelledby="intro-title">
      <div className={`fan stage-${stage}`} aria-hidden="true">
        {['J♠', '9♥', 'A♣', '10♦', 'K♠'].map((c, i) => (
          <span key={c} className={`fan-card c${i} ${c.includes('♥') || c.includes('♦') ? 'red' : ''}`}>
            {c}
          </span>
        ))}
      </div>
      <h1 id="intro-title" className="intro-title">
        Trick <span>304</span>
      </h1>
      {stage === 'ready' ? (
        <>
          <p className="intro-sub">The social card game you can play by ear.</p>
          <div className="row wrap center">
            <button ref={startRef} className="btn primary big" onClick={() => void run()}>
              Start
            </button>
            <button className="btn big" onClick={skip}>
              Skip intro
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={p.playIntro} onChange={(e) => prefs.set({ playIntro: e.target.checked })} />
            Play this intro every time
          </label>
        </>
      ) : (
        <>
          <p className="intro-line">{line}</p>
          <button className="btn big" onClick={skip}>
            Skip intro
          </button>
        </>
      )}
    </main>
  );
}
