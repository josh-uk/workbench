import { expect, test } from "@playwright/test";

const runId = Date.now().toString(36);
const workspaceName = `E2E Work ${runId}`;
const projectName = `Project ${runId}`;
const requestName = `Get fact ${runId}`;

test.describe.serial("workspace and project management", () => {
  test("creates and persists a workspace, project, and nested folders", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Select workspace" }).click();
    await page.getByRole("menuitem", { name: "New workspace" }).click();
    await page.getByLabel("Name").fill(workspaceName);
    await page.getByLabel("Description").fill("Developer APIs");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByRole("button", { name: "Select workspace" }),
    ).toContainText(workspaceName);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByLabel("Name").fill(projectName);
    await page.getByLabel("Description").fill("Primary API");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByRole("heading", { name: projectName }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Name").fill("Facts");
    await page.getByRole("button", { name: "Save" }).click();

    await page
      .getByRole("button", { name: "Folder actions for Facts" })
      .click();
    await page.getByRole("menuitem", { name: "New subfolder" }).click();
    await page.getByLabel("Name").fill("Examples");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Examples")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: projectName }),
    ).toBeVisible();
    await expect(page.getByText("Examples")).toBeVisible();
  });

  test("renames, archives, restores, and searches projects", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .getByRole("button", { name: `Project actions for ${projectName}` })
      .click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByLabel("Name").fill("Core API");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Core API" })).toBeVisible();

    await page
      .getByRole("button", { name: "Project actions for Core API" })
      .click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: "Project actions for Core API" })
      .click();
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await expect(page.getByRole("heading", { name: "Core API" })).toBeVisible();

    await page.getByLabel("Search projects and folders").fill("Facts");
    await expect(page.getByText("Facts").first()).toBeVisible();

    await page.getByRole("button", { name: "Use light theme" }).click();
    await expect(page.locator("[data-theme='light']")).toBeVisible();
  });

  test("saves, executes, inspects, persists, and cancels a request", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New request" }).click();
    await expect(page.getByLabel("Request URL")).toBeVisible();
    await page.getByLabel("Request name").fill(requestName);
    await page.getByLabel("Request URL").fill("http://127.0.0.1:3201/facts");

    await page.getByRole("button", { name: "Params" }).click();
    await page.getByRole("button", { name: "Add row" }).click();
    await page.getByLabel("Field 1 name").fill("limit");
    await page.getByLabel("Field 1 value").fill("20");

    await page.getByRole("button", { name: "Headers" }).click();
    await page.getByRole("button", { name: "Add row" }).click();
    await page.getByLabel("Field 1 name").fill("X-Test");
    await page.getByLabel("Field 1 value").fill("phase-3");

    await page
      .getByRole("main")
      .getByRole("button", { name: "Settings" })
      .click();
    await page.getByLabel("Allow trusted private/local network").check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Request saved.")).toBeVisible();

    await page.getByRole("button", { name: /Send/ }).click();
    await expect(page.getByText("200 OK")).toBeVisible();
    await expect(page.getByText(/Honey never spoils/)).toBeVisible();
    await expect(page.getByText(/phase-3/)).toBeVisible();

    await page.reload();
    await page.getByText(requestName, { exact: true }).click();
    await expect(page.getByLabel("Request URL")).toHaveValue(
      "http://127.0.0.1:3201/facts",
    );
    await expect(page.getByText("200 OK")).toBeVisible();

    await page.getByLabel("Request URL").fill("http://127.0.0.1:3201/slow");
    await page.getByRole("button", { name: /Send/ }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("REQUEST_CANCELLED")).toBeVisible();
  });
});
