CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Story',
  topic TEXT,
  story_type TEXT NOT NULL DEFAULT 'mystery',
  custom_story_type TEXT,
  duration_seconds INT NOT NULL DEFAULT 60,
  tone TEXT NOT NULL DEFAULT 'suspenseful',
  intensity INT NOT NULL DEFAULT 5,
  ending_type TEXT NOT NULL DEFAULT 'twist',
  narration_style TEXT NOT NULL DEFAULT 'cinematic',
  status TEXT NOT NULL DEFAULT 'draft',
  current_stage TEXT NOT NULL DEFAULT 'idea',
  overall_score INT,
  source_prompt TEXT,
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own projects" ON public.projects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.stories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT,
  hook TEXT,
  body TEXT,
  ending TEXT,
  cta TEXT,
  alt_hooks JSONB NOT NULL DEFAULT '[]',
  alt_titles JSONB NOT NULL DEFAULT '[]',
  scores JSONB NOT NULL DEFAULT '{}',
  overall_score INT,
  us_optimized BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stories TO authenticated;
GRANT ALL ON public.stories TO service_role;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own stories" ON public.stories FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.characters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  age TEXT,
  gender TEXT,
  appearance TEXT,
  hair TEXT,
  clothing TEXT,
  body_type TEXT,
  personality TEXT,
  visual_style TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.characters TO authenticated;
GRANT ALL ON public.characters TO service_role;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own characters" ON public.characters FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.scenes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  scene_number INT NOT NULL,
  start_seconds NUMERIC,
  duration_seconds NUMERIC,
  narration TEXT,
  visual_description TEXT,
  camera_movement TEXT,
  lighting TEXT,
  environment TEXT,
  character_description TEXT,
  emotion TEXT,
  transition TEXT,
  sound_effect TEXT,
  image_prompt TEXT,
  video_prompt TEXT,
  visual_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenes TO authenticated;
GRANT ALL ON public.scenes TO service_role;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own scenes" ON public.scenes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES public.scenes(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own assets" ON public.assets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.narrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  text TEXT,
  voice TEXT NOT NULL DEFAULT 'alloy',
  gender TEXT NOT NULL DEFAULT 'female',
  accent TEXT NOT NULL DEFAULT 'american',
  speed NUMERIC NOT NULL DEFAULT 1.0,
  pitch NUMERIC NOT NULL DEFAULT 1.0,
  emotion TEXT NOT NULL DEFAULT 'neutral',
  status TEXT NOT NULL DEFAULT 'pending',
  audio_asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.narrations TO authenticated;
GRANT ALL ON public.narrations TO service_role;
ALTER TABLE public.narrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own narrations" ON public.narrations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.captions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  chunks JSONB NOT NULL DEFAULT '[]',
  style JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.captions TO authenticated;
GRANT ALL ON public.captions TO service_role;
ALTER TABLE public.captions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own captions" ON public.captions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.thumbnails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  prompt TEXT,
  title_text TEXT,
  concept TEXT,
  asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.thumbnails TO authenticated;
GRANT ALL ON public.thumbnails TO service_role;
ALTER TABLE public.thumbnails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own thumbnails" ON public.thumbnails FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.renders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'not_configured',
  url TEXT,
  format TEXT NOT NULL DEFAULT 'mp4_1080x1920_30fps_aac',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.renders TO authenticated;
GRANT ALL ON public.renders TO service_role;
ALTER TABLE public.renders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own renders" ON public.renders FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.queue_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.queue_items TO authenticated;
GRANT ALL ON public.queue_items TO service_role;
ALTER TABLE public.queue_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own queue" ON public.queue_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.scheduled_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  platform TEXT NOT NULL DEFAULT 'youtube',
  status TEXT NOT NULL DEFAULT 'planned',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_posts TO authenticated;
GRANT ALL ON public.scheduled_posts TO service_role;
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own scheduled posts" ON public.scheduled_posts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.analytics_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  platform TEXT,
  metric TEXT NOT NULL,
  value NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analytics_events TO authenticated;
GRANT ALL ON public.analytics_events TO service_role;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own analytics" ON public.analytics_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  us_audience_mode BOOLEAN NOT NULL DEFAULT true,
  default_story_length INT NOT NULL DEFAULT 60,
  default_genre TEXT NOT NULL DEFAULT 'mystery',
  default_tone TEXT NOT NULL DEFAULT 'suspenseful',
  default_aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  ai_settings JSONB NOT NULL DEFAULT '{}',
  voice_settings JSONB NOT NULL DEFAULT '{}',
  video_settings JSONB NOT NULL DEFAULT '{}',
  caption_settings JSONB NOT NULL DEFAULT '{}',
  youtube_auto_upload BOOLEAN NOT NULL DEFAULT false,
  youtube_auto_publish BOOLEAN NOT NULL DEFAULT false,
  youtube_default_privacy TEXT NOT NULL DEFAULT 'private',
  cleanup_temp_assets BOOLEAN NOT NULL DEFAULT false,
  generation_concurrency INT NOT NULL DEFAULT 3,
  exploration_ratio NUMERIC NOT NULL DEFAULT 0.2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own settings" ON public.settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.production_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  current_step TEXT,
  progress INT NOT NULL DEFAULT 0,
  error TEXT,
  concurrency INT NOT NULL DEFAULT 3,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_jobs TO authenticated;
GRANT ALL ON public.production_jobs TO service_role;
ALTER TABLE public.production_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own production jobs" ON public.production_jobs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_production_jobs_user ON public.production_jobs (user_id, created_at DESC);
CREATE INDEX idx_production_jobs_project ON public.production_jobs (project_id);
CREATE INDEX idx_production_jobs_status ON public.production_jobs (status, created_at DESC);

CREATE TABLE public.production_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.production_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  step TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  attempt_count INT NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, step)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_steps TO authenticated;
GRANT ALL ON public.production_steps TO service_role;
ALTER TABLE public.production_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own production steps" ON public.production_steps FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_production_steps_job ON public.production_steps (job_id, position);
CREATE INDEX idx_production_steps_status ON public.production_steps (job_id, status);

CREATE TABLE public.youtube_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  channel_id TEXT,
  channel_title TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'CONNECTED',
  error TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.youtube_connections TO service_role;
ALTER TABLE public.youtube_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.youtube_oauth_states (
  state TEXT NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.youtube_oauth_states TO service_role;
ALTER TABLE public.youtube_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.youtube_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.production_jobs(id) ON DELETE SET NULL,
  youtube_video_id TEXT,
  youtube_url TEXT,
  title TEXT,
  description TEXT,
  tags JSONB NOT NULL DEFAULT '[]',
  privacy_status TEXT NOT NULL DEFAULT 'private',
  upload_status TEXT NOT NULL DEFAULT 'PENDING',
  processing_status TEXT,
  short_form BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.youtube_uploads TO authenticated;
GRANT ALL ON public.youtube_uploads TO service_role;
ALTER TABLE public.youtube_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own youtube uploads" ON public.youtube_uploads FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_youtube_uploads_project ON public.youtube_uploads (project_id);
CREATE INDEX idx_youtube_uploads_user ON public.youtube_uploads (user_id, created_at DESC);

CREATE TABLE public.channel_profile (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  channel_id TEXT,
  channel_title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  subscriber_count BIGINT,
  view_count BIGINT,
  video_count INT,
  country TEXT,
  audience_profile JSONB NOT NULL DEFAULT '{}',
  data_sufficiency TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_profile TO authenticated;
GRANT ALL ON public.channel_profile TO service_role;
ALTER TABLE public.channel_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own channel profile" ON public.channel_profile FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.channel_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  video_id TEXT NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  duration_seconds INT,
  short_form BOOLEAN NOT NULL DEFAULT false,
  tags JSONB NOT NULL DEFAULT '[]',
  privacy_status TEXT,
  hook_text TEXT,
  genre TEXT,
  structure TEXT,
  narration_style TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_videos TO authenticated;
GRANT ALL ON public.channel_videos TO service_role;
ALTER TABLE public.channel_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own channel videos" ON public.channel_videos FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_channel_videos_user_published ON public.channel_videos (user_id, published_at DESC);

CREATE TABLE public.channel_video_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  video_id TEXT NOT NULL,
  window_key TEXT NOT NULL,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  watch_time_minutes NUMERIC,
  average_view_duration_seconds NUMERIC,
  average_view_percentage NUMERIC,
  subscribers_gained BIGINT,
  impressions BIGINT,
  impression_ctr NUMERIC,
  retention_curve JSONB NOT NULL DEFAULT '[]',
  traffic_sources JSONB NOT NULL DEFAULT '{}',
  us_share NUMERIC,
  source TEXT NOT NULL DEFAULT 'youtube_analytics_api',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id, window_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_video_metrics TO authenticated;
GRANT ALL ON public.channel_video_metrics TO service_role;
ALTER TABLE public.channel_video_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own video metrics" ON public.channel_video_metrics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_channel_video_metrics_lookup ON public.channel_video_metrics (user_id, window_key, collected_at DESC);

CREATE TABLE public.channel_baselines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  window_key TEXT NOT NULL,
  cohort TEXT NOT NULL DEFAULT 'all',
  sample_size INT NOT NULL DEFAULT 0,
  median_views NUMERIC,
  average_views NUMERIC,
  p25_views NUMERIC,
  p75_views NUMERIC,
  median_watch_time_minutes NUMERIC,
  median_retention_percentage NUMERIC,
  median_subscribers_gained NUMERIC,
  sufficiency TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, window_key, cohort)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_baselines TO authenticated;
GRANT ALL ON public.channel_baselines TO service_role;
ALTER TABLE public.channel_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own baselines" ON public.channel_baselines FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.channel_learnings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  confidence NUMERIC NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  video_id TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_learnings TO authenticated;
GRANT ALL ON public.channel_learnings TO service_role;
ALTER TABLE public.channel_learnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own learnings" ON public.channel_learnings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_channel_learnings_user ON public.channel_learnings (user_id, created_at DESC);

CREATE TABLE public.channel_experiments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  video_id TEXT,
  hypothesis TEXT NOT NULL,
  what_changed TEXT NOT NULL,
  expected_outcome TEXT,
  actual_outcome TEXT,
  metrics JSONB NOT NULL DEFAULT '{}',
  baseline JSONB NOT NULL DEFAULT '{}',
  conclusion TEXT,
  confidence NUMERIC NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'NEW_EXPERIMENT',
  next_action TEXT,
  mode TEXT NOT NULL DEFAULT 'EXPLOITATION',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_experiments TO authenticated;
GRANT ALL ON public.channel_experiments TO service_role;
ALTER TABLE public.channel_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own experiments" ON public.channel_experiments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_channel_experiments_user ON public.channel_experiments (user_id, created_at DESC);

CREATE TABLE public.channel_strategies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  objective TEXT NOT NULL,
  observed_strengths JSONB NOT NULL DEFAULT '[]',
  observed_weaknesses JSONB NOT NULL DEFAULT '[]',
  next_experiment TEXT,
  maintain JSONB NOT NULL DEFAULT '[]',
  test JSONB NOT NULL DEFAULT '[]',
  avoid JSONB NOT NULL DEFAULT '[]',
  target_duration_seconds INT,
  recommended_genre TEXT,
  recommended_structure TEXT,
  recommended_narration TEXT,
  recommended_upload_time TEXT,
  thumbnail_direction TEXT,
  exploration_ratio NUMERIC NOT NULL DEFAULT 0.2,
  mode TEXT NOT NULL DEFAULT 'EXPLORATION',
  evidence JSONB NOT NULL DEFAULT '{}',
  sufficiency TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_strategies TO authenticated;
GRANT ALL ON public.channel_strategies TO service_role;
ALTER TABLE public.channel_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own strategies" ON public.channel_strategies FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_channel_strategies_active ON public.channel_strategies (user_id, active, version DESC);

CREATE TABLE public.channel_sync_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  detail TEXT,
  items_synced INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_sync_log TO authenticated;
GRANT ALL ON public.channel_sync_log TO service_role;
ALTER TABLE public.channel_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own sync log" ON public.channel_sync_log FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_channel_sync_log_user ON public.channel_sync_log (user_id, started_at DESC);

CREATE INDEX idx_projects_user_created ON public.projects (user_id, created_at DESC);
CREATE INDEX idx_projects_status ON public.projects (user_id, status, created_at DESC);
CREATE INDEX idx_scenes_project ON public.scenes (project_id, scene_number);
CREATE INDEX idx_assets_project ON public.assets (project_id, kind);
CREATE INDEX idx_assets_scene ON public.assets (scene_id);
CREATE INDEX idx_renders_project ON public.renders (project_id, created_at DESC);
CREATE INDEX idx_queue_items_position ON public.queue_items (user_id, position);
CREATE INDEX idx_scheduled_posts_date ON public.scheduled_posts (user_id, scheduled_date);
CREATE INDEX idx_analytics_project ON public.analytics_events (project_id, recorded_at DESC);
CREATE INDEX idx_stories_project ON public.stories (project_id);
CREATE INDEX idx_captions_project ON public.captions (project_id);
CREATE INDEX idx_thumbnails_project ON public.thumbnails (project_id);
CREATE INDEX idx_narrations_project ON public.narrations (project_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_stories_updated_at BEFORE UPDATE ON public.stories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_characters_updated_at BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scenes_updated_at BEFORE UPDATE ON public.scenes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_narrations_updated_at BEFORE UPDATE ON public.narrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_captions_updated_at BEFORE UPDATE ON public.captions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_thumbnails_updated_at BEFORE UPDATE ON public.thumbnails FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_renders_updated_at BEFORE UPDATE ON public.renders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scheduled_posts_updated_at BEFORE UPDATE ON public.scheduled_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_production_jobs_updated_at BEFORE UPDATE ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_production_steps_updated_at BEFORE UPDATE ON public.production_steps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_youtube_connections_updated_at BEFORE UPDATE ON public.youtube_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_youtube_uploads_updated_at BEFORE UPDATE ON public.youtube_uploads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_channel_profile_updated_at BEFORE UPDATE ON public.channel_profile FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_channel_videos_updated_at BEFORE UPDATE ON public.channel_videos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_channel_experiments_updated_at BEFORE UPDATE ON public.channel_experiments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_channel_strategies_updated_at BEFORE UPDATE ON public.channel_strategies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users read own production files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'productions' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users write own production files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'productions' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users update own production files" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'productions' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own production files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'productions' AND (storage.foldername(name))[1] = auth.uid()::text);