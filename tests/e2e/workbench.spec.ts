import { expect, test } from "@playwright/test";

const runId = Date.now().toString(36);
const workspaceName = `E2E Work ${runId}`;
const projectName = `Project ${runId}`;
const requestName = `Get fact ${runId}`;
const environmentName = `Local ${runId}`;
const tokenRequestName = `Generate OAuth token ${runId}`;
const authProfileName = `Derived OAuth ${runId}`;
const protectedRequestName = `Protected fact ${runId}`;
const importedRequestName = `Imported facts ${runId}`;
const httpieRequestName = `HTTPie facts ${runId}`;

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

    await page.getByRole("button", { name: "Headers", exact: true }).click();
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

  test("manages environments and resolves masked runtime variables", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Workspace variables" }).click();
    await page.getByRole("button", { name: "New environment" }).click();
    await page.getByLabel("Name").fill(environmentName);
    await page
      .getByLabel("Description")
      .fill("Local variables for the end-to-end mock API");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Environment created.")).toBeVisible();

    await page.getByRole("button", { name: environmentName }).click();
    await page.getByRole("button", { name: "Add variable" }).click();
    await page.getByLabel("Variable name 1").fill("baseUrl");
    await page.getByLabel("Variable value 1").fill("http://127.0.0.1:3201");
    await page.getByRole("button", { name: "Save variables" }).click();
    await expect(page.getByText("Variables saved.")).toBeVisible();
    await page.getByRole("button", { name: "Close variable manager" }).click();

    await page.getByText(requestName, { exact: true }).click();
    await page.getByLabel("Request URL").fill("{{baseUrl}}/{{resourcePath}}");
    await page.getByRole("button", { name: "Headers 1", exact: true }).click();
    await page.getByLabel("Field 1 value").fill("{{runtimeToken}}");
    await page.getByRole("button", { name: "Variables", exact: true }).click();
    await page.getByLabel("Workspace environment").selectOption({
      label: environmentName,
    });

    const requestVariables = page
      .getByRole("heading", { name: "Request variables" })
      .locator("..");
    await requestVariables
      .getByRole("button", { name: "Add variable" })
      .click();
    await requestVariables.getByLabel("Variable name 1").fill("resourcePath");
    await requestVariables.getByLabel("Variable value 1").fill("facts");

    const runtimeVariables = page
      .getByRole("heading", { name: "Temporary runtime overrides" })
      .locator("..");
    await runtimeVariables
      .getByRole("button", { name: "Add variable" })
      .click();
    await runtimeVariables.getByLabel("Variable name 1").fill("runtimeToken");
    await runtimeVariables.getByLabel("Variable value 1").fill("e2e-secret");

    await page
      .getByRole("button", { name: "Preview resolved request" })
      .click();
    await expect(page.getByText("http://127.0.0.1:3201/facts")).toBeVisible();
    await expect(
      page.getByText("Temporary runtime override", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("••••••••")).toBeVisible();

    await page.getByRole("button", { name: /Send/ }).click();
    await expect(page.getByText("200 OK")).toBeVisible();
    await expect(page.getByText(/Honey never spoils/)).toBeVisible();
    await expect(page.getByText(/e2e-secret/)).toHaveCount(0);

    await page.reload();
    await page.getByText(requestName, { exact: true }).click();
    await page.getByRole("button", { name: /^Variables(?: \d+)?$/ }).click();
    await expect(page.getByLabel("Workspace environment")).toHaveValue(/^.+$/);
    await expect(requestVariables.getByLabel("Variable value 1")).toHaveValue(
      "facts",
    );
  });

  test("extracts and reuses a saved OAuth token without exposing it", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New request" }).click();
    await page.getByLabel("Request name").fill(tokenRequestName);
    await page
      .getByLabel("Request URL")
      .fill("http://127.0.0.1:3201/derived-token");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Settings" })
      .click();
    await page.getByLabel("Allow trusted private/local network").check();
    await page.getByRole("button", { name: "Outputs" }).click();
    await page.getByRole("button", { name: "Add output" }).click();
    await page.getByLabel("Output 1 name").fill("accessToken");
    await page.getByLabel("Output 1 JSONPath").fill("$.access_token");
    await page.getByLabel("Output 1 expiry JSONPath").fill("$.expires_in");
    await page
      .getByLabel("Output 1 name")
      .locator("..")
      .getByText("Secret")
      .click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Request saved.")).toBeVisible();

    await page.getByRole("button", { name: "Authentication profiles" }).click();
    await page.getByRole("button", { name: "New profile" }).click();
    await page.getByLabel("Name").fill(authProfileName);
    await page.getByLabel("Type").selectOption("request_derived");
    await page.getByLabel("Token request").selectOption({
      label: tokenRequestName,
    });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Authentication profile saved.")).toBeVisible();
    await page
      .getByRole("button", { name: "Close authentication profiles" })
      .click();

    await page.getByRole("button", { name: "New request" }).click();
    await page.getByLabel("Request name").fill(protectedRequestName);
    await page
      .getByLabel("Request URL")
      .fill("http://127.0.0.1:3201/protected");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Settings" })
      .click();
    await page.getByLabel("Allow trusted private/local network").check();
    await page.getByRole("button", { name: "Auth", exact: true }).click();
    await page.getByLabel("Authentication profile").selectOption({
      label: `${authProfileName} · request derived · project`,
    });
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: /Send/ }).click();
    await expect(page.getByText("200 OK")).toBeVisible();
    await expect(page.getByText(/derivedTokenRequests/)).toBeVisible();
    await expect(page.getByText(/e2e-derived-secret/)).toHaveCount(0);
    await expect(page.getByText(/••••••••/)).toBeVisible();

    await page.getByRole("button", { name: /Send/ }).click();
    await expect(page.getByText(/"derivedTokenRequests": 1/)).toBeVisible();
  });

  test("imports an OpenAPI operation and executes the generated request", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Imported definitions" }).click();
    await page.getByRole("button", { name: "Import OpenAPI" }).click();
    await page.getByLabel("OpenAPI JSON or YAML").fill(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: `E2E Facts ${runId}`, version: "1.0.0" },
        servers: [{ url: "http://127.0.0.1:3201" }],
        paths: {
          "/facts": {
            get: {
              operationId: `listFacts${runId}`,
              summary: importedRequestName,
              tags: [`Imported ${runId}`],
              parameters: [
                {
                  name: "source",
                  in: "query",
                  schema: { type: "string", example: "openapi" },
                },
              ],
              responses: { "200": { description: "Facts" } },
            },
          },
        },
      }),
    );
    await page.getByLabel("Allow trusted private/local network").check();
    await page.getByRole("button", { name: "Preview import" }).click();

    await expect(
      page.getByRole("heading", { name: `E2E Facts ${runId}` }),
    ).toBeVisible();
    await expect(page.getByText(importedRequestName)).toBeVisible();
    await page.getByRole("button", { name: "Apply import" }).click();
    await expect(
      page.getByText(`Imported 1 requests from E2E Facts ${runId}.`),
    ).toBeVisible();

    await page.getByRole("button", { name: "Close imports" }).click();
    await page.getByText(importedRequestName, { exact: true }).click();
    await expect(page.getByLabel("Request URL")).toHaveValue(
      "{{baseUrl}}/facts",
    );
    await page.getByRole("button", { name: /Send/ }).click();
    await expect(page.getByText("200 OK")).toBeVisible();
    await expect(page.getByText(/Honey never spoils/)).toBeVisible();
    await expect(page.getByText(/source=openapi/)).toBeVisible();
  });

  test("imports an HTTPie collection request and executes it", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Collection imports" }).click();
    await page.getByRole("button", { name: "Import source" }).first().click();
    await page.getByLabel("Import source").fill(
      JSON.stringify({
        meta: {
          format: "httpie",
          version: "1.0.0",
          contentType: "collection",
        },
        entry: {
          id: `httpie-collection-${runId}`,
          name: `HTTPie E2E ${runId}`,
          auth: { type: "none" },
          requests: [
            {
              id: `httpie-request-${runId}`,
              name: httpieRequestName,
              method: "GET",
              url: "http://127.0.0.1:3201/facts",
              auth: { type: "inherited" },
              headers: [
                { name: "Accept", value: "application/json", enabled: true },
              ],
              queryParams: [{ name: "source", value: "httpie", enabled: true }],
              pathParams: [],
              body: { type: "none" },
            },
          ],
        },
      }),
    );
    await page.getByRole("button", { name: "Preview import" }).click();

    await expect(
      page.getByRole("heading", { name: `HTTPie E2E ${runId}` }),
    ).toBeVisible();
    await expect(page.getByText(httpieRequestName)).toBeVisible();
    await page.getByText("Allow private/local request targets").click();
    await page.getByRole("button", { name: "Import 1 request" }).click();
    await expect(page.getByText("Imported 1 request.")).toBeVisible();

    await page
      .getByRole("button", { name: "Close collection imports" })
      .click();
    await page.getByText(httpieRequestName, { exact: true }).click();
    await expect(page.getByLabel("Request URL")).toHaveValue(
      "http://127.0.0.1:3201/facts",
    );
    await page.getByRole("button", { name: /Send/ }).click();
    await expect(page.getByText("200 OK")).toBeVisible();
    await expect(page.getByText(/Honey never spoils/)).toBeVisible();
    await expect(page.getByText(/source=httpie/)).toBeVisible();
  });
});
