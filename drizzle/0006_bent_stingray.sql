CREATE TABLE "hr_internal"."whatsapp_auth_state" (
	"id" text PRIMARY KEY NOT NULL,
	"encrypted_state" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
