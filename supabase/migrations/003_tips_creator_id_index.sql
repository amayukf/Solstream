-- SolStream Migration 003: Index tips(creator_id) for fast All-Time Top Donors leaderboard queries

CREATE INDEX IF NOT EXISTS idx_tips_creator_id
  ON public.tips (creator_id);
