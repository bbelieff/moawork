import "dotenv/config";
import { Pool } from "pg";
import { checkOutboxOperationalReadiness } from "./jobs/outbox/operational-check.js";

const connectionString = process.env.OUTBOX_DATABASE_URL;
if (!connectionString) throw new Error("OUTBOX_DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 1 });
try {
  const result = await checkOutboxOperationalReadiness({ query: (sql, values) => pool.query(sql, values as unknown[]) });
  console.log(JSON.stringify({ ready: true, identity: result.identity, rowSecurityOn: result.rowSecurityOn, schemaReady: result.schemaReady, canClaim: result.canClaim, pendingRows: result.pendingRows }));
} finally {
  await pool.end();
}
