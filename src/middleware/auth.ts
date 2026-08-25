import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../lib/db";

// Mirrors db enum enos_role — keep in sync with db/001_core_schema.sql
export type EnosRole =
  | "corporate_admin"
  | "enos_admin"
  | "internal_staff"
  | "project_owner"
  | "project_staff"
  | "finance_officer"
  | "compliance_officer"
  | "event_manager"
  | "investor_reviewer"
  | "investor"
  | "auditor"
  | "read_only_observer"
  | "elayja_service";

export interface AuthedUser {
  userId: string;
  email: string;
  isElayja: boolean;
  mfaVerifiedThisSession: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/**
 * Verifies the bearer JWT and attaches the authed user to the request.
 * All protected routes require this first (Step 3: "Protected URLs
 * require server-side authorisation").
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  try {
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthedUser;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Requires that the authed user holds at least one of the given roles,
 * either org-wide or scoped to req.params.projectId when provided.
 * Elayja's service identity is checked the same way — it simply never
 * holds roles like corporate_admin, so capability boundaries in Step 14
 * ("Elayja cannot change permissions / move money / ...") fall straight
 * out of what roles are ever granted to elayja_service.
 */
export function requireRole(...allowed: EnosRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const projectId = req.params.projectId ?? null;
    const { rows } = await pool.query(
      `SELECT role FROM user_roles
       WHERE user_id = $1 AND role = ANY($2::enos_role[])
         AND (project_id = $3 OR project_id IS NULL)`,
      [req.user.userId, allowed, projectId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: "Insufficient role for this action" });
    }
    next();
  };
}

/**
 * Hard MFA gate for admin-level actions, independent of the DB trigger
 * that blocks granting admin roles without MFA. This checks the CURRENT
 * session actually completed MFA, not just that the account has it enabled.
 */
export function requireMfa(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.mfaVerifiedThisSession) {
    return res.status(403).json({ error: "MFA verification required for this action" });
  }
  next();
}
