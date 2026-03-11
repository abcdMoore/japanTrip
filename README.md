# Japan 2026 — Trip Guide

Mobile-first PWA travel guide for a Japan trip (Mar 17–31, 2026).
Built with Vite + React + Leaflet. No backend, no auth, fully static.

---

## Local Development

```bash
npm install
npm run dev       # http://localhost:5173
```

## Build & Preview

```bash
npm run build     # outputs to dist/
npm run preview   # preview the production build locally
```

## Deployment (Vercel)

Push to GitHub — Vercel auto-detects Vite. `vercel.json` is already configured.

1. Connect the repo to Vercel (Import Project)
2. Framework preset: **Vite** (auto-detected)
3. No environment variables needed — OSRM is a free public API

---

## Updating Trip Data

All itinerary content lives in `src/trip-data.md`. The format is:

```markdown
# Date | Day Label | City

## Time | Area Name | stop type | lat,lng
- Activity text
- Activity with numbered map pin [lat,lng]

### transit: type | duration
1. Step text
2. Walk step [walk:from_lat,from_lng:to_lat,to_lng]
3. Train step [line:from_lat,from_lng:to_lat,to_lng]
```

**Step annotations:**
- `[walk:…]` → OSRM foot-routed dashed blue line + turn-by-turn arrows
- `[line:…]` → OSRM driving-routed solid purple line (approximates rail path)
- No annotation → plain text, no map line

After editing, run `npm run build` to verify there are no parse errors.

---

## App Features

| Feature | Notes |
|---|---|
| Day-by-day navigation | Swipe via Prev/Next or tap progress dots |
| Map per stop | CartoDB dark tiles, auto-zooms to stop + activities |
| Transit panel | Auto-opens on "Next Stop →"; shows turn-by-turn for walk segments |
| OSRM fallback | If routing times out (12s), falls back to dashed straight line |
| Full-day view | Tap **Day** button near progress dots to see all stops on one map |
| Navigate button | 📍 Navigate deep-links to Apple Maps walking directions |
| Open in Maps | Tap any map marker popup → "Open in Maps" |
| Near me (◎) | Bottom-right map button — shows your GPS dot, recenters for 4s then snaps back |
| Copy button | Copies place name to clipboard from any marker popup |
| Offline tiles | Workbox CacheFirst strategy caches CartoDB tiles as you view them (500 tiles, 30 days) |
| PWA | Installable, standalone display, status bar matches app theme |
| Persistent position | Remembers last-viewed day + stop via localStorage |

---

## Icons

PNG icons (required for iOS home screen) are generated from the SVG source:

```bash
npm install -D sharp          # one-time setup
node scripts/generate-icons.mjs
```

This writes `public/icons/icon-192.png`, `icon-512.png`, and `apple-touch-icon.png`.
These are already committed — only re-run if you change `public/icons/icon.svg`.

---

## Stack

- **Vite 5** + **React 18** (JSX, no TypeScript)
- **Leaflet 1.9** + **react-leaflet 4**
- **vite-plugin-pwa 0.20** (Workbox for offline caching)
- **OSRM** public API (no key required)
- **Maps deep-links**: `maps://` scheme (Apple Maps, iPhone-only by design)

---

## File Structure

```
src/
  App.jsx          Main app — parsing, map, navigation, all features
  main.jsx         React root + Leaflet icon fix
  index.css        Global styles + GPS pulse animation
  trip-data.md     Itinerary data (edit this to update the trip)

public/
  icons/
    icon.svg               Source icon (torii gate + sakura)
    icon-192.png           PWA manifest icon
    icon-512.png           PWA manifest icon (large)
    apple-touch-icon.png   iOS home screen icon

scripts/
  generate-icons.mjs   Converts icon.svg → PNG icons (needs sharp)
```
