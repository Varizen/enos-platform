import { customAlphabet } from "nanoid";
import { pool } from "./db";

// AUD-000001 style IDs
const numericId = customAlphabet("0123456789", 6);
export function nextAuditId(): string {
  return `AUD-${numericId()}`;
}

interface AuditEntryInput {
  actorUserId: string | null;
  actorIsElayja?: boolean;
  action: string;            // e.g. 'qr.revoked', 'access.approved', 'role.granted'
  targetTable: string;
  targetId: string;
  beforeState?: unknown;
  afterState?: unknown;
}

/**
 * Writes an append-only audit record. Call this from EVERY mutation that
 * touches a governed table (see Step 3: "Every permission change is
 * audited") and every workflow transition (Step 13: request -> policy
 * check -> approval -> execution -> verification -> evidence -> audit).
 *
 * The audit_events table itself blocks UPDATE/DELETE at the DB level
 * (see db/001_core_schema.sql), so this function is the only sanctioned
 * way records land there.
 */
export async function writeAudit(entry: AuditEntryInput): Promise<void> {
  const id = nextAuditId();
  await pool.query(
    `INSERT INTO audit_events
       (id, actor_user_id, actor_is_elayja, action, target_table, target_id, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      entry.actorUserId,
      entry.actorIsElayja ?? false,
      entry.action,
      entry.targetTable,
      entry.targetId,
      entry.beforeState ? JSON.stringify(entry.beforeState) : null,
      entry.afterState ? JSON.stringify(entry.afterState) : null,
    ]
  );
}
