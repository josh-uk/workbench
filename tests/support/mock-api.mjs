import http from "node:http";

const port = Number(process.env.E2E_MOCK_PORT ?? 3201);

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
    }),
  );
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Workbench mock API listening on ${port}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
