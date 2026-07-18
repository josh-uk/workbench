import { describe, expect, it } from "vitest";

import {
  diffOpenApiDefinitions,
  materialiseOpenApiRequest,
  parseOpenApiDocument,
} from "./parser";

const baseDocument = {
  openapi: "3.1.0",
  info: { title: "Fact Data API", version: "1.4.0" },
  servers: [
    {
      url: "https://{region}.example.test/v1",
      variables: { region: { default: "eu" } },
    },
  ],
  tags: [{ name: "Facts", description: "Fact operations" }],
  paths: {
    "/facts/{id}": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", example: "fact-123" },
        },
      ],
      get: {
        operationId: "getFact",
        summary: "Get a fact",
        tags: ["Facts"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "include",
            in: "query",
            schema: { type: "string", enum: ["sources"] },
          },
          {
            name: "X-Trace-Id",
            in: "header",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Fact",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Fact" },
              },
            },
          },
        },
      },
    },
    "/facts": {
      post: {
        operationId: "createFact",
        tags: ["Facts"],
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FactInput" },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      serviceKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      oauth: {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: "https://auth.example.test/token",
            scopes: { "facts:read": "Read facts" },
          },
        },
      },
    },
    schemas: {
      Fact: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } },
      },
      FactInput: {
        type: "object",
        properties: {
          text: { type: "string", example: "The sky is blue" },
          confidence: { type: "number", default: 0.9 },
        },
      },
    },
  },
};

describe("OpenAPI parsing", () => {
  it("maps JSON operations, parameters, examples, servers, and security", () => {
    const parsed = parseOpenApiDocument(JSON.stringify(baseDocument));

    expect(parsed.format).toBe("openapi_json");
    expect(parsed.title).toBe("Fact Data API");
    expect(parsed.servers[0]?.resolvedUrl).toBe("https://eu.example.test/v1");
    expect(parsed.operations).toHaveLength(2);
    expect(parsed.securityProposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ schemeName: "bearerAuth", type: "bearer" }),
        expect.objectContaining({
          schemeName: "serviceKey",
          type: "api_key_header",
        }),
        expect.objectContaining({
          schemeName: "oauth",
          type: "oauth2_client_credentials",
        }),
      ]),
    );

    const get = parsed.operations.find(
      ({ operationId }) => operationId === "getFact",
    );
    expect(get?.generatedRequest).toMatchObject({
      name: "Get a fact",
      method: "GET",
      url: "https://eu.example.test/v1/facts/{{id}}",
      queryParameters: [
        { name: "include", value: "sources", enabled: true, secret: false },
      ],
      headers: [
        {
          name: "X-Trace-Id",
          value: "00000000-0000-4000-8000-000000000000",
          enabled: true,
          secret: false,
        },
      ],
      requestVariables: [
        { name: "id", value: "fact-123", enabled: true, secret: false },
      ],
    });

    const create = parsed.operations.find(
      ({ operationId }) => operationId === "createFact",
    );
    expect(JSON.parse(create?.generatedRequest.body.content ?? "{}")).toEqual({
      text: "The sky is blue",
      confidence: 0.9,
    });
  });

  it("parses YAML without merge keys and materialises a server variable", () => {
    const parsed = parseOpenApiDocument(`
openapi: 3.0.3
info:
  title: Small API
  version: 1.0.0
servers:
  - url: http://mock-api:4010
paths:
  /health:
    get:
      summary: Health
      responses:
        "200":
          description: OK
`);
    const operation = parsed.operations[0];
    expect(parsed.format).toBe("openapi_yaml");
    expect(operation).toBeDefined();
    expect(materialiseOpenApiRequest(operation!, "smallApiUrl").url).toBe(
      "{{smallApiUrl}}/health",
    );
  });

  it("rejects unsupported versions, duplicate YAML keys, and alias bombs", () => {
    expect(() =>
      parseOpenApiDocument(
        JSON.stringify({ swagger: "2.0", info: { title: "Old" }, paths: {} }),
      ),
    ).toThrow("Only OpenAPI 3.x");
    expect(() =>
      parseOpenApiDocument(`
openapi: 3.1.0
info: { title: One, title: Two }
paths: {}
`),
    ).toThrow("YAML is invalid");
    const aliases = Array.from({ length: 30 }, () => "*base").join(", ");
    expect(() =>
      parseOpenApiDocument(`
openapi: 3.1.0
info: { title: Alias API }
paths:
  /items:
    get: &base
      responses: { "200": { description: OK } }
components:
  schemas:
    aliases: [${aliases}]
`),
    ).toThrow("expanded safely");
  });

  it("lets operation parameters override path parameters without duplicates", () => {
    const document = structuredClone(baseDocument);
    document.paths["/facts/{id}"]!.parameters.push({
      name: "include",
      in: "query",
      required: false,
      schema: { type: "string", example: "path-default" },
    });
    const parsed = parseOpenApiDocument(JSON.stringify(document));
    const request = parsed.operations.find(
      ({ operationId }) => operationId === "getFact",
    )?.generatedRequest;

    expect(request?.queryParameters).toEqual([
      { name: "include", value: "sources", enabled: true, secret: false },
    ]);
  });

  it("rejects prototype-chain mapping keys", () => {
    expect(() =>
      parseOpenApiDocument(
        '{"openapi":"3.1.0","info":{"title":"Unsafe"},"paths":{"/ok":{"get":{"responses":{"200":{"description":"OK"}}}}},"components":{"schemas":{"constructor":{}}}}',
      ),
    ).toThrow("prohibited mapping key");
  });
});

describe("OpenAPI refresh diffing", () => {
  it("classifies added, removed, detailed operation, and global changes", () => {
    const previous = parseOpenApiDocument(JSON.stringify(baseDocument));
    const nextDocument = structuredClone(baseDocument);
    Reflect.deleteProperty(nextDocument.paths, "/facts");
    nextDocument.paths["/facts/{id}"]!.get!.parameters![0]!.required = true;
    Object.assign(nextDocument.paths, {
      "/search": {
        post: {
          operationId: "searchFacts",
          tags: ["Facts"],
          responses: { "200": { description: "Results" } },
        },
      },
    });
    nextDocument.servers[0]!.url = "https://api.example.test/v2";
    Object.assign(nextDocument.components.schemas.Fact.properties.text, {
      example: "changed",
    });
    const next = parseOpenApiDocument(JSON.stringify(nextDocument));
    const result = diffOpenApiDefinitions(
      previous,
      next,
      new Set(["GET /facts/{id}"]),
    );

    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "added",
          sourceKey: "POST /search",
        }),
        expect.objectContaining({
          category: "removed",
          sourceKey: "POST /facts",
        }),
        expect.objectContaining({
          category: "changed",
          sourceKey: "GET /facts/{id}",
          customized: true,
          details: expect.arrayContaining(["Parameters changed"]),
        }),
        expect.objectContaining({ category: "servers" }),
        expect.objectContaining({ category: "schemas" }),
      ]),
    );
  });
});
