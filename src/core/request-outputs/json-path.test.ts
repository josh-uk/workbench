import { describe, expect, it } from "vitest";

import {
  evaluateJsonPath,
  JsonPathError,
  outputValueToString,
} from "./json-path";

describe("JSONPath output extraction", () => {
  const document = {
    access_token: "token-value",
    nested: { "odd-key": [{ id: 42 }, { id: 84 }] },
  };

  it("supports root, properties, quoted properties, indexes, and wildcards", () => {
    expect(evaluateJsonPath(document, "$.access_token")).toBe("token-value");
    expect(evaluateJsonPath(document, "$['nested']['odd-key'][1].id")).toBe(84);
    expect(evaluateJsonPath(document, "$.nested['odd-key'][*].id")).toEqual([
      42, 84,
    ]);
  });

  it("distinguishes missing values and serialises structured matches", () => {
    expect(evaluateJsonPath(document, "$.missing")).toBeUndefined();
    expect(outputValueToString([42, 84])).toBe("[42,84]");
    expect(() => outputValueToString(undefined)).toThrow(JsonPathError);
  });

  it("rejects unsupported or malformed paths", () => {
    expect(() => evaluateJsonPath(document, "access_token")).toThrow(
      "start with $",
    );
    expect(() => evaluateJsonPath(document, "$..access_token")).toThrow(
      JsonPathError,
    );
    expect(() => evaluateJsonPath(document, "$.items[?(@.id)]")).toThrow(
      JsonPathError,
    );
    expect(() => evaluateJsonPath(document, "$.items[0")).toThrow("not closed");
    expect(() => evaluateJsonPath(document, "$ trailing")).toThrow(
      JsonPathError,
    );
  });

  it("handles object wildcards, missing indexes, and primitive values", () => {
    expect(evaluateJsonPath({ first: 1, second: 2 }, "$.*")).toEqual([1, 2]);
    expect(evaluateJsonPath(["only"], "$[4]")).toBeUndefined();
    expect(outputValueToString(null)).toBe("null");
    expect(outputValueToString(false)).toBe("false");
  });
});
