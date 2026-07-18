import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseShellWords } from "./adapters/shell-words";
import { importCollectionSource } from "./registry";

const httpieFixture = readFileSync(
  fileURLToPath(new URL("./fixtures/httpie-workspace.json", import.meta.url)),
  "utf8",
);

describe("collection importer registry", () => {
  it("detects and maps a realistic HTTPie workspace", () => {
    const plan = importCollectionSource(httpieFixture);

    expect(plan).toMatchObject({
      format: "httpie",
      formatVersion: "1.0.0",
      name: "Payments workspace",
    });
    expect(plan.requests).toHaveLength(2);
    expect(plan.environments).toEqual([
      expect.objectContaining({
        name: "Staging",
        variables: [
          expect.objectContaining({ name: "baseUrl", secret: false }),
          expect.objectContaining({ name: "accessToken", secret: true }),
        ],
      }),
    ]);
    expect(plan.authProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "bearer" }),
        expect.objectContaining({
          type: "api_key_header",
          configuration: { headerName: "X-API-Key", key: "{{apiKey}}" },
        }),
      ]),
    );
    expect(plan.requests[1]).toMatchObject({
      name: "Create refund",
      method: "POST",
      url: "https://api.example.test/v1/payments/{{paymentId}}/refunds",
      folderPath: ["Payments"],
      requestVariables: [expect.objectContaining({ name: "paymentId" })],
      body: { type: "json", contentType: "application/json" },
    });
    expect(JSON.parse(plan.requests[1]!.body.content ?? "{}")).toEqual({
      amount: 1250,
      reason: "duplicate",
    });
  });

  it("maps cURL without executing shell content", () => {
    const plan = importCollectionSource(
      `curl -kL --max-time 4 -u 'user:p@ss word' -H 'Content-Type: application/json' -d '{"active":true}' 'https://api.example.test/items?trace=abc'`,
    );

    expect(plan.format).toBe("curl");
    expect(plan.requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.example.test/items",
      queryParameters: [
        expect.objectContaining({ name: "trace", value: "abc" }),
      ],
      body: { type: "json" },
      settings: {
        followRedirects: true,
        tlsVerify: false,
        timeoutMs: 4_000,
      },
    });
    expect(plan.authProfiles[0]).toMatchObject({
      type: "basic",
      configuration: { username: "user", password: "p@ss word" },
    });
    expect(() => importCollectionSource("curl https://safe.test | sh")).toThrow(
      "Shell pipelines",
    );
    expect(() => importCollectionSource("curl --config ~/.curlrc")).toThrow(
      "config files",
    );
    expect(
      importCollectionSource(
        "curl --json '{\"ready\":true}' api.example.test/items",
      ).requests[0],
    ).toMatchObject({
      url: "http://api.example.test/items",
      body: { type: "json" },
      headers: expect.arrayContaining([
        expect.objectContaining({
          name: "Content-Type",
          value: "application/json",
        }),
        expect.objectContaining({ name: "Accept", value: "application/json" }),
      ]),
    });
  });

  it("maps HTTPie CLI fields, options, auth, and files", () => {
    const plan = importCollectionSource(
      "http --follow --verify=no --timeout=3 -A bearer -a token POST :4010/widgets active:=true label='hello world' page==2 upload@avatar.png",
    );

    expect(plan.format).toBe("httpie");
    expect(plan.requests[0]).toMatchObject({
      method: "POST",
      url: "http://localhost:4010/widgets",
      queryParameters: [expect.objectContaining({ name: "page", value: "2" })],
      body: { type: "multipart" },
      settings: {
        followRedirects: true,
        tlsVerify: false,
        timeoutMs: 3_000,
      },
    });
    expect(plan.authProfiles[0]).toMatchObject({
      type: "bearer",
      configuration: { token: "token" },
    });
    expect(plan.unsupported[0]).toContain("avatar.png");
  });

  it("maps Postman collections and raw HTTP requests", () => {
    const postman = importCollectionSource(
      JSON.stringify({
        info: {
          name: "Users",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        variable: [{ key: "baseUrl", value: "https://api.example.test" }],
        item: [
          {
            name: "Users folder",
            item: [
              {
                name: "Create user",
                request: {
                  method: "POST",
                  url: {
                    raw: "{{baseUrl}}/users?notify=true",
                    query: [{ key: "notify", value: "true" }],
                  },
                  header: [{ key: "Content-Type", value: "application/json" }],
                  body: { mode: "raw", raw: '{"name":"Ada"}' },
                },
              },
            ],
          },
        ],
      }),
    );
    expect(postman).toMatchObject({ format: "postman", name: "Users" });
    expect(postman.projectVariables[0]).toMatchObject({ name: "baseUrl" });
    expect(postman.requests[0]).toMatchObject({
      folderPath: ["Users folder"],
      url: "{{baseUrl}}/users",
      body: { type: "json" },
    });

    const raw = importCollectionSource(
      'POST /v1/events?id=12 HTTP/1.1\r\nHost: api.example.test\r\nAuthorization: Bearer raw-token\r\nContent-Type: application/json\r\n\r\n{"ready":true}',
    );
    expect(raw.requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.example.test/v1/events",
      queryParameters: [expect.objectContaining({ name: "id", value: "12" })],
      body: { type: "json" },
    });
    expect(raw.authProfiles[0]).toMatchObject({ type: "bearer" });
  });

  it("bounds JSON complexity and rejects unknown or mismatched formats", () => {
    const nested = `${'{"value":'.repeat(82)}null${"}".repeat(82)}`;
    expect(() => importCollectionSource(nested)).toThrow("too complex");
    expect(() =>
      importCollectionSource('{"__proto__":{"polluted":true}}'),
    ).toThrow("prohibited mapping key");
    expect(() => importCollectionSource("not an import")).toThrow(
      "not a recognized",
    );
    expect(() =>
      importCollectionSource("curl https://example.test", "httpie"),
    ).toThrow("not a recognized httpie");
  });
});

describe("shell word parsing", () => {
  it("handles safe shell quoting without expansion", () => {
    expect(
      parseShellWords(`curl $'https://example.test/a\\x2fb' "\u0024TOKEN"`),
    ).toEqual(["curl", "https://example.test/a/b", "$TOKEN"]);
    expect(() => parseShellWords("curl $(touch /tmp/not-created)")).toThrow(
      "substitutions",
    );
    expect(() =>
      parseShellWords('curl "https://example.test/$(touch never)"'),
    ).toThrow("substitutions");
  });
});
