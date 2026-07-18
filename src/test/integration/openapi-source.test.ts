import http from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_OPENAPI_DOCUMENT_BYTES } from "@/features/openapi/domain";
import { loadOpenApiSource } from "@/features/openapi/source-loader";

const definition = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Source API", version: "1.0.0" },
  paths: {
    "/health": { get: { responses: { "200": { description: "OK" } } } },
  },
});

describe("OpenAPI URL source security", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      if (request.url === "/metadata-redirect") {
        response.writeHead(302, {
          Location: "http://169.254.169.254/latest/meta-data",
        });
        response.end();
        return;
      }
      if (request.url === "/large") {
        response.writeHead(200, {
          "Content-Length": String(MAX_OPENAPI_DOCUMENT_BYTES + 1),
          "Content-Type": "application/json",
        });
        response.end("oversized");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(definition);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("OpenAPI test server did not bind to a TCP port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("requires an explicit opt-in before loading a local source", async () => {
    await expect(
      loadOpenApiSource({
        sourceType: "url",
        sourceUrl: `${baseUrl}/openapi.json`,
        allowPrivateNetwork: false,
      }),
    ).rejects.toThrow("Private and reserved network destinations are blocked");

    await expect(
      loadOpenApiSource({
        sourceType: "url",
        sourceUrl: `${baseUrl}/openapi.json`,
        allowPrivateNetwork: true,
      }),
    ).resolves.toBe(definition);
  });

  it("revalidates redirects and always blocks cloud metadata", async () => {
    await expect(
      loadOpenApiSource({
        sourceType: "url",
        sourceUrl: `${baseUrl}/metadata-redirect`,
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow("Cloud metadata destinations are blocked");
    await expect(
      loadOpenApiSource({
        sourceType: "url",
        sourceUrl: "http://169.254.169.254/latest/meta-data",
        content: definition,
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow("OpenAPI source URL is not allowed");
  });

  it("rejects oversized, credentialed, and non-HTTP sources", async () => {
    await expect(
      loadOpenApiSource({
        sourceType: "url",
        sourceUrl: `${baseUrl}/large`,
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow("larger than 2 MiB");
    await expect(
      loadOpenApiSource({
        sourceType: "url",
        sourceUrl: "http://user:secret@example.test/openapi.json",
        allowPrivateNetwork: false,
      }),
    ).rejects.toThrow("OpenAPI source URL is not allowed");
    await expect(
      loadOpenApiSource({
        sourceType: "url",
        sourceUrl: "file:///etc/passwd",
        allowPrivateNetwork: false,
      }),
    ).rejects.toThrow("OpenAPI source URL is not allowed");
  });
});
