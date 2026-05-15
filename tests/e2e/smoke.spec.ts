import { expect, test } from "@playwright/test";

test("user can log in and use core navigation controls", async ({ page }) => {
  await page.goto("/");

  const enterAppButton = page.getByRole("button", { name: /Enter App/i });
  if (await enterAppButton.isVisible().catch(() => false)) {
    await enterAppButton.click();
  }

  await expect(page.getByRole("heading", { name: "BusinessPulse AI Login" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: /Demo Home Services Co\.|BusinessPulse/i })).toBeVisible();
  await expect(page.locator("aside nav").getByRole("button", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByLabel("Start date")).toBeVisible();
  await expect(page.getByLabel("End date")).toBeVisible();

  await page.locator("aside nav").getByRole("button", { name: "Ask AI" }).click();
  await expect(page).toHaveURL(/tab=ask/);

  await page.locator("aside nav").getByRole("button", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/tab=dashboard/);

  await expect(page.getByRole("button", { name: "Copy View Link" })).toBeVisible();
});
