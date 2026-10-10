import { useState } from "react";
import { MapPin, Maximize2 } from "lucide-react";
import type { FeatureMeasurement } from "../lib/api";
import { FeatureMap } from "./FeatureMap";
import { Alert, Button, Card, CardBody, CardHeader, Spinner } from "./ui";

interface Props {
  title: string;
  subtitle?: string;
  features: FeatureMeasurement[];
  totalCount: number | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  selectedId: number | null;
  onSelect: (f: FeatureMeasurement) => void;
  emptyHint: string;
}

/** Reusable map card: one Leaflet instance, reset-view action, full state handling. */
export function MapCard({
  title,
  subtitle,
  features,
  totalCount,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
  emptyHint,
}: Props) {
  const [fitSignal, setFitSignal] = useState(0);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <MapPin className="h-4 w-4 text-emerald-600" aria-hidden />
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {totalCount !== null && (
            <span className="text-xs text-slate-500" aria-live="polite">
              {features.length} of {totalCount} features plotted
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || features.length === 0}
            onClick={() => setFitSignal((s) => s + 1)}
            aria-label="Reset map view to fit all features"
            title="Reset map view to fit all features"
          >
            <Maximize2 className="h-4 w-4" aria-hidden /> Reset view
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        {loading && features.length === 0 ? (
          <div className="flex h-80 items-center justify-center">
            <Spinner label="Loading map geometries" />
          </div>
        ) : error && features.length === 0 ? (
          <Alert tone="error" title="Could not load map data">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{error} Check the connection and try again.</span>
              {onRetry && (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              )}
            </div>
          </Alert>
        ) : features.length === 0 ? (
          <div className="flex h-80 items-center justify-center rounded-xl bg-slate-50 px-6 text-center text-sm text-slate-500">
            {emptyHint}
          </div>
        ) : (
          <FeatureMap
            features={features}
            selectedId={selectedId}
            onSelect={onSelect}
            fitSignal={fitSignal}
          />
        )}
      </CardBody>
    </Card>
  );
}
