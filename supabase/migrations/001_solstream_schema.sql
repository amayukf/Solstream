-- SolStream Supabase PostgreSQL Schema, RLS, Storage & Realtime Setup

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Creators Table
CREATE TABLE IF NOT EXISTS public.creators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  wallet_address text NOT NULL UNIQUE,
  pda_address text NOT NULL UNIQUE,
  voice_id text NOT NULL DEFAULT 'pNInz6obpgDQGcFmaJgB',
  goal_title text NOT NULL DEFAULT 'Stream Goal',
  goal_target_lamports bigint NOT NULL DEFAULT 3000000000,
  goal_current_lamports bigint NOT NULL DEFAULT 0,
  total_tips bigint NOT NULL DEFAULT 0,
  total_volume_lamports bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Verified Tips Table (Unique signature enforces replay protection)
CREATE TABLE IF NOT EXISTS public.tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature text NOT NULL UNIQUE,
  creator_id uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  username text NOT NULL,
  donor_wallet text NOT NULL,
  display_name text NOT NULL DEFAULT 'Anonymous',
  amount_lamports bigint NOT NULL,
  tier smallint NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  audio_url text,
  tts_engine text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tips_username_created
  ON public.tips (username, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tips_donor_wallet
  ON public.tips (donor_wallet);

-- 3. Row Level Security & Grants (Strict Read-Only for Public Publishable Key; Server writes via Postgres)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.creators, public.tips TO anon, authenticated;

ALTER TABLE public.creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'creators' AND policyname = 'Public read creators'
  ) THEN
    CREATE POLICY "Public read creators" ON public.creators FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tips' AND policyname = 'Public read tips'
  ) THEN
    CREATE POLICY "Public read tips" ON public.tips FOR SELECT USING (true);
  END IF;
END $$;

-- 4. Enable Supabase Realtime on creators and tips
ALTER TABLE public.creators REPLICA IDENTITY FULL;
ALTER TABLE public.tips REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'creators'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.creators;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tips;
  END IF;
END $$;

-- 5. Public Storage Bucket for Stream Alert TTS Audio
INSERT INTO storage.buckets (id, name, public)
VALUES ('stream-alerts', 'stream-alerts', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read stream-alerts'
  ) THEN
    CREATE POLICY "Public read stream-alerts"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'stream-alerts');
  END IF;
END $$;
