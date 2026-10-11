import { expect, test, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "sample_data");

async function upload(page: Page, filename: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Upload", exact: true }).first().click();
  await page.locator('input[type="file"]').setInputFiles(join(SAMPLES, filename), { force: true });
  await expect(page.getByText(filename).first()).toBeVisible({ timeout: 30000 });
}

async function downloadText(page: Page, buttonName: RegExp): Promise<string> {
  const download = page.waitForEvent("download", { timeout: 30000 });
  await page.getByRole("button", { name: buttonName }).click();
  const path = await (await download).path();
  if (!path) throw new Error("download produced no file");
  const { readFileSync } = await import("node:fs");
  return readFileSync(path, "utf-8");
}

test("multipart_shapes.zip: MultiPoint point count, coordinates, exports", async ({ page }) => {
  await upload(page, "multipart_shapes.zip");

  await page.getByRole("button", { name: "Measurements", exact: true }).first().click();
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /Survey Pegs/ })).toBeVisible({ timeout: 15000 });
  await expect(table.locator("tbody tr")).toHaveCount(3);

  // Point Count column is the 10th cell: MultiPoint -> 3, others -> —.
  const pegs = table.getByRole("row", { name: /Survey Pegs/ });
  await expect(pegs.locator("td").nth(9)).toHaveText("3");
  await expect(pegs).toContainText("NOT APPLICABLE");
  await expect(table.getByRole("row", { name: /Twin Lakes/ }).locator("td").nth(9)).toHaveText("—");
  await expect(table.getByRole("row", { name: /Ring Road/ }).locator("td").nth(9)).toHaveText("—");

  // Existing polygon/line measurements unchanged: Twin Lakes has an area, Ring Road a length.
  const lakes = table.getByRole("row", { name: /Twin Lakes/ });
  await expect(lakes).toContainText("COMPLETED");
  await expect(table.getByRole("row", { name: /Ring Road/ })).toContainText("COMPLETED");

  // Row click selects the feature; the details panel shows point count + coordinates.
  await pegs.click();
  await expect(page.getByText("Selected: Survey Pegs")).toBeVisible();
  const details = page.getByLabel("Selected feature details");
  await expect(details.getByText("Point count")).toBeVisible();
  await details.getByText(/Coordinates \(3 points\)/).click();
  const coords = page.locator("text=Longitude (°)").locator("xpath=ancestor::table[1]");
  await expect(coords.locator("tbody tr")).toHaveCount(3);
  await expect(coords).toContainText("77.001");
  await expect(coords).toContainText("28.001");

  // Feature CSV gains point_count; Survey Pegs keeps one row with count 3.
  const csv = await downloadText(page, /Export all measurements as CSV/);
  const lines = csv.split("\r\n").filter((l) => l.length > 0);
  expect(lines).toHaveLength(4); // header + 3 features
  expect(lines[0].split(",").slice(-1)[0]).toBe("point_count");
  const pegLine = lines.find((l) => l.includes("Survey Pegs"));
  expect(pegLine).toBeDefined();
  expect(pegLine!.split(",").slice(-1)[0]).toBe("3");
  expect(pegLine).toContain("NOT_APPLICABLE");

  // Per-point coordinate CSV: one row per stored point, indexed, with CRS.
  const pointsCsv = await downloadText(page, /Export point coordinates as CSV/);
  const plines = pointsCsv.split("\r\n").filter((l) => l.length > 0);
  expect(plines[0]).toBe(
    "file_id,filename,feature_id,feature_name,geometry_type,point_index,x,y,crs",
  );
  const pegRows = plines.filter((l) => l.includes("Survey Pegs"));
  expect(pegRows).toHaveLength(3);
  expect(pegRows.map((l) => l.split(",")[5])).toEqual(["0", "1", "2"]);
  for (const r of pegRows) expect(r).toContain("EPSG:4326");

  // JSON export carries point_count per feature.
  const jsonText = await downloadText(page, /Export all measurements as JSON/);
  const doc = JSON.parse(jsonText) as {
    features: Array<{ feature_name: string; point_count: number | null }>;
  };
  const pegJson = doc.features.find((f) => f.feature_name === "Survey Pegs");
  expect(pegJson?.point_count).toBe(3);
  expect(doc.features.find((f) => f.feature_name === "Twin Lakes")?.point_count).toBeNull();
});

test("multipart_shapes.zip: Twin Lakes polygon parts sum to the combined area", async ({ page }) => {
  await upload(page, "multipart_shapes.zip");

  await page.getByRole("button", { name: "Measurements", exact: true }).first().click();
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /Twin Lakes/ })).toBeVisible({ timeout: 15000 });

  // Parts column is the 11th cell: multis show counts, single types show —.
  await expect(table.getByRole("row", { name: /Twin Lakes/ }).locator("td").nth(10)).toHaveText("2");
  await expect(table.getByRole("row", { name: /Ring Road/ }).locator("td").nth(10)).toHaveText("2");
  await expect(table.getByRole("row", { name: /Survey Pegs/ }).locator("td").nth(10)).toHaveText("—");

  // Combined feature area unchanged; expandable Polygon Parts list the parts.
  const lakes = table.getByRole("row", { name: /Twin Lakes/ });
  await expect(lakes).toContainText("21,805.18");
  await lakes.click();
  const details = page.getByLabel("Selected feature details");
  await expect(details.getByText("Polygon Parts (2)")).toBeVisible();
  await expect(details.getByText("Part 1", { exact: true })).toBeVisible();
  await expect(details.getByText("Part 2", { exact: true })).toBeVisible();

  // Selecting a part keeps the parent selected (map highlight stays on Twin Lakes).
  await details.getByText("Part 1", { exact: true }).click();
  await expect(page.getByText("Selected: Twin Lakes")).toBeVisible();

  // Parts CSV: 2 lake parts + 2 road parts; lake parts sum to the combined area.
  const partsCsv = await downloadText(page, /Export multipart part measurements as CSV/);
  const plines = partsCsv.split("\r\n").filter((l) => l.length > 0);
  expect(plines).toHaveLength(5); // header + 4 parts
  const lakeParts = plines.filter((l) => l.includes("Twin Lakes"));
  expect(lakeParts).toHaveLength(2);
  expect(lakeParts[0]).toContain("Part 1");
  expect(lakeParts[1]).toContain("Part 2");
  const valueIdx = plines[0].split(",").indexOf("measurement_value");
  const partSum = lakeParts.reduce((s, l) => s + Number(l.split(",")[valueIdx]), 0);

  const csv = await downloadText(page, /Export all measurements as CSV/);
  const flines = csv.split("\r\n").filter((l) => l.length > 0);
  const combined = Number(
    flines.find((l) => l.includes("Twin Lakes"))!.split(",")[flines[0].split(",").indexOf("measurement_value")],
  );
  expect(Math.abs(partSum - combined)).toBeLessThanOrEqual(1e-6 * combined);

  // JSON export carries the structured parts array; combined value untouched.
  const jsonText = await downloadText(page, /Export all measurements as JSON/);
  const doc = JSON.parse(jsonText) as {
    features: Array<{
      feature_name: string;
      measurement: { value: number } | null;
      parts: Array<{ part_index: number; measurement_value: number }> | null;
    }>;
  };
  const lakesJson = doc.features.find((f) => f.feature_name === "Twin Lakes")!;
  expect(lakesJson.parts).toHaveLength(2);
  expect(lakesJson.parts!.map((p) => p.part_index)).toEqual([0, 1]);
  const jsonSum = lakesJson.parts!.reduce((s, p) => s + p.measurement_value, 0);
  expect(Math.abs(jsonSum - lakesJson.measurement!.value)).toBeLessThanOrEqual(
    1e-6 * lakesJson.measurement!.value,
  );
  expect(
    doc.features.find((f) => f.feature_name === "Survey Pegs")!.parts,
  ).toBeNull();
});
