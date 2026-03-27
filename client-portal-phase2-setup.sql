-- ============================================================
-- PHASE 2: CLIENT PORTAL ACCOUNTS
-- Run in Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS client_portal_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  company_name text,
  contact_name text,
  phone text,
  -- Links to existing data
  comp_no text,  -- links to ltd_clients
  -- Status
  status text DEFAULT 'active' CHECK (status IN ('active','inactive')),
  -- Registration details (captured on first login)
  registered_at timestamptz,
  -- Auth is handled by Supabase Auth (user_id links to auth.users)
  auth_user_id uuid,
  created_at timestamptz DEFAULT now(),
  created_by text,
  notes text
);

ALTER TABLE client_portal_accounts ENABLE ROW LEVEL SECURITY;

-- Staff can do everything
CREATE POLICY "staff_full_access" ON client_portal_accounts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Clients can read their own record
CREATE POLICY "client_read_own" ON client_portal_accounts
  FOR SELECT TO anon USING (true);

-- ============================================================
-- Also add client_email to client_approvals if not there
-- (so clients can filter their own documents)
-- ============================================================
-- client_email column already exists from Phase 1 setup
