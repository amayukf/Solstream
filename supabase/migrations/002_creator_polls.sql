-- SolStream Migration 002: Live Micro-Vote Polls per Creator

CREATE TABLE IF NOT EXISTS public.creator_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL UNIQUE REFERENCES public.creators(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  question text NOT NULL,
  option_a text NOT NULL,
  option_b text NOT NULL,
  min_vote_lamports bigint NOT NULL DEFAULT 1000000,
  is_active boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_polls_username
  ON public.creator_polls (username);

GRANT SELECT ON public.creator_polls TO anon, authenticated;

ALTER TABLE public.creator_polls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'creator_polls' AND policyname = 'Public read creator_polls'
  ) THEN
    CREATE POLICY "Public read creator_polls" ON public.creator_polls FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE public.creator_polls REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'creator_polls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.creator_polls;
  END IF;
END $$;
