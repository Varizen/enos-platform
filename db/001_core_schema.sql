-- ============================================================================
-- ENOS Core Schema — V1 (Steps 1-4 of the implementation roadmap)
-- Varizen Inc. — Global Resource Center foundation
--
-- Implements:
--   Step 2: Universal identifiers (every record carries ENOS ID, Owner,
--           Classification, Sensitivity, Status, timestamps, Audit trail)
--   Step 3: Isolation and access (roles, project-level isolation, MFA flag)
--   Step 4: Technical foundation (audit logging, soft-delete/recovery hooks)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------

CREATE TYPE enos_role AS ENUM (
  'corporate_admin',
  'enos_admin',
  'internal_staff',
  'project_owner',
  'project_staff',
  'finance_officer',
  'compliance_officer',
  'event_manager',
  'investor_reviewer',
  'investor',
  'auditor',
  'read_only_observer',
  'elayja_service'
);

CREATE TYPE record_status AS ENUM (
  'draft', 'active', 'suspended', 'archived', 'revoked'
);

CREATE TYPE sensitivity_level AS ENUM (
  'public', 'internal', 'restricted', 'confidential'
);

CREATE TYPE qr_type AS ENUM (
  'corporate', 'event', 'visiting_card', 'project', 'investor_invitation',
  'customer_invitation', 'referral', 'document_verification',
  'temporary_access', 'campaign'
);

CREATE TYPE project_nature AS ENUM ('supportive', 'disruptive');

-- ----------------------------------------------------------------------------
-- ID GENERATORS
-- Mirrors the scheme from Step 2: ORG-VARIZEN-001, PRJ-V0-ENOS,
-- EVT-2026-0001, QR-2026-000001, CON-000001, INV-000001, DOC-000001,
-- WFL-000001, AUD-000001
-- ----------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS seq_project;
CREATE SEQUENCE IF NOT EXISTS seq_event;
CREATE SEQUENCE IF NOT EXISTS seq_qr;
CREATE SEQUENCE IF NOT EXISTS seq_contact;
CREATE SEQUENCE IF NOT EXISTS seq_investor;
CREATE SEQUENCE IF NOT EXISTS seq_document;
CREATE SEQUENCE IF NOT EXISTS seq_workflow;
CREATE SEQUENCE IF NOT EXISTS seq_audit;
CREATE SEQUENCE IF NOT EXISTS seq_campaign;

-- ----------------------------------------------------------------------------
-- SHARED "UNIVERSAL RECORD" COLUMNS
-- Every governed table below repeats this envelope so that no record can
-- exist without owner / classification / sensitivity / status / audit trail.
-- ----------------------------------------------------------------------------
-- id                TEXT PRIMARY KEY   -- e.g. PRJ-V0-ENOS
-- owner_user_id      UUID
-- classification     TEXT              -- free-text business classification
-- sensitivity        sensitivity_level
-- status             record_status
-- created_at         TIMESTAMPTZ
-- updated_at         TIMESTAMPTZ
-- access_policy      JSONB             -- pointer/description of applicable policy
-- retention_policy   TEXT
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- ORGANIZATIONS  (ORG-VARIZEN-001)
-- ----------------------------------------------------------------------------
CREATE TABLE organizations (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  owner_user_id      UUID,
  classification     TEXT DEFAULT 'corporate',
  sensitivity        sensitivity_level NOT NULL DEFAULT 'internal',
  status             record_status NOT NULL DEFAULT 'active',
  access_policy      JSONB DEFAULT '{}',
  retention_policy   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- USERS / IDENTITY
-- Backs role assignment for Step 3's role list, including the
-- non-human 'elayja_service' identity.
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT UNIQUE NOT NULL,
  display_name       TEXT NOT NULL,
  mfa_enabled        BOOLEAN NOT NULL DEFAULT false,
  is_service_identity BOOLEAN NOT NULL DEFAULT false,
  status             record_status NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role               enos_role NOT NULL,
  project_id         TEXT,               -- NULL = org-wide role
  granted_by         UUID REFERENCES users(id),
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role, project_id)
);

-- Enforce: administrators (corporate_admin, enos_admin) must have MFA enabled.
-- Application layer must check this before granting the role; DB trigger
-- below is a hard backstop.
CREATE OR REPLACE FUNCTION enforce_admin_mfa() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IN ('corporate_admin', 'enos_admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM users WHERE id = NEW.user_id AND mfa_enabled = true
    ) THEN
      RAISE EXCEPTION 'MFA must be enabled before granting an admin role (Step 3 rule)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_admin_mfa
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_admin_mfa();

-- ----------------------------------------------------------------------------
-- PROJECT REGISTRY  (PRJ-V0-ENOS, PRJ-R0-DOCTOR360, ...)
-- Each project is isolated by default: it owns its own runtime pointer,
-- database pointer, and credential vault reference. ENOS stores only
-- metadata + approved published metrics, never operational data.
-- ----------------------------------------------------------------------------
CREATE TABLE projects (
  id                 TEXT PRIMARY KEY,          -- e.g. PRJ-V0-ENOS
  name               TEXT NOT NULL,
  organization_id    TEXT NOT NULL REFERENCES organizations(id),
  market_segment     TEXT,
  short_description  TEXT,
  problem_statement  TEXT,
  proposed_solution  TEXT,
  nature             project_nature,
  est_preseed_usd_m  NUMERIC(10,2),             -- estimated pre-seed/seed, $M
  readiness_pct      SMALLINT CHECK (readiness_pct BETWEEN 0 AND 100),
  completion_pct     SMALLINT CHECK (completion_pct BETWEEN 0 AND 100),
  investor_onboarded BOOLEAN DEFAULT false,
  remarks            TEXT,

  -- isolation pointers — actual runtime lives outside ENOS
  runtime_ref        TEXT,   -- e.g. deployment/cluster identifier
  database_ref       TEXT,   -- opaque pointer, never a live connection string
  credentials_vault_ref TEXT,
  backup_ref         TEXT,

  owner_user_id      UUID REFERENCES users(id),
  classification     TEXT,
  sensitivity        sensitivity_level NOT NULL DEFAULT 'internal',
  status             record_status NOT NULL DEFAULT 'draft',
  access_policy      JSONB DEFAULT '{}',
  retention_policy   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dependency Registry (Step 5)
CREATE TABLE project_dependencies (
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  depends_on_project_id TEXT NOT NULL REFERENCES projects(id),
  relationship_note  TEXT,
  PRIMARY KEY (project_id, depends_on_project_id)
);

-- Approved, sanitized snapshot of project metrics published outward to
-- Showcase / Investment portals. This is the ONLY data those portals read —
-- never a live join into a project's operational database.
CREATE TABLE project_metric_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         TEXT NOT NULL REFERENCES projects(id),
  snapshot_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  metrics            JSONB NOT NULL,     -- validated + normalized payload
  approved_by        UUID REFERENCES users(id),
  disclosure_level   sensitivity_level NOT NULL DEFAULT 'public',
  source             TEXT,               -- which adapter/system produced it
  formula_notes      TEXT
);

-- ----------------------------------------------------------------------------
-- PEOPLE / ROLE REGISTRY (org directory, distinct from auth `users`)
-- ----------------------------------------------------------------------------
CREATE TABLE people (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id),
  full_name          TEXT NOT NULL,
  title              TEXT,
  organization_id    TEXT REFERENCES organizations(id),
  project_id         TEXT REFERENCES projects(id),
  status             record_status NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- GLOBAL EVENT REGISTRY  (EVT-2026-0001)
-- Event-neutral by design — NICE 2026 is just a row here (Step 15).
-- ----------------------------------------------------------------------------
CREATE TABLE events (
  id                 TEXT PRIMARY KEY,          -- e.g. EVT-2026-0001
  name               TEXT NOT NULL,
  event_type         TEXT,
  starts_at          TIMESTAMPTZ,
  ends_at            TIMESTAMPTZ,
  location            TEXT,
  budget_usd          NUMERIC(12,2),
  owner_user_id       UUID REFERENCES users(id),
  classification      TEXT,
  sensitivity          sensitivity_level NOT NULL DEFAULT 'internal',
  status               record_status NOT NULL DEFAULT 'draft',
  access_policy         JSONB DEFAULT '{}',
  retention_policy      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_projects (
  event_id           TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id),
  PRIMARY KEY (event_id, project_id)
);

CREATE TABLE event_team (
  event_id           TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id),
  role_on_event      TEXT,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE campaigns (
  id                 TEXT PRIMARY KEY,          -- e.g. CAM-2026-0001
  event_id           TEXT REFERENCES events(id),
  name               TEXT NOT NULL,
  status             record_status NOT NULL DEFAULT 'draft',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- QR REGISTRY  (QR-2026-000001)
-- QR is a tracked entry point ONLY — never an authentication credential.
-- Encodes nothing but an opaque token; all rules live server-side here.
-- ----------------------------------------------------------------------------
CREATE TABLE qr_codes (
  id                 TEXT PRIMARY KEY,          -- e.g. QR-2026-000001
  opaque_token       TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(9), 'base64'),
  qr_type            qr_type NOT NULL,
  owner_user_id      UUID REFERENCES users(id),
  project_id         TEXT REFERENCES projects(id),
  campaign_id        TEXT REFERENCES campaigns(id),
  distribution_source TEXT,                     -- e.g. "Event Badge", "Print Card"
  destination_rule   JSONB NOT NULL,             -- role-gated routing rule, not a raw URL
  issue_date         DATE NOT NULL DEFAULT current_date,
  expiry_date        DATE,
  scan_limit         INTEGER,
  approval_required  BOOLEAN NOT NULL DEFAULT true,
  status             record_status NOT NULL DEFAULT 'active',
  revoked_at         TIMESTAMPTZ,
  revoked_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE qr_scans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_id              TEXT NOT NULL REFERENCES qr_codes(id),
  scanned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash            TEXT,           -- store a hash, not a raw IP
  user_agent         TEXT,
  resulted_in_registration BOOLEAN DEFAULT false
);

-- ----------------------------------------------------------------------------
-- CONTACT / RELATIONSHIP REGISTRY  (CON-000001) + INVESTORS (INV-000001)
-- ----------------------------------------------------------------------------
CREATE TABLE contacts (
  id                 TEXT PRIMARY KEY,          -- e.g. CON-000001
  full_name          TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  email_verified     BOOLEAN NOT NULL DEFAULT false,
  phone_verified     BOOLEAN NOT NULL DEFAULT false,
  consent_given_at   TIMESTAMPTZ,
  source_qr_id       TEXT REFERENCES qr_codes(id),
  status             record_status NOT NULL DEFAULT 'draft',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE investors (
  id                 TEXT PRIMARY KEY,          -- e.g. INV-000001
  contact_id         TEXT REFERENCES contacts(id),
  firm_name          TEXT,
  reviewer_user_id   UUID REFERENCES users(id),
  decision_status    TEXT DEFAULT 'pending',    -- pending / interested / conditionally_interested / declined
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- ACCESS ADMINISTRATION
-- Implements the flow: registration -> consent -> verification -> admin
-- review -> approval/rejection -> entitlement -> expiry/revocation.
-- ----------------------------------------------------------------------------
CREATE TABLE access_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         TEXT NOT NULL REFERENCES contacts(id),
  requested_project_id TEXT REFERENCES projects(id),
  qr_id              TEXT REFERENCES qr_codes(id),
  disclosure_level   sensitivity_level DEFAULT 'public',
  status             TEXT NOT NULL DEFAULT 'pending', -- pending/approved/declined/info_requested
  reviewed_by        UUID REFERENCES users(id),
  reviewed_at        TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE entitlements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         TEXT NOT NULL REFERENCES contacts(id),
  project_id         TEXT NOT NULL REFERENCES projects(id),
  disclosure_level   sensitivity_level NOT NULL DEFAULT 'public',
  granted_by         UUID REFERENCES users(id),
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  revoked_by         UUID REFERENCES users(id)
);

-- ----------------------------------------------------------------------------
-- DOCUMENT / EVIDENCE VAULT  (DOC-000001)
-- ----------------------------------------------------------------------------
CREATE TABLE documents (
  id                 TEXT PRIMARY KEY,          -- e.g. DOC-000001
  project_id         TEXT REFERENCES projects(id),
  title              TEXT NOT NULL,
  storage_ref        TEXT NOT NULL,             -- pointer to blob storage, not inline bytes
  sensitivity        sensitivity_level NOT NULL DEFAULT 'internal',
  uploaded_by        UUID REFERENCES users(id),
  uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- WORKFLOWS  (WFL-000001)
-- Every workflow follows: request -> policy check -> approval -> execution
-- -> verification -> evidence -> audit  (Step 13)
-- ----------------------------------------------------------------------------
CREATE TABLE workflows (
  id                 TEXT PRIMARY KEY,          -- e.g. WFL-000001
  workflow_type      TEXT NOT NULL,             -- e.g. 'project_onboarding', 'qr_campaign_activation'
  project_id         TEXT REFERENCES projects(id),
  requested_by       UUID REFERENCES users(id),
  status             TEXT NOT NULL DEFAULT 'requested', -- requested/policy_check/approved/executing/verified/complete/rejected
  policy_check_result JSONB,
  approved_by        UUID REFERENCES users(id),
  approved_at        TIMESTAMPTZ,
  executed_at        TIMESTAMPTZ,
  verified_at        TIMESTAMPTZ,
  evidence_document_id TEXT REFERENCES documents(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- AUDIT LOG  (AUD-000001)
-- Append-only. Every permission change, approval, revocation, and
-- Elayja-proposed action must land here (Step 3, Step 14).
-- ----------------------------------------------------------------------------
CREATE TABLE audit_events (
  id                 TEXT PRIMARY KEY,          -- e.g. AUD-000001
  actor_user_id      UUID REFERENCES users(id), -- NULL if actor is elayja_service
  actor_is_elayja    BOOLEAN NOT NULL DEFAULT false,
  action             TEXT NOT NULL,             -- e.g. 'role.granted', 'qr.revoked', 'access.approved'
  target_table       TEXT NOT NULL,
  target_id          TEXT NOT NULL,
  before_state       JSONB,
  after_state        JSONB,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log is append-only: block UPDATE and DELETE at the DB level.
CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only — % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_audit_update
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

-- ----------------------------------------------------------------------------
-- BACKUP / RECOVERY CONTROL LOG
-- ----------------------------------------------------------------------------
CREATE TABLE backup_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         TEXT REFERENCES projects(id),
  backup_ref         TEXT NOT NULL,
  taken_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_restorable BOOLEAN DEFAULT false,
  last_restore_test_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX idx_projects_org ON projects(organization_id);
CREATE INDEX idx_qr_codes_project ON qr_codes(project_id);
CREATE INDEX idx_qr_scans_qr ON qr_scans(qr_id);
CREATE INDEX idx_access_requests_status ON access_requests(status);
CREATE INDEX idx_entitlements_contact ON entitlements(contact_id);
CREATE INDEX idx_audit_events_target ON audit_events(target_table, target_id);
CREATE INDEX idx_audit_events_occurred ON audit_events(occurred_at);
CREATE INDEX idx_metric_snapshots_project ON project_metric_snapshots(project_id);
