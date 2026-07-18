import { sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDatabase().execute(sql`select 1`);

    return Response.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      {
        status: "degraded",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
