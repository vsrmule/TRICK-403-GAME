import { ReactNode, useEffect, useId, useRef } from 'react';
import { Card, SUIT_NAMES, SUIT_SYMBOLS, cardName, points, teamLabel } from '@g304/engine';
import type { RoomSnapshot } from '@g304/engine';
import { announcer } from '../announcer';
import { call } from '../net';
import { sfx } from '../sfx';

/** Accessible modal built on the native <dialog> element (focus trap + Escape for free). */
export function Dialog(props: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Closing from code (because `open` became false) must not report a user close,
  // or moving from one dialog to another (More → Settings) would cancel the second.
  const closingFromCode = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) {
      closingFromCode.current = true;
      d.close();
    }
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className={props.wide ? 'dialog wide' : 'dialog'}
      aria-labelledby={titleId}
      onClose={() => {
        if (closingFromCode.current) {
          closingFromCode.current = false;
          return;
        }
        props.onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{props.title}</h2>
        <button type="button" className="btn ghost" onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className="dialog-body">{props.open && props.children}</div>
    </dialog>
  );
}

const SUIT_LETTER: Record<string, string> = { S: 'S', H: 'H', C: 'C', D: 'D' };

/**
 * Card face: rank + suit symbol + suit letter in two corners and a centre suit mark,
 * so suits never depend on colour. Decorative (aria-hidden); the accessible name is
 * provided as real text by the component that uses it.
 */
export function CardFace({ card, small, points: showPts }: { card: Card; small?: boolean; points?: boolean }) {
  const corner = (
    <>
      <b>{card.rank}</b>
      <i>{SUIT_SYMBOLS[card.suit]}</i>
      <em>{SUIT_LETTER[card.suit]}</em>
    </>
  );
  return (
    <span className={`card-face suit-${card.suit}${small ? ' small' : ''}`} aria-hidden="true">
      <span className="corner tl">{corner}</span>
      <span className="pip">{SUIT_SYMBOLS[card.suit]}</span>
      <span className="corner br">{corner}</span>
      {showPts && <span className="pts-badge">{points(card)}</span>}
    </span>
  );
}

/** Card back (other players' unplayed cards). There is no face-down trump card (Issue 6). */
export function CardBack({ small, label }: { small?: boolean; label?: string }) {
  return (
    <span className={`card-back${small ? ' small' : ''}`} role="img" aria-label={label ?? 'Face-down card'}>
      <span className="back-mark" aria-hidden="true">
        304
      </span>
    </span>
  );
}

/**
 * Team identity: colour + shape + text. Team A is a circle, Team B a diamond.
 * In 2- and 3-player games each player is their own side, so no team badge is shown.
 */
export function TeamBadge({ team, label, compact }: { team: number; label: string; compact?: boolean }) {
  return (
    <span className={`team-badge team-${team}`}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        {team === 0 ? <circle cx="6" cy="6" r="5" /> : <rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" />}
      </svg>
      {!compact && <span>{label}</span>}
    </span>
  );
}

/** Visually hidden but read by screen readers. */
export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export const names = (room: RoomSnapshot) => room.seats.map((s) => s.name);

export function sideName(room: RoomSnapshot, team: number) {
  return teamLabel(team, room.settings.numPlayers, names(room));
}

export const isTeamMode = (n: number) => n === 4 || n === 6 || n === 8 || n === 12;

/** True inside the installed Android app (Capacitor), false on the website. */
export const inNativeApp = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/** Call the server and announce any error. */
export async function act(event: string, payload: object = {}) {
  sfx.unlock();
  const r = await call(event, payload);
  if (!r.ok) {
    sfx.play('error');
    announcer.say(r.error, { interrupt: true });
  }
  return r;
}

export function describeCardShort(c: Card) {
  return `${cardName(c)}`;
}

export { SUIT_NAMES };

/**
 * Stepper (WAI-ARIA spinbutton): − / value / +. Arrow keys, Page Up/Down, Home/End
 * work on the value; screen readers announce `valueText` on every change.
 */
export function Stepper<T>(props: {
  id: string;
  label: string;
  values: T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
  describe?: (v: T) => string;
  disabled?: boolean;
}) {
  const i = Math.max(0, props.values.indexOf(props.value));
  const go = (j: number) => {
    if (props.disabled) return;
    const k = Math.max(0, Math.min(props.values.length - 1, j));
    if (k !== i) props.onChange(props.values[k]);
  };
  const text = props.describe ? props.describe(props.value) : props.format(props.value);
  return (
    <div className="stepper" role="group" aria-labelledby={`${props.id}-l`}>
      <span id={`${props.id}-l`} className="stepper-label">
        {props.label}
      </span>
      <button type="button" className="btn step" onClick={() => go(i - 1)} disabled={props.disabled || i === 0} aria-label={`Lower ${props.label}`}>
        −
      </button>
      <span
        id={props.id}
        className="stepper-value"
        role="spinbutton"
        tabIndex={props.disabled ? -1 : 0}
        aria-labelledby={`${props.id}-l`}
        aria-valuenow={i}
        aria-valuemin={0}
        aria-valuemax={props.values.length - 1}
        aria-valuetext={text}
        aria-disabled={props.disabled || undefined}
        onKeyDown={(e) => {
          const map: Record<string, number> = { ArrowUp: i + 1, ArrowRight: i + 1, ArrowDown: i - 1, ArrowLeft: i - 1, PageUp: i + 5, PageDown: i - 5, Home: 0, End: props.values.length - 1 };
          if (e.key in map) {
            e.preventDefault();
            go(map[e.key]);
          }
        }}
      >
        {props.format(props.value)}
      </span>
      <button
        type="button"
        className="btn step"
        onClick={() => go(i + 1)}
        disabled={props.disabled || i === props.values.length - 1}
        aria-label={`Raise ${props.label}`}
      >
        +
      </button>
    </div>
  );
}

const ICONS: Record<string, string> = {
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm3.5 4.5-2 5-5 2 2-5z',
  table: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v8h16V8zm3 2h4v4H7zm6 0h4v4h-4z',
  trophy: 'M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.7zm10 0v2.7A2 2 0 0 0 18 8V7z',
  basket: 'M5 9h14l-1.5 10.2A2 2 0 0 1 15.5 21h-7a2 2 0 0 1-2-1.8zM8 9l4-6 4 6h-2.4L12 6.6 10.4 9z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm-7 9h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h-2v-2.1A7 7 0 0 1 5 12z',
  micOff: 'M3.3 2 2 3.3l5 5V12a5 5 0 0 0 7.7 4.2l1.5 1.5A7 7 0 0 1 13 18.9V21h-2v-2.1A7 7 0 0 1 5 12h2a5 5 0 0 0 .1 1L20.7 22l1.3-1.3zM12 3a3 3 0 0 1 3 3v5.2L9.1 5.3A3 3 0 0 1 12 3zm5 9h2a7 7 0 0 1-.6 2.8l-1.6-1.6A5 5 0 0 0 17 12z',
  chat: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z',
  gear: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10.6 2h2.8l.5 2.6 1.6.7 2.2-1.5 2 2-1.5 2.2.7 1.6 2.6.5v2.8l-2.6.5-.7 1.6 1.5 2.2-2 2-2.2-1.5-1.6.7-.5 2.6h-2.8l-.5-2.6-1.6-.7-2.2 1.5-2-2 1.5-2.2-.7-1.6L2 13.4v-2.8l2.6-.5.7-1.6-1.5-2.2 2-2 2.2 1.5 1.6-.7z',
  help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 15.5a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm1.2-4.6v.6h-2.4v-1c0-1.3 1-2 1.8-2.6.6-.4 1-.8 1-1.4a1.6 1.6 0 0 0-3.2 0H8a4 4 0 0 1 8 0c0 1.6-1.2 2.4-2 3-.5.4-.8.7-.8 1.4z',
  leave: 'M10 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-9v-2h9V5h-9zM9 7l1.4 1.4L7.8 11H16v2H7.8l2.6 2.6L9 17l-5-5z',
  more: 'M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  talk: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM8 20h8v2H8zm-3-8h2a5 5 0 0 0 10 0h2a7 7 0 0 1-14 0z',
  copy: 'M8 3h11a2 2 0 0 1 2 2v11h-2V5H8zM4 7h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v11h11V9z',
  share: 'M18 3a3 3 0 1 1-2.8 4l-7 3.3a3 3 0 0 1 0 3.4l7 3.3A3 3 0 1 1 15 18l-7-3.4a3 3 0 1 1 0-5.2L15 6a3 3 0 0 1 3-3z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  bot: 'M11 2h2v3h4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h4zM9 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 15v1h6v-1z',
  chair: 'M7 3h10v9H7zm-2 10h14v2h-1v6h-2v-6H8v6H6v-6H5z',
  camera: 'M4 6h11a2 2 0 0 1 2 2v2.5l4-3v9l-4-3V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  cameraOff: 'M3.3 2 2 3.3 4.7 6H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h11c.4 0 .8-.1 1.1-.3L20.7 22l1.3-1.3zM17 8v2.5l4-3v9l-1.2-.9L9.2 6H15a2 2 0 0 1 2 2z',
  android: 'M7 9h10v8a2 2 0 0 1-2 2h-1v3h-2v-3h-0v3h-2v-3H9a2 2 0 0 1-2-2zM5 9h1v6H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm13 0h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1zM8.5 3.5l1 1.6A5.9 5.9 0 0 1 12 4.5c.9 0 1.7.2 2.5.6l1-1.6.8.5-1 1.6A5 5 0 0 1 17 8H7a5 5 0 0 1 1.7-2.4l-1-1.6zM10 6.3a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4zm4 0a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4z',
  download: 'M11 3h2v9l3.5-3.5 1.4 1.4L12 15.8 6.1 9.9l1.4-1.4L11 12zM4 18h16v2H4z',
};

/** Decorative icon; always paired with a visible text label. */
export function Icon({ name, size = 20 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={ICONS[name] ?? ''} fill="currentColor" />
    </svg>
  );
}

/** Brand mark: a fanned pair of cards with the 304 identity. */
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="9" y="5" width="20" height="28" rx="4" transform="rotate(-12 19 19)" fill="var(--c-felt)" stroke="var(--c-rim-line)" strokeWidth="1.5" />
      <rect x="13" y="6" width="20" height="28" rx="4" transform="rotate(8 23 20)" fill="var(--c-card)" stroke="var(--c-accent-edge)" strokeWidth="1.5" />
      <text x="23.5" y="24.5" textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="800" fontSize="9" fill="var(--c-card-ink)" transform="rotate(8 23 20)">
        304
      </text>
    </svg>
  );
}

/** Toolbar button: icon + visible label (+ keyboard hint). */
export function ToolButton(props: {
  icon: string;
  label: string;
  kbd?: string;
  onClick: () => void;
  className?: string;
  pressed?: boolean;
  tone?: 'accent' | 'danger' | 'live';
}) {
  return (
    <button
      type="button"
      className={`tb${props.tone ? ` tb-${props.tone}` : ''}${props.className ? ` ${props.className}` : ''}`}
      onClick={props.onClick}
      aria-pressed={props.pressed}
      aria-keyshortcuts={props.kbd}
    >
      <Icon name={props.icon} />
      <span className="tb-label">{props.label}</span>
      {props.kbd && <kbd aria-hidden="true">{props.kbd}</kbd>}
    </button>
  );
}
