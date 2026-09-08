CREATE TYPE "public"."device" AS ENUM('phone', 'desktop', 'tablet', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."feed_source" AS ENUM('estimate', 'device_report');--> statement-breakpoint
CREATE TYPE "public"."measurement_scope" AS ENUM('feed', 'app_total');--> statement-breakpoint
CREATE TABLE "daily_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"realm" realm_enum NOT NULL,
	"local_date" date NOT NULL,
	"sleep_minutes" integer,
	"stress" integer,
	"mindfulness_minutes" integer,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "daily_checkins_program_local_date_unique" UNIQUE("program_id","local_date"),
	CONSTRAINT "daily_checkins_stress_range" CHECK ("daily_checkins"."stress" is null or "daily_checkins"."stress" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "feed_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkin_id" uuid NOT NULL,
	"device" "device" NOT NULL,
	"platform" text NOT NULL,
	"minutes" integer NOT NULL,
	"short_video_minutes" integer,
	"measurement_scope" "measurement_scope" NOT NULL,
	"source" "feed_source" NOT NULL,
	"planned_window" boolean,
	CONSTRAINT "feed_usage_checkin_device_platform_scope_unique" UNIQUE("checkin_id","device","platform","measurement_scope"),
	CONSTRAINT "feed_usage_short_video_subset" CHECK ("feed_usage"."short_video_minutes" is null or "feed_usage"."short_video_minutes" <= "feed_usage"."minutes")
);
--> statement-breakpoint
CREATE TABLE "mutation_receipts" (
	"user_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"result_ref" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mutation_receipts_user_id_idempotency_key_pk" PRIMARY KEY("user_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "daily_checkins" ADD CONSTRAINT "daily_checkins_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id");--> statement-breakpoint
ALTER TABLE "feed_usage" ADD CONSTRAINT "feed_usage_checkin_id_daily_checkins_id_fk" FOREIGN KEY ("checkin_id") REFERENCES "public"."daily_checkins"("id");