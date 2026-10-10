import { useCallback, useRef, useState } from "react";
import { FileUp, Loader2, UploadCloud } from "lucide-react";
import { describeError, uploadFile, validateClientFile, type FileUploadResult } from "../lib/api";
import { Alert, Button, ProgressBar } from "./ui";
import { cn } from "../lib/cn";

interface Props {
  onUploaded: (result: FileUploadResult) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export function UploadPanel({ onUploaded, onError, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const startUpload = useCallback(
    async (file: File) => {
      const problem = validateClientFile(file);
      if (problem) {
        setLocalError(problem);
        onError(problem);
        return;
      }
      setLocalError(null);
      setBusy(true);
      setProgress(0);
      try {
        const result = await uploadFile(file, setProgress);
        onUploaded(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed.";
        // Surface friendly backend-aware text via describeError in App; keep raw too.
        setLocalError(message);
        onError(describeError(err));
      } finally {
        setBusy(false);
      }
    },
    [onUploaded, onError],
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a KML or Shapefile ZIP"
        aria-disabled={busy || disabled}
        onClick={() => !busy && !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy && !disabled) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy && !disabled) void startUpload(f);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
          dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 bg-white hover:border-emerald-400",
          (busy || disabled) && "cursor-wait opacity-80",
        )}
      >
        {busy ? (
          <Loader2 className="h-10 w-10 animate-spin text-emerald-600" aria-hidden />
        ) : dragging ? (
          <FileUp className="h-10 w-10 text-emerald-600" aria-hidden />
        ) : (
          <UploadCloud className="h-10 w-10 text-slate-400" aria-hidden />
        )}
        <div>
          <p className="font-semibold text-slate-700">
            {busy ? "Uploading and processing…" : "Drag & drop a file here, or click to browse"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Accepts <code>.kml</code> and <code>.zip</code> Shapefile archives (max 25 MB)
          </p>
        </div>
        {busy && (
          <div className="w-full max-w-xs">
            <ProgressBar value={progress} />
            <p className="mt-1 text-xs text-slate-500" aria-live="polite">
              {progress}% uploaded — the server is extracting and measuring features.
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".kml,.zip"
          className="hidden"
          disabled={busy || disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void startUpload(f);
          }}
        />
      </div>
      {localError && !busy && (
        <div className="mt-3">
          <Alert title="Upload problem">{localError}</Alert>
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button variant="secondary" size="sm" disabled={busy || disabled} onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
      </div>
    </div>
  );
}
