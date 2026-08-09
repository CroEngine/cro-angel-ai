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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      angel_billing: {
        Row: {
          current_period_end: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          current_period_end?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          current_period_end?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      angel_content_inventory: {
        Row: {
          created_at: string
          id: string
          item_id: string
          meta: Json
          path: string
          selector: string | null
          site_slug: string
          slot: string
          text: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          meta?: Json
          path?: string
          selector?: string | null
          site_slug: string
          slot: string
          text?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          meta?: Json
          path?: string
          selector?: string | null
          site_slug?: string
          slot?: string
          text?: string | null
        }
        Relationships: []
      }
      angel_events: {
        Row: {
          created_at: string
          decision_id: string | null
          id: number
          payload: Json
          site: string
          type: string
          visitor_hash: string | null
        }
        Insert: {
          created_at?: string
          decision_id?: string | null
          id?: never
          payload?: Json
          site: string
          type: string
          visitor_hash?: string | null
        }
        Update: {
          created_at?: string
          decision_id?: string | null
          id?: never
          payload?: Json
          site?: string
          type?: string
          visitor_hash?: string | null
        }
        Relationships: []
      }
      angel_notifications: {
        Row: {
          channel: string
          created_at: string
          dedupe_key: string
          email: string
          id: string
          kind: string
          payload: Json
          site: string
        }
        Insert: {
          channel?: string
          created_at?: string
          dedupe_key: string
          email: string
          id?: string
          kind: string
          payload?: Json
          site: string
        }
        Update: {
          channel?: string
          created_at?: string
          dedupe_key?: string
          email?: string
          id?: string
          kind?: string
          payload?: Json
          site?: string
        }
        Relationships: []
      }
      angel_preview_jobs: {
        Row: {
          created_at: string
          error: string | null
          findings: Json | null
          id: string
          report_url: string | null
          requester_hash: string
          status: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          findings?: Json | null
          id?: string
          report_url?: string | null
          requester_hash: string
          status?: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          error?: string | null
          findings?: Json | null
          id?: string
          report_url?: string | null
          requester_hash?: string
          status?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      angel_referrer_domains: {
        Row: {
          day: string
          domain: string
          site: string
          visits: number
        }
        Insert: {
          day?: string
          domain: string
          site: string
          visits?: number
        }
        Update: {
          day?: string
          domain?: string
          site?: string
          visits?: number
        }
        Relationships: []
      }
      angel_site_members: {
        Row: {
          created_at: string
          id: string
          role: string
          site_slug: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          site_slug: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          site_slug?: string
          user_id?: string
        }
        Relationships: []
      }
      angel_sites: {
        Row: {
          adaptations_enabled: boolean
          billing_status: string
          consent_mode: string
          conversion_kind: string | null
          conversion_selector: string | null
          conversion_source: string | null
          conversion_text: string | null
          conversion_url: string | null
          created_at: string
          day0_findings: Json | null
          day0_report_at: string | null
          day0_report_status: string | null
          day0_report_url: string | null
          domain: string | null
          domain_verified_at: string | null
          first_verified_at: string | null
          goal_candidates: Json | null
          holdout_pct: number
          id: string
          ingest_key: string | null
          layout_patterns_enabled: boolean
          name: string | null
          observe_sections: boolean
          ramp_pct: number
          serving_enabled: boolean
          slug: string
          test_metric: string
        }
        Insert: {
          adaptations_enabled?: boolean
          billing_status?: string
          consent_mode?: string
          conversion_kind?: string | null
          conversion_selector?: string | null
          conversion_source?: string | null
          conversion_text?: string | null
          conversion_url?: string | null
          created_at?: string
          day0_findings?: Json | null
          day0_report_at?: string | null
          day0_report_status?: string | null
          day0_report_url?: string | null
          domain?: string | null
          domain_verified_at?: string | null
          first_verified_at?: string | null
          goal_candidates?: Json | null
          holdout_pct?: number
          id?: string
          ingest_key?: string | null
          layout_patterns_enabled?: boolean
          name?: string | null
          observe_sections?: boolean
          ramp_pct?: number
          serving_enabled?: boolean
          slug: string
          test_metric?: string
        }
        Update: {
          adaptations_enabled?: boolean
          billing_status?: string
          consent_mode?: string
          conversion_kind?: string | null
          conversion_selector?: string | null
          conversion_source?: string | null
          conversion_text?: string | null
          conversion_url?: string | null
          created_at?: string
          day0_findings?: Json | null
          day0_report_at?: string | null
          day0_report_status?: string | null
          day0_report_url?: string | null
          domain?: string | null
          domain_verified_at?: string | null
          first_verified_at?: string | null
          goal_candidates?: Json | null
          holdout_pct?: number
          id?: string
          ingest_key?: string | null
          layout_patterns_enabled?: boolean
          name?: string | null
          observe_sections?: boolean
          ramp_pct?: number
          serving_enabled?: boolean
          slug?: string
          test_metric?: string
        }
        Relationships: []
      }
      angel_variants: {
        Row: {
          created_at: string
          evidence: Json
          held_at: string | null
          held_reason: string | null
          id: string
          ops: Json
          path: string
          required_cohorts: string[] | null
          segment_key: string
          serve_ops: Json
          site: string
          status: string
          success: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          evidence?: Json
          held_at?: string | null
          held_reason?: string | null
          id?: string
          ops?: Json
          path?: string
          required_cohorts?: string[] | null
          segment_key: string
          serve_ops?: Json
          site: string
          status?: string
          success?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          evidence?: Json
          held_at?: string | null
          held_reason?: string | null
          id?: string
          ops?: Json
          path?: string
          required_cohorts?: string[] | null
          segment_key?: string
          serve_ops?: Json
          site?: string
          status?: string
          success?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      content_inventory: {
        Row: {
          above_fold: boolean | null
          attrs: Json | null
          category: string
          crawl_run_id: string | null
          extractor_version: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          rect: Json | null
          section_kind: string | null
          selector: string
          site_id: string
          text: string | null
          url: string
          visual_weight: number | null
        }
        Insert: {
          above_fold?: boolean | null
          attrs?: Json | null
          category: string
          crawl_run_id?: string | null
          extractor_version?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          rect?: Json | null
          section_kind?: string | null
          selector: string
          site_id: string
          text?: string | null
          url: string
          visual_weight?: number | null
        }
        Update: {
          above_fold?: boolean | null
          attrs?: Json | null
          category?: string
          crawl_run_id?: string | null
          extractor_version?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          rect?: Json | null
          section_kind?: string | null
          selector?: string
          site_id?: string
          text?: string | null
          url?: string
          visual_weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_inventory_crawl_run_id_fkey"
            columns: ["crawl_run_id"]
            isOneToOne: false
            referencedRelation: "crawl_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_inventory_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      crawl_runs: {
        Row: {
          error: string | null
          extractor_version: string | null
          finished_at: string | null
          id: string
          pages_crawled: number
          site_id: string
          started_at: string
          status: string
        }
        Insert: {
          error?: string | null
          extractor_version?: string | null
          finished_at?: string | null
          id?: string
          pages_crawled?: number
          site_id: string
          started_at?: string
          status?: string
        }
        Update: {
          error?: string | null
          extractor_version?: string | null
          finished_at?: string | null
          id?: string
          pages_crawled?: number
          site_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crawl_runs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          client_ts: string | null
          ctx: Json | null
          id: number
          received_at: string
          selector: string | null
          session_id: string | null
          site_id: string
          type: string
          url: string | null
          value: number | null
          visitor_id: string | null
        }
        Insert: {
          client_ts?: string | null
          ctx?: Json | null
          id?: never
          received_at?: string
          selector?: string | null
          session_id?: string | null
          site_id: string
          type: string
          url?: string | null
          value?: number | null
          visitor_id?: string | null
        }
        Update: {
          client_ts?: string | null
          ctx?: Json | null
          id?: never
          received_at?: string
          selector?: string | null
          session_id?: string | null
          site_id?: string
          type?: string
          url?: string | null
          value?: number | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      events_rollup: {
        Row: {
          avg_scroll_pct: number
          conversions: number
          cta_clicks: number
          day: string
          exits_before: number
          id: string
          reached_section: number
          section_kind: string
          segment_id: string | null
          site_id: string
          source: string
          views: number
        }
        Insert: {
          avg_scroll_pct?: number
          conversions?: number
          cta_clicks?: number
          day: string
          exits_before?: number
          id?: string
          reached_section?: number
          section_kind?: string
          segment_id?: string | null
          site_id: string
          source?: string
          views?: number
        }
        Update: {
          avg_scroll_pct?: number
          conversions?: number
          cta_clicks?: number
          day?: string
          exits_before?: number
          id?: string
          reached_section?: number
          section_kind?: string
          segment_id?: string | null
          site_id?: string
          source?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "events_rollup_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          bounced: boolean | null
          device: Json | null
          duration_ms: number | null
          ended_at: string | null
          entry_url: string | null
          exit_url: string | null
          geo: Json | null
          id: string
          language: string | null
          max_scroll_pct: number | null
          site_id: string
          source: string | null
          started_at: string
          utm: Json | null
          visitor_id: string
        }
        Insert: {
          bounced?: boolean | null
          device?: Json | null
          duration_ms?: number | null
          ended_at?: string | null
          entry_url?: string | null
          exit_url?: string | null
          geo?: Json | null
          id?: string
          language?: string | null
          max_scroll_pct?: number | null
          site_id: string
          source?: string | null
          started_at?: string
          utm?: Json | null
          visitor_id: string
        }
        Update: {
          bounced?: boolean | null
          device?: Json | null
          duration_ms?: number | null
          ended_at?: string | null
          entry_url?: string | null
          exit_url?: string | null
          geo?: Json | null
          id?: string
          language?: string | null
          max_scroll_pct?: number | null
          site_id?: string
          source?: string | null
          started_at?: string
          utm?: Json | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          allowed_origins: string[]
          consent_config: Json
          consent_mode: string
          created_at: string
          domain: string
          id: string
          owner_user_id: string
          phase: string
          public_site_key: string
          updated_at: string
        }
        Insert: {
          allowed_origins?: string[]
          consent_config?: Json
          consent_mode?: string
          created_at?: string
          domain: string
          id?: string
          owner_user_id: string
          phase?: string
          public_site_key: string
          updated_at?: string
        }
        Update: {
          allowed_origins?: string[]
          consent_config?: Json
          consent_mode?: string
          created_at?: string
          domain?: string
          id?: string
          owner_user_id?: string
          phase?: string
          public_site_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      visitors: {
        Row: {
          first_referrer: string | null
          first_seen_at: string
          first_utm: Json | null
          id: string
          is_returning: boolean
          last_seen_at: string
          site_id: string
          visitor_key: string
        }
        Insert: {
          first_referrer?: string | null
          first_seen_at?: string
          first_utm?: Json | null
          id?: string
          is_returning?: boolean
          last_seen_at?: string
          site_id: string
          visitor_key: string
        }
        Update: {
          first_referrer?: string | null
          first_seen_at?: string
          first_utm?: Json | null
          id?: string
          is_returning?: boolean
          last_seen_at?: string
          site_id?: string
          visitor_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitors_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      angel_events_clean: {
        Row: {
          created_at: string | null
          decision_id: string | null
          id: number | null
          payload: Json | null
          site: string | null
          type: string | null
          visitor_hash: string | null
        }
        Insert: {
          created_at?: string | null
          decision_id?: string | null
          id?: number | null
          payload?: Json | null
          site?: string | null
          type?: string | null
          visitor_hash?: string | null
        }
        Update: {
          created_at?: string | null
          decision_id?: string | null
          id?: number | null
          payload?: Json | null
          site?: string | null
          type?: string | null
          visitor_hash?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      angel_bump_referrer_domain: {
        Args: { p_domain: string; p_site: string }
        Returns: undefined
      }
      angel_cohort_traffic: {
        Args: { p_days?: number; p_site: string }
        Returns: {
          is_returning: boolean
          traffic_source: string
          viewed_pricing: boolean
          visitors: number
        }[]
      }
      angel_email_has_account: {
        Args: { p_email: string }
        Returns: boolean
      }
      angel_page_flow_rollup: {
        Args: { p_since?: string; p_site: string }
        Returns: {
          channel: string
          country: string
          dest_path: string
          device: string
          is_returning: boolean
          landing_path: string
          reached: number
          sessions: number
        }[]
      }
      angel_page_segment_rollup: {
        Args: { p_since?: string; p_site: string }
        Returns: {
          channel: string
          conversions: number
          country: string
          device: string
          is_returning: boolean
          path: string
          visits: number
        }[]
      }
      angel_referrer_domains_top: {
        Args: { p_limit?: number; p_site: string }
        Returns: {
          domain: string
          visits: number
        }[]
      }
      angel_segment_rollup: {
        Args: { p_since?: string; p_site: string }
        Returns: {
          channel: string
          conversions: number
          country: string
          device: string
          form_abandons: number
          form_starts: number
          is_returning: boolean
          rage_sessions: number
          visits: number
        }[]
      }
      angel_variant_arms: {
        Args: { p_site: string; p_variant: string }
        Returns: {
          arm: string
          continuations: number
          conversions: number
          cta_clicks: number
          deep_scrolls: number
          engaged: number
          form_submits: number
          visits: number
        }[]
      }
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
