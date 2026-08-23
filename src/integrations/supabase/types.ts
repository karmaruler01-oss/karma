export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      analytics_events: {
        Row: {
          created_at: string
          id: string
          metric: string
          platform: string | null
          project_id: string
          recorded_at: string
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          metric: string
          platform?: string | null
          project_id: string
          recorded_at?: string
          user_id: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          metric?: string
          platform?: string | null
          project_id?: string
          recorded_at?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          created_at: string
          id: string
          kind: string
          meta: Json
          project_id: string
          scene_id: string | null
          status: string
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          meta?: Json
          project_id: string
          scene_id?: string | null
          status?: string
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          meta?: Json
          project_id?: string
          scene_id?: string | null
          status?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      captions: {
        Row: {
          chunks: Json
          created_at: string
          id: string
          project_id: string
          status: string
          style: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          chunks?: Json
          created_at?: string
          id?: string
          project_id: string
          status?: string
          style?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          chunks?: Json
          created_at?: string
          id?: string
          project_id?: string
          status?: string
          style?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "captions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_baselines: {
        Row: {
          average_views: number | null
          cohort: string
          computed_at: string
          id: string
          median_retention_percentage: number | null
          median_subscribers_gained: number | null
          median_views: number | null
          median_watch_time_minutes: number | null
          p25_views: number | null
          p75_views: number | null
          sample_size: number
          sufficiency: string
          user_id: string
          window_key: string
        }
        Insert: {
          average_views?: number | null
          cohort?: string
          computed_at?: string
          id?: string
          median_retention_percentage?: number | null
          median_subscribers_gained?: number | null
          median_views?: number | null
          median_watch_time_minutes?: number | null
          p25_views?: number | null
          p75_views?: number | null
          sample_size?: number
          sufficiency?: string
          user_id: string
          window_key: string
        }
        Update: {
          average_views?: number | null
          cohort?: string
          computed_at?: string
          id?: string
          median_retention_percentage?: number | null
          median_subscribers_gained?: number | null
          median_views?: number | null
          median_watch_time_minutes?: number | null
          p25_views?: number | null
          p75_views?: number | null
          sample_size?: number
          sufficiency?: string
          user_id?: string
          window_key?: string
        }
        Relationships: []
      }
      channel_experiments: {
        Row: {
          actual_outcome: string | null
          baseline: Json
          conclusion: string | null
          confidence: number
          created_at: string
          expected_outcome: string | null
          hypothesis: string
          id: string
          metrics: Json
          mode: string
          next_action: string | null
          project_id: string | null
          state: string
          updated_at: string
          user_id: string
          video_id: string | null
          what_changed: string
        }
        Insert: {
          actual_outcome?: string | null
          baseline?: Json
          conclusion?: string | null
          confidence?: number
          created_at?: string
          expected_outcome?: string | null
          hypothesis: string
          id?: string
          metrics?: Json
          mode?: string
          next_action?: string | null
          project_id?: string | null
          state?: string
          updated_at?: string
          user_id: string
          video_id?: string | null
          what_changed: string
        }
        Update: {
          actual_outcome?: string | null
          baseline?: Json
          conclusion?: string | null
          confidence?: number
          created_at?: string
          expected_outcome?: string | null
          hypothesis?: string
          id?: string
          metrics?: Json
          mode?: string
          next_action?: string | null
          project_id?: string | null
          state?: string
          updated_at?: string
          user_id?: string
          video_id?: string | null
          what_changed?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_experiments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_learnings: {
        Row: {
          category: string
          confidence: number
          created_at: string
          evidence: Json
          id: string
          observed_at: string
          project_id: string | null
          source: string
          state: string
          statement: string
          user_id: string
          video_id: string | null
        }
        Insert: {
          category: string
          confidence?: number
          created_at?: string
          evidence?: Json
          id?: string
          observed_at?: string
          project_id?: string | null
          source: string
          state?: string
          statement: string
          user_id: string
          video_id?: string | null
        }
        Update: {
          category?: string
          confidence?: number
          created_at?: string
          evidence?: Json
          id?: string
          observed_at?: string
          project_id?: string | null
          source?: string
          state?: string
          statement?: string
          user_id?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_learnings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_profile: {
        Row: {
          audience_profile: Json
          channel_id: string | null
          channel_title: string | null
          country: string | null
          created_at: string
          data_sufficiency: string
          description: string | null
          id: string
          last_synced_at: string | null
          subscriber_count: number | null
          thumbnail_url: string | null
          updated_at: string
          user_id: string
          video_count: number | null
          view_count: number | null
        }
        Insert: {
          audience_profile?: Json
          channel_id?: string | null
          channel_title?: string | null
          country?: string | null
          created_at?: string
          data_sufficiency?: string
          description?: string | null
          id?: string
          last_synced_at?: string | null
          subscriber_count?: number | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
          video_count?: number | null
          view_count?: number | null
        }
        Update: {
          audience_profile?: Json
          channel_id?: string | null
          channel_title?: string | null
          country?: string | null
          created_at?: string
          data_sufficiency?: string
          description?: string | null
          id?: string
          last_synced_at?: string | null
          subscriber_count?: number | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
          video_count?: number | null
          view_count?: number | null
        }
        Relationships: []
      }
      channel_strategies: {
        Row: {
          active: boolean
          avoid: Json
          created_at: string
          evidence: Json
          exploration_ratio: number
          id: string
          maintain: Json
          mode: string
          next_experiment: string | null
          objective: string
          observed_strengths: Json
          observed_weaknesses: Json
          recommended_genre: string | null
          recommended_narration: string | null
          recommended_structure: string | null
          recommended_upload_time: string | null
          sufficiency: string
          target_duration_seconds: number | null
          test: Json
          thumbnail_direction: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          active?: boolean
          avoid?: Json
          created_at?: string
          evidence?: Json
          exploration_ratio?: number
          id?: string
          maintain?: Json
          mode?: string
          next_experiment?: string | null
          objective: string
          observed_strengths?: Json
          observed_weaknesses?: Json
          recommended_genre?: string | null
          recommended_narration?: string | null
          recommended_structure?: string | null
          recommended_upload_time?: string | null
          sufficiency?: string
          target_duration_seconds?: number | null
          test?: Json
          thumbnail_direction?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          active?: boolean
          avoid?: Json
          created_at?: string
          evidence?: Json
          exploration_ratio?: number
          id?: string
          maintain?: Json
          mode?: string
          next_experiment?: string | null
          objective?: string
          observed_strengths?: Json
          observed_weaknesses?: Json
          recommended_genre?: string | null
          recommended_narration?: string | null
          recommended_structure?: string | null
          recommended_upload_time?: string | null
          sufficiency?: string
          target_duration_seconds?: number | null
          test?: Json
          thumbnail_direction?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      channel_sync_log: {
        Row: {
          detail: string | null
          finished_at: string | null
          id: string
          items_synced: number
          kind: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          detail?: string | null
          finished_at?: string | null
          id?: string
          items_synced?: number
          kind: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          detail?: string | null
          finished_at?: string | null
          id?: string
          items_synced?: number
          kind?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      channel_video_metrics: {
        Row: {
          average_view_duration_seconds: number | null
          average_view_percentage: number | null
          collected_at: string
          comments: number | null
          id: string
          impression_ctr: number | null
          impressions: number | null
          likes: number | null
          retention_curve: Json
          shares: number | null
          source: string
          subscribers_gained: number | null
          traffic_sources: Json
          us_share: number | null
          user_id: string
          video_id: string
          views: number | null
          watch_time_minutes: number | null
          window_key: string
        }
        Insert: {
          average_view_duration_seconds?: number | null
          average_view_percentage?: number | null
          collected_at?: string
          comments?: number | null
          id?: string
          impression_ctr?: number | null
          impressions?: number | null
          likes?: number | null
          retention_curve?: Json
          shares?: number | null
          source?: string
          subscribers_gained?: number | null
          traffic_sources?: Json
          us_share?: number | null
          user_id: string
          video_id: string
          views?: number | null
          watch_time_minutes?: number | null
          window_key: string
        }
        Update: {
          average_view_duration_seconds?: number | null
          average_view_percentage?: number | null
          collected_at?: string
          comments?: number | null
          id?: string
          impression_ctr?: number | null
          impressions?: number | null
          likes?: number | null
          retention_curve?: Json
          shares?: number | null
          source?: string
          subscribers_gained?: number | null
          traffic_sources?: Json
          us_share?: number | null
          user_id?: string
          video_id?: string
          views?: number | null
          watch_time_minutes?: number | null
          window_key?: string
        }
        Relationships: []
      }
      channel_videos: {
        Row: {
          created_at: string
          description: string | null
          duration_seconds: number | null
          genre: string | null
          hook_text: string | null
          id: string
          last_synced_at: string | null
          narration_style: string | null
          privacy_status: string | null
          project_id: string | null
          published_at: string | null
          short_form: boolean
          structure: string | null
          tags: Json
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          genre?: string | null
          hook_text?: string | null
          id?: string
          last_synced_at?: string | null
          narration_style?: string | null
          privacy_status?: string | null
          project_id?: string | null
          published_at?: string | null
          short_form?: boolean
          structure?: string | null
          tags?: Json
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          genre?: string | null
          hook_text?: string | null
          id?: string
          last_synced_at?: string | null
          narration_style?: string | null
          privacy_status?: string | null
          project_id?: string | null
          published_at?: string | null
          short_form?: boolean
          structure?: string | null
          tags?: Json
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_videos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          age: string | null
          appearance: string | null
          body_type: string | null
          clothing: string | null
          created_at: string
          gender: string | null
          hair: string | null
          id: string
          name: string
          personality: string | null
          project_id: string
          updated_at: string
          user_id: string
          visual_style: string | null
        }
        Insert: {
          age?: string | null
          appearance?: string | null
          body_type?: string | null
          clothing?: string | null
          created_at?: string
          gender?: string | null
          hair?: string | null
          id?: string
          name: string
          personality?: string | null
          project_id: string
          updated_at?: string
          user_id: string
          visual_style?: string | null
        }
        Update: {
          age?: string | null
          appearance?: string | null
          body_type?: string | null
          clothing?: string | null
          created_at?: string
          gender?: string | null
          hair?: string | null
          id?: string
          name?: string
          personality?: string | null
          project_id?: string
          updated_at?: string
          user_id?: string
          visual_style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "characters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      narrations: {
        Row: {
          accent: string
          audio_asset_id: string | null
          created_at: string
          emotion: string
          gender: string
          id: string
          pitch: number
          project_id: string
          speed: number
          status: string
          text: string | null
          updated_at: string
          user_id: string
          voice: string
        }
        Insert: {
          accent?: string
          audio_asset_id?: string | null
          created_at?: string
          emotion?: string
          gender?: string
          id?: string
          pitch?: number
          project_id: string
          speed?: number
          status?: string
          text?: string | null
          updated_at?: string
          user_id: string
          voice?: string
        }
        Update: {
          accent?: string
          audio_asset_id?: string | null
          created_at?: string
          emotion?: string
          gender?: string
          id?: string
          pitch?: number
          project_id?: string
          speed?: number
          status?: string
          text?: string | null
          updated_at?: string
          user_id?: string
          voice?: string
        }
        Relationships: [
          {
            foreignKeyName: "narrations_audio_asset_id_fkey"
            columns: ["audio_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      production_jobs: {
        Row: {
          concurrency: number
          created_at: string
          current_step: string | null
          error: string | null
          id: string
          lease_until: string | null
          progress: number
          project_id: string
          prompt: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          concurrency?: number
          created_at?: string
          current_step?: string | null
          error?: string | null
          id?: string
          lease_until?: string | null
          progress?: number
          project_id: string
          prompt: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          concurrency?: number
          created_at?: string
          current_step?: string | null
          error?: string | null
          id?: string
          lease_until?: string | null
          progress?: number
          project_id?: string
          prompt?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      production_steps: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          job_id: string
          metadata: Json
          position: number
          started_at: string | null
          status: string
          step: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          job_id: string
          metadata?: Json
          position?: number
          started_at?: string | null
          status?: string
          step: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          job_id?: string
          metadata?: Json
          position?: number
          started_at?: string | null
          status?: string
          step?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_steps_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "production_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          approved_at: string | null
          aspect_ratio: string
          created_at: string
          current_stage: string
          custom_story_type: string | null
          duration_seconds: number
          ending_type: string
          id: string
          intensity: number
          narration_style: string
          overall_score: number | null
          rejected_at: string | null
          review_note: string | null
          source_prompt: string | null
          status: string
          story_type: string
          title: string
          tone: string
          topic: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          aspect_ratio?: string
          created_at?: string
          current_stage?: string
          custom_story_type?: string | null
          duration_seconds?: number
          ending_type?: string
          id?: string
          intensity?: number
          narration_style?: string
          overall_score?: number | null
          rejected_at?: string | null
          review_note?: string | null
          source_prompt?: string | null
          status?: string
          story_type?: string
          title?: string
          tone?: string
          topic?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          aspect_ratio?: string
          created_at?: string
          current_stage?: string
          custom_story_type?: string | null
          duration_seconds?: number
          ending_type?: string
          id?: string
          intensity?: number
          narration_style?: string
          overall_score?: number | null
          rejected_at?: string | null
          review_note?: string | null
          source_prompt?: string | null
          status?: string
          story_type?: string
          title?: string
          tone?: string
          topic?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      queue_items: {
        Row: {
          created_at: string
          id: string
          note: string | null
          position: number
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          position?: number
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          position?: number
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      renders: {
        Row: {
          created_at: string
          error: string | null
          format: string
          id: string
          project_id: string
          provider: string | null
          status: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          format?: string
          id?: string
          project_id: string
          provider?: string | null
          status?: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          format?: string
          id?: string
          project_id?: string
          provider?: string | null
          status?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          camera_movement: string | null
          character_description: string | null
          created_at: string
          duration_seconds: number | null
          emotion: string | null
          environment: string | null
          id: string
          image_prompt: string | null
          lighting: string | null
          narration: string | null
          project_id: string
          scene_number: number
          sound_effect: string | null
          start_seconds: number | null
          transition: string | null
          updated_at: string
          user_id: string
          video_prompt: string | null
          visual_description: string | null
          visual_status: string
        }
        Insert: {
          camera_movement?: string | null
          character_description?: string | null
          created_at?: string
          duration_seconds?: number | null
          emotion?: string | null
          environment?: string | null
          id?: string
          image_prompt?: string | null
          lighting?: string | null
          narration?: string | null
          project_id: string
          scene_number: number
          sound_effect?: string | null
          start_seconds?: number | null
          transition?: string | null
          updated_at?: string
          user_id: string
          video_prompt?: string | null
          visual_description?: string | null
          visual_status?: string
        }
        Update: {
          camera_movement?: string | null
          character_description?: string | null
          created_at?: string
          duration_seconds?: number | null
          emotion?: string | null
          environment?: string | null
          id?: string
          image_prompt?: string | null
          lighting?: string | null
          narration?: string | null
          project_id?: string
          scene_number?: number
          sound_effect?: string | null
          start_seconds?: number | null
          transition?: string | null
          updated_at?: string
          user_id?: string
          video_prompt?: string | null
          visual_description?: string | null
          visual_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_posts: {
        Row: {
          created_at: string
          id: string
          note: string | null
          platform: string
          project_id: string
          scheduled_date: string
          scheduled_time: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          platform?: string
          project_id: string
          scheduled_date: string
          scheduled_time?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          platform?: string
          project_id?: string
          scheduled_date?: string
          scheduled_time?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          ai_settings: Json
          caption_settings: Json
          cleanup_temp_assets: boolean
          created_at: string
          default_aspect_ratio: string
          default_genre: string
          default_story_length: number
          default_tone: string
          exploration_ratio: number
          generation_concurrency: number
          id: string
          updated_at: string
          us_audience_mode: boolean
          user_id: string
          video_settings: Json
          voice_settings: Json
          youtube_auto_publish: boolean
          youtube_auto_upload: boolean
          youtube_default_privacy: string
        }
        Insert: {
          ai_settings?: Json
          caption_settings?: Json
          cleanup_temp_assets?: boolean
          created_at?: string
          default_aspect_ratio?: string
          default_genre?: string
          default_story_length?: number
          default_tone?: string
          exploration_ratio?: number
          generation_concurrency?: number
          id?: string
          updated_at?: string
          us_audience_mode?: boolean
          user_id: string
          video_settings?: Json
          voice_settings?: Json
          youtube_auto_publish?: boolean
          youtube_auto_upload?: boolean
          youtube_default_privacy?: string
        }
        Update: {
          ai_settings?: Json
          caption_settings?: Json
          cleanup_temp_assets?: boolean
          created_at?: string
          default_aspect_ratio?: string
          default_genre?: string
          default_story_length?: number
          default_tone?: string
          exploration_ratio?: number
          generation_concurrency?: number
          id?: string
          updated_at?: string
          us_audience_mode?: boolean
          user_id?: string
          video_settings?: Json
          voice_settings?: Json
          youtube_auto_publish?: boolean
          youtube_auto_upload?: boolean
          youtube_default_privacy?: string
        }
        Relationships: []
      }
      stories: {
        Row: {
          alt_hooks: Json
          alt_titles: Json
          body: string | null
          created_at: string
          cta: string | null
          ending: string | null
          hook: string | null
          id: string
          overall_score: number | null
          project_id: string
          scores: Json
          title: string | null
          updated_at: string
          us_optimized: boolean
          user_id: string
        }
        Insert: {
          alt_hooks?: Json
          alt_titles?: Json
          body?: string | null
          created_at?: string
          cta?: string | null
          ending?: string | null
          hook?: string | null
          id?: string
          overall_score?: number | null
          project_id: string
          scores?: Json
          title?: string | null
          updated_at?: string
          us_optimized?: boolean
          user_id: string
        }
        Update: {
          alt_hooks?: Json
          alt_titles?: Json
          body?: string | null
          created_at?: string
          cta?: string | null
          ending?: string | null
          hook?: string | null
          id?: string
          overall_score?: number | null
          project_id?: string
          scores?: Json
          title?: string | null
          updated_at?: string
          us_optimized?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      thumbnails: {
        Row: {
          asset_id: string | null
          concept: string | null
          created_at: string
          id: string
          project_id: string
          prompt: string | null
          status: string
          title_text: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_id?: string | null
          concept?: string | null
          created_at?: string
          id?: string
          project_id: string
          prompt?: string | null
          status?: string
          title_text?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_id?: string | null
          concept?: string | null
          created_at?: string
          id?: string
          project_id?: string
          prompt?: string | null
          status?: string
          title_text?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thumbnails_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thumbnails_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_connections: {
        Row: {
          access_token: string | null
          channel_id: string | null
          channel_title: string | null
          connected_at: string
          error: string | null
          id: string
          refresh_token: string | null
          scope: string | null
          status: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          channel_id?: string | null
          channel_title?: string | null
          connected_at?: string
          error?: string | null
          id?: string
          refresh_token?: string | null
          scope?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          channel_id?: string | null
          channel_title?: string | null
          connected_at?: string
          error?: string | null
          id?: string
          refresh_token?: string | null
          scope?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      youtube_oauth_states: {
        Row: {
          created_at: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          redirect_uri?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      youtube_uploads: {
        Row: {
          created_at: string
          description: string | null
          error: string | null
          id: string
          job_id: string | null
          privacy_status: string
          processing_status: string | null
          project_id: string
          short_form: boolean
          tags: Json
          title: string | null
          updated_at: string
          upload_status: string
          uploaded_at: string | null
          user_id: string
          youtube_url: string | null
          youtube_video_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          job_id?: string | null
          privacy_status?: string
          processing_status?: string | null
          project_id: string
          short_form?: boolean
          tags?: Json
          title?: string | null
          updated_at?: string
          upload_status?: string
          uploaded_at?: string | null
          user_id: string
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          job_id?: string | null
          privacy_status?: string
          processing_status?: string | null
          project_id?: string
          short_form?: boolean
          tags?: Json
          title?: string | null
          updated_at?: string
          upload_status?: string
          uploaded_at?: string | null
          user_id?: string
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "youtube_uploads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "production_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "youtube_uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
