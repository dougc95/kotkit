CREATE TYPE "public"."program_status_enum" AS ENUM('draft', 'baseline_ready', 'active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."realm_enum" AS ENUM('demo', 'pilot');--> statement-breakpoint
CREATE TYPE "public"."benchmark_phase_enum" AS ENUM('baseline', 'midpoint', 'final');--> statement-breakpoint
CREATE TYPE "public"."slot_label_enum" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"timezone" text NOT NULL,
	"preferences" jsonb NOT NULL,
	"demo_clock_offset_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"realm" realm_enum NOT NULL,
	"baseline_date" date NOT NULL,
	"timezone" text NOT NULL,
	"status" "program_status_enum" NOT NULL,
	"leisure_allowance_min" integer NOT NULL,
	"feed_estimate_min" integer,
	"current_revision_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"effective_day" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocol_revisions_program_revision_unique" UNIQUE("program_id","revision")
);
--> statement-breakpoint
CREATE TABLE "benchmark_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"phase" "benchmark_phase_enum" NOT NULL,
	"label" "slot_label_enum" NOT NULL,
	"material_ref" text NOT NULL,
	"language" text,
	"device_format" text,
	"material_level" text,
	"planned_local_time" time,
	"assigned_local_date" date NOT NULL,
	"frozen_at" timestamp with time zone,
	CONSTRAINT "benchmark_slots_program_phase_label_unique" UNIQUE("program_id","phase","label")
);
--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id");--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_current_revision_id_protocol_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."protocol_revisions"("id");--> statement-breakpoint
ALTER TABLE "protocol_revisions" ADD CONSTRAINT "protocol_revisions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id");--> statement-breakpoint
ALTER TABLE "benchmark_slots" ADD CONSTRAINT "benchmark_slots_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_one_open_per_user" ON "programs" USING btree ("user_id") WHERE status in ('draft', 'baseline_ready', 'active');