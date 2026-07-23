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
          user_id: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          status: string
          trial_end: string | null
          current_period_end: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          status?: string
          trial_end?: string | null
          current_period_end?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          status?: string
          trial_end?: string | null
          current_period_end?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      angel_preview_jobs: {
        Row: {
          id: string
          url: string
          status: string
          report_url: string | null
          findings: Json | null
          error: string | null
          requester_hash: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          url: string
          status?: string
          report_url?: string | null
          findings?: Json | null
          error?: string | null
          requester_hash: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          url?: string
          status?: string
          report_url?: string | null
          findings?: Json | null
          error?: string | null
          requester_hash?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      angel_notifications: {
        Row: {
          id: string
          site: string
          kind: string
          dedupe_key: string
          email: string
          channel: string
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          site: string
          kind: string
          dedupe_key: string
          email: string
          channel?: string
          payload?: Json
          created_at?: string
        }
        Update: {
          id?: string
          site?: string
          kind?: string
          dedupe_key?: string
          email?: string
          channel?: string
          payload?: Json
          created_at?: string
        }
        Relationships: []
      }
      angel_sites: {
        Row: {
          id: string
          slug: string
          domain: string | null
          domain_verified_at: string | null
          billing_status: string
          name: string | null
          consent_mode: string
          holdout_pct: number
          conversion_url: string | null
          conversion_selector: string | null
          conversion_text: string | null
          conversion_source: string | null
          conversion_kind: string | null
          ingest_key: string | null
          layout_patterns_enabled: boolean
          adaptations_enabled: boolean
          serving_enabled: boolean
          test_metric: string
          ramp_pct: number
          goal_candidates: Json | null
          day0_report_url: string | null
          day0_report_at: string | null
          day0_report_status: string | null
          day0_findings: Json | null
          first_verified_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          slug: string
          domain?: string | null
          domain_verified_at?: string | null
          billing_status?: string
          name?: string | null
          consent_mode?: string
          holdout_pct?: number
          conversion_url?: string | null
          conversion_selector?: string | null
          conversion_text?: string | null
          conversion_source?: string | null
          conversion_kind?: string | null
          ingest_key?: string | null
          layout_patterns_enabled?: boolean
          adaptations_enabled?: boolean
          serving_enabled?: boolean
          test_metric?: string
          ramp_pct?: number
          goal_candidates?: Json | null
          day0_report_url?: string | null
          day0_report_at?: string | null
          day0_report_status?: string | null
          day0_findings?: Json | null
          first_verified_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          slug?: string
          domain?: string | null
          domain_verified_at?: string | null
          billing_status?: string
          name?: string | null
          consent_mode?: string
          holdout_pct?: number
          conversion_url?: string | null
          conversion_selector?: string | null
          conversion_text?: string | null
          conversion_source?: string | null
          conversion_kind?: string | null
          ingest_key?: string | null
          layout_patterns_enabled?: boolean
          adaptations_enabled?: boolean
          serving_enabled?: boolean
          test_metric?: string
          ramp_pct?: number
          goal_candidates?: Json | null
          day0_report_url?: string | null
          day0_report_at?: string | null
          day0_report_status?: string | null
          day0_findings?: Json | null
          first_verified_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      angel_variants: {
        Row: {
          id: string
          site: string
          path: string
          segment_key: string
          status: string
          ops: Json
          serve_ops: Json
          required_cohorts: string[] | null
          success: Json | null
          evidence: Json
          held_reason: string | null
          held_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          site: string
          path?: string
          segment_key: string
          status?: string
          ops?: Json
          serve_ops?: Json
          required_cohorts?: string[] | null
          success?: Json | null
          evidence?: Json
          held_reason?: string | null
          held_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          site?: string
          path?: string
          segment_key?: string
          status?: string
          ops?: Json
          serve_ops?: Json
          required_cohorts?: string[] | null
          success?: Json | null
          evidence?: Json
          held_reason?: string | null
          held_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      angel_site_members: {
        Row: {
          id: string
          user_id: string
          site_slug: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          site_slug: string
          role?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          site_slug?: string
          role?: string
          created_at?: string
        }
        Relationships: []
      }
      angel_content_inventory: {
        Row: {
          id: string
          site_slug: string
          path: string
          slot: string
          item_id: string
          text: string | null
          selector: string | null
          meta: Json
          created_at: string
        }
        Insert: {
          id?: string
          site_slug: string
          path?: string
          slot: string
          item_id: string
          text?: string | null
          selector?: string | null
          meta?: Json
          created_at?: string
        }
        Update: {
          id?: string
          site_slug?: string
          path?: string
          slot?: string
          item_id?: string
          text?: string | null
          selector?: string | null
          meta?: Json
          created_at?: string
        }
        Relationships: []
      }
      angel_events: {
        Row: {
          id: number
          site: string
          type: string
          decision_id: string | null
          visitor_hash: string | null
          payload: Json
          created_at: string
        }
        Insert: {
          id?: never
          site: string
          type: string
          decision_id?: string | null
          visitor_hash?: string | null
          payload?: Json
          created_at?: string
        }
        Update: {
          id?: never
          site?: string
          type?: string
          decision_id?: string | null
          visitor_hash?: string | null
          payload?: Json
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      angel_segment_rollup: {
        Args: { p_site: string; p_since?: string }
        Returns: {
          channel: string
          device: string
          country: string
          is_returning: boolean
          visits: number
          conversions: number
          form_starts: number
          form_abandons: number
          rage_sessions: number
        }[]
      }
      angel_cohort_traffic: {
        Args: { p_site: string; p_days?: number }
        Returns: {
          traffic_source: string | null
          is_returning: boolean | null
          viewed_pricing: boolean | null
          visitors: number
        }[]
      }
      angel_variant_arms: {
        Args: { p_site: string; p_variant: string }
        Returns: {
          arm: string
          visits: number
          conversions: number
          continuations: number
          cta_clicks: number
          form_submits: number
          engaged: number
          deep_scrolls: number
        }[]
      }
      angel_page_segment_rollup: {
        Args: { p_site: string; p_since?: string }
        Returns: {
          path: string
          channel: string
          device: string
          country: string
          is_returning: boolean
          visits: number
          conversions: number
        }[]
      }
      angel_page_flow_rollup: {
        Args: { p_site: string; p_since?: string }
        Returns: {
          landing_path: string
          dest_path: string
          channel: string
          device: string
          country: string
          is_returning: boolean
          sessions: number
          reached: number
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
