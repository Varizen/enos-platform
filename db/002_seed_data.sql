-- ============================================================================
-- ENOS Seed Data — bootstraps the IDs defined in Step 2 and the initial
-- project records from Step 5. Safe to run once against a fresh database.
-- ============================================================================

INSERT INTO organizations (id, name, classification, sensitivity, status)
VALUES ('ORG-VARIZEN-001', 'Varizen Inc.', 'corporate', 'internal', 'active');

-- Initial project records (Step 5) — market_segment / readiness / completion
-- left NULL for the team to fill in; do not delete rows, only update status
-- to 'archived' if a project is dropped, per the "do not delete, strikethrough"
-- instruction from the original planning conversation.
INSERT INTO projects (id, name, organization_id, status, classification, sensitivity) VALUES
  ('PRJ-V0-VARIZEN-CORP',       'Varizen Corporate',              'ORG-VARIZEN-001', 'active', 'internal', 'internal'),
  ('PRJ-V0-ENOS',               'ENOS',                            'ORG-VARIZEN-001', 'active', 'internal', 'internal'),
  ('PRJ-V0-VECTOR',             'Varizen Vector',                  'ORG-VARIZEN-001', 'draft',  'internal', 'internal'),
  ('PRJ-V0-AI-FOUNDATION',      'Varizen AI Foundation',           'ORG-VARIZEN-001', 'draft',  'internal', 'internal'),
  ('PRJ-V0-CARET-V-AFA',        'Caret V AFA',                     'ORG-VARIZEN-001', 'draft',  'internal', 'internal'),
  ('PRJ-R0-DOCTOR360',          'Doctor360',                       'ORG-VARIZEN-001', 'draft',  'client',   'internal'),
  ('PRJ-V0-GRIHOSTIOS',         'GrihostiOS',                      'ORG-VARIZEN-001', 'draft',  'internal', 'internal'),
  ('PRJ-V0-HABITATOS360',       'HabitatOS 360',                   'ORG-VARIZEN-001', 'draft',  'internal', 'internal'),
  ('PRJ-V0-ONE360-L365',        'ONE360/L365',                     'ORG-VARIZEN-001', 'draft',  'internal', 'internal'),
  ('PRJ-R0-360PAY',             '360Pay',                          'ORG-VARIZEN-001', 'draft',  'client',   'internal'),
  ('PRJ-V0-CONNECTIVITY-FABRIC','Varizen Connectivity Fabric',     'ORG-VARIZEN-001', 'draft',  'internal', 'internal'),
  ('PRJ-V0-SKILLCONNECT',       'SkillConnect',                    'ORG-VARIZEN-001', 'draft',  'internal', 'internal'),
  ('PRJ-V0-SUSTAINABLE-MATS',   'Sustainable Materials Ecosystem', 'ORG-VARIZEN-001', 'draft',  'internal', 'internal'),
  ('PRJ-V0-ENTERPRISE-PLATFORMS','Varizen Enterprise Platforms',   'ORG-VARIZEN-001', 'draft',  'internal', 'internal');

-- Generic internal test event (Step 6) — build and prove the reusable
-- lifecycle here BEFORE entering NICE 2026 as real data.
INSERT INTO events (id, name, event_type, status, classification, sensitivity)
VALUES ('EVT-TEST-001', 'Varizen Test Event 001', 'Customer and investor engagement', 'draft', 'internal', 'internal');

-- NICE 2026 is entered ONLY after the generic test event workflow passes
-- (Step 15). Left commented intentionally — uncomment when ready:
-- INSERT INTO events (id, name, event_type, status, classification, sensitivity)
-- VALUES ('EVT-2026-NICE-001', 'NICE 2026', 'Customer and investor engagement', 'draft', 'internal', 'internal');
-- INSERT INTO campaigns (id, event_id, name, status)
-- VALUES ('CAM-2026-NICE-001', 'EVT-2026-NICE-001', 'NICE 2026 Campaign', 'draft');
