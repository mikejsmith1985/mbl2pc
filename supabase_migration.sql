-- mbl2pc Supabase setup — run this once in the Supabase SQL Editor
-- Project Settings → SQL Editor → New query → paste this → Run

-- Base messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender TEXT,
  text TEXT,
  image_url TEXT,
  file_url TEXT,
  file_name TEXT,
  timestamp TEXT,
  user_id TEXT
);

-- Future feature columns (safe to run even if table already exists)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS starred BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TEXT DEFAULT NULL;

-- Snippets table (saved reusable text blobs)
CREATE TABLE IF NOT EXISTS snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS if you're using the service_role key (recommended for server-side)
-- ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE snippets DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE push_subscriptions DISABLE ROW LEVEL SECURITY;

-- ── Storage bucket setup ────────────────────────────────────────────────────
-- Creates the file/image upload bucket and the policies required to allow
-- the server (service_role key) to upload and anyone to read public files.
-- Run this if file/image uploads return 403 Forbidden.

INSERT INTO storage.buckets (id, name, public)
VALUES ('mbl2pc-files', 'mbl2pc-files', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop old policies if re-running (idempotent)
DROP POLICY IF EXISTS "mbl2pc service role upload"  ON storage.objects;
DROP POLICY IF EXISTS "mbl2pc service role delete"  ON storage.objects;
DROP POLICY IF EXISTS "mbl2pc public read"          ON storage.objects;

-- Allow the server (service_role) to upload files
CREATE POLICY "mbl2pc service role upload"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'mbl2pc-files');

-- Allow the server (service_role) to delete files
CREATE POLICY "mbl2pc service role delete"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'mbl2pc-files');

-- Allow anyone to read/download files (public bucket)
CREATE POLICY "mbl2pc public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'mbl2pc-files');
