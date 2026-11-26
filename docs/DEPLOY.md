# Running Trick 304 online 24/7 (Render)

The project has a `Dockerfile` and a `render.yaml`. Render builds the website and the game server from them and keeps them running.

## 1. Put the code on GitHub (one time)
1. Make a free account at https://github.com and create an empty **private** repository named `trick304`.
2. On this laptop, in `D:\workspace\GAME`:
   ```
   git add .
   git commit -m "Trick 304"
   git branch -M main
   git remote add origin https://github.com/<your-username>/trick304.git
   git push -u origin main
   ```

## 2. Create the service on Render (one time)
1. Sign up at https://render.com with your GitHub account.
2. Choose **New → Blueprint**, pick the `trick304` repository, then **Apply**. Render reads `render.yaml` and uses the **Free** plan.
3. Wait for the build to finish (about 3–5 minutes). Then open `https://trick304.onrender.com` (Render shows the exact address).
4. Check: `https://<your-address>/healthz` should say OK.

## 3. Updates
Every `git push` to `main` redeploys automatically. A redeploy ends any game in progress, because rooms are kept in memory.

## 4. Android app
The app opens the address in `apps/web/capacitor.config.json` (`server.url`). After moving to Render, change it to the Render address, rebuild the APK (see `ANDROID.md`), and push. Players then install the new APK once.

## Notes
- After moving, ngrok is no longer needed; your laptop can be off.
- Optional: a custom domain (for example `play.trick304.com`) can be added in Render → Settings → Custom Domains.

## Keeping the free plan awake
Render's free plan goes to sleep after 15 minutes with no visitors. The first visitor then waits about a minute.
To keep it awake, sign up free at https://uptimerobot.com and add an **HTTP(s)** monitor for `https://<your-address>/healthz`, checking every **5 minutes**.
One service running all month uses about 744 of the 750 free hours Render gives each month, so it stays free.
