-- One-pass Supabase setup for InstaAuto.
-- Run this in Supabase SQL Editor for a fresh project.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id bigint PRIMARY KEY,
  username text UNIQUE,
  access_token text NOT NULL,
  token_expires_at timestamptz,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  business_account_id bigint,
  page_id text,
  groq_auto_reply_enabled boolean DEFAULT false,
  ai_context text DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_id bigint NOT NULL,
  recipient_username text NOT NULL,
  last_message_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.messages (
  id text PRIMARY KEY,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id bigint REFERENCES public.users(id) ON DELETE CASCADE,
  sender_id bigint,
  sender_username text,
  content text,
  is_from_instagram boolean DEFAULT true,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id bigint,
  data jsonb,
  processed_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_source text NOT NULL DEFAULT 'comment' CHECK (trigger_source IN ('comment', 'dm', 'story')),
  trigger_type text NOT NULL,
  trigger_value text NOT NULL,
  response_type text DEFAULT 'pro',
  response_content jsonb NOT NULL,
  media_selection jsonb DEFAULT NULL,
  selected_reel_id text DEFAULT NULL,
  specific_media_id text DEFAULT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.media_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  media_id text NOT NULL,
  media_type text NOT NULL,
  caption text,
  image_url text,
  video_url text,
  permalink text,
  media_product_type text,
  timestamp timestamptz,
  cached_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, media_id)
);

CREATE TABLE IF NOT EXISTS public.ice_breakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question text NOT NULL,
  response text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.content_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  video_url text NOT NULL,
  caption text,
  cover_url text,
  thumbnail_url text,
  sequence_index integer NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.scheduler_config (
  user_id bigint PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  is_running boolean DEFAULT false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  start_time text DEFAULT '09:00',
  end_time text DEFAULT '21:00',
  interval_minutes integer DEFAULT 60,
  current_sequence_index integer DEFAULT 0,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reels_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content_pool_id uuid REFERENCES public.content_pool(id) ON DELETE SET NULL,
  video_url text,
  caption text,
  ig_container_id text,
  ig_media_id text,
  status text,
  error_message text,
  published_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS business_account_id bigint;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS page_id text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS groq_auto_reply_enabled boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ai_context text DEFAULT NULL;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS trigger_source text NOT NULL DEFAULT 'comment';
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS media_selection jsonb DEFAULT NULL;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS selected_reel_id text DEFAULT NULL;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS specific_media_id text DEFAULT NULL;
ALTER TABLE public.content_pool ADD COLUMN IF NOT EXISTS thumbnail_url text;

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_id ON public.webhook_events(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_type_time ON public.webhook_events(user_id, event_type, processed_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_data_gin ON public.webhook_events USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_automations_user_id ON public.automations(user_id);
CREATE INDEX IF NOT EXISTS idx_automations_specific_media_id ON public.automations(specific_media_id);
CREATE INDEX IF NOT EXISTS idx_automations_trigger_source ON public.automations(trigger_source);
CREATE INDEX IF NOT EXISTS idx_automations_user_source ON public.automations(user_id, trigger_source);
CREATE INDEX IF NOT EXISTS idx_media_cache_user_id ON public.media_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_media_cache_media_id ON public.media_cache(media_id);
CREATE INDEX IF NOT EXISTS idx_content_pool_user_id ON public.content_pool(user_id);
CREATE INDEX IF NOT EXISTS idx_content_pool_sequence ON public.content_pool(user_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_reels_posts_user_status ON public.reels_posts(user_id, status);

INSERT INTO storage.buckets (id, name, public)
VALUES ('reels', 'reels', true)
ON CONFLICT (id) DO UPDATE SET public = true;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media', 'media', true, 52428800, ARRAY['video/mp4', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['video/mp4', 'image/jpeg', 'image/png'];

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Public Viewing" ON storage.objects;
DROP POLICY IF EXISTS "Public Deletion" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Viewing" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Update" ON storage.objects;
DROP POLICY IF EXISTS "Media Public Deletion" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;

CREATE POLICY "Public Uploads"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'reels');

CREATE POLICY "Public Viewing"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'reels');

CREATE POLICY "Public Deletion"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'reels');

CREATE POLICY "Public Access"
ON storage.objects FOR ALL
TO public
USING (bucket_id = 'media')
WITH CHECK (bucket_id = 'media');
