CREATE TABLE "hr_internal"."wa_automation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"send_time" text NOT NULL,
	"template" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "hr_internal"."wa_automation_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "hr_internal"."wa_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"title" text NOT NULL,
	"template" text NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audience" jsonb NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"repeat_monthly" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_on" text,
	"recipients" integer
);
--> statement-breakpoint
CREATE TABLE "hr_internal"."wa_employee_snapshots" (
	"employee_id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_internal"."wa_holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"name" text NOT NULL,
	"religions" jsonb NOT NULL,
	"greeting" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_internal"."wa_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"rule_id" text NOT NULL,
	"campaign_id" text,
	"employee_id" text,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"deliver_to" text NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"message" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"wa_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_outbox_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "hr_internal"."wa_campaigns" ADD CONSTRAINT "wa_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "hr_internal"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_campaigns_status_idx" ON "hr_internal"."wa_campaigns" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "wa_outbox_due_idx" ON "hr_internal"."wa_outbox" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "wa_outbox_created_idx" ON "hr_internal"."wa_outbox" USING btree ("created_at");