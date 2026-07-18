import { jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { primaryId, timestamps } from "./helpers";

export const applicationSettings = pgTable(
  "application_settings",
  {
    id: primaryId(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("application_settings_key_unique").on(table.key)],
);
