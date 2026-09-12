-- ############################################################
-- DEPRECATED — DO NOT RUN.
--
-- The policies below grant the public role INSERT/UPDATE/DELETE on a storage
-- bucket, which lets any visitor (the anon key is in the client bundle) upload
-- to and delete from your storage. Superseded by scripts/setup-supabase.sql
-- and scripts/10-lock-down-rls.sql, which keep public access read-only.
--
-- Kept only as migration history.
-- ############################################################

-- Force create bucket if not exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES ('media', 'media', true, 52428800, ARRAY['video/mp4', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET 
    public = true,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['video/mp4', 'image/jpeg', 'image/png'];

-- Clear existing policies to avoid conflicts
DROP POLICY IF EXISTS "Media Public Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Viewing" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Update" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Deletion" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;

-- Re-create policies with simplest possible rules
CREATE POLICY "Public Access"
ON storage.objects FOR ALL
TO public
USING (bucket_id = 'media')
WITH CHECK (bucket_id = 'media');
