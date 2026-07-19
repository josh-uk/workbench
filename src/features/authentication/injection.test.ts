import { describe, expect, it } from "vitest";

import type { RequestPlan } from "@/features/requests/execution/http-engine";

import { type EffectiveAuthProfile, defaultAuthConfiguration } from "./domain";
import {
  calculateTokenExpiry,
  injectAuthentication,
  tokenIsFresh,
} from "./injection";

const plan: RequestPlan = {
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  method: "GET",
  url: "https://example.test",
  queryParameters: [],
  headers: [],
  body: { type: "none", content: null, contentType: null, metadata: {} },
  settings: {
    timeoutMs: 1_000,
    followRedirects: true,
    maxRedirects: 5,
    tlsVerify: true,
    maxResponseBytes: 100_000,
    allowPrivateNetwork: false,
    cookies: [],
  },
};

function profile(
  type: EffectiveAuthProfile["type"],
  configuration: Partial<EffectiveAuthProfile["configuration"]>,
): EffectiveAuthProfile {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: null,
    tokenRequestId: null,
    name: "Test auth",
    type,
    configuration: { ...defaultAuthConfiguration(), ...configuration },
    inherited: true,
    overridden: false,
  };
}

describe("authentication injection", () => {
  it("injects bearer, basic, and API key credentials as secrets", () => {
    const bearer = injectAuthentication(
      plan,
      profile("bearer", { token: "token-1" }),
    ).plan;
    expect(bearer.headers).toEqual([
      expect.objectContaining({
        name: "Authorization",
        value: "Bearer token-1",
        secret: true,
      }),
    ]);
    expect(bearer.secretValues).toEqual(
      expect.arrayContaining(["Bearer token-1", "token-1"]),
    );

    const basic = injectAuthentication(
      plan,
      profile("basic", { username: "worker", password: "secret" }),
    ).plan;
    expect(basic.headers[0]?.value).toBe(
      `Basic ${Buffer.from("worker:secret").toString("base64")}`,
    );
    expect(basic.secretValues).toContain("secret");

    expect(
      injectAuthentication(
        plan,
        profile("api_key_query", { key: "key-1", queryName: "api_key" }),
      ).plan.queryParameters,
    ).toEqual([
      expect.objectContaining({
        name: "api_key",
        value: "key-1",
        secret: true,
      }),
    ]);
  });

  it("injects reusable tokens into the configured target", () => {
    const result = injectAuthentication(
      plan,
      profile("oauth2_client_credentials", {
        injectionTarget: "header",
        injectionName: "Authorization",
      }),
      { value: "oauth-token", prefix: "Bearer", source: "cache" },
    );
    expect(result.plan.headers[0]?.value).toBe("Bearer oauth-token");
    expect(result.trace).toMatchObject({
      source: "cache",
      credential: "••••••••",
    });
  });

  it("calculates expiry and refreshes inside the safety window", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    expect(calculateTokenExpiry(3600, now)?.toISOString()).toBe(
      "2026-07-18T13:00:00.000Z",
    );
    expect(tokenIsFresh(new Date(now.getTime() + 31_000), now)).toBe(true);
    expect(tokenIsFresh(new Date(now.getTime() + 30_000), now)).toBe(false);
    expect(() => calculateTokenExpiry("not-a-number", now)).toThrow(
      "non-negative number",
    );
  });
});
