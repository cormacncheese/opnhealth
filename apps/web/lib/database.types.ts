export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_run_io: {
        Row: {
          error: string | null
          input: Json
          is_public: boolean
          output: Json | null
          run_id: string
        }
        Insert: {
          error?: string | null
          input?: Json
          is_public?: boolean
          output?: Json | null
          run_id: string
        }
        Update: {
          error?: string | null
          input?: Json
          is_public?: boolean
          output?: Json | null
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_run_io_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent: string
          cost_usd: number | null
          finished_at: string
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          prompt_version: string
          started_at: string
          status: string
          subject_id: string
          subject_type: string
          submission_id: string | null
        }
        Insert: {
          agent: string
          cost_usd?: number | null
          finished_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          prompt_version: string
          started_at: string
          status: string
          subject_id: string
          subject_type: string
          submission_id?: string | null
        }
        Update: {
          agent?: string
          cost_usd?: number | null
          finished_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          prompt_version?: string
          started_at?: string
          status?: string
          subject_id?: string
          subject_type?: string
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_submission_fk"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_steps: {
        Row: {
          detail: Json
          duration_ms: number | null
          id: number
          idx: number
          kind: string
          name: string
          run_id: string
        }
        Insert: {
          detail?: Json
          duration_ms?: number | null
          id?: never
          idx: number
          kind: string
          name: string
          run_id: string
        }
        Update: {
          detail?: Json
          duration_ms?: number | null
          id?: never
          idx?: number
          kind?: string
          name?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      analytes: {
        Row: {
          cas_number: string | null
          category: Database["public"]["Enums"]["analyte_category"]
          id: string
          name: string
          slug: string
          synonyms: string[]
        }
        Insert: {
          cas_number?: string | null
          category: Database["public"]["Enums"]["analyte_category"]
          id?: string
          name: string
          slug: string
          synonyms?: string[]
        }
        Update: {
          cas_number?: string | null
          category?: Database["public"]["Enums"]["analyte_category"]
          id?: string
          name?: string
          slug?: string
          synonyms?: string[]
        }
        Relationships: []
      }
      brand_members: {
        Row: {
          attempts: number
          brand_id: string
          challenge_token: string
          created_at: string
          decided_at: string | null
          email_domain: string | null
          id: string
          method: string | null
          note: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          brand_id: string
          challenge_token?: string
          created_at?: string
          decided_at?: string | null
          email_domain?: string | null
          id?: string
          method?: string | null
          note?: string | null
          status?: string
          user_id?: string
        }
        Update: {
          attempts?: number
          brand_id?: string
          challenge_token?: string
          created_at?: string
          decided_at?: string | null
          email_domain?: string | null
          id?: string
          method?: string | null
          note?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: string
          last_crawled_at: string | null
          name: string
          name_normalised: string
          slug: string
          website: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_crawled_at?: string | null
          name: string
          name_normalised: string
          slug: string
          website?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_crawled_at?: string | null
          name?: string
          name_normalised?: string
          slug?: string
          website?: string | null
        }
        Relationships: []
      }
      coa_reports: {
        Row: {
          accreditation_stated: Json | null
          agent_run_id: string
          created_at: string
          document_id: string
          document_type: string
          extraction_confidence: number | null
          id: string
          lab_name_raw: string | null
          lot_number: string | null
          methods: string[]
          report_date: string | null
          report_number: string | null
          sample_brand_raw: string | null
          sample_description: string | null
          sample_matrix: string | null
          sample_product_raw: string | null
          sample_received_on: string | null
          submission_id: string
          supersedes_id: string | null
          tested_on: string | null
        }
        Insert: {
          accreditation_stated?: Json | null
          agent_run_id: string
          created_at?: string
          document_id: string
          document_type: string
          extraction_confidence?: number | null
          id?: string
          lab_name_raw?: string | null
          lot_number?: string | null
          methods?: string[]
          report_date?: string | null
          report_number?: string | null
          sample_brand_raw?: string | null
          sample_description?: string | null
          sample_matrix?: string | null
          sample_product_raw?: string | null
          sample_received_on?: string | null
          submission_id: string
          supersedes_id?: string | null
          tested_on?: string | null
        }
        Update: {
          accreditation_stated?: Json | null
          agent_run_id?: string
          created_at?: string
          document_id?: string
          document_type?: string
          extraction_confidence?: number | null
          id?: string
          lab_name_raw?: string | null
          lot_number?: string | null
          methods?: string[]
          report_date?: string | null
          report_number?: string | null
          sample_brand_raw?: string | null
          sample_description?: string | null
          sample_matrix?: string | null
          sample_product_raw?: string | null
          sample_received_on?: string | null
          submission_id?: string
          supersedes_id?: string | null
          tested_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coa_reports_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coa_reports_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coa_reports_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coa_reports_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "coa_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      coa_resolutions: {
        Row: {
          agent_run_id: string
          coa_report_id: string
          confidence: number | null
          created_at: string
          id: string
          lab_id: string | null
          match_kind: string
          product_id: string | null
          proposed_product: Json | null
          rationale: string | null
          submission_id: string
        }
        Insert: {
          agent_run_id: string
          coa_report_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          lab_id?: string | null
          match_kind: string
          product_id?: string | null
          proposed_product?: Json | null
          rationale?: string | null
          submission_id: string
        }
        Update: {
          agent_run_id?: string
          coa_report_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          lab_id?: string | null
          match_kind?: string
          product_id?: string | null
          proposed_product?: Json | null
          rationale?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coa_resolutions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coa_resolutions_coa_report_id_fkey"
            columns: ["coa_report_id"]
            isOneToOne: false
            referencedRelation: "coa_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coa_resolutions_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coa_resolutions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coa_resolutions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      data_exports: {
        Row: {
          created_at: string
          id: string
          ledger_head_hash: string | null
          ledger_head_seq: number | null
          manifest_path: string
          tables: Json
        }
        Insert: {
          created_at?: string
          id?: string
          ledger_head_hash?: string | null
          ledger_head_seq?: number | null
          manifest_path: string
          tables: Json
        }
        Update: {
          created_at?: string
          id?: string
          ledger_head_hash?: string | null
          ledger_head_seq?: number | null
          manifest_path?: string
          tables?: Json
        }
        Relationships: []
      }
      dispute_details: {
        Row: {
          created_at: string
          dispute_id: string
          evidence_url: string | null
          reason: string
          relationship: string
          resolution: string | null
        }
        Insert: {
          created_at?: string
          dispute_id: string
          evidence_url?: string | null
          reason: string
          relationship: string
          resolution?: string | null
        }
        Update: {
          created_at?: string
          dispute_id?: string
          evidence_url?: string | null
          reason?: string
          relationship?: string
          resolution?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispute_details_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: true
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          category: string
          created_at: string
          id: string
          opened_by: string
          resolution_code: string | null
          resolved_at: string | null
          status: string
          submission_id: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          opened_by?: string
          resolution_code?: string | null
          resolved_at?: string | null
          status?: string
          submission_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          opened_by?: string
          resolution_code?: string | null
          resolved_at?: string | null
          status?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_pages: {
        Row: {
          agent_run_id: string | null
          created_at: string
          document_id: string
          page_number: number
          redacted_text: string
        }
        Insert: {
          agent_run_id?: string | null
          created_at?: string
          document_id: string
          page_number: number
          redacted_text: string
        }
        Update: {
          agent_run_id?: string | null
          created_at?: string
          document_id?: string
          page_number?: number
          redacted_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_pages_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_pages_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          byte_size: number
          created_at: string
          id: string
          mime_type: string
          origin_url: string | null
          page_count: number | null
          redaction_status: string
          sha256: string
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          byte_size: number
          created_at?: string
          id?: string
          mime_type: string
          origin_url?: string | null
          page_count?: number | null
          redaction_status?: string
          sha256: string
          storage_bucket: string
          storage_path: string
        }
        Update: {
          byte_size?: number
          created_at?: string
          id?: string
          mime_type?: string
          origin_url?: string | null
          page_count?: number | null
          redaction_status?: string
          sha256?: string
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: []
      }
      entities: {
        Row: {
          created_at: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          name?: string
        }
        Relationships: []
      }
      eval_runs: {
        Row: {
          created_at: string
          git_sha: string | null
          id: string
          metrics: Json
          model: string
          passed: boolean
          prompt_versions: Json
        }
        Insert: {
          created_at?: string
          git_sha?: string | null
          id?: string
          metrics: Json
          model: string
          passed: boolean
          prompt_versions: Json
        }
        Update: {
          created_at?: string
          git_sha?: string | null
          id?: string
          metrics?: Json
          model?: string
          passed?: boolean
          prompt_versions?: Json
        }
        Relationships: []
      }
      events: {
        Row: {
          actor: string
          agent_run_id: string | null
          event_type: string
          hash: string
          occurred_at: string
          payload: Json
          prev_hash: string
          seq: number
          subject_id: string
          subject_type: string
        }
        Insert: {
          actor: string
          agent_run_id?: string | null
          event_type: string
          hash: string
          occurred_at: string
          payload?: Json
          prev_hash: string
          seq: number
          subject_id: string
          subject_type: string
        }
        Update: {
          actor?: string
          agent_run_id?: string | null
          event_type?: string
          hash?: string
          occurred_at?: string
          payload?: Json
          prev_hash?: string
          seq?: number
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      labs: {
        Row: {
          accreditation_body: string | null
          accreditation_checked_at: string | null
          accreditation_number: string | null
          accreditation_source_url: string | null
          accreditation_status: string
          created_at: string
          id: string
          name: string
          name_normalised: string
          website: string | null
        }
        Insert: {
          accreditation_body?: string | null
          accreditation_checked_at?: string | null
          accreditation_number?: string | null
          accreditation_source_url?: string | null
          accreditation_status?: string
          created_at?: string
          id?: string
          name: string
          name_normalised: string
          website?: string | null
        }
        Update: {
          accreditation_body?: string | null
          accreditation_checked_at?: string | null
          accreditation_number?: string | null
          accreditation_source_url?: string | null
          accreditation_status?: string
          created_at?: string
          id?: string
          name?: string
          name_normalised?: string
          website?: string | null
        }
        Relationships: []
      }
      maintainer_actions: {
        Row: {
          created_at: string
          decision_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          decision_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          decision_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintainer_actions_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "review_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      maintainers: {
        Row: {
          added_at: string
          user_id: string
        }
        Insert: {
          added_at?: string
          user_id: string
        }
        Update: {
          added_at?: string
          user_id?: string
        }
        Relationships: []
      }
      measurements: {
        Row: {
          analyte_id: string | null
          analyte_name_raw: string
          citation: string | null
          coa_report_id: string
          created_at: string
          id: string
          lod: number | null
          loq: number | null
          method: string | null
          normalised_unit: string | null
          normalised_value: number | null
          operator: Database["public"]["Enums"]["measurement_operator"]
          page_number: number | null
          submission_id: string
          unit: string | null
          value: number | null
        }
        Insert: {
          analyte_id?: string | null
          analyte_name_raw: string
          citation?: string | null
          coa_report_id: string
          created_at?: string
          id?: string
          lod?: number | null
          loq?: number | null
          method?: string | null
          normalised_unit?: string | null
          normalised_value?: number | null
          operator: Database["public"]["Enums"]["measurement_operator"]
          page_number?: number | null
          submission_id: string
          unit?: string | null
          value?: number | null
        }
        Update: {
          analyte_id?: string | null
          analyte_name_raw?: string
          citation?: string | null
          coa_report_id?: string
          created_at?: string
          id?: string
          lod?: number | null
          loq?: number | null
          method?: string | null
          normalised_unit?: string | null
          normalised_value?: number | null
          operator?: Database["public"]["Enums"]["measurement_operator"]
          page_number?: number | null
          submission_id?: string
          unit?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurements_analyte_id_fkey"
            columns: ["analyte_id"]
            isOneToOne: false
            referencedRelation: "analytes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_coa_report_id_fkey"
            columns: ["coa_report_id"]
            isOneToOne: false
            referencedRelation: "coa_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      observations: {
        Row: {
          agent_run_id: string | null
          attribute: string
          content_hash: string
          document_id: string | null
          entity_id: string
          external_ref: string | null
          id: number
          observed_at: string
          source_id: string
          value: Json
        }
        Insert: {
          agent_run_id?: string | null
          attribute: string
          content_hash: string
          document_id?: string | null
          entity_id: string
          external_ref?: string | null
          id?: never
          observed_at?: string
          source_id: string
          value: Json
        }
        Update: {
          agent_run_id?: string | null
          attribute?: string
          content_hash?: string
          document_id?: string | null
          entity_id?: string
          external_ref?: string | null
          id?: never
          observed_at?: string
          source_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "observations_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_controls: {
        Row: {
          daily_budget_usd: number
          paused: boolean
          paused_at: string | null
          paused_reason: string | null
          pipeline: string
        }
        Insert: {
          daily_budget_usd: number
          paused?: boolean
          paused_at?: string | null
          paused_reason?: string | null
          pipeline: string
        }
        Update: {
          daily_budget_usd?: number
          paused?: boolean
          paused_at?: string | null
          paused_reason?: string | null
          pipeline?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          categories: string[]
          category: string | null
          created_at: string
          first_source_id: string
          gtin: string | null
          id: string
          image_url: string | null
          ingredients_text: string | null
          name: string
          search: unknown
          serving_size: string | null
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          brand_name?: string | null
          categories?: string[]
          category?: string | null
          created_at?: string
          first_source_id: string
          gtin?: string | null
          id: string
          image_url?: string | null
          ingredients_text?: string | null
          name: string
          search?: unknown
          serving_size?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          brand_name?: string | null
          categories?: string[]
          category?: string | null
          created_at?: string
          first_source_id?: string
          gtin?: string | null
          id?: string
          image_url?: string | null
          ingredients_text?: string | null
          name?: string
          search?: unknown
          serving_size?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_first_source_id_fkey"
            columns: ["first_source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      recall_products: {
        Row: {
          agent_run_id: string | null
          confidence: number
          created_at: string
          product_id: string
          rationale: string | null
          recall_id: string
        }
        Insert: {
          agent_run_id?: string | null
          confidence: number
          created_at?: string
          product_id: string
          rationale?: string | null
          recall_id: string
        }
        Update: {
          agent_run_id?: string | null
          confidence?: number
          created_at?: string
          product_id?: string
          rationale?: string | null
          recall_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recall_products_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recall_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recall_products_recall_id_fkey"
            columns: ["recall_id"]
            isOneToOne: false
            referencedRelation: "recalls"
            referencedColumns: ["id"]
          },
        ]
      }
      recalls: {
        Row: {
          classification: string | null
          created_at: string
          external_ref: string
          firm: string | null
          id: string
          matched_at: string | null
          product_description: string | null
          raw: Json
          reason: string | null
          recall_date: string | null
          report_date: string | null
          source_id: string
          status: string | null
          url: string | null
        }
        Insert: {
          classification?: string | null
          created_at?: string
          external_ref: string
          firm?: string | null
          id?: string
          matched_at?: string | null
          product_description?: string | null
          raw?: Json
          reason?: string | null
          recall_date?: string | null
          report_date?: string | null
          source_id: string
          status?: string | null
          url?: string | null
        }
        Update: {
          classification?: string | null
          created_at?: string
          external_ref?: string
          firm?: string | null
          id?: string
          matched_at?: string | null
          product_description?: string | null
          raw?: Json
          reason?: string | null
          recall_date?: string | null
          report_date?: string | null
          source_id?: string
          status?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recalls_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_limits: {
        Row: {
          analyte_id: string
          applies_to: string
          authority: string
          basis: string
          category_keywords: string[]
          effective_on: string | null
          id: string
          jurisdiction: string
          kind: string
          limit_value: number
          normalised_unit: string | null
          normalised_value: number | null
          notes: string | null
          source_id: string | null
          source_url: string
          unit: string
        }
        Insert: {
          analyte_id: string
          applies_to: string
          authority: string
          basis: string
          category_keywords?: string[]
          effective_on?: string | null
          id?: string
          jurisdiction: string
          kind: string
          limit_value: number
          normalised_unit?: string | null
          normalised_value?: number | null
          notes?: string | null
          source_id?: string | null
          source_url: string
          unit: string
        }
        Update: {
          analyte_id?: string
          applies_to?: string
          authority?: string
          basis?: string
          category_keywords?: string[]
          effective_on?: string | null
          id?: string
          jurisdiction?: string
          kind?: string
          limit_value?: number
          normalised_unit?: string | null
          normalised_value?: number | null
          notes?: string | null
          source_id?: string | null
          source_url?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_limits_analyte_id_fkey"
            columns: ["analyte_id"]
            isOneToOne: false
            referencedRelation: "analytes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_limits_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      review_decision_details: {
        Row: {
          created_at: string
          decision_id: string
          reasons: Json
          submission_id: string
          summary: string
        }
        Insert: {
          created_at?: string
          decision_id: string
          reasons?: Json
          submission_id: string
          summary: string
        }
        Update: {
          created_at?: string
          decision_id?: string
          reasons?: Json
          submission_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_decision_details_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "review_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_decision_details_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      review_decisions: {
        Row: {
          agent_run_id: string | null
          coa_report_id: string | null
          confidence: number | null
          created_at: string
          dispute_id: string | null
          id: string
          outcome: string
          reason_codes: string[]
          stage: string
          submission_id: string
        }
        Insert: {
          agent_run_id?: string | null
          coa_report_id?: string | null
          confidence?: number | null
          created_at?: string
          dispute_id?: string | null
          id?: string
          outcome: string
          reason_codes?: string[]
          stage: string
          submission_id: string
        }
        Update: {
          agent_run_id?: string | null
          coa_report_id?: string | null
          confidence?: number | null
          created_at?: string
          dispute_id?: string | null
          id?: string
          outcome?: string
          reason_codes?: string[]
          stage?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_decisions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_decisions_coa_report_id_fkey"
            columns: ["coa_report_id"]
            isOneToOne: false
            referencedRelation: "coa_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_decisions_dispute_fk"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_decisions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["source_kind"]
          license: string | null
          name: string
          slug: string
          trust_tier: number
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["source_kind"]
          license?: string | null
          name: string
          slug: string
          trust_tier: number
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["source_kind"]
          license?: string | null
          name?: string
          slug?: string
          trust_tier?: number
          url?: string | null
        }
        Relationships: []
      }
      submission_owners: {
        Row: {
          created_at: string
          submission_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          submission_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          submission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_owners_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_private: {
        Row: {
          claimed_product_text: string | null
          notes: string | null
          pii_terms: string[]
          submission_id: string
          updated_at: string
        }
        Insert: {
          claimed_product_text?: string | null
          notes?: string | null
          pii_terms?: string[]
          submission_id: string
          updated_at?: string
        }
        Update: {
          claimed_product_text?: string | null
          notes?: string | null
          pii_terms?: string[]
          submission_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_private_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          claimed_product_id: string | null
          created_at: string
          document_id: string
          duplicate_of: string | null
          id: string
          lab_id: string | null
          product_id: string | null
          relationship: Database["public"]["Enums"]["submitter_relationship"]
          source_id: string
          status: Database["public"]["Enums"]["submission_status"]
          updated_at: string
        }
        Insert: {
          claimed_product_id?: string | null
          created_at?: string
          document_id: string
          duplicate_of?: string | null
          id?: string
          lab_id?: string | null
          product_id?: string | null
          relationship: Database["public"]["Enums"]["submitter_relationship"]
          source_id: string
          status?: Database["public"]["Enums"]["submission_status"]
          updated_at?: string
        }
        Update: {
          claimed_product_id?: string | null
          created_at?: string
          document_id?: string
          duplicate_of?: string | null
          id?: string
          lab_id?: string | null
          product_id?: string | null
          relationship?: Database["public"]["Enums"]["submitter_relationship"]
          source_id?: string
          status?: Database["public"]["Enums"]["submission_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_claimed_product_id_fkey"
            columns: ["claimed_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_state: {
        Row: {
          connector: string
          cursor: Json
          items_total: number
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
        }
        Insert: {
          connector: string
          cursor?: Json
          items_total?: number
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
        }
        Update: {
          connector?: string
          cursor?: Json
          items_total?: number
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
        }
        Relationships: []
      }
      verification_reports: {
        Row: {
          agent_run_id: string
          checks: Json
          coa_report_id: string
          created_at: string
          dispute_id: string | null
          id: string
          risk: string
          submission_id: string
          summary: string | null
        }
        Insert: {
          agent_run_id: string
          checks: Json
          coa_report_id: string
          created_at?: string
          dispute_id?: string | null
          id?: string
          risk: string
          submission_id: string
          summary?: string | null
        }
        Update: {
          agent_run_id?: string
          checks?: Json
          coa_report_id?: string
          created_at?: string
          dispute_id?: string | null
          id?: string
          risk?: string
          submission_id?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_reports_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_reports_coa_report_id_fkey"
            columns: ["coa_report_id"]
            isOneToOne: false
            referencedRelation: "coa_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_reports_dispute_fk"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_reports_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      published_measurements: {
        Row: {
          analyte_category:
            | Database["public"]["Enums"]["analyte_category"]
            | null
          analyte_id: string | null
          analyte_name: string | null
          analyte_name_raw: string | null
          analyte_slug: string | null
          citation: string | null
          coa_report_id: string | null
          id: string | null
          lab_accreditation_status: string | null
          lab_id: string | null
          lab_name: string | null
          lod: number | null
          loq: number | null
          lot_number: string | null
          method: string | null
          normalised_unit: string | null
          normalised_value: number | null
          operator: Database["public"]["Enums"]["measurement_operator"] | null
          page_number: number | null
          product_id: string | null
          relationship:
            | Database["public"]["Enums"]["submitter_relationship"]
            | null
          report_date: string | null
          sample_matrix: string | null
          submission_id: string | null
          unit: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurements_analyte_id_fkey"
            columns: ["analyte_id"]
            isOneToOne: false
            referencedRelation: "analytes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_coa_report_id_fkey"
            columns: ["coa_report_id"]
            isOneToOne: false
            referencedRelation: "coa_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      search_products: {
        Args: { max_results?: number; q: string }
        Returns: {
          brand_id: string | null
          brand_name: string | null
          categories: string[]
          category: string | null
          created_at: string
          first_source_id: string
          gtin: string | null
          id: string
          image_url: string | null
          ingredients_text: string | null
          name: string
          search: unknown
          serving_size: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      verify_ledger: {
        Args: { from_seq?: number; to_seq?: number }
        Returns: number
      }
    }
    Enums: {
      analyte_category:
        | "heavy_metal"
        | "pfas"
        | "pesticide"
        | "mycotoxin"
        | "microbial"
        | "plasticiser"
        | "solvent"
        | "process_contaminant"
        | "mineral"
        | "other"
      entity_type:
        | "product"
        | "food"
        | "water_system"
        | "location"
        | "restaurant"
      measurement_operator: "eq" | "lt" | "lte" | "gt" | "gte" | "nd"
      source_kind:
        | "public_dataset"
        | "regulator"
        | "lab"
        | "brand"
        | "consumer"
        | "crawler"
        | "maintainer"
      submission_status:
        | "received"
        | "processing"
        | "approved"
        | "published"
        | "rejected"
        | "escalated"
        | "withdrawn"
        | "duplicate"
        | "failed"
      submitter_relationship: "consumer" | "brand" | "lab" | "crawler"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      analyte_category: [
        "heavy_metal",
        "pfas",
        "pesticide",
        "mycotoxin",
        "microbial",
        "plasticiser",
        "solvent",
        "process_contaminant",
        "mineral",
        "other",
      ],
      entity_type: [
        "product",
        "food",
        "water_system",
        "location",
        "restaurant",
      ],
      measurement_operator: ["eq", "lt", "lte", "gt", "gte", "nd"],
      source_kind: [
        "public_dataset",
        "regulator",
        "lab",
        "brand",
        "consumer",
        "crawler",
        "maintainer",
      ],
      submission_status: [
        "received",
        "processing",
        "approved",
        "published",
        "rejected",
        "escalated",
        "withdrawn",
        "duplicate",
        "failed",
      ],
      submitter_relationship: ["consumer", "brand", "lab", "crawler"],
    },
  },
} as const

