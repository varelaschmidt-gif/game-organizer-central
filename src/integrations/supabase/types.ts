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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      attendance_history: {
        Row: {
          actor_id: string | null
          attendance_id: string
          created_at: string
          from_status: string | null
          group_id: string
          id: string
          note: string | null
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          attendance_id: string
          created_at?: string
          from_status?: string | null
          group_id: string
          id?: string
          note?: string | null
          to_status: string
        }
        Update: {
          actor_id?: string | null
          attendance_id?: string
          created_at?: string
          from_status?: string | null
          group_id?: string
          id?: string
          note?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_history_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendances"
            referencedColumns: ["id"]
          },
        ]
      }
      attendances: {
        Row: {
          attended: boolean | null
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          event_id: string
          group_id: string
          id: string
          offer_expires_at: string | null
          player_id: string
          status: string
          updated_at: string
          updated_by: string | null
          waitlisted_at: string | null
        }
        Insert: {
          attended?: boolean | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          event_id: string
          group_id: string
          id?: string
          offer_expires_at?: string | null
          player_id: string
          status: string
          updated_at?: string
          updated_by?: string | null
          waitlisted_at?: string | null
        }
        Update: {
          attended?: boolean | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          event_id?: string
          group_id?: string
          id?: string
          offer_expires_at?: string | null
          player_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          waitlisted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendances_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity: string | null
          entity_id: string | null
          group_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity?: string | null
          entity_id?: string | null
          group_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity?: string | null
          entity_id?: string | null
          group_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      event_series: {
        Row: {
          created_at: string
          created_by: string
          group_id: string
          id: string
          start_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          created_by: string
          group_id: string
          id?: string
          start_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          created_by?: string
          group_id?: string
          id?: string
          start_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_series_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          cancellation_rules: string | null
          confirm_deadline: string | null
          created_at: string
          created_by: string
          duration_minutes: number
          goalkeepers_wanted: number
          group_id: string
          id: string
          location: string | null
          max_participants: number
          notes: string | null
          players_per_team: number
          price: number | null
          series_id: string | null
          starts_at: string
          status: string
          teams_count: number
          title: string
          updated_at: string
          waitlist_offer_minutes: number | null
        }
        Insert: {
          cancellation_rules?: string | null
          confirm_deadline?: string | null
          created_at?: string
          created_by: string
          duration_minutes?: number
          goalkeepers_wanted?: number
          group_id: string
          id?: string
          location?: string | null
          max_participants?: number
          notes?: string | null
          players_per_team?: number
          price?: number | null
          series_id?: string | null
          starts_at: string
          status?: string
          teams_count?: number
          title?: string
          updated_at?: string
          waitlist_offer_minutes?: number | null
        }
        Update: {
          cancellation_rules?: string | null
          confirm_deadline?: string | null
          created_at?: string
          created_by?: string
          duration_minutes?: number
          goalkeepers_wanted?: number
          group_id?: string
          id?: string
          location?: string | null
          max_participants?: number
          notes?: string | null
          players_per_team?: number
          price?: number | null
          series_id?: string | null
          starts_at?: string
          status?: string
          teams_count?: number
          title?: string
          updated_at?: string
          waitlist_offer_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          group_id: string
          id: string
          invited_by: string
          player_id: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["group_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          group_id: string
          id?: string
          invited_by: string
          player_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["group_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          group_id?: string
          id?: string
          invited_by?: string
          player_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["group_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string
          group_id: string
          id: string
          permissions: string[]
          role: Database["public"]["Enums"]["group_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          permissions?: string[]
          role?: Database["public"]["Enums"]["group_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          permissions?: string[]
          role?: Database["public"]["Enums"]["group_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_settings: {
        Row: {
          created_at: string
          default_time: string | null
          default_weekday: number | null
          group_id: string
          location: string | null
          max_players: number
          monthly_fee: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_time?: string | null
          default_weekday?: number | null
          group_id: string
          location?: string | null
          max_players?: number
          monthly_fee?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_time?: string | null
          default_weekday?: number | null
          group_id?: string
          location?: string | null
          max_players?: number
          monthly_fee?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_settings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      player_private_notes: {
        Row: {
          group_id: string
          notes: string
          player_id: string
          updated_at: string
        }
        Insert: {
          group_id: string
          notes?: string
          player_id: string
          updated_at?: string
        }
        Update: {
          group_id?: string
          notes?: string
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_private_notes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_private_notes_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          dominant_foot: string | null
          email: string | null
          goalkeeper_level: number | null
          group_id: string
          id: string
          is_monthly: boolean
          joined_at: string
          name: string
          nickname: string | null
          participation_type: string
          phone: string | null
          photo_path: string | null
          position: string | null
          secondary_positions: string[]
          skill_level: number | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          dominant_foot?: string | null
          email?: string | null
          goalkeeper_level?: number | null
          group_id: string
          id?: string
          is_monthly?: boolean
          joined_at?: string
          name: string
          nickname?: string | null
          participation_type?: string
          phone?: string | null
          photo_path?: string | null
          position?: string | null
          secondary_positions?: string[]
          skill_level?: number | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          dominant_foot?: string | null
          email?: string | null
          goalkeeper_level?: number | null
          group_id?: string
          id?: string
          is_monthly?: boolean
          joined_at?: string
          name?: string
          nickname?: string | null
          participation_type?: string
          phone?: string | null
          photo_path?: string | null
          position?: string | null
          secondary_positions?: string[]
          skill_level?: number | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _expire_offers: { Args: { _event_id: string }; Returns: undefined }
      _lock_event: {
        Args: { _event_id: string }
        Returns: {
          cancellation_rules: string | null
          confirm_deadline: string | null
          created_at: string
          created_by: string
          duration_minutes: number
          goalkeepers_wanted: number
          group_id: string
          id: string
          location: string | null
          max_participants: number
          notes: string | null
          players_per_team: number
          price: number | null
          series_id: string | null
          starts_at: string
          status: string
          teams_count: number
          title: string
          updated_at: string
          waitlist_offer_minutes: number | null
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _promote_next: { Args: { _event_id: string }; Returns: undefined }
      _resolve_player: {
        Args: {
          _ev: Database["public"]["Tables"]["events"]["Row"]
          _player_id: string
        }
        Returns: string
      }
      accept_invite: { Args: { _token: string }; Returns: string }
      admin_mark_attended: {
        Args: { _attended: boolean; _event_id: string; _player_id: string }
        Returns: undefined
      }
      admin_promote: {
        Args: { _event_id: string; _player_id: string }
        Returns: undefined
      }
      create_event_series: {
        Args: {
          _first_date: string
          _group_id: string
          _occurrences: number
          _start_time: string
          _template: Json
        }
        Returns: string
      }
      create_group: {
        Args: { _as_player?: boolean; _name: string }
        Returns: string
      }
      create_invite: {
        Args: {
          _email: string
          _group_id: string
          _player_id?: string
          _role?: Database["public"]["Enums"]["group_role"]
        }
        Returns: string
      }
      get_invite: {
        Args: { _token: string }
        Returns: {
          accepted: boolean
          email: string
          expired: boolean
          group_name: string
          player_name: string
          revoked: boolean
          role: Database["public"]["Enums"]["group_role"]
        }[]
      }
      has_group_permission: {
        Args: { _group_id: string; _perm: string }
        Returns: boolean
      }
      has_platform_role: {
        Args: { _role: Database["public"]["Enums"]["platform_role"] }
        Returns: boolean
      }
      is_group_admin: { Args: { _group_id: string }; Returns: boolean }
      is_group_member: { Args: { _group_id: string }; Returns: boolean }
      process_event: { Args: { _event_id: string }; Returns: undefined }
      revoke_invite: { Args: { _invite_id: string }; Returns: undefined }
      rsvp_cancel: {
        Args: { _event_id: string; _player_id?: string }
        Returns: undefined
      }
      rsvp_confirm: {
        Args: { _event_id: string; _player_id?: string }
        Returns: string
      }
      shares_group_with: { Args: { _user_id: string }; Returns: boolean }
      update_events_scoped: {
        Args: { _changes: Json; _event_id: string; _scope: string }
        Returns: number
      }
    }
    Enums: {
      group_role: "admin" | "organizer" | "player"
      platform_role: "group_creator"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      group_role: ["admin", "organizer", "player"],
      platform_role: ["group_creator"],
    },
  },
} as const
