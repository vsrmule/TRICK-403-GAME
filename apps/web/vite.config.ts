import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig(({ mode }) => {
  const android = mode === 'android';
  const outDir = resolve(__dirname, android ? 'dist-android' : 'dist');
  return {
    plugins: [react(), ...(android ? [dropDownloads(outDir)] : [])],
    build: { outDir, emptyOutDir: true },
    server: {
      host: true,
      port: 5173,
      proxy: { '/socket.io': { target: 'http://localhost:3304', ws: true } },
    },
  };
});
