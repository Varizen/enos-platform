# Roadmap → Code Mapping

This scaffold implements **Steps 1–8** of the 15-step plan from the ENOS
planning conversation. It is a starting foundation, not a finished product —
treat it as the "technical foundation + Global Resource Center + QR Registry
+ Access Administration" slice, which the original plan estimated at
roughly weeks 1–8 of a 20–24 week programme.

| Step | What it asked for | Where it lives |
|---|---|---|
| 1. Freeze ENOS V1 scope | Only the 12 first modules | `db/001_core_schema.sql` tables map 1:1 to the module list |
| 2. Universal identifiers | ORG-, PRJ-, EVT-, QR-, CON-, INV-, DOC-, WFL-, AUD- prefixes; every record carries owner/classification/sensitivity/status/audit | Every table's shared envelope columns; ID generators in each `*.service.ts` |
| 3. Isolation and access | 13 roles, MFA-for-admins, project isolation, audited permission changes | `enos_role` enum, `trg_enforce_admin_mfa` trigger, `middleware/auth.ts`, project isolation pointers (`runtime_ref`, `database_ref`, etc. — never live connections) |
| 4. Technical foundation | Repo, envs, tests, pipeline, rollback, identity, secrets, audit, backups | This repo structure, `.github/workflows/ci.yml`, `audit_events` (append-only via trigger), `backup_records` table |
| 5. Global Resource Center | Org profile, project registry, people, events, calendar, timeline, contacts, docs, QR, dependencies | `db/002_seed_data.sql` (14 initial projects), `projects`, `people`, `events`, `contacts`, `documents`, `project_dependencies` tables |
| 6. Generic event workflow | Reusable event lifecycle, tested with a fictional event before NICE 2026 | `EVT-TEST-001` seeded; NICE 2026 insert is present but **commented out** until the generic flow is proven, exactly as instructed |
| 7. QR Registry | 10 QR types, opaque token, no embedded personal data, revocation, scan analytics | `src/modules/qr/qr.service.ts`, `qr_codes` + `qr_scans` tables |
| 8. Registration & access admin | registration → consent → verification → admin review → approval → entitlement → expiry/revocation | `src/modules/access/access.service.ts`, `access_requests` + `entitlements` tables |

## Not yet built (Steps 9–15)

Intentionally out of scope for this pass — build in this order per the
original plan:

- Step 9: Public `varizen.co` site (separate frontend project, not this repo)
- Step 10: Showcase (reads `project_metric_snapshots` — the table already
  exists and `getLatestSnapshot()` already filters by disclosure level, so
  Showcase is mostly a frontend + one more read endpoint)
- Step 11: Investment Rooms (needs new tables: funding ask, valuation,
  scenarios — extend `project_metric_snapshots`-style pattern)
- Step 12: Business Control & Finance
- Step 13: Execution & Actuation (the `workflows` table exists; only the
  generic state-machine runner is missing)
- Step 14: Elayja integration (the `elayja_service` role and
  `actor_is_elayja` audit flag already exist so this plugs in cleanly —
  give Elayja a service account with a deliberately narrow role set and it
  is architecturally incapable of the things Step 14 forbids)
- Step 15: Enter NICE 2026 as ordinary event data (uncomment the seed rows)

## Design decisions worth knowing about

- **QR is never a credential.** `qr_codes.destination_rule` is a role-gated
  *rule*, not a URL. `resolveQrToken()` validates the QR's own state and
  hands back a rule for the caller to route by — actual protected content
  still requires the full access-request → entitlement chain.
- **Projects are isolated by pointer, not by data.** `projects.runtime_ref`,
  `database_ref`, `credentials_vault_ref` are opaque strings ENOS stores for
  bookkeeping. ENOS's own database never contains a project's operational
  data or live connection strings — only what's explicitly published via
  `project_metric_snapshots`.
- **Audit log is append-only at the database level**, not just by
  convention — `trg_block_audit_update` raises on any UPDATE/DELETE against
  `audit_events`.
- **Admin roles require MFA already-enabled**, enforced by a DB trigger
  (`trg_enforce_admin_mfa`), independent of whatever the application layer
  does — a backstop against a future code change accidentally skipping the
  check.
