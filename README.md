# Spatial File Measurement API

A production-style Python REST API that accepts geospatial files (KML and ZIP-packed
Shapefiles), extracts geographic features, computes metric measurements with correct
coordinate-reference-system handling, and serves the results through documented endpoints.

Built as an engineering assignment for a Software Development Internship at AEREO.

## 1. Overview

Upload a `.kml` file or a `.zip` containing a Shapefile dataset and the API will:

1. Validate and safely store the upload.
2. Parse features with GeoPandas (KML driver / Shapefile driver).
3. Detect the source CRS and select a projected measurement CRS (UTM estimate for local
   datasets, global equal-area fallback for large ones).
4. Transform geometries out of angular (degree) coordinates before measuring.
5. Compute polygon area (m²) and line length (m); points get an explicit
   `NOT_APPLICABLE` status; unsupported types get `UNSUPPORTED` — never a crash.
6. Persist file metadata + per-feature results in SQLite and expose them via REST.

## 2. Problem statement and use cases

GIS analysts routinely receive parcels, roads, and markers as KML exports or Shapefile
archives in WGS84 longitude/latitude. Naively applying planar area/length math to
degrees yields meaningless numbers. This API automates the correct pipeline —
CRS-aware transformation followed by projected measurement — and records every
decision (source CRS, measurement CRS, units, per-feature status) so results are
auditable.

Use cases: plot-area estimation, corridor-length checks, bulk validation of survey
deliverables, teaching CRS pitfalls.

## 3. Feature list

- `POST /api/files/` — multipart upload of `.kml` / `.zip` (Shapefile), size-limited,
  synchronously processed, stable JSON response.
- `GET /api/files/{id}/` — file metadata, source + measurement CRS, status, error summary.
- `GET /api/files/{id}/measurements/?limit=&offset=` — paginated feature measurements
  with GeoJSON geometry, properties, measurement value/unit/status.
- `DELETE /api/files/{id}/` — removes the dataset, its results, and the stored bytes.
- `GET /health`, `GET /ready` (DB connectivity) checks.
- Per-feature fault isolation: one bad geometry never aborts the dataset.
- ZIP-slip, archive-bomb, missing-CRS, and malformed-input protections.
- Consistent `{"error": {"code", "message", "request_id"}}` error responses.
- 52 automated tests (unit + integration), Ruff lint/format clean.

## 4. Technology stack

| Layer | Choice | Why |
|---|---|---|
| API | FastAPI + Uvicorn | Async-ready, automatic OpenAPI/Swagger, Pydantic v2 validation |
| Geodata I/O | GeoPandas + Pyogrio (GDAL) | Reads KML and Shapefiles, keeps CRS metadata |
| Geometry | Shapely | Inspection, `make_valid` repair, GeoJSON mapping |
| CRS | PyProj | CRS parsing, UTM estimation, `to_crs` transforms |
| DB | SQLAlchemy 2.x + SQLite | Zero-ops file-backed persistence, survives restarts |
| Migrations | Alembic (+ `create_all` bootstrap) | Versioned schema, `0001_initial` included |
| Tests | Pytest + HTTPX/TestClient | Real endpoint behaviour, isolated temp DB/storage |
| Lint | Ruff | `ruff check` + `ruff format` |

Python 3.11+ (developed and tested on 3.11; 3.12 compatible). No frontend, auth,
queues, or cloud services — deliberately out of scope.

## 5. Architecture

```
upload → routes.py → file_service.py ─┬─ geospatial_reader.py (parse + validate)
                                       ├─ crs_service.py (source CRS → measurement CRS)
                                       └─ measurement_service.py (area/length/status)
          file/feature repositories → SQLite (SQLAlchemy)
          GET endpoints read persisted rows only (no in-memory state)
```

Processing is **synchronous**: the `PROCESSING` row is committed before the expensive
work, then the final outcome is committed afterwards — no single long transaction,
no losable background job, bounded by the upload-size limit.

## 6. Project directory structure

```
spatial-file-measurement-api/
├── app/
│   ├── main.py                  # app factory, middleware, error handlers, /health /ready
│   ├── api/{routes.py,dependencies.py}
│   ├── core/{config.py,exceptions.py,logging.py}
│   ├── schemas/{files.py,measurements.py}
│   ├── models/{file_record.py,feature_record.py}
│   ├── services/{file_service.py,geospatial_reader.py,crs_service.py,measurement_service.py}
│   ├── repositories/{file_repository.py,feature_repository.py}
│   └── db/{base.py,session.py,migrations/{env.py,versions/0001_initial.py}}
├── tests/{conftest.py,unit/,integration/}
├── sample_data/{survey.kml,parcels.zip}
├── scripts/{generate_sample_data.py,init_db.py}
├── alembic.ini  compose.yaml  Dockerfile  LICENSE
├── requirements.txt  pyproject.toml  .env.example  README.md
```

## 7. Prerequisites

- Python 3.11+ with pip.
- Windows/macOS/Linux. GeoPandas + Shapely + PyProj + Pyogrio install from wheels
  (`pip install -r requirements.txt`); no system GDAL required on Windows. The
  Dockerfile installs `gdal-bin` for containerised runs.

## 8. Installation

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python scripts/init_db.py
```

## 9. Environment configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./spatial.db` | File-backed SQLite database |
| `STORAGE_DIR` | `./uploads` | Stored upload bytes (generated names) |
| `MAX_UPLOAD_BYTES` | `26214400` (25 MiB) | Upload cap → HTTP 413 |
| `MAX_ARCHIVE_ENTRIES` | `500` | ZIP entry cap (bomb protection) |
| `MAX_EXTRACTED_BYTES` | `209715200` (200 MiB) | Extracted-size cap |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

## 10. Database initialization and migrations

Tables auto-create on startup (`init_db()`), so a plain `uvicorn` run works. For
versioned migrations:

```bash
alembic upgrade head     # applies app/db/migrations/versions/0001_initial.py
```

## 11. Run the application

```bash
uvicorn app.main:app --reload
# or: docker compose up --build
```

## 12. Swagger UI

Open http://127.0.0.1:8000/docs for interactive Swagger UI (try the upload endpoint
with `sample_data/survey.kml`). ReDoc at `/redoc`, schema at `/openapi.json`.

## 13. Endpoints

### POST /api/files/ — upload and process

```bash
curl -X POST http://127.0.0.1:8000/api/files/ \
  -F "file=@sample_data/survey.kml"
curl -X POST http://127.0.0.1:8000/api/files/ \
  -F "file=@sample_data/parcels.zip"
```

Success (201):

```json
{
  "id": "00ed7ed7beda4bc6b42f9d118ca0b2b5",
  "filename": "survey.kml",
  "feature_count": 3,
  "crs": "EPSG:4326",
  "status": "COMPLETED",
  "created_at": "2026-10-10T06:44:37.188213"
}
```

### GET /api/files/{id}/ — file information

```bash
curl http://127.0.0.1:8000/api/files/<id>/
```

```json
{
  "id": "00ed7ed7beda4bc6b42f9d118ca0b2b5",
  "filename": "survey.kml",
  "feature_count": 3,
  "crs": "EPSG:4326",
  "measurement_crs": "EPSG:32643",
  "status": "COMPLETED",
  "created_at": "2026-10-10T06:44:37.188213",
  "error_summary": null
}
```

404 for unknown IDs.

### GET /api/files/{id}/measurements/ — feature measurements (paginated)

```bash
curl "http://127.0.0.1:8000/api/files/<id>/measurements/?limit=2&offset=0"
```

```json
{
  "file_id": "00ed7ed7beda4bc6b42f9d118ca0b2b5",
  "source_crs": "EPSG:4326",
  "measurement_crs": "EPSG:32643",
  "units": {"area": "m²", "length": "m"},
  "total": 3, "limit": 2, "offset": 0, "count": 2, "has_more": true,
  "features": [
    {
      "feature_id": 0,
      "geometry_type": "Polygon",
      "geometry": {"type": "Polygon", "coordinates": [...]},
      "properties": {"Name": "Survey Plot"},
      "measurement": {"type": "area", "value": 10902.05, "unit": "m²", "status": "COMPLETED"},
      "measurement_status": "COMPLETED",
      "error_details": null
    },
    {
      "feature_id": 2,
      "geometry_type": "Point",
      "properties": {"Name": "Gate Marker"},
      "measurement": null,
      "measurement_status": "NOT_APPLICABLE"
    }
  ]
}
```

`limit` 1–1000 (default 100), `offset` ≥ 0. `has_more` tells clients when to keep paging.

### DELETE /api/files/{id}/ and health checks

```bash
curl -X DELETE http://127.0.0.1:8000/api/files/<id>/
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

## 14. Error responses

All errors share the shape `{"error": {"code", "message", "request_id"}}` plus an
`X-Request-ID` response header:

| HTTP | Code | Trigger |
|---|---|---|
| 400 | `INVALID_FILE` | Bad extension inline, unsafe archive entry, empty upload |
| 404 | `NOT_FOUND` | Unknown file ID |
| 413 | `PAYLOAD_TOO_LARGE` | Upload over `MAX_UPLOAD_BYTES` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `.txt`, `.geojson`, etc. |
| 422 | `INVALID_GEODATA` | Malformed KML, corrupt ZIP, no `.shp` inside |
| 422 | `MISSING_CRS` | Shapefile without `.prj`/CRS (never guessed) |
| 500 | `INTERNAL_ERROR` | Unexpected failure (no stack trace leaked) |

## 15. CRS selection and measurement methodology

**Geographic vs projected, in one paragraph.** EPSG:4326 stores positions as angles
(degrees of longitude/latitude) on an ellipsoid. A "square degree" is not square and
its ground size varies with latitude, so planar formulas applied to degrees are
meaningless. Reliable area/length requires projecting coordinates onto a flat grid
with linear units (metres) first — at the cost that every projection distorts
something, somewhere, so the choice of projection bounds the accuracy.

Pipeline (`app/services/crs_service.py`):

1. Read source CRS from the file. KML is WGS84 lon/lat by specification, so a missing
   reader CRS defaults to EPSG:4326 (recorded); a Shapefile with no `.prj` is **rejected**
   with `MISSING_CRS` — guessing would be dishonest.
2. Metre-based projected source → measure in it directly.
3. Geographic source → estimate UTM from the dataset centroid (zone from longitude,
   EPSG:326xx north / 327xx south) for local extents (≤6° wide, ≤8° tall, latitude
   within 84°N / 80°S — the true UTM limits, since UPS covers the poles — and no
   antimeridian crossing). Zone 43 spans 72°E–78°E and zone 44 spans 78°E–84°E, so
   the Delhi sample (lon 77.0–77.002) correctly measures in EPSG:32643 while a
   Hyderabad dataset (~78.48°E) correctly measures in EPSG:32644.
4. Large / multi-zone / polar / antimeridian datasets → global equal-area EPSG:6933.
5. `GeoDataFrame.to_crs()` transforms every geometry; area/length come from projected
   Shapely math (m² / m). Invalid polygons are repaired with `make_valid` and the
   repair is recorded in `error_details` — never silent.

Tests prove the transform: raw degree-area of the Delhi sample is ~1e-6 while the
projected area is ~10,900 m² — the API could not have skipped reprojection.

## 16. File validation and security protections

- Extension allow-list (`.kml`, `.zip`); generated UUID storage names; client paths ignored.
- Chunked size enforcement → 413; per-file and total archive byte caps; entry-count cap.
- ZIP-slip normalisation + containment check; extraction confined to a temp dir that is
  always removed; only `*.shp` layers (plus sidecars) are read from validated contents.
- Malformed KML / corrupt ZIP → 4xx with safe messages; temp files cleaned; raw bytes
  never logged; SQLAlchemy parameterised access throughout.

## 17. Tests and linting

```bash
python -m pytest tests -q        # 52 tests: 27 unit + 25 integration
ruff check app tests
ruff format --check app tests
```

Coverage highlights: KML + Shapefile uploads, metadata, paginated measurements, area
(100×100 square, holes, multipolygons, invalid-polygon repair), length, points,
empty/null geometries, GeometryCollection `UNSUPPORTED`, per-feature isolation,
EPSG:4326 transformation proof, units, missing CRS, invalid KML/ZIP, bad extensions,
unknown IDs, size limits, ZIP traversal, persistence across sessions, error-shape
consistency. Tests use isolated temp SQLite DBs and storage — never real user data.

## 18. Design decisions and alternatives

- **FastAPI**: OpenAPI for free, Pydantic validation, easy testing with TestClient.
- **GeoPandas + Shapely + PyProj together**: GeoPandas for format I/O and `to_crs`,
  Shapely for per-geometry inspection/repair/measure, PyProj for CRS parsing and UTM
  logic — each does what it is best at.
- **KML via GDAL KML driver** (`read_file(..., driver="KML")`); **Shapefiles** by
  safe-extracting the ZIP then reading every `.shp` layer and concatenating (one
  geometry type per layer is a Shapefile format constraint, handled, not fought).
- **SQLite**: file-backed, zero-ops, survives restarts — sufficient for an assignment;
  Postgres would be the production swap (SQLAlchemy makes it a URL change).
- **Persist everything**: uploads are the system of record; GETs read rows, never memory.
- **Synchronous processing**: bounded by size limits, state committed before/after, no
  losable background tasks. For huge datasets: move to a durable queue (DB-backed job
  table + worker), stream features in chunks, add progress callbacks.
- **Pagination** (`limit`/`offset` + `total`/`has_more`) keeps large datasets transferable.

## 19. Learning outcomes

- Why degree coordinates must be projected before measurement, hands-on.
- UTM zone estimation and when equal-area projections are preferable.
- Defensive file handling: ZIP-slip, decompression bombs, CRS-less Shapefiles.
- Transaction discipline: commit processing state before expensive work.
- Per-feature fault isolation with honest status reporting.

## 20. Future scope

DB-backed background jobs with progress, GeoPackage/GeoJSON ingest, geodesic
(ellipsoidal) measurements as a cross-check, spatial indexing, auth/quotas, S3 storage,
tiling for very large datasets.

## 21. Known limitations

- Developed/tested on Python 3.11 (3.12-compatible code; CI matrix recommended).
- Projected planar measurements are approximations whose error grows with dataset
  extent — see §15; continental datasets use equal-area EPSG:6933 and lengths there
  are approximate.
- Multi-`.shp` archives are concatenated into one feature list (documented).
- KML network links / embedded resources are never fetched (treated as untrusted).
- `uploads/` and `spatial.db` are local artifacts (gitignored), not part of the repo.

## 22. GitHub submission

```bash
git init
git add .
git commit -m "Spatial File Measurement API: KML/Shapefile ingest, CRS-aware measurements, tests"
gh repo create spatial-file-measurement-api --public --source=. --push
# or: git remote add origin https://github.com/<you>/spatial-file-measurement-api.git
#     git branch -M main && git push -u origin main
```

Suggested repo description: “FastAPI service that ingests KML/Shapefile uploads,
computes CRS-correct area/length measurements, and serves paginated results.”

Suggested commit message: as above. Never commit `.env`, `uploads/`, `*.db`, or
customer data — `.gitignore` already excludes them. Regenerate samples any time with
`python scripts/generate_sample_data.py`.

## License

MIT — see [LICENSE](LICENSE).
