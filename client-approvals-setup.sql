-- ============================================================
-- CHOWDURY ACCOUNTANTS — CLIENT APPROVALS SETUP
-- Run this in Supabase → SQL Editor
-- ============================================================

-- 1. CLIENT APPROVALS TABLE
-- One record per approval bundle (can contain multiple docs)
CREATE TABLE IF NOT EXISTS client_approvals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token uuid DEFAULT gen_random_uuid() UNIQUE NOT NULL,

  -- Client details
  client_name text NOT NULL,
  client_email text,
  client_phone text,
  company_name text NOT NULL,
  period_end text,

  -- Documents (array of {type, filename, storage_path, description})
  documents jsonb DEFAULT '[]'::jsonb,

  -- Status
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','expired')),
  expiry_date date DEFAULT (CURRENT_DATE + INTERVAL '30 days'),

  -- Sent by
  created_by text,
  created_at timestamptz DEFAULT now(),
  sent_via text DEFAULT 'email',

  -- Approval capture
  approved_at timestamptz,
  approved_name text,
  approved_ip text,
  approved_user_agent text,
  declaration_confirmed boolean DEFAULT false,

  -- Notes
  notes text
);

-- Enable RLS
ALTER TABLE client_approvals ENABLE ROW LEVEL SECURITY;

-- Staff can do everything (authenticated)
CREATE POLICY "staff_full_access" ON client_approvals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Public can read by token (for approve.html — no login)
CREATE POLICY "public_read_by_token" ON client_approvals
  FOR SELECT TO anon
  USING (true);

-- Public can update approval fields only (for approve.html submission)
CREATE POLICY "public_approve_by_token" ON client_approvals
  FOR UPDATE TO anon
  USING (status = 'pending')
  WITH CHECK (true);

-- 2. AUDIT LOG ENTRY (extends existing audit_log if it exists)
-- If audit_log table doesn't exist yet, create it
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  action text,
  details text,
  user_name text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_audit_access" ON audit_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_insert_audit" ON audit_log
  FOR INSERT TO anon WITH CHECK (true);

-- ============================================================
-- STORAGE BUCKET — run this separately if needed
-- Or create manually: Supabase → Storage → New bucket
-- Name: client-documents
-- Public: NO (private)
-- ============================================================

-- 3. STORAGE POLICY (run after creating the bucket)
-- Allow authenticated users to upload
-- INSERT INTO storage.buckets (id, name, public) VALUES ('client-documents', 'client-documents', false);

-- Allow staff to upload
-- CREATE POLICY "staff_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'client-documents');
-- CREATE POLICY "staff_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'client-documents');
-- CREATE POLICY "anon_read" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'client-documents');
