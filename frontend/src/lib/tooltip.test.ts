import { describe, expect, it } from "vitest";
import type { FeatureMeasurement } from "./api";
import { buildFeatureTooltipHtml, escapeHtml } from "./tooltip";

function feat(partial: Partial<FeatureMeasurement> & { feature_id: number }): FeatureMeasurement {
  return {
    geometry_type: "Polygon",
    geometry: { type: "Polygon", coordinates: [] },
    properties: {},
    measurement: null,
    measurement_status: "COMPLETED",
    error_details: null,
    components: null,
    parts: null,
    ...partial,
  };
}

describe("escapeHtml", () => {
  it("neutralizes markup in untrusted names", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("A&B's")).toBe("A&amp;B&#39;s");
  });
});

describe("buildFeatureTooltipHtml", () => {
  it("shows polygon area with units (survey plot)", () => {
    const html = buildFeatureTooltipHtml(
      feat({
        feature_id: 0,
        geometry_type: "Polygon",
        properties: { Name: "Survey Plot" },
        measurement: { type: "area", value: 10902.0514, unit: "m²", status: "COMPLETED" },
      }),
    );
    expect(html).toContain("Survey Plot");
    expect(html).toContain("#0");
    expect(html).toContain("Polygon");
    expect(html).toContain("10,902.05 m²");
    expect(html).toContain("COMPLETED");
  });

  it("shows line length with units (road)", () => {
    const html = buildFeatureTooltipHtml(
      feat({
        feature_id: 1,
        geometry_type: "LineString",
        properties: { Name: "Access Road" },
        measurement: { type: "length", value: 196.42, unit: "m", status: "COMPLETED" },
      }),
    );
    expect(html).toContain("Access Road");
    expect(html).toContain("LineString");
    expect(html).toContain("196.42 m");
  });

  it("shows Not applicable for points", () => {
    const html = buildFeatureTooltipHtml(
      feat({
        feature_id: 2,
        geometry_type: "Point",
        properties: { Name: "Gate Marker" },
        measurement: null,
        measurement_status: "NOT_APPLICABLE",
      }),
    );
    expect(html).toContain("Gate Marker");
    expect(html).toContain("Not applicable");
    expect(html).not.toContain(">0<");
  });

  it("falls back to Unnamed feature and shows failure status + error", () => {
    const html = buildFeatureTooltipHtml(
      feat({
        feature_id: 5,
        geometry_type: "GeometryCollection",
        properties: {},
        measurement: null,
        measurement_status: "UNSUPPORTED",
        error_details: "Unsupported geometry type: GeometryCollection",
      }),
    );
    expect(html).toContain("Unnamed feature");
    expect(html).toContain("UNSUPPORTED");
    expect(html).toContain("Unsupported geometry type: GeometryCollection");
  });

  it("escapes hostile property values", () => {
    const html = buildFeatureTooltipHtml(
      feat({ feature_id: 0, properties: { Name: '<img src=x onerror="1">' } }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("lists PARTIAL components with their own values", () => {
    const html = buildFeatureTooltipHtml(
      feat({
        feature_id: 5,
        geometry_type: "GeometryCollection",
        properties: { Name: "Mixed Bag" },
        measurement: null,
        measurement_status: "PARTIAL",
        error_details: null,
        components: [
          {
            geometry_type: "Point",
            measurement_type: null,
            measurement_value: null,
            measurement_unit: null,
            measurement_status: "NOT_APPLICABLE",
            error_details: null,
          },
          {
            geometry_type: "LineString",
            measurement_type: "length",
            measurement_value: 97.84,
            measurement_unit: "m",
            measurement_status: "COMPLETED",
            error_details: null,
          },
        ],
      }),
    );
    expect(html).toContain("Mixed Bag");
    expect(html).toContain("PARTIAL");
    expect(html).toContain("1 of 2 parts measured");
    expect(html).toContain("LineString: 97.84 m");
    expect(html).toContain("Point: not applicable");
  });
});
