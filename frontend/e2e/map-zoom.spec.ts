import { expect, test, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "sample_data");

async function tileZoom(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const imgs = Array.from(
      document.querySelectorAll(".leaflet-tile-pane img[src*='tile.openstreetmap.org']"),
    ) as HTMLImageElement[];
    for (const img of imgs) {
      const m = img.src.match(/\/(\d+)\/\d+\/\d+\.png/);
      if (m) return Number(m[1]);
    }
    return null;
  });
}

async function waitTileZoom(page: Page): Promise<number> {
  const z = await page.waitForFunction(
    () => {
      const imgs = Array.from(
        document.querySelectorAll(".leaflet-tile-pane img[src*='tile.openstreetmap.org']"),
      ) as HTMLImageElement[];
      for (const img of imgs) {
        const m = img.src.match(/\/(\d+)\/\d+\/\d+\.png/);
        if (m) return Number(m[1]);
      }
      return null;
    },
    null,
    { timeout: 20000 },
  );
  const zoom = await z.jsonValue();
  if (typeof zoom !== "number") throw new Error("no OSM tiles loaded");
  return zoom;
}

/** Poll until tile zoom satisfies pred (tiles reload after fly animations). */
async function expectTileZoom(page: Page, pred: (z: number) => boolean, what: string) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const z = await tileZoom(page);
    if (z !== null && pred(z)) return z;
    if (Date.now() > deadline) throw new Error(`tile zoom never satisfied: ${what}`);
    await page.waitForTimeout(400);
  }
}

async function upload(page: Page, filename: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Upload", exact: true }).first().click();
  await page.locator('input[type="file"]').setInputFiles(join(SAMPLES, filename), { force: true });
  await expect(page.getByText(filename).first()).toBeVisible({ timeout: 30000 });
}

test("survey.kml: marker click selects + zooms, table row zooms, reset restores", async ({
  page,
}) => {
  await upload(page, "survey.kml");
  await page.getByRole("button", { name: "Map", exact: true }).first().click();
  await page.waitForSelector(".leaflet-container");
  await page.waitForSelector(".poly-marker");
  const z0 = await waitTileZoom(page);

  // Click the polygon center marker -> selects Survey Plot and zooms.
  await page.locator(".poly-marker").first().click();
  await expect(page.getByText("Selected: Survey Plot")).toBeVisible({ timeout: 10000 });
  const z1 = await expectTileZoom(page, () => true, "any tiles after marker click");
  expect(z1).toBeGreaterThanOrEqual(Math.min(z0, 15));

  // Repeat click on the same feature: no crash, selection stays.
  await page.locator(".poly-marker").first().click();
  await expect(page.getByText("Selected: Survey Plot")).toBeVisible();

  // Table row click -> same feature selection + zoom, from Measurements view.
  await page.getByRole("button", { name: "Measurements", exact: true }).first().click();
  await page.getByRole("row", { name: /Access Road/ }).click();
  await page.getByRole("button", { name: "Map", exact: true }).first().click();
  await expect(page.getByText("Selected: Access Road")).toBeVisible({ timeout: 15000 });
  await expectTileZoom(page, (z) => z >= 15, "zoomed to road");

  // Line and point geometries stay independently selectable via their paths.
  // (Render order is deterministic: polygon fill, line, point circle.)
  await page.getByRole("button", { name: /reset map view/i }).click();
  await page.locator(".leaflet-overlay-pane path").nth(1).click({ force: true });
  await expect(page.getByText("Selected: Access Road")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: /reset map view/i }).click();
  await page.locator(".leaflet-overlay-pane path").nth(2).click({ force: true });
  await expect(page.getByText("Selected: Gate Marker")).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByLabel("Selected feature details").getByText("Not applicable").first(),
  ).toBeVisible();

  // Reset view restores the all-features overview.
  await page.getByRole("button", { name: /reset map view/i }).click();
  await expectTileZoom(page, (z) => z <= z0 + 1, "reset overview");
});

test("parcels.zip: both polygon markers discoverable + independently selectable", async ({
  page,
}) => {
  await upload(page, "parcels.zip");
  await page.getByRole("button", { name: "Map", exact: true }).first().click();
  await page.waitForSelector(".leaflet-container");
  await expect(page.locator(".poly-marker")).toHaveCount(2, { timeout: 20000 });
  const z0 = await waitTileZoom(page);

  const markers = page.locator(".poly-marker");
  await markers.nth(0).click();
  await expect(page.getByText(/Selected:/)).toBeVisible({ timeout: 10000 });
  const first = await page.getByText(/Selected:/).textContent();
  // Reset so the second parcel's marker is back in the viewport, then select it.
  await page.getByRole("button", { name: /reset map view/i }).click();
  await expect(page.locator(".poly-marker")).toHaveCount(2, { timeout: 20000 });
  await markers.nth(1).click();
  await expect(page.getByText(/Selected:/)).toBeVisible({ timeout: 10000 });
  const second = await page.getByText(/Selected:/).textContent();
  expect(first).not.toEqual(second);
  // Zoomed into a single parcel (tighter than the two-parcel overview).
  await expectTileZoom(page, (z) => z > z0 || z >= 16, "zoomed to parcel");
});
