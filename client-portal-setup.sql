-- ============================================================
-- CHOWDURY ACCOUNTANTS — CLIENT PORTAL PHASE 2 SETUP
-- Run this in Supabase → SQL Editor
-- ============================================================

-- 1. CLIENT ACCOUNTS — links Supabase auth user to their company
CREATE TABLE IF NOT EXISTS client_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  supabase_user_id uuid UNIQUE,
  email text UNIQUE NOT NULL,
  first_name text,
  last_name text,
  company_name text,
  comp_no text,
  created_at timestamptz DEFAULT now(),
  last_login timestamptz,
  invited_by text,
  invitation_token uuid DEFAULT gen_random_uuid() UNIQUE,
  invitation_used boolean DEFAULT false
);

ALTER TABLE client_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_by_token" ON client_accounts FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert" ON client_accounts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update" ON client_accounts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON client_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. CLIENT INFO — My Info form data
CREATE TABLE IF NOT EXISTS client_info (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  comp_no text,
  company_name text,

  -- Company Details
  company_email text,
  turnover text,
  date_of_trading date,
  nature_of_business text,
  corporation_tax_office text,
  ct_utr text,
  company_reg_no text,

  -- Personal Details
  title text,
  first_name text,
  last_name text,
  preferred_name text,
  dob date,
  ni_number text,
  personal_utr text,
  postal_address text,
  mobile text,
  telephone text,
  nationality text,

  -- VAT Details
  vat_number text,
  vat_reg_date date,
  vat_scheme text,

  -- PAYE Details
  paye_ref text,
  accounts_office_ref text,
  no_of_employees integer,
  paye_frequency text,
  first_pay_date date,

  updated_at timestamptz DEFAULT now()
);

ALTER TABLE client_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_client_info" ON client_info FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_client_info" ON client_info FOR ALL TO authenticated USING (true) WITH CHECK (true);
