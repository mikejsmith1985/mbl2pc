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

-- Optional: snippets table for future pinned-snippets feature
CREATE TABLE IF NOT EXISTS snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS if you're using the service_role key (recommended for server-side)
-- ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE snippets DISABLE ROW LEVEL SECURITY;
