CREATE TABLE "hr_internal"."st_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"register_office" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "hr_internal"."st_attachments" ADD CONSTRAINT "st_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "hr_internal"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_internal"."st_attachments" ADD CONSTRAINT "st_attachments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "hr_internal"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "st_attachments_group_idx" ON "hr_internal"."st_attachments" USING btree ("group_id");