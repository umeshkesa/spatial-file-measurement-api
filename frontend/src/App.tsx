import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Database,
  FileUp,
  Globe2,
  LayoutDashboard,
  Map as MapIcon,
  Satellite,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { Dashboard } from "./components/Dashboard";
import { FeatureMap } from "./components/FeatureMap";
import { MeasurementTable } from "./components/MeasurementTable";
import { UploadPanel } from "./components/UploadPanel";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Spinner } from "./components/ui";
import { cn } from "./lib/cn";
import {
  API_BASE_URL,
  deleteFile,
  describeError,
  getFileInfo,
  getMeasurements,
  type FeatureMeasurement,
  type FileInfo,
  type FileUploadResult,
  type MeasurementsPage,
} from "./lib/api";
import { featureDisplayName, formatMeasurement } from "./lib/format";

type View = "dashboard" | "upload" | "map" | "table";

const NAV: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" aria-hidden /> },
  { id: "upload", label: "Upload", icon: <FileUp className="h-4 w-4" aria-hidden /> },
  { id: "map", label: "Map", icon: <MapIcon className="h-4 w-4" aria-hidden /> },
  { id: "table", label: "Measurements", icon: <Table2 className="h-4 w-4" aria-hidden /> },
];

const PAGE_SIZE = 25;

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [uploads, setUploads] = useState<FileUploadResult[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [page, setPage] = useState<MeasurementsPage | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/health`)
      .then((r) => setBackendUp(r.ok))
      .catch(() => setBackendUp(false));
  }, []);

  const loadFile = useCallback(
    async (id: string, pageLimit: number, offset: number) => {
      setFileLoading(true);
      setPageLoading(true);
      setSelectedId(null);
      try {
        const info = await getFileInfo(id);
        setFileInfo(info);
        const pg = await getMeasurements(id, pageLimit, offset);
        setPage(pg);
      } catch (err) {
        setBanner(describeError(err));
      } finally {
        setFileLoading(false);
        setPageLoading(false);
      }
    },
    [],
  );

  const handleUploaded = useCallback(
    (result: FileUploadResult) => {
      setUploads((prev) =>
        prev.some((u) => u.id === result.id) ? prev : [result, ...prev],
      );
      setActiveId(result.id);
      setBanner(null);
      setView("dashboard");
      void loadFile(result.id, limit, 0);
    },
    [loadFile, limit],
  );

  const selectUpload = useCallback(
    (id: string) => {
      setActiveId(id);
      setBanner(null);
      void loadFile(id, limit, 0);
    },
    [loadFile, limit],
  );

  const changePage = useCallback(
    (nextLimit: number, offset: number) => {
      if (!activeId) return;
      setLimit(nextLimit);
      setPageLoading(true);
      getMeasurements(activeId, nextLimit, offset)
        .then((pg) => {
          setPage(pg);
          setSelectedId(null);
        })
        .catch((err: unknown) => setBanner(describeError(err)))
        .finally(() => setPageLoading(false));
    },
    [activeId],
  );

  const handleDelete = useCallback(async () => {
    if (!activeId) return;
    if (!window.confirm("Delete this dataset and its stored results?")) return;
    try {
      await deleteFile(activeId);
      setUploads((prev) => prev.filter((u) => u.id !== activeId));
      setActiveId(null);
      setFileInfo(null);
      setPage(null);
      setBanner(null);
    } catch (err) {
      setBanner(describeError(err));
    }
  }, [activeId]);

  const selectedFeature: FeatureMeasurement | null = useMemo(
    () => page?.features.find((f) => f.feature_id === selectedId) ?? null,
    [page, selectedId],
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col bg-slate-900 text-slate-200 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <Satellite className="h-6 w-6 text-emerald-400" aria-hidden />
          <div>
            <p className="text-lg font-bold text-white">SpatialLens</p>
            <p className="text-xs text-slate-400">Geospatial measurement analytics</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1 px-3" aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                view === item.id
                  ? "bg-emerald-600 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-5 py-4 text-xs text-slate-500">
          <p className="flex items-center gap-1">
            <Globe2 className="h-3.5 w-3.5" aria-hidden /> API: {API_BASE_URL}
          </p>
          <p className="mt-1 flex items-center gap-1">
            <Database className="h-3.5 w-3.5" aria-hidden />
            {backendUp === null ? "Checking backend…" : backendUp ? "Backend reachable" : "Backend unreachable"}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-3 bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 sm:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <Satellite className="h-5 w-5 text-emerald-600" aria-hidden />
            <span className="font-bold">SpatialLens</span>
          </div>
          <nav className="flex items-center gap-1 md:hidden" aria-label="Primary mobile">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? "page" : undefined}
                className={cn(
                  "rounded-lg p-2",
                  view === item.id ? "bg-emerald-100 text-emerald-800" : "text-slate-500",
                )}
                title={item.label}
                aria-label={item.label}
              >
                {item.icon}
              </button>
            ))}
          </nav>
          <p className="hidden text-sm text-slate-500 md:block">
            Upload KML or Shapefile archives — area in m², length in m, CRS-correct.
          </p>
          {fileInfo && (
            <div className="flex items-center gap-2">
              <span className="hidden max-w-48 truncate text-sm text-slate-600 sm:block">
                {fileInfo.filename}
              </span>
              <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </Button>
            </div>
          )}
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6">
          {backendUp === false && (
            <Alert title="Backend unreachable">
              Cannot reach the API at <code>{API_BASE_URL}</code>. Start it with{" "}
              <code>uvicorn app.main:app --reload</code> from the repository root, then reload
              this page.
            </Alert>
          )}
          {banner && (
            <Alert title="Something went wrong">
              <div className="flex items-start justify-between gap-2">
                <span>{banner}</span>
                <button
                  onClick={() => setBanner(null)}
                  aria-label="Dismiss error"
                  className="rounded p-1 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </Alert>
          )}

          {view === "dashboard" && (
            <section aria-label="Dashboard">
              {fileLoading && !fileInfo ? (
                <Spinner label="Loading file" />
              ) : fileInfo ? (
                <Dashboard file={fileInfo} page={page} sessionUploads={uploads.length} />
              ) : (
                <EmptyState
                  icon={<LayoutDashboard className="h-10 w-10" aria-hidden />}
                  title="No dataset selected"
                  hint="Upload a .kml file or .zip Shapefile archive to see feature counts, area/length totals, and CRS details here."
                />
              )}
              {uploads.length > 0 && (
                <Card className="mt-6">
                  <CardHeader>
                    <h2 className="font-semibold">Session uploads</h2>
                    <p className="text-xs text-slate-500">
                      Files uploaded from this browser session. The API has no list
                      endpoint, so history is session-local.
                    </p>
                  </CardHeader>
                  <CardBody>
                    <ul className="divide-y divide-slate-100">
                      {uploads.map((u) => (
                        <li key={u.id}>
                          <button
                            onClick={() => selectUpload(u.id)}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm",
                              "hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                              activeId === u.id && "bg-emerald-50",
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{u.filename}</span>
                              <span className="block truncate font-mono text-xs text-slate-500">
                                {u.id} · {u.feature_count} features · {u.crs ?? "unknown CRS"}
                              </span>
                            </span>
                            <Badge status={u.status}>{u.status.replaceAll("_", " ")}</Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}
            </section>
          )}

          {view === "upload" && (
            <section aria-label="Upload">
              <Card>
                <CardHeader>
                  <h2 className="font-semibold">Upload a geospatial file</h2>
                  <p className="text-xs text-slate-500">
                    Results come from the live POST /api/files/ endpoint — nothing is
                    fabricated.
                  </p>
                </CardHeader>
                <CardBody>
                  <UploadPanel
                    onUploaded={handleUploaded}
                    onError={(m) => setBanner(m)}
                  />
                </CardBody>
              </Card>
            </section>
          )}

          {view === "map" && (
            <section aria-label="Map" className="space-y-4">
              {!fileInfo ? (
                <EmptyState
                  icon={<MapIcon className="h-10 w-10" aria-hidden />}
                  title="No geometries to show"
                  hint="Upload a dataset first — its polygons, lines, and points will render here on an OpenStreetMap basemap."
                />
              ) : (
                <>
                  <Card>
                    <CardBody>
                      {pageLoading && !page ? (
                        <Spinner label="Loading geometries" />
                      ) : (
                        <FeatureMap
                          features={page?.features ?? []}
                          selectedId={selectedId}
                          onSelect={(f) => setSelectedId(f.feature_id)}
                        />
                      )}
                    </CardBody>
                  </Card>
                  {selectedFeature && (
                    <Card>
                      <CardHeader>
                        <h2 className="font-semibold">
                          Selected: {featureDisplayName(selectedFeature)}
                        </h2>
                      </CardHeader>
                      <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Geometry</p>
                          <p>{selectedFeature.geometry_type}</p>
                          <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">
                            Measurement
                          </p>
                          <p className="font-medium">{formatMeasurement(selectedFeature)}</p>
                          <p className="mt-1">
                            <Badge status={selectedFeature.measurement_status}>
                              {selectedFeature.measurement_status.replaceAll("_", " ")}
                            </Badge>
                          </p>
                          {selectedFeature.error_details && (
                            <p className="mt-1 text-xs text-amber-700">
                              {selectedFeature.error_details}
                            </p>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            Properties
                          </p>
                          <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">
                            {JSON.stringify(selectedFeature.properties ?? {}, null, 2)}
                          </pre>
                        </div>
                      </CardBody>
                    </Card>
                  )}
                </>
              )}
            </section>
          )}

          {view === "table" && (
            <section aria-label="Measurements">
              {!fileInfo ? (
                <EmptyState
                  icon={<Table2 className="h-10 w-10" aria-hidden />}
                  title="No measurements yet"
                  hint="Upload a dataset to browse per-feature measurements from the live GET measurements endpoint."
                />
              ) : (
                <Card>
                  <CardHeader>
                    <h2 className="font-semibold">Feature measurements</h2>
                    <p className="text-xs text-slate-500">
                      Source {fileInfo.crs ?? "unknown"} → measured in{" "}
                      {fileInfo.measurement_crs ?? "—"}. Click a row to highlight it.
                    </p>
                  </CardHeader>
                  <CardBody>
                    <MeasurementTable
                      page={page}
                      loading={pageLoading}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      onPage={changePage}
                    />
                  </CardBody>
                </Card>
              )}
            </section>
          )}

          {fileInfo?.status === "FAILED" && (
            <Alert tone="warning" title="Processing failed">
              {fileInfo.error_summary ?? "The file could not be processed."}{" "}
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" aria-hidden /> Try a different file.
              </span>
            </Alert>
          )}
        </main>

        <footer className="px-6 py-4 text-center text-xs text-slate-400">
          SpatialLens · measurements by the Spatial File Measurement API · geometries rendered
          as longitude/latitude
        </footer>
      </div>
    </div>
  );
}
