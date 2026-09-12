-- ==========================================
-- Lock down anon access. Run this in the Supabase SQL editor.
--
-- WHY THIS MATTERS
--
-- NEXT_PUBLIC_SUPABASE_ANON_KEY is compiled into the client JavaScript that
-- every visitor of the deployed site downloads. Supabase grants the `anon`
-- role table privileges by default and relies on RLS to restrain it — so with
-- RLS off, anyone who opens the site can read every row of every table.
--
-- Verified against this project before writing the script:
--   users            READABLE with the anon key — including access_token
--   automations      READABLE
--   webhook_events   READABLE
--
-- That means the Instagram access token was readable by any visitor. Rotate it
-- (disconnect and reconnect Instagram) after applying this.
--
-- WHY DENY-ALL IS SAFE HERE
--
-- Every server route uses getSupabaseServerClient(), which authenticates with
-- SUPABASE_SERVICE_ROLE_KEY and bypasses RLS entirely. No client-side code
-- talks to Postgres any more — the last consumer of the anon key was
-- ContentPool.tsx, deleted along with the scheduler. Enabling RLS with no
-- permissive policy therefore denies `anon` and `authenticated` while leaving
-- the application fully working.
-- ==========================================

-- ------------------------------------------
-- 1. Tables: RLS on, no policies -> anon and authenticated are denied
-- ------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ice_breakers ENABLE ROW LEVEL SECURITY;

-- The rest may or may not exist depending on how old the install is (scheduler
-- leftovers) or whether 09-social-posting.sql has run yet. Driving the loop
-- from pg_tables means a missing table is skipped instead of aborting.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'content_pool', 'scheduler_config', 'reels_posts', 'dm_queue',
        'social_accounts', 'post_jobs', 'post_targets'
      ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    RAISE NOTICE 'RLS enabled on public.%', t;
  END LOOP;
END $$;

-- ------------------------------------------
-- 2. Storage: public read only
--
-- Instagram and YouTube both fetch the video from the public URL, so SELECT
-- must stay open. INSERT and DELETE do not: uploads now go through a
-- service-role signed upload URL (app/api/post/upload-url), which is
-- authorised by its own token rather than by these policies.
--
-- Before this, any visitor could upload files into the bucket and delete
-- anything already in it.
-- ------------------------------------------
DROP POLICY IF EXISTS "Public Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Public Deletion" ON storage.objects;
DROP POLICY IF EXISTS "Public Update" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Deletion" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Update" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Viewing" ON storage.objects;

-- Keep exactly one policy: anyone may read from the reels bucket.
DROP POLICY IF EXISTS "Public Viewing" ON storage.objects;
CREATE POLICY "Public Viewing"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'reels');

-- ------------------------------------------
-- 3. Confirm it worked
--
-- Expect rowsecurity = true for every row.
-- ------------------------------------------
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' ORDER BY tablename;
