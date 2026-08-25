import express from "express";
import "dotenv/config";
import path from "path";
import QRCode from "qrcode";
import { requireAuth, requireRole } from "./middleware/auth";
import * as qrService from "./modules/qr/qr.service";
import * as accessService from "./modules/access/access.service";
import * as projectsService from "./modules/projects/projects.service";

const app = express();
app.use(express.json());

// --------------------------------------------------------------------------
// Root + Health — no auth.
// --------------------------------------------------------------------------
app.get("/", (_req, res) => res.json({
  name: "ENOS Platform API",
  version: "0.1.0",
  status: "ok",
  docs: "/health"
}));
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

// Returns a PNG QR code image for a registered QR (auth required).
app.get("/api/qr/:qrId/image", requireAuth, async (req, res) => {
  const { rows } = await (await import("./lib/db")).pool.query(
    `SELECT opaque_token FROM qr_codes WHERE id = $1 AND status = 'active'`,
    [req.params.qrId]
  );
  if (rows.length === 0) return res.status(404).json({ error: "QR not found or inactive" });
  const shortLink = `${process.env.QR_SHORT_LINK_BASE ?? "https://go.varizen.co/q"}/${rows[0].opaque_token}`;
  const png = await QRCode.toBuffer(shortLink, { type: "png", width: 400, margin: 2 });
  res.set("Content-Type", "image/png").send(png);
});

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

// --------------------------------------------------------------------------
// SHOWCASE  (showcase.varizen.co → CNAME → this service)
// --------------------------------------------------------------------------
app.get("/showcase", async (_req, res) => {
  const projects = await projectsService.listProjects().catch(() => []);
  res.set("Content-Type", "text/html").send(showcaseHtml(projects));
});

// --------------------------------------------------------------------------
// INVESTMENT  (investment.varizen.co → CNAME → this service)
// --------------------------------------------------------------------------
app.get("/investment", (_req, res) => {
  res.set("Content-Type", "text/html").send(investmentHtml());
});

function showcaseHtml(projects: any[]) {
  const cards = projects.length
    ? projects.map((p: any) => `
      <div class="card">
        <div class="tag">${p.nature ?? "project"}</div>
        <h3>${p.name ?? p.id}</h3>
        <p>${p.description ?? ""}</p>
        <div class="meta">
          <span class="badge">${p.status ?? "active"}</span>
          <span class="badge dim">${p.id}</span>
        </div>
      </div>`).join("")
    : `<p class="empty">Projects loading — database initialising.</p>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Varizen Showcase</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:#f7f9fc;color:#0a1733;min-height:100vh}
nav{background:#fff;border-bottom:1px solid #e2e7ef;padding:0 32px;height:64px;display:flex;align-items:center;justify-content:space-between}
.logo{font-weight:800;font-size:18px;letter-spacing:-.03em;color:#0a1733}
.logo span{color:#0080FA}
.hero{padding:64px 32px 40px;max-width:1100px;margin:auto}
.hero h1{font-size:clamp(32px,5vw,56px);font-weight:800;letter-spacing:-.04em;margin-bottom:14px}
.hero p{color:#65718a;font-size:18px;max-width:580px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;max-width:1100px;margin:0 auto;padding:0 32px 64px}
.card{background:#fff;border:1px solid #e2e7ef;border-radius:12px;padding:24px;transition:.2s}
.card:hover{border-color:#0080FA;box-shadow:0 8px 24px #0080fa18}
.tag{display:inline-block;font-size:11px;background:#eef3ff;color:#174fc9;padding:4px 10px;border-radius:99px;margin-bottom:14px;text-transform:capitalize}
.card h3{font-size:18px;font-weight:700;margin-bottom:8px}
.card p{color:#65718a;font-size:14px;line-height:1.6}
.meta{margin-top:16px;display:flex;gap:8px;flex-wrap:wrap}
.badge{font-size:11px;padding:3px 8px;border-radius:6px;background:#f0f3f8;color:#0a1733;font-family:monospace}
.badge.dim{color:#65718a}
.empty{text-align:center;color:#65718a;padding:64px;font-size:16px;grid-column:1/-1}
footer{background:#0080FA;color:#fff;padding:40px 32px;text-align:center}
footer a{color:#fff;opacity:.8;text-decoration:none;margin:0 12px}
</style></head><body>
<nav><span class="logo">Vari<span>zen</span></span><a href="https://varizen.co" style="color:#65718a;font-size:14px;text-decoration:none">← varizen.co</a></nav>
<div class="hero"><h1>Varizen Portfolio Showcase</h1><p>Governed projects, verified progress, transparent pipeline.</p></div>
<div class="grid">${cards}</div>
<footer><a href="https://varizen.co">varizen.co</a><a href="/investment">Investment</a><a href="/health">API Status</a></footer>
</body></html>`;
}

function investmentHtml() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Varizen Investment</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:#0a1733;color:#fff;min-height:100vh}
nav{background:#0a1733;border-bottom:1px solid #1e2d4a;padding:0 32px;height:64px;display:flex;align-items:center;justify-content:space-between}
.logo{font-weight:800;font-size:18px;letter-spacing:-.03em}
.logo span{color:#0080FA}
.hero{padding:80px 32px 48px;max-width:900px;margin:auto;text-align:center}
.hero h1{font-size:clamp(36px,5vw,64px);font-weight:800;letter-spacing:-.04em;margin-bottom:18px}
.hero p{color:#8fa3c0;font-size:18px;max-width:560px;margin:0 auto 40px}
.access-box{background:#111f36;border:1px solid #1e2d4a;border-radius:16px;padding:40px;max-width:520px;margin:0 auto}
.access-box h2{font-size:24px;font-weight:700;margin-bottom:12px}
.access-box p{color:#8fa3c0;font-size:15px;margin-bottom:28px;line-height:1.6}
.field{display:grid;gap:8px;margin-bottom:18px;text-align:left}
.field label{font-size:13px;font-weight:600;color:#c5d4e8}
.field input{height:46px;background:#0a1733;border:1px solid #1e2d4a;border-radius:8px;color:#fff;padding:0 14px;font-size:15px;width:100%}
.field input:focus{outline:none;border-color:#0080FA}
.btn{width:100%;height:48px;background:#0080FA;border:0;border-radius:8px;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.btn:hover{background:#0070e0}
.note{font-size:12px;color:#65718a;margin-top:14px;text-align:center}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:900px;margin:64px auto;padding:0 32px}
.step{background:#111f36;border:1px solid #1e2d4a;border-radius:12px;padding:24px}
.step-num{font-size:28px;font-weight:800;color:#0080FA;margin-bottom:10px}
.step h3{font-size:16px;font-weight:700;margin-bottom:8px}
.step p{color:#8fa3c0;font-size:14px;line-height:1.5}
footer{border-top:1px solid #1e2d4a;padding:32px;text-align:center;color:#65718a;font-size:13px}
footer a{color:#8fa3c0;text-decoration:none;margin:0 10px}
</style></head><body>
<nav><span class="logo">Vari<span>zen</span></span><a href="https://varizen.co" style="color:#8fa3c0;font-size:14px;text-decoration:none">← varizen.co</a></nav>
<div class="hero">
  <h1>Varizen Investment Access</h1>
  <p>Controlled, governed access to investment information for qualified reviewers.</p>
  <div class="access-box">
    <h2>Request Access</h2>
    <p>Investment rooms are restricted to approved reviewers. Submit your details to begin the access workflow.</p>
    <form onsubmit="handleRequest(event)">
      <div class="field"><label>Full Name</label><input type="text" id="name" required placeholder="Your full name"></div>
      <div class="field"><label>Email Address</label><input type="email" id="email" required placeholder="official@organisation.com"></div>
      <div class="field"><label>Organisation</label><input type="text" id="org" required placeholder="Organisation name"></div>
      <button class="btn" type="submit">Request Investment Access</button>
    </form>
    <p class="note" id="msg">Access is subject to review. You will receive an email within 24–48 hours.</p>
  </div>
</div>
<div class="steps">
  <div class="step"><div class="step-num">01</div><h3>Submit Request</h3><p>Provide your details and organisation. All submissions are verified.</p></div>
  <div class="step"><div class="step-num">02</div><h3>Admin Review</h3><p>ENOS governance team reviews and approves qualified investors within 48 hours.</p></div>
  <div class="step"><div class="step-num">03</div><h3>Secure Access</h3><p>You receive a secure, time-limited link to the investment room with your entitlement level.</p></div>
</div>
<footer><a href="https://varizen.co">varizen.co</a><a href="/showcase">Showcase</a><a href="/health">API Status</a></footer>
<script>
async function handleRequest(e) {
  e.preventDefault();
  const msg = document.getElementById('msg');
  msg.textContent = 'Submitting...';
  try {
    const res = await fetch('/api/access-requests', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        fullName: document.getElementById('name').value,
        email: document.getElementById('email').value,
        organizationName: document.getElementById('org').value,
        requestType: 'investor_access',
        qrToken: null
      })
    });
    if (res.ok) msg.textContent = '✓ Request submitted. You will be contacted within 48 hours.';
    else msg.textContent = 'Error submitting — please email invest@varizen.co directly.';
  } catch { msg.textContent = 'Network error. Please try again.'; }
}
</script>
</body></html>`;
}

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`ENOS control plane listening on :${port}`);
});
