-- Run this in Supabase SQL editor to create the GoCardless live data tables

-- Customers table
CREATE TABLE IF NOT EXISTS gc_customers (
  gc_id TEXT PRIMARY KEY,
  email TEXT,
  given_name TEXT,
  family_name TEXT,
  company_name TEXT,
  created_at TIMESTAMPTZ,
  metadata TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mandates table
CREATE TABLE IF NOT EXISTS gc_mandates (
  gc_id TEXT PRIMARY KEY,
  status TEXT,
  customer_id TEXT REFERENCES gc_customers(gc_id),
  created_at TIMESTAMPTZ,
  next_possible_charge_date DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS gc_payments (
  gc_id TEXT PRIMARY KEY,
  amount NUMERIC(10,2),
  status TEXT,
  charge_date DATE,
  description TEXT,
  customer_id TEXT,
  mandate_id TEXT,
  created_at TIMESTAMPTZ,
  month_key TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Monthly summary (pre-aggregated for fast portal queries)
CREATE TABLE IF NOT EXISTS gc_monthly_summary (
  month TEXT PRIMARY KEY,  -- YYYY-MM
  total_revenue NUMERIC(10,2),
  payment_count INTEGER,
  active_customers INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync log
CREATE TABLE IF NOT EXISTS gc_sync_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  customers INTEGER,
  active_mandates INTEGER,
  payments_synced INTEGER,
  status TEXT,
  log TEXT
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_gc_payments_month ON gc_payments(month_key);
CREATE INDEX IF NOT EXISTS idx_gc_payments_status ON gc_payments(status);
CREATE INDEX IF NOT EXISTS idx_gc_payments_customer ON gc_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_gc_mandates_status ON gc_mandates(status);
CREATE INDEX IF NOT EXISTS idx_gc_mandates_customer ON gc_mandates(customer_id);

-- Grant anon access (for portal frontend)
GRANT SELECT ON gc_customers TO anon;
GRANT SELECT ON gc_mandates TO anon;
GRANT SELECT ON gc_payments TO anon;
GRANT SELECT ON gc_monthly_summary TO anon;
GRANT SELECT ON gc_sync_log TO anon;
GRANT INSERT ON gc_customers TO anon;
GRANT INSERT ON gc_mandates TO anon;
GRANT INSERT ON gc_payments TO anon;
GRANT INSERT ON gc_monthly_summary TO anon;
GRANT INSERT ON gc_sync_log TO anon;
