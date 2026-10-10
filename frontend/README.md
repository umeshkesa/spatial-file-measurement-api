# SpatialLens frontend

React + TypeScript + Vite interface for the Spatial File Measurement API.

## Prerequisites

- Node.js 20+ with npm.
- The backend running locally (see root README).

## Setup

```bash
cd frontend
npm install
cp .env.example .env   # optional; defaults to http://127.0.0.1:8000
```

## Run

```bash
# Terminal 1 — backend (repository root):
uvicorn app.main:app --reload

# Terminal 2 — frontend:
npm run dev   # http://localhost:5173
```

The dev server calls the API directly via CORS. Allowed browser origins are
configured in the backend with `CORS_ALLOWED_ORIGINS`
(default `http://localhost:5173,http://127.0.0.1:5173`).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | Backend base URL used by the typed client (`src/lib/api.ts`) |

## Checks

```bash
npm run build   # tsc typecheck + production bundle into dist/
npm run lint    # oxlint
npm test        # vitest unit tests (export helpers, 24 tests)
npm run preview # serve the production bundle locally
```

Live end-to-end export test (uploads the real `sample_data/` files, walks real API
pagination, asserts CSV/JSON content) — backend must be running:

```bash
SPATIAL_LIVE_API=1 VITE_API_BASE_URL=http://127.0.0.1:8000 npm test -- live-export
```

## Features

- **Dashboard**: stat cards, CRS/status, interactive dataset preview map (reset-view
  action, click-to-select), full-dataset CSV/JSON export, session upload history.
- **Map**: all file geometries on OpenStreetMap, selection synced with the table
  (selecting an off-page feature jumps the table to its page).
- **Measurements**: paginated table with geometry/status badges, filters, sorting,
  error indicators, export buttons, and a details panel (raw geometry collapsible).
- **Export**: `*_measurements_YYYY-MM-DD.csv` (all pages, RFC-4180 escaping,
  `'`-prefix formula guard, empty value for NOT_APPLICABLE) and readable JSON with
  file metadata + all records. No partial export is ever labeled complete.

## Notes

- No file-history endpoint exists in the API, so the dashboard shows the selected
  file plus uploads made in the current browser session (session-local list).
- Map geometries are rendered as GeoJSON longitude/latitude; projected measurement
  coordinates are never plotted. Points render as circle markers (no icon assets).
- All measurements, statuses, and error text come from live API responses.
