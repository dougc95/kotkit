CREATE TYPE "public"."lifecycle" AS ENUM('running', 'paused', 'awaiting_review', 'finalized', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('practice', 'benchmark');--> statement-breakpoint
CREATE TYPE "public"."time_source" AS ENUM('measured', 'demo_clock', 'attested');--> statement-breakpoint
CREATE TYPE "public"."timer_quality" AS ENUM('ok', 'uncertain');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('off_task', 'external', 'agent_check', 'pause', 'resume', 'clock_gap', 'visibility');--> statement-breakpoint
CREATE TYPE "public"."count_method" AS ENUM('event', 'retrospective');--> statement-breakpoint
CREATE TYPE "public"."first_switch_kind" AS ENUM('none_capped', 'known', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."first_switch_method" AS ENUM('event', 'estimate');--> statement-breakpoint
CREATE TYPE "public"."output_quality" AS ENUM('yes', 'partly', 'no');--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"program_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"slot_id" uuid,
	"realm" realm_enum NOT NULL,
	"kind" "session_kind" NOT NULL,
	"lifecycle" "lifecycle" NOT NULL,
	"target_seconds" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"paused_seconds" integer DEFAULT 0 NOT NULL,
	"current_pause_started_at" timestamp with time zone,
	"local_date" date NOT NULL,
	"intended_output" text,
	"time_source" time_source NOT NULL,
	"timer_quality" timer_quality DEFAULT 'ok' NOT NULL,
	"clock_gap_seconds" integer,
	"complete_interval" boolean,
	"eligible" boolean,
	"exclusion_reasons" text[] NOT NULL,
	"replacement_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "focus_sessions_benchmark_has_slot" CHECK (("focus_sessions"."kind" = 'benchmark') = ("focus_sessions"."slot_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"client_event_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"elapsed_ms" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "session_events_client_event_unique" UNIQUE("session_id","client_event_id")
);
--> statement-breakpoint
CREATE TABLE "session_reviews" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"episode_count" integer,
	"count_method" "count_method",
	"first_switch_kind" "first_switch_kind",
	"first_switch_seconds" integer,
	"first_switch_method" "first_switch_method",
	"external_count" integer,
	"unplanned_agent_checks" integer,
	"mind_wandering_count" integer,
	"output_quality" "output_quality",
	"output_note" text,
	"review_note" text,
	"materially_disrupted" boolean,
	"disruption_note" text,
	"recall_points" jsonb,
	"recall_started_at" timestamp with time zone,
	"recall_locked_at" timestamp with time zone,
	"recall_delay_seconds" integer,
	"recall_duration_seconds" integer,
	"recall_flags" text[] NOT NULL,
	"recall_scores" jsonb,
	"recall_score" integer,
	"observed_conditions" jsonb NOT NULL,
	"finalized_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"exclude_from_report" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_plans" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"workstream" text,
	"waiting_task" text,
	"resume_note" text,
	"review_checkpoint" text DEFAULT 'end_of_block' NOT NULL,
	"review_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id");--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id");--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_revision_id_protocol_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."protocol_revisions"("id");--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_slot_id_benchmark_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."benchmark_slots"("id");--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_focus_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."focus_sessions"("id");--> statement-breakpoint
ALTER TABLE "session_reviews" ADD CONSTRAINT "session_reviews_session_id_focus_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."focus_sessions"("id");--> statement-breakpoint
ALTER TABLE "session_amendments" ADD CONSTRAINT "session_amendments_session_id_focus_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."focus_sessions"("id");--> statement-breakpoint
ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_session_id_focus_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."focus_sessions"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "focus_sessions_one_active_per_user" ON "focus_sessions" USING btree ("user_id") WHERE "focus_sessions"."lifecycle" in ('running', 'paused', 'awaiting_review');--> statement-breakpoint
CREATE INDEX "focus_sessions_program_kind_local_date_idx" ON "focus_sessions" USING btree ("program_id","kind","local_date");--> statement-breakpoint
CREATE INDEX "session_events_session_elapsed_idx" ON "session_events" USING btree ("session_id","elapsed_ms");