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
