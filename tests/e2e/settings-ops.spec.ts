import { expect, test } from "@playwright/test";

test("owner can open settings and see operations metrics controls", async ({ page }) => {
  await page.goto("/");

  const enterAppButton = page.getByRole("button", { name: /Enter App/i });
  if (await enterAppButton.isVisible().catch(() => false)) {
    await enterAppButton.click();
  }

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("aside nav").getByRole("button", { name: "Settings" })).toBeVisible();

  await page.locator("aside nav").getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/tab=settings/);

  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh Ops Metrics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export Ops CSV" })).toBeVisible();
});
