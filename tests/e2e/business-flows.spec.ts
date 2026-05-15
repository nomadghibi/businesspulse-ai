import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test("upload, ask ai, and recommendation status flows work", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");

  const enterAppButton = page.getByRole("button", { name: /Enter App/i });
  if (await enterAppButton.isVisible().catch(() => false)) {
    await enterAppButton.click();
  }

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("aside nav").getByRole("button", { name: "Data Sources" })).toBeVisible();
  const appError = page.getByText("Unexpected server error");
  if (await appError.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Reset View" }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(appError).toBeHidden();
  }

  // Ask AI flow + save recommendation
  await page.locator("aside nav").getByRole("button", { name: "Ask AI" }).click();
  await expect(page).toHaveURL(/tab=ask/);
  await expect(page.getByLabel("Ask AI question")).toBeVisible();
  await page.getByLabel("Ask AI question").fill("Summarize current business performance and one action for this week.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Grounded answer")).toBeVisible();
  await page.getByRole("button", { name: "Save As Recommendation" }).click();
  await expect(page.getByText("Saved to recommendations.")).toBeVisible();

  // Recommendation status update flow
  await page.locator("aside nav").getByRole("button", { name: "Recommendations" }).click();
  await expect(page).toHaveURL(/tab=recommendations/);
  const statusSelect = page.locator('div.list select').first();
  await expect(statusSelect).toBeVisible();
  await statusSelect.selectOption("completed");
  await expect(page.getByText(/Updated .* to \"completed\"/)).toBeVisible();

  // Upload flow: preview path
  await page.locator("aside nav").getByRole("button", { name: "Data Sources" }).click();
  await expect(page).toHaveURL(/tab=sources/);
  await page.locator("section.panel").getByRole("combobox").first().selectOption("marketing_spend");
  await page.locator('input[type="file"]').setInputFiles({
    name: "marketing_spend.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("date,platform,campaign,impressions,clicks,spend,leads,conversions\n2026-05-14,google,search_brand,1000,100,250.50,8,2\n")
  });
  await expect(page.getByRole("button", { name: "Commit Import" })).toBeVisible();
});
