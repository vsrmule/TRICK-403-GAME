// Checks every text/background and UI pair of the three Trick 304 themes against WCAG.
// Usage: node apps/web/scripts/contrast.mjs [--md]   (prints a table; exits 1 on any failure)
import { THEMES } from './themes.mjs';

const lum = (hex) => {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/** [foreground token, background token, kind] — kind: text (4.5), large/ui (3). High contrast needs 7 for text. */
const PAIRS = [
  ['text', 'bg', 'text'],
  ['text', 'surface', 'text'],
  ['text', 'surface-2', 'text'],
  ['muted', 'bg', 'text'],
  ['muted', 'surface', 'text'],
  ['accent-ink', 'surface', 'text'],
  ['accent-ink', 'bg', 'text'],
  ['on-accent', 'accent', 'text'],
  ['team-a', 'surface', 'text'],
  ['team-b', 'surface', 'text'],
  ['good', 'surface', 'text'],
  ['bad', 'surface', 'text'],
  ['felt-text', 'felt', 'text'],
  ['card-ink', 'card', 'text'],
  ['suit-hearts', 'card', 'text'],
  ['suit-clubs', 'card', 'text'],
  ['suit-diamonds', 'card', 'text'],
  ['border-strong', 'surface', 'ui'],
  ['focus', 'bg', 'ui'],
  ['focus', 'surface', 'ui'],
  ['accent-edge', 'bg', 'ui'],
  ['accent-edge', 'surface', 'ui'],
  ['rim-line', 'felt', 'ui'],
  ['suit-spades', 'card', 'text'],
];

const md = process.argv.includes('--md');
let failed = 0;
const rows = [];
for (const [name, t] of Object.entries(THEMES)) {
  for (const [fg, bg, kind] of PAIRS) {
    if (!t[fg] || !t[bg]) continue;
    const r = ratio(t[fg], t[bg]);
    const need = name === 'high-contrast' && kind === 'text' ? 7 : kind === 'text' ? 4.5 : 3;
    const ok = r >= need;
    if (!ok) failed++;
    rows.push({ theme: name, pair: `${fg} on ${bg}`, fg: t[fg], bg: t[bg], ratio: r.toFixed(2), need, ok });
  }
}
if (md) {
  console.log('| Theme | Pair | Colours | Ratio | Needs | |\n|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.theme} | ${r.pair} | ${r.fg} on ${r.bg} | ${r.ratio}:1 | ${r.need}:1 | ${r.ok ? 'pass' : 'FAIL'} |`);
} else {
  for (const r of rows) if (!r.ok) console.log('FAIL', r.theme, r.pair, r.fg, r.bg, r.ratio, '<', r.need);
  console.log(`${rows.length - failed}/${rows.length} pairs pass`);
}
process.exit(failed ? 1 : 0);
