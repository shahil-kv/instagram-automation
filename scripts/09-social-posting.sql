-- ==========================================
-- Manual cross-posting: Instagram + YouTube
-- Run this in the Supabase SQL editor.
--
-- No scheduler involved. One row in post_jobs per video the user posts,
-- one row in post_targets per platform that video goes to.
-- ==========================================

-- ------------------------------------------
-- 1. Connected non-Instagram accounts (YouTube today, room for more)
-- ------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                  -- 'youtube'
  external_id TEXT,                        -- YouTube channel id
  display_name TEXT,                       -- channel title, for the UI
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- ------------------------------------------
-- 2. One video the user chose to post
-- ------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,                 -- public Supabase Storage URL
  thumbnail_url TEXT,
  title TEXT,                              -- YouTube title
  caption TEXT,                            -- IG caption / YouTube description
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------
-- 3. Per-platform outcome for that video
--    status: pending | processing | published | failed
-- ------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.post_jobs(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,                  -- 'instagram' | 'youtube'
  status TEXT NOT NULL DEFAULT 'pending',
  external_ref TEXT,                       -- IG container id / YT resumable session
  external_id TEXT,                        -- IG media id / YouTube video id
  permalink TEXT,
  privacy TEXT,                            -- YouTube: private | unlisted | public
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (job_id, platform)
);

-- ------------------------------------------
-- Indexes
-- ------------------------------------------
CREATE INDEX IF NOT EXISTS idx_social_accounts_user ON public.social_accounts(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_post_jobs_user_created ON public.post_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_targets_job ON public.post_targets(job_id);
CREATE INDEX IF NOT EXISTS idx_post_targets_user_status ON public.post_targets(user_id, status);

-- ------------------------------------------
-- RLS
--
-- Every route that touches these tables uses the service-role key, which
-- bypasses RLS. These policies exist so a leaked anon key cannot read your
-- OAuth tokens or post history. social_accounts holds refresh tokens, so the
-- anon role gets no access to it at all.
-- ------------------------------------------
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_accounts_no_anon" ON public.social_accounts;
DROP POLICY IF EXISTS "post_jobs_no_anon" ON public.post_jobs;
DROP POLICY IF EXISTS "post_targets_no_anon" ON public.post_targets;

-- Intentionally no permissive policy: RLS enabled with zero policies denies
-- the anon and authenticated roles outright. Server routes still work because
-- the service-role key bypasses RLS.
