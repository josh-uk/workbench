import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("PostgreSQL integration", () => {
  let client: ReturnType<typeof postgres>;

  beforeAll(() => {
    client = postgres(databaseUrl as string, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("connects to the configured database", async () => {
    const [result] = await client<{ answer: number }[]>`select 1 as answer`;

    expect(result?.answer).toBe(1);
  });
});
