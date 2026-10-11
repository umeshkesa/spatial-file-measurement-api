import { useState } from "react";
import { Download, FileJson, FileSpreadsheet, Loader2 } from "lucide-react";
import type { FeatureMeasurement, FileInfo } from "../lib/api";
import { describeError } from "../lib/api";
import {
  buildCsv,
  buildJsonExport,
  buildPartsCsv,
  buildPointsCsv,
  downloadTextFile,
  exportFilename,
  fetchAllMeasurements,
} from "../lib/export";
import { Alert, Button } from "./ui";

interface Props {
  file: FileInfo;
  units: Record<string, string>;
  /** Already-fetched full feature list; when absent the panel fetches all pages itself. */
  cachedFeatures: FeatureMeasurement[] | null;
  disabled?: boolean;
}

export function ExportPanel({ file, units, cachedFeatures, disabled }: Props) {
  const [busy, setBusy] = useState<"csv" | "json" | "points" | "parts" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runExport = async (kind: "csv" | "json" | "points" | "parts") => {
    setBusy(kind);
    setError(null);
    setProgress("Starting…");
    try {
      const bundle =
        cachedFeatures !== null
          ? { file, units, features: cachedFeatures }
          : await fetchAllMeasurements(file.id, file, (loaded, total) =>
              setProgress(
                total !== null ? `Loaded ${loaded} of ${total}…` : `Loaded ${loaded}…`,
              ),
            );
      const date = new Date();
      if (kind === "csv") {
        downloadTextFile(buildCsv(bundle), "text/csv", exportFilename(file.filename, "csv", date));
      } else if (kind === "points") {
        downloadTextFile(
          buildPointsCsv(bundle),
          "text/csv",
          exportFilename(file.filename, "csv", date, "point_coordinates"),
        );
      } else if (kind === "parts") {
        downloadTextFile(
          buildPartsCsv(bundle),
          "text/csv",
          exportFilename(file.filename, "csv", date, "multipart_parts"),
        );
      } else {
        downloadTextFile(
          buildJsonExport(bundle),
          "application/json",
          exportFilename(file.filename, "json", date),
        );
      }
      setProgress(null);
    } catch (err) {
      // No partial file is written: the download only starts after all pages succeed.
      setError(describeError(err));
      setProgress(null);
    } finally {
      setBusy(null);
    }
  };

  const off = disabled || busy !== null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={off}
          onClick={() => void runExport("csv")}
          aria-label="Export all measurements as CSV"
        >
          {busy === "csv" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          )}
          Export CSV
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={off}
          onClick={() => void runExport("json")}
          aria-label="Export all measurements as JSON"
        >
          {busy === "json" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileJson className="h-4 w-4" aria-hidden />
          )}
          Export JSON
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={off}
          onClick={() => void runExport("points")}
          aria-label="Export point coordinates as CSV"
        >
          {busy === "points" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          )}
          Export point coordinates
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={off}
          onClick={() => void runExport("parts")}
          aria-label="Export multipart part measurements as CSV"
        >
          {busy === "parts" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          )}
          Export multipart parts
        </Button>
        {busy && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500" aria-live="polite">
            <Download className="h-3.5 w-3.5" aria-hidden />
            {progress ?? "Working…"} Exports cover every page, not just the visible rows.
          </span>
        )}
      </div>
      {error && (
        <Alert tone="error" title="Export failed — no file was downloaded">
          {error}
        </Alert>
      )}
    </div>
  );
}
