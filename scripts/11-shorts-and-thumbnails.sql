-- ==========================================
-- Shorts flag + publish lock. Run this in the Supabase SQL editor.
--
-- Additive and idempotent: adds two nullable columns. No data is read, moved,
-- or deleted, and existing rows keep working.
--
-- `thumbnail_url` already exists on post_jobs from 09-social-posting.sql, so
-- the thumbnail feature needs no new column.
-- ==========================================

-- ------------------------------------------
-- 1. Shorts
--
-- YouTube has no API flag for Shorts — it classifies by aspect ratio (<= 1:1)
-- and duration (<= 3 min). This only controls whether #Shorts is appended to
-- the description as a hint.
-- ------------------------------------------
ALTER TABLE public.post_jobs
  ADD COLUMN IF NOT EXISTS youtube_shorts BOOLEAN DEFAULT TRUE;

-- ------------------------------------------
-- 2. Publish lock
--
-- Publishing is advanced by repeated calls to /api/post/tick. Two of those can
-- overlap — the composer's poll loop running while Resume is pressed, or the
-- page open in two tabs. Without a lock, both could see a finished Instagram
-- container and each call media_publish, posting the same Reel twice.
--
-- A tick claims a target by stamping locked_at only if it is unclaimed or the
-- claim has gone stale, so exactly one caller can publish at a time.
-- ------------------------------------------
ALTER TABLE public.post_targets
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.post_targets.locked_at IS
  'Held by the tick currently advancing this target. Stale claims (older than the lock TTL) are reclaimable so a crashed request cannot strand a post.';
