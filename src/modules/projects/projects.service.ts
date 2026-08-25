import { pool } from "../../lib/db";
import { writeAudit } from "../../lib/audit";

export async function listProjects() {
  const { rows } = await pool.query(
    `SELECT id, name, market_segment, nature, readiness_pct, completion_pct,
            investor_onboarded, status, sensitivity
     FROM projects ORDER BY name`
  );
  return rows;
}

export async function getProject(id: string) {
  const { rows } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Publishes an approved, sanitized metrics snapshot for a project. This is
 * the ONLY path data reaches Showcase/Investment — never a live query into
 * a project's own database (Step 6, data acquisition pipeline).
 */
export async function publishMetricSnapshot(input: {
  projectId: string;
  metrics: Record<string, unknown>;
  approvedByUserId: string;
  disclosureLevel: "public" | "internal" | "restricted" | "confidential";
  source: string;
  formulaNotes?: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO project_metric_snapshots
       (project_id, metrics, approved_by, disclosure_level, source, formula_notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      input.projectId,
      JSON.stringify(input.metrics),
      input.approvedByUserId,
      input.disclosureLevel,
      input.source,
      input.formulaNotes ?? null,
    ]
  );

  await writeAudit({
    actorUserId: input.approvedByUserId,
    action: "project_metrics.published",
    targetTable: "project_metric_snapshots",
    targetId: rows[0].id,
    afterState: rows[0],
  });

  return rows[0];
}

/**
 * Latest approved snapshot at or below the caller's disclosure level.
 * This is what Showcase/Investment actually render.
 */
export async function getLatestSnapshot(
  projectId: string,
  maxDisclosure: "public" | "internal" | "restricted" | "confidential"
) {
  const order = ["public", "internal", "restricted", "confidential"];
  const allowed = order.slice(0, order.indexOf(maxDisclosure) + 1);

  const { rows } = await pool.query(
    `SELECT * FROM project_metric_snapshots
     WHERE project_id = $1 AND disclosure_level = ANY($2)
     ORDER BY snapshot_at DESC LIMIT 1`,
    [projectId, allowed]
  );
  return rows[0] ?? null;
}
