import { Pool } from "pg";
import "dotenv/config";

// Single shared pool. Every project has its own isolated database per the
// Step 3 isolation rule — this pool is for the ENOS control-plane database
// only (organizations, projects metadata, events, QR, access, audit, etc.),
// never a project's operational data.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected error on idle ENOS db client", err);
  process.exit(1);
});
