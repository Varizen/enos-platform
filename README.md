# ENOS — Varizen Cloud Control Plane

ENOS is Varizen Inc.'s central governance, security, resource, financial,
execution, intelligence and portfolio operating platform. **It is a cloud
application, not a Linux distribution or bootable OS** — that decision was
made explicitly during planning (see `docs/ROADMAP_MAPPING.md`).

This repo is the initial production scaffold covering **Steps 1–8** of the
15-step build plan: frozen V1 scope, universal identifiers, roles/isolation,
technical foundation, the Global Resource Center, a generic event workflow,
the QR Registry, and Access Administration.

## Quick start

```bash
cp .env.example .env          # fill in DATABASE_URL, JWT_SECRET
docker compose up -d          # starts local Postgres on :5432
npm install
npm run migrate               # applies db/001_core_schema.sql + seed data
npm run dev                   # starts the API on :4000
```

Check it's alive:

```bash
curl http://localhost:4000/health
```

## Repo layout

```
db/
  001_core_schema.sql   # full schema: orgs, projects, events, QR, access, audit
  002_seed_data.sql      # bootstraps ORG-VARIZEN-001 + the 14 initial projects
src/
  server.ts              # Express app, route wiring
  middleware/auth.ts      # JWT auth + role-based access control (13 roles)
  lib/db.ts               # Postgres pool
  lib/audit.ts             # append-only audit logging helper
  modules/
    qr/                    # QR Registry (Step 7)
    access/                 # Registration, verification, entitlements (Step 8)
    projects/                # Project registry + metric snapshot publishing
docs/
  ROADMAP_MAPPING.md         # maps every table/module back to the original plan
```

## Core principles this scaffold enforces, not just documents

1. **A QR code is a tracked entry point, never a credential.** See
   `src/modules/qr/qr.service.ts`.
2. **Projects are isolated by default.** ENOS stores pointers
   (`runtime_ref`, `database_ref`, `credentials_vault_ref`), never a
   project's live data or connection strings.
3. **Every governed record carries the full envelope**: owner,
   classification, sensitivity, status, access policy, retention policy,
   creation/update timestamps — enforced by schema, not convention.
4. **The audit log is append-only at the database level** (a trigger blocks
   UPDATE/DELETE on `audit_events`), and every mutation in every service
   module calls `writeAudit()`.
5. **Admin roles cannot be granted without MFA already enabled** — enforced
   by a database trigger as a backstop independent of the application code.
6. **Elayja's capabilities are bounded by what roles its service identity
   is ever granted** — not by a prompt or policy document. Give
   `elayja_service` a narrow role set and the "Elayja cannot..." list from
   Step 14 falls out of the access-control model automatically.

## What's intentionally NOT here yet

Public site, Showcase, Investment Rooms, Business/Finance, Execution &
Actuation runner, and the actual Elayja integration — see
`docs/ROADMAP_MAPPING.md` for what's next and why this build order was
chosen.

## Tech stack

Node.js + TypeScript + Express + PostgreSQL. Chosen for wide hiring
availability and because nothing about ENOS's requirements (governance,
audit, RBAC, workflow orchestration) needs anything more exotic.
