import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getDatabaseUrl } from "@/lib/env";

import * as schema from "./schema";

let queryClient: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDatabase() {
  if (!queryClient) {
    queryClient = postgres(getDatabaseUrl(), {
      max: 10,
      prepare: false,
      idle_timeout: 20,
    });
    database = drizzle(queryClient, { schema });
  }

  return database as ReturnType<typeof drizzle<typeof schema>>;
}

export async function closeDatabase() {
  await queryClient?.end({ timeout: 5 });
  queryClient = undefined;
  database = undefined;
}
