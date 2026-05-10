# Phrase Finder

A GitHub Pages app that searches YouTube live and shows results **on your page**, with an option to save them to your catalog.

## What it does

- accepts a phrase or word
- accepts language selection: English, German, Finnish, Russian
- **searches YouTube live** and finds videos with matching transcripts
- shows the matching clip, timestamp, and transcript snippet **in-page** (no redirect)
- lets you click **"Save"** to add a clip to your catalog
- all results stay on your page

## Two-part deploy

The app uses two free services:

1. **GitHub Pages** (frontend + catalog): `index.html`, `styles.css`, `app.js`, `data/catalog.json`
2. **Vercel** (search API): `api/search.js` (searches YouTube, fetches transcripts, finds matches)

### Step 1: Deploy the frontend to GitHub Pages

1. Push the repo to GitHub.
2. Enable GitHub Pages from the repository settings and choose GitHub Actions as the source.
3. Push to `main` and wait for the workflow to finish.

### Step 2: Deploy the search API to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub (free).
2. Click **"New Project"** and select this GitHub repo.
3. Click **"Deploy"** — Vercel will auto-detect it's a Node project.
4. After deployment, copy your Vercel project URL (e.g., `https://my-project-xyz.vercel.app`).
5. **Update `app.js`**: Replace the `SEARCH_API` value with your Vercel URL:
   ```javascript
   const SEARCH_API = "https://your-vercel-url.vercel.app/api/search";
   ```
6. Push the change to GitHub.

## How to save clips

1. Search for a phrase.
2. Results appear on your page.
3. Click **"Save"** on any clip.
4. A JSON file downloads.
5. Replace `data/catalog.json` with the downloaded file.
6. Push to GitHub — clips are now indexed for future offline searches.

## Files

- `index.html` — main app UI
- `styles.css` — design
- `app.js` — frontend logic (calls Vercel API, handles UI)
- `data/catalog.json` — your local clip index (built by saving results)
- `api/search.js` — Vercel search function (searches YouTube, gets transcripts)
- `package.json` — Vercel dependencies
- `vercel.json` — Vercel config
- `.github/workflows/pages.yml` — GitHub Pages deploy workflow

## Run locally

```bash
npm install
vercel dev
```

Then open `http://localhost:3000` in your browser.

