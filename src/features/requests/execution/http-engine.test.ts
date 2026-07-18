import { describe, expect, it } from "vitest";

import type { RequestBody } from "@/features/requests/domain";

import {
  createRequestSnapshot,
  safeDisplayUrl,
  serialiseRequestBody,
} from "./http-engine";

describe("HTTP execution preparation", () => {
  it("redacts sensitive query values from display URLs", () => {
    const value = safeDisplayUrl(
      "https://example.test/facts?access_token=secret&limit=20",
    );
    expect(value).not.toContain("secret");
    expect(value).toContain("limit=20");
  });

  it("serialises supported textual bodies", () => {
    const form = serialiseRequestBody({
      type: "form_urlencoded",
      content: "first=one two\nsecond=2",
      contentType: null,
      metadata: {},
    });
    expect(form.bytes?.toString()).toBe("first=one+two&second=2");
    expect(form.contentType).toBe("application/x-www-form-urlencoded");
  });

  it("rejects malformed JSON", () => {
    const body: RequestBody = {
      type: "json",
      content: "{broken",
      contentType: null,
      metadata: {},
    };
    expect(() => serialiseRequestBody(body)).toThrow(
      "JSON request body is invalid",
    );
  });

  it("redacts secret headers and cookies from execution snapshots", () => {
    const snapshot = createRequestSnapshot({
      id: "request-id",
      projectId: "project-id",
      method: "GET",
      url: "https://example.test/facts",
      queryParameters: [],
      headers: [
        {
          name: "Authorization",
          value: "Bearer top-secret",
          enabled: true,
          secret: false,
        },
      ],
      body: { type: "none", content: null, contentType: null, metadata: {} },
      settings: {
        timeoutMs: 30_000,
        followRedirects: true,
        maxRedirects: 5,
        tlsVerify: true,
        maxResponseBytes: 1_048_576,
        allowPrivateNetwork: false,
        cookies: [
          {
            name: "session",
            value: "cookie-secret",
            enabled: true,
            secret: true,
          },
        ],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("top-secret");
    expect(JSON.stringify(snapshot)).not.toContain("cookie-secret");
  });
});
