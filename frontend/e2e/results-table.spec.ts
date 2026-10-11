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

test("geometry_catalog.kml: feature-wise results, search, export", async ({ page }) => {
  await upload(page, "geometry_catalog.kml");

  // Dashboard: Total cards equal the eligible individuals; feature table present.
  await expect(page.getByText("Total polygon area")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("98,115.93").first()).toBeVisible();
  await expect(page.getByText("Total line length")).toBeVisible();
  await expect(page.getByText("315.23").first()).toBeVisible();
  await expect(page.getByText("Feature-wise measurement results")).toBeVisible();
  await expect(page.getByText("Land 1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Broken Outline").first()).toBeVisible();

  await page.getByRole("button", { name: "Measurements", exact: true }).first().click();
  const table = page.getByRole("table");

  // All seven features represented, with Land labels on the four polygons.
  await expect(table.getByRole("row", { name: /Simple Park/ })).toBeVisible({ timeout: 15000 });
  expect(await table.getByText("Land 1", { exact: true }).count()).toBeGreaterThan(0);
  expect(await table.getByText("Land 4", { exact: true }).count()).toBeGreaterThan(0);

  // Courtyard area with hectare conversion (32703.36 m² ≈ 3.2703 ha).
  const courtyard = table.getByRole("row", { name: /Building With Courtyard/ });
  await expect(courtyard).toContainText("32,703.36");
  await expect(courtyard).toContainText("3.2703");

  // Mixed Bag: PARTIAL with empty single value; Broken Outline: FAILED + reason.
  await expect(table.getByRole("row", { name: /Mixed Bag/ })).toContainText("PARTIAL");
  const broken = table.getByRole("row", { name: /Broken Outline/ });
  await expect(broken).toContainText("FAILED");
  await expect(broken).toContainText("Empty geometry.");

  // Search narrows to one row; clearing restores all seven.
  await page.getByLabel("Search by feature name or ID").fill("courtyard");
  await expect(table.getByRole("row", { name: /Building With Courtyard/ })).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Search by feature name or ID").fill("");
  await expect(table.locator("tbody tr")).toHaveCount(7);

  // Table row click selects the feature (details panel appears).
  await table.getByRole("row", { name: /Main Road/ }).click();
  await expect(page.getByText("Selected: Main Road")).toBeVisible();

  // CSV export downloads all seven rows with the new columns.
  const download = page.waitForEvent("download", { timeout: 30000 });
  await page.getByRole("button", { name: /Export all measurements as CSV/ }).click();
  const path = await (await download).path();
  if (!path) throw new Error("CSV download produced no file");
  const { readFileSync } = await import("node:fs");
  const csv = readFileSync(path, "utf-8");
  const lines = csv.split("\r\n").filter((l) => l.length > 0);
  expect(lines).toHaveLength(8); // header + 7 features
  expect(lines[0]).toContain("label,feature_name");
  expect(lines[0]).toContain("area_ha,area_acres,length_km");
  expect(csv).toContain("Land 1");
  expect(csv).toContain("PARTIAL");
});
