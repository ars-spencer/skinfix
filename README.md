# Skin Almanac

A private, local-only tracker for day-to-day rosacea logging: flare severity, possible triggers, routine/product changes, and a same-spot photo each day — with a calendar heatmap and trend view to help spot patterns over time.

## How it works

- **No backend, no account, no syncing.** It's three files — `index.html`, `style.css`, `app.js` — that run entirely in your browser.
- **Your data (including photos) is stored in IndexedDB**, a local database built into the browser. It lives only on the device/browser you're using it in.
- **Publishing this code to GitHub does not publish your data.** A public GitHub repo just hosts the app's source code (the form, the heatmap logic, the styling). Nothing you log inside the app — photos, notes, ratings — is ever uploaded, committed, or visible to anyone viewing the repo or the live site.
- Because storage is per-browser, switching devices or browsers (or clearing site data) starts you fresh unless you've exported a backup. **Use Settings → Export backup (.json) regularly.** The export includes photos (as embedded image data), so keep that file somewhere private — a personal cloud drive folder, not another public repo.

## Running it locally

No build step needed. Either:
- Open `index.html` directly in a browser, or
- From this folder, run a tiny local server (recommended, since some browsers restrict local file access for things like file inputs):
  ```
  python3 -m http.server 8000
  ```
  then visit `http://localhost:8000`

## Publishing on GitHub Pages

1. Create a new repository on GitHub (private or public — your data isn't in the code either way, but private keeps casual visitors from finding it at all).
2. Push these three files to the repo root:
   ```
   git init
   git add index.html style.css app.js README.md
   git commit -m "Skin Almanac tracker"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**, set **Source** to "Deploy from a branch," branch `main`, folder `/ (root)`. Save.
4. GitHub gives you a URL like `https://<username>.github.io/<repo-name>/` within a minute or two. That's your tracker — bookmark it on whatever device(s) you'll log from.

A quick note on the public/private choice: if the repo is **public**, anyone can see the *app's code*, but not your logged data — that never leaves your browser's storage. If you'd rather not have even the code publicly visible, make the repo **private**; GitHub Pages still works on private repos with GitHub Pro, or you can just run it locally / host it elsewhere privately.

## Using it

- **Today** — pick a date (defaults to today, but you can back-fill past days), rate flare level 1–5, tag any triggers that applied, add notes, attach a photo. Photos are auto-resized before storing so months of daily shots don't balloon storage.
- **Almanac** — a month-by-month heatmap (sage = calm, clay = flared) plus a rolling-average trend line and a trigger comparison: average flare level on days a trigger was present vs. absent. This is the view to watch as you build up data — it's what will tell you whether something like dairy or heat actually correlates with flares for you specifically.
- **Gallery** — your photos in order; toggle "compare mode" to pick any two and view them side by side.
- **Routine Log** — track when you start, stop, or adjust a product (this is where you'd log starting the azelaic acid, for instance, so you can later see whether the trend line shifts after that date).
- **Settings** — export/import a full JSON backup, or erase everything on this device.

## A note on scope

This is a personal tracking tool, not a diagnostic one. It won't tell you whether what you're seeing is rosacea, and it's not a substitute for an in-person dermatology evaluation if you decide you want one down the line — it's just a way to make your own patterns easier to see than they are to remember.
