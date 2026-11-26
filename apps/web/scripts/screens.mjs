// Captures the design-review screens in four layouts (+ themes) and runs axe on each.
// Usage: node apps/web/scripts/screens.mjs <outDir> [baseUrl]   (needs playwright-core + axe-core resolvable)
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(process.env.PW_FROM ? resolve(process.env.PW_FROM, 'x.js') : import.meta.url);
const { chromium } = require('playwright-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const OUT = resolve(process.argv[2] ?? 'docs/design/screens');
const URL = process.argv[3] ?? 'http://localhost:3304';
mkdirSync(OUT, { recursive: true });

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  landscape: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  tablet: { viewport: { width: 834, height: 1112 }, hasTouch: true, deviceScaleFactor: 1 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const only = process.env.ONLY?.split(',');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const axeReport = {};

async function shot(p, name) {
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 80 });
  await p.addScriptTag({ content: AXE });
  const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id}(${x.nodes.length}: ${x.nodes[0]?.target} ${x.nodes[0]?.any?.[0]?.message ?? ""})`));
  axeReport[name] = v;
  console.log(name, v.length ? v.join(' ') : 'axe: clean');
}

async function layout(key, theme = 'dark') {
  const ctx = await browser.newContext({ ...LAYOUTS[key], permissions: ['microphone'] });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.addInitScript((theme) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('g304.prefs', JSON.stringify({ v: 6, name: 'Siri', theme, playIntro: true, speech: 'silent', haptics: false }));
      sessionStorage.setItem('seeded', '1');
    }
    // Slow, silent fake voice so the start sequence can be photographed.
    speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 1600);
  }, theme);
  const tag = theme === 'dark' ? key : `${key}-${theme}`;
  await p.goto(URL);

  if (theme === 'dark') {
    await shot(p, `${tag}-a-splash`);
    await p.getByRole('button', { name: 'Start' }).click();
    await p.locator('.intro-line', { hasText: /by (MVS|KS|GVS)/ }).waitFor({ timeout: 15000 });
    await shot(p, `${tag}-a-credits`);
    await p.locator('.intro-line', { hasText: 'Welcome to the table' }).waitFor({ timeout: 20000 });
    await shot(p, `${tag}-b-narration`);
    await p.getByRole('button', { name: 'Skip intro' }).click();
    await p.getByLabel('Name shown to other players').waitFor();
    await shot(p, `${tag}-c-home`);
  } else {
    await p.getByRole('button', { name: 'Skip intro' }).click();
  }
  await p.getByRole('button', { name: /Create private room/ }).click();
  await p.locator('.lobby2').waitFor();
  await p.locator('.seg', { hasText: '4' }).first().click();
  await p.locator('summary', { hasText: 'More settings' }).click();
  await p.getByLabel('Bot speed').selectOption('normal');
  await p.locator('summary', { hasText: 'More settings' }).click();
  if (theme === 'dark') await shot(p, `${tag}-c-lobby`);
  await p.getByRole('button', { name: /Start with|Start game/ }).click();
  await p.getByRole('heading', { name: /Your hand/ }).waitFor();

  let bid = false, play = false, result = false, trump = false;
  for (let i = 0; i < 500 && !(play && result); i++) {
    const tap = (l) => l.click({ timeout: 1500 }).catch(() => {});
    if (await p.getByRole('button', { name: 'Ready for next round' }).isVisible().catch(() => false)) {
      if (!result) {
        result = true;
        await shot(p, `${tag}-h-result`);
      }
      break;
    }
    const pass = p.getByRole('button', { name: 'Pass', exact: true });
    if (await pass.isVisible().catch(() => false)) {
      if (!bid) {
        bid = true;
        await p.locator('.stepper-value').first().press('ArrowUp');
        await p.locator('.stepper-value').first().press('ArrowUp');
        if (theme === 'dark') await shot(p, `${tag}-e-bidding`);
      }
      await tap(p.getByRole('button', { name: /^Bid / }).first());
      continue;
    }
    if (await p.getByText('Choose a card from your hand below').isVisible().catch(() => false)) {
      await tap(p.locator('button.card').first());
      continue;
    }
    const ask = p.getByRole('button', { name: 'Ask for trump' });
    if (!trump && theme === 'dark' && (await ask.isVisible().catch(() => false))) {
      trump = true;
      await tap(ask);
      await p.waitForTimeout(350);
      await p.screenshot({ path: `${OUT}/${tag}-g-trump.jpg`, type: 'jpeg', quality: 80 });
      continue;
    }
    const card = p.locator('button.card.playable').first();
    if (await card.isVisible().catch(() => false)) {
      if (!play && (await p.locator('.felt-card').count()) >= 2) {
        play = true;
        await p.waitForTimeout(400);
        await shot(p, `${tag}-d-table`);
        if (theme === 'dark') {
          await p.locator('#hand').scrollIntoViewIfNeeded();
          await p.screenshot({ path: `${OUT}/${tag}-f-hand.jpg`, type: 'jpeg', quality: 80 });
        }
      }
      await tap(card);
      continue;
    }
    await p.waitForTimeout(200);
  }
  if (theme === 'dark') {
    await p.getByRole('button', { name: /History/ }).click();
    await shot(p, `${tag}-i-history`);
    await p.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await p.getByRole('button', { name: /Settings|More/ }).first().click();
    await p.waitForTimeout(400);
    if (await p.getByRole('dialog', { name: 'More' }).isVisible().catch(() => false)) await p.getByRole('dialog').getByRole('button', { name: /Settings/ }).click();
    await shot(p, `${tag}-j-settings`);
    await p.locator('#disp-h').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${OUT}/${tag}-l-display.jpg`, type: 'jpeg', quality: 80 });
    await p.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  }
  await ctx.close();
}

for (const key of Object.keys(LAYOUTS)) if (!only || only.includes(key)) await layout(key);
if (!only || only.includes('themes')) {
  await layout('desktop', 'light');
  await layout('desktop', 'high-contrast');
  await layout('phone', 'high-contrast');
}
await browser.close();
const bad = Object.entries(axeReport).filter(([, v]) => v.length);
console.log(bad.length ? `axe issues on ${bad.length} screens` : 'axe: all screens clean');
