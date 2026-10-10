/** Typed client for the Spatial File Measurement API. No secrets, no mocks. */

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

/** Backend upload cap (25 MiB) mirrored for client-side pre-validation. */
export const MAX_UPLOAD_BYTES = 26_214_400;
export const ALLOWED_EXTENSIONS = [".kml", ".zip"] as const;

export interface FileUploadResult {
  id: string;
  filename: string;
  feature_count: number;
  crs: string | null;
  status: string;
  created_at: string;
}

export interface FileInfo {
  id: string;
  filename: string;
  feature_count: number;
  crs: string | null;
  measurement_crs: string | null;
  status: string;
  created_at: string;
  error_summary: string | null;
}

export interface MeasurementDetail {
  type: string;
  value: number | null;
  unit: string;
  status: string;
}

export type GeometryObject = {
  type: string;
  coordinates?: unknown;
  geometries?: GeometryObject[];
} | null;

export interface ComponentMeasurement {
  geometry_type: string;
  measurement_type: string | null;
  measurement_value: number | null;
  measurement_unit: string | null;
  measurement_status: string;
  error_details: string | null;
}

export interface FeatureMeasurement {
  feature_id: number;
  geometry_type: string;
  geometry: GeometryObject;
  properties: Record<string, unknown>;
  measurement: MeasurementDetail | null;
  measurement_status: string;
  error_details: string | null;
  /** Per-component breakdown for GeometryCollection features (PARTIAL); otherwise null. */
  components: ComponentMeasurement[] | null;
}

export interface MeasurementsPage {
  file_id: string;
  source_crs: string | null;
  measurement_crs: string | null;
  units: Record<string, string>;
  total: number;
  limit: number;
  offset: number;
  count: number;
  has_more: boolean;
  features: FeatureMeasurement[];
}

export interface ApiErrorBody {
  code: string;
  message: string;
  request_id?: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code || "UNKNOWN";
    this.requestId = body.request_id;
  }
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  const fallback: ApiErrorBody = {
    code: res.status === 404 ? "NOT_FOUND" : "REQUEST_FAILED",
    message: `Request failed with status ${res.status}`,
  };
  try {
    const data = (await res.json()) as { error?: ApiErrorBody };
    if (data?.error) return new ApiError(res.status, data.error);
  } catch {
    /* non-JSON body */
  }
  return new ApiError(res.status, fallback);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (err) {
    throw new Error(
      `Cannot reach the API at ${API_BASE_URL}. Is the backend running? (${String(err)})`,
    );
  }
  if (!res.ok) throw await parseErrorResponse(res);
  return (await res.json()) as T;
}

export function uploadFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<FileUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.open("POST", `${API_BASE_URL}/api/files/`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText || "{}") as
          | FileUploadResult
          | { error: ApiErrorBody };
        if (xhr.status === 201) {
          if (onProgress) onProgress(100);
          resolve(body as FileUploadResult);
        } else if ("error" in body && body.error) {
          reject(new ApiError(xhr.status, body.error));
        } else {
          reject(new ApiError(xhr.status, { code: "REQUEST_FAILED", message: xhr.statusText }));
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Invalid upload response"));
      }
    };
    xhr.onerror = () =>
      reject(new Error(`Cannot reach the API at ${API_BASE_URL}. Is the backend running?`));
    xhr.send(form);
  });
}

export const getFileInfo = (id: string) => request<FileInfo>(`/api/files/${encodeURIComponent(id)}/`);

export const getMeasurements = (id: string, limit: number, offset: number) =>
  request<MeasurementsPage>(
    `/api/files/${encodeURIComponent(id)}/measurements/?limit=${limit}&offset=${offset}`,
  );

export const deleteFile = (id: string) =>
  request<{ id: string; deleted: boolean }>(`/api/files/${encodeURIComponent(id)}/`, {
    method: "DELETE",
  });

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function validateClientFile(file: File): string | null {
  const ext = extensionOf(file.name);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Unsupported file type "${ext || "(none)"}". Upload a .kml file or a .zip Shapefile archive.`;
  }
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `File is ${(file.size / 1048576).toFixed(1)} MB, above the ${(MAX_UPLOAD_BYTES / 1048576).toFixed(0)} MB limit.`;
  }
  return null;
}

/** Human message for an upload/processing failure. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "PAYLOAD_TOO_LARGE":
        return "Upload exceeds the server size limit. Try a smaller file.";
      case "UNSUPPORTED_MEDIA_TYPE":
        return "Unsupported file type. Upload a .kml file or a .zip Shapefile archive.";
      case "INVALID_GEODATA":
        return `The file could not be read as geospatial data: ${err.message}`;
      case "MISSING_CRS":
        return `Missing coordinate system: ${err.message}`;
      case "NOT_FOUND":
        return "The requested file no longer exists on the server.";
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : "An unexpected error occurred.";
}
