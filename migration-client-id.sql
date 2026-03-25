-- ============================================================
-- CA Portal — Master Client ID Migration
-- Run this in: Supabase → SQL Editor
-- Purpose: Creates a master clients table and links vat_clients,
--          paye_employers, sa_clients, onboarding_clients to it
--          via client_id so data stays consistent.
-- ============================================================

-- 1. Create db_backups table (needed for nightly backup function)
CREATE TABLE IF NOT EXISTS db_backups (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  backed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tables     TEXT,
  total_rows INTEGER DEFAULT 0,
  size_kb    INTEGER DEFAULT 0,
  status     TEXT DEFAULT 'success',
  log        TEXT,
  snapshot   TEXT  -- JSON snapshot of all tables
);
CREATE INDEX IF NOT EXISTS idx_db_backups_backed_at ON db_backups(backed_at DESC);
GRANT SELECT, INSERT, DELETE ON db_backups TO anon;

-- 2. Create the master clients lookup table
--    Seeded from ltd_clients (the most complete source of truth)
CREATE TABLE IF NOT EXISTS clients (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comp_no         TEXT UNIQUE,           -- Companies House number (Ltd only)
  client_type     TEXT NOT NULL DEFAULT 'ltd',  -- 'ltd', 'se', 'partnership'
  display_name    TEXT,                  -- Company name or trading name
  director_name   TEXT,
  director_email  TEXT,
  director_mobile TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_comp_no ON clients(comp_no);
CREATE INDEX IF NOT EXISTS idx_clients_type   ON clients(client_type);
GRANT SELECT, INSERT, UPDATE ON clients TO anon;
GRANT USAGE, SELECT ON SEQUENCE clients_id_seq TO anon;

-- 3. Seed clients from ltd_clients (existing data)
INSERT INTO clients (comp_no, client_type, director_name, director_email, director_mobile, created_at)
SELECT 
  comp_no,
  'ltd',
  director_name,
  director_email,
  director_mobile,
  created_at
FROM ltd_clients
ON CONFLICT (comp_no) DO NOTHING;

-- 4. Add client_id foreign key to each tracker table
--    Using DO $$ blocks so it's safe to re-run

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='vat_clients' AND column_name='client_id'
  ) THEN
    ALTER TABLE vat_clients ADD COLUMN client_id BIGINT REFERENCES clients(id);
    CREATE INDEX idx_vat_clients_client_id ON vat_clients(client_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='paye_employers' AND column_name='client_id'
  ) THEN
    ALTER TABLE paye_employers ADD COLUMN client_id BIGINT REFERENCES clients(id);
    CREATE INDEX idx_paye_employers_client_id ON paye_employers(client_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='sa_clients' AND column_name='client_id'
  ) THEN
    ALTER TABLE sa_clients ADD COLUMN client_id BIGINT REFERENCES clients(id);
    CREATE INDEX idx_sa_clients_client_id ON sa_clients(client_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='onboarding_clients' AND column_name='client_id'
  ) THEN
    ALTER TABLE onboarding_clients ADD COLUMN client_id BIGINT REFERENCES clients(id);
    CREATE INDEX idx_onboarding_clients_client_id ON onboarding_clients(client_id);
  END IF;
END $$;

-- 5. Add staff_jobs table (for Fix 5 — job queue)
CREATE TABLE IF NOT EXISTS staff_jobs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id    BIGINT REFERENCES clients(id),
  comp_no      TEXT,           -- denormalised for quick lookup
  client_name  TEXT,
  job_type     TEXT NOT NULL,  -- 'Accounts', 'VAT Return', 'PAYE', 'SA Return', 'CT600', 'Other'
  description  TEXT,
  assigned_to  TEXT NOT NULL,  -- staff name: 'Hassan', 'Aminul', 'Nawaz', 'Sadat'
  priority     TEXT DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'
  status       TEXT DEFAULT 'todo',    -- 'todo', 'in_progress', 'review', 'done'
  due_date     DATE,
  completed_at TIMESTAMPTZ,
  notes        TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_jobs_assigned  ON staff_jobs(assigned_to);
CREATE INDEX IF NOT EXISTS idx_staff_jobs_status    ON staff_jobs(status);
CREATE INDEX IF NOT EXISTS idx_staff_jobs_due_date  ON staff_jobs(due_date);
CREATE INDEX IF NOT EXISTS idx_staff_jobs_client_id ON staff_jobs(client_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_jobs TO anon;
GRANT USAGE, SELECT ON SEQUENCE staff_jobs_id_seq TO anon;

-- Done!
SELECT 'Migration complete ✅' as result;
