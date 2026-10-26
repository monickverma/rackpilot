// Seeds the synthetic businesses into an empty database, then runs the
// investigation engine once so the planted discrepancies are detected the way
// the scheduled consistency check would detect them.

import type { PGlite } from "@electric-sql/pglite";
import { database, registerSeeder, withConnection } from "../db/client.ts";
import { ALL_TABLES } from "../db/schema.ts";
import { runChecks } from "../lib/investigate/engine.ts";
import { buildWorld } from "./build.ts";
import { writeWorld } from "./write.ts";

export async function seedInto(db: PGlite, now = new Date()) {
  const built = buildWorld(now);
  await writeWorld(db, built);
  await withConnection(db, async () => {
    for (const biz of built.businesses) await runChecks(biz.id, now, { process: "consistency check" });
  });
}

registerSeeder((db) => seedInto(db));

/** Wipes every table and regenerates the demo as of now. */
export async function resetDemo(now = new Date()) {
  const db = await database();
  await db.exec(`TRUNCATE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  await seedInto(db, now);
}
