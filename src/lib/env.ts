import { z } from "zod";

const databaseUrlSchema = z
  .string()
  .url()
  .refine(
    (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://"),
    "DATABASE_URL must use the postgres or postgresql protocol",
  );

export function getDatabaseUrl() {
  const result = databaseUrlSchema.safeParse(process.env.DATABASE_URL);

  if (!result.success) {
    throw new Error(
      "DATABASE_URL is missing or invalid. See .env.example for the expected format.",
    );
  }

  return result.data;
}
