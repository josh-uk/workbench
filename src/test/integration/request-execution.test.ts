import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  RequestDomainError,
  type RequestSettings,
} from "@/features/requests/domain";
import {
  executeHttpRequest,
  type RequestPlan,
} from "@/features/requests/execution/http-engine";

const integrationDescribe = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe("server-side HTTP execution", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/json" });
        response.end();
        return;
      }
      if (request.url === "/metadata-redirect") {
        response.writeHead(302, {
          Location: "http://169.254.169.254/latest/meta-data",
        });
        response.end();
        return;
      }
      if (request.url === "/slow") {
        setTimeout(() => {
          response.writeHead(200, { "Content-Type": "text/plain" });
          response.end("late");
        }, 250);
        return;
      }
      if (request.url === "/large") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("x".repeat(4_096));
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": "session=top-secret; HttpOnly; SameSite=Strict",
      });
      response.end(
        JSON.stringify({
          ok: true,
          authorization: request.headers.authorization ?? null,
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Mock API did not start.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const settings = (
    values: Partial<RequestSettings> = {},
  ): RequestSettings => ({
    timeoutMs: 2_000,
    followRedirects: true,
    maxRedirects: 5,
    tlsVerify: true,
    maxResponseBytes: 100_000,
    allowPrivateNetwork: true,
    cookies: [],
    ...values,
  });

  const plan = (
    path: string,
    values: Partial<RequestPlan> = {},
  ): RequestPlan => ({
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    method: "GET",
    url: `${baseUrl}${path}`,
    queryParameters: [],
    headers: [],
    body: { type: "none", content: null, contentType: null, metadata: {} },
    settings: settings(),
    ...values,
  });

  it("executes against a trusted local API and follows validated redirects", async () => {
    const response = await executeHttpRequest(
      plan("/redirect", {
        headers: [
          {
            name: "Authorization",
            value: "Bearer local-test",
            enabled: true,
            secret: true,
          },
        ],
      }),
      new AbortController().signal,
    );

    expect(response).toMatchObject({
      statusCode: 200,
      contentType: "application/json",
      redirects: [{ statusCode: 302 }],
      cookies: [{ name: "session", value: "••••••••" }],
    });
    expect(response.bodyPreview).not.toContain("local-test");
    expect(response.bodyPreview).toContain("••••••••");
    expect(JSON.stringify(response.headers)).not.toContain("top-secret");
  });

  it("enforces response size and timeout limits", async () => {
    await expect(
      executeHttpRequest(
        plan("/large", { settings: settings({ maxResponseBytes: 1_024 }) }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });

    await expect(
      executeHttpRequest(
        plan("/slow", { settings: settings({ timeoutMs: 100 }) }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
  });

  it("revalidates every redirect destination", async () => {
    await expect(
      executeHttpRequest(
        plan("/metadata-redirect"),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "METADATA_BLOCKED" });
  });

  it("cancels an in-flight request", async () => {
    const controller = new AbortController();
    const execution = executeHttpRequest(plan("/slow"), controller.signal);
    setTimeout(() => controller.abort(), 20);

    await expect(execution).rejects.toEqual(
      expect.objectContaining<Partial<RequestDomainError>>({
        code: "REQUEST_CANCELLED",
      }),
    );
  });

  it("rejects a request whose signal was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeHttpRequest(plan("/slow"), controller.signal),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RequestDomainError>>({
        code: "REQUEST_CANCELLED",
      }),
    );
  });
});
