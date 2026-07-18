import { describe, expect, it } from "vitest";

import { extractRequestOutputs, parseJsonResponse } from "./extraction";

describe("request output extraction", () => {
  it("extracts string and structured values and calculates expiry", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const outputs = extractRequestOutputs(
      { access_token: "secret-token", expires_in: 120, entity: { id: 42 } },
      [
        {
          id: "token-definition",
          name: "accessToken",
          jsonPath: "$.access_token",
          expiresInJsonPath: "$.expires_in",
          secret: true,
        },
        {
          id: "entity-definition",
          name: "entity",
          jsonPath: "$.entity",
          expiresInJsonPath: null,
          secret: false,
        },
      ],
      now,
    );

    expect(outputs[0]).toMatchObject({
      value: "secret-token",
      expiresAt: new Date("2026-07-18T12:02:00.000Z"),
    });
    expect(outputs[1]?.value).toBe('{"id":42}');
  });

  it("reports invalid response JSON and missing paths clearly", () => {
    expect(() => parseJsonResponse("not-json")).toThrow("valid JSON");
    expect(() =>
      extractRequestOutputs({}, [
        {
          id: "missing",
          name: "missing",
          jsonPath: "$.missing",
          expiresInJsonPath: null,
          secret: false,
        },
      ]),
    ).toThrow("Output missing failed");
  });
});
