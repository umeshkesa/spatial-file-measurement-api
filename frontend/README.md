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
npm run preview # serve the production bundle locally
```

## Notes

- No file-history endpoint exists in the API, so the dashboard shows the selected
  file plus uploads made in the current browser session (session-local list).
- Map geometries are rendered as GeoJSON longitude/latitude; projected measurement
  coordinates are never plotted. Points render as circle markers (no icon assets).
- All measurements, statuses, and error text come from live API responses.
