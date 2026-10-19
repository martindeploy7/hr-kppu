ALTER TABLE "hr_internal"."meal_submissions" ADD COLUMN "supersedes_id" text;--> statement-breakpoint
ALTER TABLE "hr_internal"."meal_submissions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_internal"."meal_submissions" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "hr_internal"."meal_submissions" ADD CONSTRAINT "meal_submissions_supersedes_id_meal_submissions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "hr_internal"."meal_submissions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX meal_one_active_correction ON hr_internal.meal_submissions(supersedes_id) WHERE supersedes_id IS NOT NULL AND status <> 'cancelled';
--> statement-breakpoint
ALTER TABLE hr_internal.meal_submissions ADD CONSTRAINT meal_version_check CHECK ((supersedes_id IS NULL AND version = 1 AND correction_reason IS NULL) OR (supersedes_id IS NOT NULL AND version > 1 AND correction_reason IS NOT NULL AND length(trim(correction_reason)) >= 10));
--> statement-breakpoint
CREATE FUNCTION hr_internal.validate_meal_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hr_internal.meal_submissions p WHERE p.id = NEW.supersedes_id AND p.status = 'locked' AND p.period = NEW.period AND p.office = NEW.office AND p.version + 1 = NEW.version) THEN
    RAISE EXCEPTION 'correction requires locked parent with identical scope and next version';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER meal_parent_valid BEFORE INSERT ON hr_internal.meal_submissions FOR EACH ROW EXECUTE FUNCTION hr_internal.validate_meal_parent();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hr_internal.protect_meal_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'meal snapshots cannot be deleted'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.checksum IS DISTINCT FROM OLD.checksum OR NEW.workspace_revision IS DISTINCT FROM OLD.workspace_revision OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.period IS DISTINCT FROM OLD.period OR NEW.office IS DISTINCT FROM OLD.office OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id OR NEW.version IS DISTINCT FROM OLD.version OR NEW.correction_reason IS DISTINCT FROM OLD.correction_reason THEN
    RAISE EXCEPTION 'meal snapshot content is immutable';
  END IF;
  IF OLD.status IN ('locked', 'cancelled') THEN RAISE EXCEPTION 'terminal meal snapshot cannot change'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hr_internal.protect_locked_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hr_internal.meal_submissions WHERE id = OLD.submission_id AND status = 'locked') THEN
    IF TG_OP <> 'DELETE' OR NOT EXISTS (
      WITH RECURSIVE ancestors(id) AS (
        SELECT supersedes_id FROM hr_internal.meal_submissions WHERE id = current_setting('hr_internal.correction_id', true) AND status = 'approved'
        UNION ALL SELECT p.supersedes_id FROM hr_internal.meal_submissions p JOIN ancestors a ON p.id = a.id WHERE p.supersedes_id IS NOT NULL
      ) SELECT 1 FROM ancestors WHERE id = OLD.submission_id
    ) THEN RAISE EXCEPTION 'locked claim cannot change'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
