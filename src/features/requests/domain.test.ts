import { describe, expect, it } from "vitest";

import {
  createRequestCopyName,
  parseRequestSettings,
  updateSavedRequestSchema,
} from "./domain";

describe("request domain", () => {
  it("applies safe execution defaults", () => {
    expect(parseRequestSettings({})).toMatchObject({
      timeoutMs: 30_000,
      followRedirects: true,
      maxRedirects: 5,
      tlsVerify: true,
      maxResponseBytes: 1_048_576,
      allowPrivateNetwork: false,
      cookies: [],
    });
  });

  it("creates collision-free copy names", () => {
    expect(
      createRequestCopyName("List facts", [
        "List facts",
        "List facts copy",
        "list facts COPY 2",
      ]),
    ).toBe("List facts copy 3");
  });

  it("rejects unsafe execution limits", () => {
    const result = updateSavedRequestSchema.safeParse({
      id: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
      name: "List facts",
      description: "",
      method: "GET",
      url: "https://example.test/facts",
      folderId: null,
      tags: [],
      queryParameters: [],
      headers: [],
      body: { type: "none", content: null, contentType: null, metadata: {} },
      settings: { timeoutMs: 1, maxResponseBytes: 50_000_000 },
    });

    expect(result.success).toBe(false);
  });
});
