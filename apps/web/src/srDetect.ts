import { useSyncExternalStore } from 'react';

/**
 * Screen-reader detection for the web (browsers don't expose whether one is running).
 *
 * Screen readers activate buttons in ways a sighted user's finger, mouse or keyboard don't:
 *  - Desktop (NVDA, JAWS, Narrator, VoiceOver for Mac): a click arrives with no pointer
 *    press and no key press reaching the page — the screen reader consumed the key.
 *  - Touch screens (VoiceOver on iPhone/iPad, TalkBack on Android): the double-tap
 *    produces a click without the page ever receiving a real touch on that spot, and the
 *    click lands at the exact centre of the button. A finger tap always sends touch events
 *    and almost never hits the exact centre.
 * When we see such a click we treat this device as using a screen reader and remember it.
 *
 * Native Android/iOS builds should use the platform's exact signal instead
 * (AccessibilityManager.isTouchExplorationEnabled / UIAccessibility.isVoiceOverRunning).
 */
const KEY = 'g304.sr';
const WINDOW_MS = 800;

let detected = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
let lastTouch = -Infinity;
let lastTouchX = NaN;
let lastTouchY = NaN;
let lastPointer = -Infinity;
let lastKey = -Infinity;
/** Consecutive exact-centre activations (a finger hits the exact centre by chance only rarely). */
let centreHits = 0;
const listeners = new Set<() => void>();

function mark() {
  if (detected) return;
  detected = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Did the click land at the exact centre of the activated control (within 1.5px)? */
function atCentre(e: MouseEvent): boolean {
  const el = (e.target as Element | null)?.closest('button, a, input, select, summary, [role="button"]');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return Math.abs(e.clientX - (r.left + r.width / 2)) <= 1.5 && Math.abs(e.clientY - (r.top + r.height / 2)) <= 1.5;
}

if (typeof window !== 'undefined') {
  const now = () => performance.now();
  const touchDevice = () => (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  window.addEventListener(
    'touchstart',
    (e) => {
      if (!e.isTrusted) return;
      lastTouch = now();
      const t = e.touches[0];
      lastTouchX = t?.clientX ?? NaN;
      lastTouchY = t?.clientY ?? NaN;
    },
    { capture: true, passive: true },
  );
  window.addEventListener('pointerdown', (e) => e.isTrusted && (lastPointer = now()), true);
  window.addEventListener('keydown', (e) => e.isTrusted && (lastKey = now()), true);
  window.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted) return;
      const t = now();
      if (t - lastKey < WINDOW_MS) return; // keyboard user
      if (touchDevice()) {
        // A real finger tap sends a touch near where the click lands.
        const touchedHere = t - lastTouch < WINDOW_MS && Math.hypot(e.clientX - lastTouchX, e.clientY - lastTouchY) < 30;
        if (!touchedHere) return mark();
        centreHits = atCentre(e) ? centreHits + 1 : 0;
        if (centreHits >= 3) mark();
        return;
      }
      if (t - lastPointer >= WINDOW_MS) mark(); // desktop: no mouse press before the click
    },
    true,
  );
}

export const screenReader = {
  get: () => detected,
  /** Forget the detection (e.g. from Settings). */
  reset() {
    detected = false;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useScreenReaderDetected() {
  return useSyncExternalStore(screenReader.subscribe, screenReader.get);
}
