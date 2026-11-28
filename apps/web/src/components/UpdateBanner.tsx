import { useEffect, useState } from 'react';
import { announcer } from '../announcer';
import { APP_VERSION, PUBLIC_URL } from '../config';
import { inNativeApp } from './ui';

/**
 * Android app only: tells the player when the website has a newer APK.
 *
 * The website publishes the current APK's version at /downloads/version.json (written by the
 * build from android/app/build.gradle). The app checks it at launch, whenever it comes back to
 * the foreground, and every 30 minutes. "Download update" opens the APK in the phone's browser;
 * installing it over the app keeps the player's settings.
 */
interface Latest {
  versionCode: number;
  versionName: string;
}

const CHECK_EVERY_MS = 30 * 60 * 1000;

async function latest(): Promise<Latest | null> {
  try {
    const r = await fetch(`${PUBLIC_URL}/downloads/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const v = (await r.json()) as Latest;
    return typeof v.versionCode === 'number' ? v : null;
  } catch {
    return null; // offline: try again later
  }
}

export function UpdateBanner() {
  const [available, setAvailable] = useState<Latest | null>(null);
  const [dismissed, setDismissed] = useState(0);

  useEffect(() => {
    if (!inNativeApp()) return;
    let live = true;
    const check = async () => {
      const v = await latest();
      if (live && v && v.versionCode > APP_VERSION.code) setAvailable(v);
    };
    void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const show = !!available && available.versionCode !== dismissed;
  useEffect(() => {
    if (show) announcer.say('A new version of Trick 304 is available. Choose Download update to install it.', { kind: 'system' });
  }, [show]);

  if (!show || !available) return null;
  return (
    <section className="update-banner" aria-labelledby="update-h">
      <p id="update-h">
        <strong>A new version of Trick 304 is available</strong> ({available.versionName}). You have {APP_VERSION.name}.
      </p>
      <div className="row wrap">
        <a className="btn primary" href={`${PUBLIC_URL}/downloads/trick304.apk`} target="_blank" rel="noopener">
          Download update
        </a>
        <button type="button" className="btn" onClick={() => setDismissed(available.versionCode)}>
          Later
        </button>
      </div>
    </section>
  );
}
