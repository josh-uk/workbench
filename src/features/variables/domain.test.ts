import { describe, expect, it } from "vitest";

import {
  createVariableResolver,
  type VariableDefinition,
} from "@/features/variables/domain";

function variable(
  name: string,
  value: string,
  origin: VariableDefinition["origin"],
  secret = false,
): VariableDefinition {
  return {
    name,
    value,
    origin,
    originLabel: origin,
    secret,
    enabled: true,
  };
}

describe("variable resolution", () => {
  it("applies broad-to-specific precedence and reports the winning origin", () => {
    const resolver = createVariableResolver([
      variable("baseUrl", "https://workspace.test", "workspace"),
      variable("baseUrl", "https://project.test", "project"),
      variable("baseUrl", "https://runtime.test", "runtime"),
    ]);

    expect(resolver.interpolate("{{baseUrl}}/facts")).toMatchObject({
      value: "https://runtime.test/facts",
      origins: ["runtime"],
      unresolved: [],
    });
    expect(resolver.resolveVariables()).toEqual([
      expect.objectContaining({
        name: "baseUrl",
        value: "https://runtime.test",
        origin: "runtime",
      }),
    ]);
  });

  it("resolves nested variables and masks secret-tainted output", () => {
    const resolver = createVariableResolver([
      variable("token", "super-secret", "project_environment", true),
      variable("authorization", "Bearer {{token}}", "request"),
    ]);

    expect(resolver.interpolate("Header: {{authorization}}")).toMatchObject({
      value: "Header: Bearer super-secret",
      preview: "Header: ••••••••",
      secret: true,
    });
    expect(
      resolver.resolveVariables().find(({ name }) => name === "authorization"),
    ).toMatchObject({ secret: true, preview: "••••••••" });
  });

  it("reports unresolved names without replacing their placeholders", () => {
    expect(
      createVariableResolver([]).interpolate("https://{{host}}/{{path}}"),
    ).toMatchObject({
      value: "https://{{host}}/{{path}}",
      unresolved: ["host", "path"],
      errors: [],
    });
  });

  it("detects recursive cycles deterministically", () => {
    const resolver = createVariableResolver([
      variable("one", "{{two}}", "workspace"),
      variable("two", "{{one}}", "project"),
    ]);

    expect(resolver.interpolate("{{one}}").errors[0]).toEqual({
      code: "VARIABLE_CYCLE",
      message: "Variable cycle detected: one → two → one.",
      path: ["one", "two", "one"],
    });
  });
});
