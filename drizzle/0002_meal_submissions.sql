CREATE TABLE "hr_internal"."meal_claimed_days" (
	"key" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"date" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_internal"."meal_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"office" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"workspace_revision" integer NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"locked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "hr_internal"."meal_claimed_days" ADD CONSTRAINT "meal_claimed_days_submission_id_meal_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "hr_internal"."meal_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_internal"."meal_submissions" ADD CONSTRAINT "meal_submissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "hr_internal"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_internal"."meal_submissions" ADD CONSTRAINT "meal_submissions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "hr_internal"."users"("id") ON DELETE no action ON UPDATE no action;