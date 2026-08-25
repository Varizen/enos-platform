import { customAlphabet } from "nanoid";
import { pool } from "../../lib/db";
import { writeAudit } from "../../lib/audit";

const numericId = customAlphabet("0123456789", 6);
const yearNow = () => new Date().getFullYear();

export function nextQrId(): string {
  return `QR-${yearNow()}-${numericId()}`;
}

export type QrType =
  | "corporate" | "event" | "visiting_card" | "project"
  | "investor_invitation" | "customer_invitation" | "referral"
  | "document_verification" | "temporary_access" | "campaign";

export interface CreateQrInput {
  qrType: QrType;
  ownerUserId: string;
  projectId?: string;
  campaignId?: string;
  distributionSource?: string;
  destinationRule: Record<string, unknown>; // role-gated routing rule, never a raw destination URL
  expiryDate?: string; // ISO date
  scanLimit?: number;
  approvalRequired?: boolean;
}

/**
 * Registers a new QR. IMPORTANT: the QR never encodes personal or access
 * information (Step 7). It encodes only an opaque token; every actual
 * routing/authorization decision happens server-side at resolution time.
 */
export async function createQr(input: CreateQrInput, actorUserId: string) {
  const id = nextQrId();
  const { rows } = await pool.query(
    `INSERT INTO qr_codes
       (id, qr_type, owner_user_id, project_id, campaign_id, distribution_source,
        destination_rule, expiry_date, scan_limit, approval_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      id,
      input.qrType,
      input.ownerUserId,
      input.projectId ?? null,
      input.campaignId ?? null,
      input.distributionSource ?? null,
      JSON.stringify(input.destinationRule),
      input.expiryDate ?? null,
      input.scanLimit ?? null,
      input.approvalRequired ?? true,
    ]
  );

  const qr = rows[0];
  await writeAudit({
    actorUserId,
    action: "qr.created",
    targetTable: "qr_codes",
    targetId: id,
    afterState: qr,
  });

  const shortLinkBase = process.env.QR_SHORT_LINK_BASE ?? "https://go.varizen.co/q";
  return { ...qr, short_link: `${shortLinkBase}/${qr.opaque_token}` };
}

/**
 * Resolution flow for a scanned QR token. This performs NO authentication
 * itself — it validates the QR's own state (active, not expired, under
 * scan limit) and returns a destination *rule* for the caller to route by.
 * Actual protected-resource access still requires the full registration ->
 * verification -> admin approval -> entitlement chain (Step 8).
 */
export async function resolveQrToken(token: string, scanMeta: { ipHash?: string; userAgent?: string }) {
  const { rows } = await pool.query(`SELECT * FROM qr_codes WHERE opaque_token = $1`, [token]);
  const qr = rows[0];
  if (!qr) return { valid: false, reason: "not_found" as const };

  if (qr.status === "revoked") return { valid: false, reason: "revoked" as const };
  if (qr.status !== "active") return { valid: false, reason: "inactive" as const };
  if (qr.expiry_date && new Date(qr.expiry_date) < new Date()) {
    return { valid: false, reason: "expired" as const };
  }

  if (qr.scan_limit != null) {
    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS n FROM qr_scans WHERE qr_id = $1`,
      [qr.id]
    );
    if (countRows[0].n >= qr.scan_limit) {
      return { valid: false, reason: "scan_limit_reached" as const };
    }
  }

  await pool.query(
    `INSERT INTO qr_scans (qr_id, ip_hash, user_agent) VALUES ($1,$2,$3)`,
    [qr.id, scanMeta.ipHash ?? null, scanMeta.userAgent ?? null]
  );

  return {
    valid: true as const,
    qrId: qr.id,
    qrType: qr.qr_type,
    projectId: qr.project_id,
    destinationRule: qr.destination_rule,
    approvalRequired: qr.approval_required,
  };
}

export async function revokeQr(qrId: string, actorUserId: string) {
  const { rows: before } = await pool.query(`SELECT * FROM qr_codes WHERE id = $1`, [qrId]);
  if (before.length === 0) throw new Error("QR not found");

  const { rows } = await pool.query(
    `UPDATE qr_codes SET status = 'revoked', revoked_at = now(), revoked_by = $2
     WHERE id = $1 RETURNING *`,
    [qrId, actorUserId]
  );

  await writeAudit({
    actorUserId,
    action: "qr.revoked",
    targetTable: "qr_codes",
    targetId: qrId,
    beforeState: before[0],
    afterState: rows[0],
  });

  return rows[0];
}
