import { describe, expect, it } from "vitest";

import type { RequestPlan } from "@/features/requests/execution/http-engine";
import type { VariableDefinition } from "@/features/variables/domain";
import { resolveRequestPlan } from "@/features/variables/resolution";

const source: RequestPlan = {
  id: "request",
  projectId: "project",
  method: "POST",
  url: "{{baseUrl}}/facts/{{factId}}",
  queryParameters: [
    { name: "token", value: "{{token}}", enabled: true, secret: false },
  ],
  headers: [
    {
      name: "Authorization",
      value: "Bearer {{token}}",
      enabled: true,
      secret: false,
    },
  ],
  body: {
    type: "json",
    content: '{"id":"{{factId}}"}',
    contentType: "application/json",
    metadata: {},
  },
  settings: {
    timeoutMs: 30_000,
    followRedirects: true,
    maxRedirects: 5,
    tlsVerify: true,
    maxResponseBytes: 1_048_576,
    allowPrivateNetwork: false,
    cookies: [],
  },
};

function definition(
  name: string,
  value: string,
  secret = false,
): VariableDefinition {
  return {
    name,
    value,
    secret,
    enabled: true,
    origin: "project_environment",
    originLabel: "Project environment: Test",
  };
}

describe("request resolution", () => {
  it("interpolates the complete request plan and masks secret previews", () => {
    const result = resolveRequestPlan(source, [
      definition("baseUrl", "https://api.test"),
      definition("factId", "42"),
      definition("token", "secret-token", true),
    ]);

    expect(result.plan).toMatchObject({
      url: "https://api.test/facts/42",
      headers: [{ value: "Bearer secret-token", secret: true }],
      body: { content: '{"id":"42"}' },
      secretValues: ["secret-token"],
    });
    expect(result.preview).toMatchObject({
      url: "https://api.test/facts/42",
      headers: [{ value: "Bearer ••••••••", secret: true }],
      queryParameters: [{ value: "••••••••", secret: true }],
    });
    expect(result).toMatchObject({ unresolved: [], errors: [] });
  });

  it("reports unresolved request placeholders", () => {
    const result = resolveRequestPlan(source, [
      definition("baseUrl", "https://api.test"),
    ]);
    expect(result.unresolved).toEqual(["factId", "token"]);
  });
});
