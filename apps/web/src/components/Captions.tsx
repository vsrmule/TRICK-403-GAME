import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '@g304/engine';
import { useActivity } from '../activity';
import { useAnnouncer } from '../announcer';
import { usePrefs } from '../prefs';
import { useVoice } from '../voice';
import { Dialog } from './ui';

/** A small channel indicator: icon + text label + on/off state (never colour alone). */
function Channel({ on, icon, label, detail }: { on: boolean; icon: 'voice' | 'speak' | 'fx' | 'music'; label: string; detail?: string }) {
  const paths: Record<typeof icon, string> = {
    voice: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm-7 9h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h-2v-2.1A7 7 0 0 1 5 12z',
    speak: 'M4 9h4l5-4v14l-5-4H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
    fx: 'M12 2l2.4 6.9H22l-6 4.6 2.3 7L12 16.3 5.7 20.5 8 13.5 2 8.9h7.6z',
    music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  };
  return (
    <span className={`chan${on ? ' on' : ''}`}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path d={paths[icon]} fill="currentColor" />
      </svg>
      <span>
        {label}
        {detail ? `: ${detail}` : on ? '' : ' off'}
      </span>
    </span>
  );
}

/**
 * Announcement strip: the current announcement as a caption, the previous one beneath
 * it, a visual indicator for every audio channel (so deaf and hard-of-hearing players
 * know when something is speaking), and the full event history one tap away.
 * Not a live region — speech is delivered by the announcer, so nothing is read twice.
 */
export function CaptionStrip({ room }: { room: RoomSnapshot | null }) {
  const { history } = useAnnouncer();
  const act = useActivity();
  const vs = useVoice();
  const p = usePrefs();
  const [open, setOpen] = useState(false);
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const talkers = [
    ...(vs.meSpeaking ? ['You'] : []),
    ...(room?.members.filter((m) => vs.speaking.includes(m.memberId)).map((m) => m.name) ?? []),
  ];
  const voiceOn = vs.status === 'on' || vs.status === 'listenOnly';
  // Publish the strip's real height so the page always leaves exactly enough room for it.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--cap-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--cap-h');
    };
  }, []);
  return (
    <>
      <section ref={ref} className="captions" aria-label="Captions and sound">
        <div className="cap-text">
          {prev && <p className="cap-prev">{prev.text}</p>}
          <p className="cap-now">{last ? last.text : 'Captions of everything that happens appear here.'}</p>
        </div>
        <div className="cap-chans">
          <Channel on={voiceOn && talkers.length > 0} icon="voice" label="Voice" detail={!voiceOn ? undefined : talkers.length ? `${talkers.join(', ')} talking` : 'quiet'} />
          <Channel on={act.announcing} icon="speak" label="Game voice" detail={act.announcing ? 'speaking' : p.speech === 'auto' || p.speech === 'voice' ? 'quiet' : undefined} />
          <Channel on={!!act.sfx} icon="fx" label="Effects" detail={act.sfx ? 'playing' : 'quiet'} />
          <Channel on={act.music} icon="music" label="Music" detail={act.music ? 'on' : undefined} />
        </div>
        <button className="btn ghost cap-hist" onClick={() => setOpen(true)}>
          History ({history.length})
        </button>
      </section>
      <Dialog open={open} onClose={() => setOpen(false)} title="Event history" wide>
        <HistoryList />
      </Dialog>
    </>
  );
}

function HistoryList() {
  const { history } = useAnnouncer();
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, []);
  if (!history.length) return <p>Nothing has happened yet.</p>;
  return (
    <ol className="list compact history" aria-label={`All events, oldest first, ${history.length}`}>
      {history.map((e, i) => (
        <li key={e.id} ref={i === history.length - 1 ? end : undefined} className={`h-${e.kind}`}>
          <span className="h-time">{new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> {e.text}
        </li>
      ))}
    </ol>
  );
}
