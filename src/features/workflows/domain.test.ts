import { describe, expect, it } from "vitest";

import { saveWorkflowSchema } from "./domain";

describe("workflow domain", () => {
  it("normalises empty descriptions idempotently across validated boundaries", () => {
    const input = {
      projectId: crypto.randomUUID(),
      name: "Deploy smoke test",
      description: "",
      steps: [
        {
          requestId: crypto.randomUUID(),
          name: "Health request",
          failureMode: "stop" as const,
          enabled: true,
          runtimeOverrides: [],
          assertions: [],
        },
      ],
    };

    const once = saveWorkflowSchema.parse(input);
    const twice = saveWorkflowSchema.parse(once);

    expect(once.description).toBeNull();
    expect(twice).toEqual(once);
  });

  it("requires at least one enabled step", () => {
    expect(() =>
      saveWorkflowSchema.parse({
        projectId: crypto.randomUUID(),
        name: "Disabled workflow",
        description: null,
        steps: [
          {
            requestId: crypto.randomUUID(),
            name: "Disabled step",
            failureMode: "stop",
            enabled: false,
            runtimeOverrides: [],
            assertions: [],
          },
        ],
      }),
    ).toThrow("Enable at least one workflow step");
  });
});
