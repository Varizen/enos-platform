import express from "express";
import "dotenv/config";
import { requireAuth, requireRole } from "./middleware/auth";
import * as qrService from "./modules/qr/qr.service";
import * as accessService from "./modules/access/access.service";
import * as projectsService from "./modules/projects/projects.service";

const app = express();
app.use(express.json());

// --------------------------------------------------------------------------
// Health check — no auth. Used by uptime monitoring / load balancer.
// --------------------------------------------------------------------------
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// --------------------------------------------------------------------------
// PROJECT REGISTRY
// --------------------------------------------------------------------------
app.get("/api/projects", requireAuth, async (_req, res) => {
  res.json(await projectsService.listProjects());
});

app.get("/api/projects/:projectId", requireAuth, async (req, res) => {
  const project = await projectsService.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: "Not found" });
  res.json(project);
});

app.post(
  "/api/projects/:projectId/metrics",
  requireAuth,
  requireRole("project_owner", "enos_admin", "corporate_admin"),
  async (req, res) => {
    const snapshot = await projectsService.publishMetricSnapshot({
      projectId: req.params.projectId,
      metrics: req.body.metrics,
      approvedByUserId: req.user!.userId,
      disclosureLevel: req.body.disclosureLevel ?? "public",
      source: req.body.source ?? "manual_entry",
      formulaNotes: req.body.formulaNotes,
    });
    res.status(201).json(snapshot);
  }
);

// --------------------------------------------------------------------------
// QR REGISTRY  (Step 7)
// --------------------------------------------------------------------------
app.post(
  "/api/qr",
  requireAuth,
  requireRole("enos_admin", "event_manager", "project_owner", "corporate_admin"),
  async (req, res) => {
    const qr = await qrService.createQr(
      { ...req.body, ownerUserId: req.user!.userId },
      req.user!.userId
    );
    res.status(201).json(qr);
  }
);

// Public resolution endpoint — this is what go.varizen.co/q/:token hits.
// No auth required to SCAN; auth is required later for anything protected.
app.get("/api/qr/resolve/:token", async (req, res) => {
  const ipHash = req.ip ? Buffer.from(req.ip).toString("base64") : undefined; // placeholder hash
  const result = await qrService.resolveQrToken(req.params.token, {
    ipHash,
    userAgent: req.headers["user-agent"],
  });
  if (!result.valid) return res.status(410).json(result);
  res.json(result);
});

app.post(
  "/api/qr/:qrId/revoke",
  requireAuth,
  requireRole("enos_admin", "corporate_admin", "project_owner"),
  async (req, res) => {
    const qr = await qrService.revokeQr(req.params.qrId, req.user!.userId);
    res.json(qr);
  }
);

// --------------------------------------------------------------------------
// ACCESS ADMINISTRATION  (Step 8)
// --------------------------------------------------------------------------
app.post("/api/contacts/register", async (req, res) => {
  const contact = await accessService.registerContact(req.body);
  res.status(201).json(contact);
});

app.post("/api/contacts/:contactId/verify-email", async (req, res) => {
  await accessService.markEmailVerified(req.params.contactId);
  res.status(204).send();
});

app.post("/api/access-requests", async (req, res) => {
  const request = await accessService.submitAccessRequest(req.body);
  res.status(201).json(request);
});

app.post(
  "/api/access-requests/:requestId/review",
  requireAuth,
  requireRole("enos_admin", "corporate_admin", "compliance_officer"),
  async (req, res) => {
    const result = await accessService.reviewAccessRequest(
      req.params.requestId,
      req.body.decision,
      req.user!.userId,
      { expiresAt: req.body.expiresAt, disclosureLevel: req.body.disclosureLevel }
    );
    res.json(result);
  }
);

app.post(
  "/api/entitlements/:entitlementId/revoke",
  requireAuth,
  requireRole("enos_admin", "corporate_admin"),
  async (req, res) => {
    const entitlement = await accessService.revokeEntitlement(req.params.entitlementId, req.user!.userId);
    res.json(entitlement);
  }
);

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`ENOS control plane listening on :${port}`);
});
