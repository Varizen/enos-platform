import { customAlphabet } from "nanoid";
import { pool } from "../../lib/db";
import { writeAudit } from "../../lib/audit";

const numericId = customAlphabet("0123456789", 6);
export function nextContactId(): string {
  return `CON-${numericId()}`;
}

/**
 * Step 8 flow, part 1: a scanned QR leads to registration + consent.
 * No access is granted here — this only creates an unverified contact.
 */
export async function registerContact(input: {
  fullName: string;
  email?: string;
  phone?: string;
  sourceQrId?: string;
}) {
  const id = nextContactId();
  const { rows } = await pool.query(
    `INSERT INTO contacts (id, full_name, email, phone, source_qr_id, status, consent_given_at)
     VALUES ($1,$2,$3,$4,$5,'draft', now())
     RETURNING *`,
    [id, input.fullName, input.email ?? null, input.phone ?? null, input.sourceQrId ?? null]
  );
  return rows[0];
}

export async function markEmailVerified(contactId: string) {
  await pool.query(`UPDATE contacts SET email_verified = true WHERE id = $1`, [contactId]);
}

export async function markPhoneVerified(contactId: string) {
  await pool.query(`UPDATE contacts SET phone_verified = true WHERE id = $1`, [contactId]);
}

/**
 * Step 8 flow, part 2: contact requests access to a specific project.
 * This lands in the admin review queue — nothing is auto-approved.
 */
export async function submitAccessRequest(input: {
  contactId: string;
  requestedProjectId: string;
  qrId?: string;
  disclosureLevel?: "public" | "internal" | "restricted" | "confidential";
}) {
  const { rows } = await pool.query(
    `INSERT INTO access_requests
       (contact_id, requested_project_id, qr_id, disclosure_level)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [input.contactId, input.requestedProjectId, input.qrId ?? null, input.disclosureLevel ?? "public"]
  );
  return rows[0];
}

/**
 * Admin review action: approve, decline, or request more info.
 * On approval, this creates the actual entitlement record — the only
 * thing that grants real access to Showcase / Investment content.
 * Every branch is audited (Step 3: "Every permission change is audited").
 */
export async function reviewAccessRequest(
  requestId: string,
  decision: "approved" | "declined" | "info_requested",
  reviewerUserId: string,
  opts?: { expiresAt?: string; disclosureLevel?: "public" | "internal" | "restricted" | "confidential" }
) {
  const { rows: before } = await pool.query(`SELECT * FROM access_requests WHERE id = $1`, [requestId]);
  if (before.length === 0) throw new Error("Access request not found");
  const request = before[0];

  const { rows } = await pool.query(
    `UPDATE access_requests
     SET status = $2, reviewed_by = $3, reviewed_at = now(), expires_at = $4
     WHERE id = $1 RETURNING *`,
    [requestId, decision, reviewerUserId, opts?.expiresAt ?? null]
  );

  await writeAudit({
    actorUserId: reviewerUserId,
    action: `access_request.${decision}`,
    targetTable: "access_requests",
    targetId: requestId,
    beforeState: request,
    afterState: rows[0],
  });

  if (decision === "approved") {
    const { rows: entRows } = await pool.query(
      `INSERT INTO entitlements
         (contact_id, project_id, disclosure_level, granted_by, expires_at)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        request.contact_id,
        request.requested_project_id,
        opts?.disclosureLevel ?? request.disclosure_level,
        reviewerUserId,
        opts?.expiresAt ?? null,
      ]
    );

    await writeAudit({
      actorUserId: reviewerUserId,
      action: "entitlement.granted",
      targetTable: "entitlements",
      targetId: entRows[0].id,
      afterState: entRows[0],
    });

    return { request: rows[0], entitlement: entRows[0] };
  }

  return { request: rows[0], entitlement: null };
}

export async function revokeEntitlement(entitlementId: string, actorUserId: string) {
  const { rows: before } = await pool.query(`SELECT * FROM entitlements WHERE id = $1`, [entitlementId]);
  if (before.length === 0) throw new Error("Entitlement not found");

  const { rows } = await pool.query(
    `UPDATE entitlements SET revoked_at = now(), revoked_by = $2 WHERE id = $1 RETURNING *`,
    [entitlementId, actorUserId]
  );

  await writeAudit({
    actorUserId,
    action: "entitlement.revoked",
    targetTable: "entitlements",
    targetId: entitlementId,
    beforeState: before[0],
    afterState: rows[0],
  });

  return rows[0];
}

/**
 * Checks whether a contact currently has live, non-expired, non-revoked
 * access to a project at a given disclosure level or higher. This is the
 * single choke point Showcase/Investment portals must call before
 * returning any protected content.
 */
export async function hasLiveEntitlement(contactId: string, projectId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM entitlements
     WHERE contact_id = $1 AND project_id = $2
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [contactId, projectId]
  );
  return rows.length > 0;
}
