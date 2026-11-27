/**
 * Renders the built-in voice clips with Azure Speech (neural voice + speaking styles).
 *
 *   $env:AZURE_SPEECH_KEY = '<key>'; $env:AZURE_SPEECH_REGION = '<region, e.g. centralindia>'
 *   npx vite-node apps/web/scripts/voice/generate.ts -- [lang=en] [--rpm 18] [--force]
 *
 * Reads apps/web/public/voice/<lang>/phrases.json, works out every clip the game can play
 * (allClips), and writes each missing one to public/voice/<lang>/clips/<id>.mp3, then
 * clips/index.json (the list the game reads to know which clips exist). Already-rendered
 * clips are skipped, so an interrupted run just continues. The free Azure tier (F0) allows
 * 20 requests a minute, hence the default --rpm 18.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allClips, type PhraseBook } from '../../../../packages/engine/src/voiceClips';

const args = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const lang = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--rpm') ?? 'en';
const rpm = Number(flag('--rpm') ?? 18);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');

const root = resolve(import.meta.dirname, '../../public/voice', lang);
const book = JSON.parse(readFileSync(resolve(root, 'phrases.json'), 'utf8')) as PhraseBook;
const outDir = resolve(root, 'clips');
mkdirSync(outDir, { recursive: true });

const clips = allClips(book);
const todo = clips.filter((c) => force || !existsSync(resolve(outDir, `${c.id}.mp3`)));
console.log(`${lang}: ${clips.length} clips, ${todo.length} to render (${book.voice}).`);
if (dryRun) {
  for (const c of todo.slice(0, 40)) console.log(`  ${c.id}  [${c.style}]  ${c.text}`);
  process.exit(0);
}

const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
if (todo.length && (!key || !region)) {
  console.error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION first.');
  process.exit(1);
}
const voice = process.env.AZURE_SPEECH_VOICE ?? book.voice;
const locale = voice.split('-').slice(0, 2).join('-');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const ssml = (style: string, text: string) =>
  `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">` +
  `<voice name="${voice}"><mstts:express-as style="${style}">${esc(text)}</mstts:express-as></voice></speak>`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gap = Math.ceil(60_000 / rpm);

async function render(style: string, text: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key!,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'trick304-voice-generator',
      },
      body: ssml(style, text),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 5000 * attempt;
      console.log(`  ${res.status}, retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Azure ${res.status}: ${await res.text()}`);
  }
}

let done = 0;
for (const c of todo) {
  const started = Date.now();
  const mp3 = await render(c.style, c.text);
  writeFileSync(resolve(outDir, `${c.id}.mp3`), mp3);
  done++;
  if (done % 25 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}  ${c.text}`);
  await sleep(Math.max(0, gap - (Date.now() - started)));
}

// The game reads this list to know which clips exist (anything missing falls back to text).
const wanted = new Set(clips.map((c) => c.id));
const have = readdirSync(outDir)
  .filter((f) => f.endsWith('.mp3'))
  .map((f) => f.slice(0, -4))
  .filter((id) => wanted.has(id))
  .sort();
writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(have));
const stale = readdirSync(outDir).filter((f) => f.endsWith('.mp3') && !wanted.has(f.slice(0, -4)));
console.log(`index.json: ${have.length}/${clips.length} clips.${stale.length ? ` ${stale.length} old clips are no longer used and can be deleted.` : ''}`);
