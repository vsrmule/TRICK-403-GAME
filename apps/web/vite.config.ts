import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The Android app's version, from android/app/build.gradle (the one place to raise it).
 * The app carries it built in; the website publishes it at /downloads/version.json, and
 * the app compares the two to tell players when a newer APK is available.
 */
function appVersion() {
  const gradle = readFileSync(resolve(__dirname, 'android/app/build.gradle'), 'utf8');
  return {
    code: Number(/versionCode\s+(\d+)/.exec(gradle)?.[1] ?? 0),
    name: /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? '0',
  };
}

/**
 * `vite build --mode android` builds the copy of the web app that ships inside the APK
 * (into dist-android, used by Capacitor). It must not contain public/downloads: that folder
 * holds the APK itself, which would otherwise be packed into the next APK.
 */
function dropDownloads(outDir: string): Plugin {
  return {
    name: 'trick304-drop-downloads',
    apply: 'build',
    closeBundle() {
      rmSync(resolve(outDir, 'downloads'), { recursive: true, force: true });
    },
  };
}

/** Website build: publish the current APK's version next to the APK. */
function publishVersion(outDir: string, v: { code: number; name: string }): Plugin {
  return {
    name: 'trick304-publish-version',
    apply: 'build',
    closeBundle() {
      mkdirSync(resolve(outDir, 'downloads'), { recursive: true });
      writeFileSync(resolve(outDir, 'downloads/version.json'), JSON.stringify({ versionCode: v.code, versionName: v.name }));
    },
  };
}

export default defineConfig(({ mode }) => {
  const android = mode === 'android';
  const outDir = resolve(__dirname, android ? 'dist-android' : 'dist');
  const version = appVersion();
  return {
    plugins: [react(), android ? dropDownloads(outDir) : publishVersion(outDir, version)],
    define: {
      __APP_VERSION_CODE__: JSON.stringify(version.code),
      __APP_VERSION_NAME__: JSON.stringify(version.name),
    },
    build: { outDir, emptyOutDir: true },
    server: {
      host: true,
      port: 5173,
      proxy: { '/socket.io': { target: 'http://localhost:3304', ws: true } },
    },
  };
});
