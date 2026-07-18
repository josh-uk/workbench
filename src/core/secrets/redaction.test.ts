import { describe, expect, it } from "vitest";

import { maskSecret, redactHeaders } from "./redaction";

describe("secret redaction", () => {
  it("masks a complete value by default", () => {
    expect(maskSecret("top-secret-value")).toBe("••••••••");
  });

  it("can retain a short suffix for identification", () => {
    expect(maskSecret("client-secret-1234", 4)).toBe("••••••••1234");
  });

  it("does not invent a value for an empty secret", () => {
    expect(maskSecret("")).toBe("");
  });

  it("redacts sensitive headers case-insensitively", () => {
    expect(
      redactHeaders({
        Authorization: "Bearer access-token",
        "X-API-Key": "api-key-value",
        Accept: "application/json",
      }),
    ).toEqual({
      Authorization: "••••••••",
      "X-API-Key": "••••••••",
      Accept: "application/json",
    });
  });
});
