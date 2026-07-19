import { describe, expect, it } from "vitest";

import { AzureAuthenticationError } from "./domain";
import { assertTrustedMutation } from "./http";

function mutationRequest(url: string, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

describe("Azure HTTP mutation protection", () => {
  it("accepts an origin matching the public Host header", () => {
    const request = mutationRequest(
      "http://0.0.0.0:3000/api/configuration/azure/login",
      { host: "localhost:3000", origin: "http://localhost:3000" },
    );

    expect(() => assertTrustedMutation(request)).not.toThrow();
  });

  it("accepts an origin supplied by a TLS reverse proxy", () => {
    const request = mutationRequest(
      "http://app:3000/api/configuration/azure/login",
      {
        host: "app:3000",
        origin: "https://workbench.example.com",
        "x-forwarded-host": "workbench.example.com",
        "x-forwarded-proto": "https",
      },
    );

    expect(() => assertTrustedMutation(request)).not.toThrow();
  });

  it("rejects a different origin", () => {
    const request = mutationRequest(
      "http://0.0.0.0:3000/api/configuration/azure/login",
      { host: "localhost:3000", origin: "https://example.com" },
    );

    expect(() => assertTrustedMutation(request)).toThrowError(
      AzureAuthenticationError,
    );
  });

  it("rejects requests identified by the browser as cross-site", () => {
    const request = mutationRequest(
      "http://localhost:3000/api/configuration/azure/login",
      {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "sec-fetch-site": "cross-site",
      },
    );

    expect(() => assertTrustedMutation(request)).toThrowError(
      AzureAuthenticationError,
    );
  });

  it("continues to require JSON mutations", () => {
    const request = new Request(
      "http://localhost:3000/api/configuration/azure/login",
      { method: "POST", body: "tenant=contoso" },
    );

    expect(() => assertTrustedMutation(request)).toThrow(
      "Azure requests must use JSON.",
    );
  });
});
