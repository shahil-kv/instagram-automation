-- Supabase Database Schema Dump for Insta-P8
-- This script contains all 11 tables, constraints, indexes, and storage bucket settings.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. Table: public.users
-- ==========================================
CREATE TABLE IF NOT EXISTS public.users (
  id BIGINT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  business_account_id BIGINT,
  page_id TEXT,
  groq_auto_reply_enabled BOOLEAN DEFAULT FALSE,
  ai_context TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 4. Table: public.webhook_events
-- ==========================================
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id BIGINT,
  data JSONB,
  processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 5. Table: public.automations
-- ==========================================
CREATE TABLE IF NOT EXISTS public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT NOT NULL,
  response_type TEXT DEFAULT 'text'::text,
  response_content JSONB,
  media_selection JSONB,
  selected_reel_id TEXT,
  specific_media_id TEXT,
  trigger_source TEXT NOT NULL DEFAULT 'comment' CHECK (trigger_source IN ('comment', 'dm', 'story')),
  follow_up_steps JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 6. Table: public.media_cache
-- ==========================================
CREATE TABLE IF NOT EXISTS public.media_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  caption TEXT,
  image_url TEXT,
  video_url TEXT,
  permalink TEXT,
  media_product_type TEXT,
  timestamp TIMESTAMPTZ,
  cached_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, media_id)
);

-- ==========================================
-- 7. Table: public.ice_breakers
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ice_breakers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  response TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 8. Table: public.content_pool
-- ==========================================
CREATE TABLE IF NOT EXISTS public.content_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  caption TEXT,
  cover_url TEXT,
  sequence_index SERIAL,
  thumbnail_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  automation_template JSONB
);

-- ==========================================
-- 9. Table: public.scheduler_config
-- ==========================================
CREATE TABLE IF NOT EXISTS public.scheduler_config (
  user_id BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  interval_minutes INTEGER NOT NULL DEFAULT 240,
  start_time TIME DEFAULT '09:00:00'::TIME WITHOUT TIME ZONE,
  end_time TIME DEFAULT '21:00:00'::TIME WITHOUT TIME ZONE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  current_sequence_index INTEGER DEFAULT 1,
  is_running BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 10. Table: public.reels_posts
-- ==========================================
CREATE TABLE IF NOT EXISTS public.reels_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content_pool_id UUID REFERENCES public.content_pool(id) ON DELETE SET NULL,
  video_url TEXT NOT NULL,
  caption TEXT,
  ig_container_id TEXT,
  ig_media_id TEXT,
  status TEXT DEFAULT 'PENDING'::text,
  error_message TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 11. Table: public.dm_queue
-- ==========================================
CREATE TABLE IF NOT EXISTS public.dm_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  message TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'::text,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- Indexes for performance
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_automations_trigger_source ON public.automations(trigger_source);
CREATE INDEX IF NOT EXISTS idx_automations_user_source ON public.automations(user_id, trigger_source);
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_type_time ON public.webhook_events(user_id, event_type, processed_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_data_gin ON public.webhook_events USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_content_pool_user_sequence ON public.content_pool(user_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_scheduler_next_run ON public.scheduler_config(next_run_at);
CREATE INDEX IF NOT EXISTS idx_reels_posts_user_status ON public.reels_posts(user_id, status);

-- ==========================================
-- Storage Bucket: reels
-- ==========================================
-- Create bucket if it doesn't exist (Requires storage schema)
INSERT INTO storage.buckets (id, name, public)
VALUES ('reels', 'reels', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- NOTE: RLS is enabled by default on storage.objects in Supabase.
-- Running ALTER TABLE storage.objects causes permission errors (must be owner of table objects)
-- on newer Supabase instances. Therefore, we do not run it here.
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop storage policies if they exist to prevent duplicates
DROP POLICY IF EXISTS "Public Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Public Viewing" ON storage.objects;
DROP POLICY IF EXISTS "Public Deletion" ON storage.objects;

-- Public READ only. Instagram and YouTube fetch the video from the public URL,
-- so SELECT must stay open. INSERT/DELETE must not be public: uploads go
-- through a service-role signed upload URL (app/api/post/upload-url), which
-- carries its own authorisation. A public INSERT policy would let any visitor
-- fill the bucket, and a public DELETE policy would let them wipe it.
CREATE POLICY "Public Viewing"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'reels');

-- =========================================================================
-- SECURITY NOTE: Row Level Security (RLS) for public schema tables
-- Enable RLS to protect tables from unauthorized public access.
-- If you want to restrict public access to the client-facing APIs,
-- uncomment the commands below and create suitable RLS policies.
--
-- ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.media_cache ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.ice_breakers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.content_pool ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.scheduler_config ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.reels_posts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.dm_queue ENABLE ROW LEVEL SECURITY;
-- =========================================================================

-- ==========================================
-- Manual cross-posting: Instagram + YouTube (Post section)
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
