# HK Outdoor Exercise Index

> **🔗 Live: https://hk-outdoor-index.pages.dev** (中文 / English toggle)

A daily 1–10 score for how suitable today is for outdoor exercise in Hong Kong, combining open data from the [Hong Kong Observatory (HKO)](https://www.hko.gov.hk) and the [Environmental Protection Department (EPD)](https://www.aqhi.gov.hk):

| Factor | Source |
|---|---|
| Temperature / humidity / UV / rain / weather warnings / 9-day forecast | HKO Open Data API |
| Visibility (haze) | HKO regional 10-minute mean visibility |
| Air quality (AQHI) | EPD |

The score starts at 10 and deducts for heat, humidity, thunderstorm/heavy rain, air pollution, low visibility and strong UV. Severe-weather warnings (rainstorm / thunderstorm / very hot / typhoon) hard-cap the score.

## Architecture

HKO's visibility CSV and EPD's AQHI XML have **no CORS**, so the browser cannot fetch them directly — and GitHub runners can't reliably reach HK government hosts either. So a **Cloudflare Pages Function** (`functions/api/today.js`) fetches all five sources at the edge, computes the score, and returns localized JSON with CORS, cached 20 minutes at the edge.

→ Data is **live on every visit** (not just every morning). The daily GitHub Actions run is just a redeploy heartbeat.

```
functions/api/today.js   edge API that fetches + scores (supports ?lang=tc|en)
src/                     React frontend (score dial + factor cards + advice)
public/sample*.json      local-dev fallback when no Function is available
```

## Develop

```bash
npm install
npm run dev       # vite UI dev (uses public/sample.json mock data)
npm run dev:cf    # build + wrangler pages dev — runs the real /api/today Function
npm run build
```

## Deploy (Cloudflare Pages)

Auto-deploys on push to `main`, on the daily schedule, or manual dispatch. Repo needs Secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The Pages project `hk-outdoor-index` is created automatically on first run.

## Disclaimer

The index is an estimated composite, for reference only. In bad weather, always follow official HKO warnings.
