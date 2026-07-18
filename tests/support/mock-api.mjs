import http from "node:http";

const port = Number(process.env.E2E_MOCK_PORT ?? 3201);
let derivedTokenRequests = 0;

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  if (request.url === "/redirect") {
    response.writeHead(302, { Location: "/facts?source=redirect" });
    response.end();
    return;
  }
  if (request.url?.startsWith("/slow")) {
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"late":true}');
    }, 1_500);
    return;
  }
  if (request.url === "/derived-token") {
    derivedTokenRequests += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        access_token: `e2e-derived-secret-${derivedTokenRequests}`,
        expires_in: 3_600,
        token_type: "Bearer",
      }),
    );
    return;
  }
  if (request.url === "/workflow-seed") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ workflow_token: "e2e-handoff-value" }));
    return;
  }
  if (request.url === "/workflow-consume/e2e-handoff-value") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ consumed: true }));
    return;
  }

  response.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": "mock-session=not-a-real-secret; HttpOnly; SameSite=Strict",
    "X-Mock-Api": "workbench-e2e",
  });
  response.end(
    JSON.stringify({
      fact: "Honey never spoils",
      method: request.method,
      url: request.url,
      testHeader: request.headers["x-test"] ?? null,
      authorization: request.headers.authorization ?? null,
      derivedTokenRequests,
    }),
  );
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Workbench mock API listening on ${port}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
