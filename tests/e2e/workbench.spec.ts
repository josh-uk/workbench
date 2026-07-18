import { expect, test } from "@playwright/test";

test("renders the Workbench request and response workspace", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("Workbench", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Request URL")).toHaveValue(
    "{{baseUrl}}/facts/fact_7f31ad",
  );
  await expect(page.getByText("200 OK")).toBeVisible();
  await expect(
    page.getByText("Honey never spoils", { exact: false }),
  ).toBeVisible();
});

test("switches between response details and themes", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Headers 8" }).click();
  await expect(
    page.getByText("Headers 8 details will appear here."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Use light theme" }).click();
  await expect(page.locator("[data-theme='light']")).toBeVisible();
});
