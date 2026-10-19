CREATE FUNCTION hr_internal.protect_meal_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'meal snapshots cannot be deleted'; END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.checksum IS DISTINCT FROM OLD.checksum OR NEW.workspace_revision IS DISTINCT FROM OLD.workspace_revision OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.period IS DISTINCT FROM OLD.period OR NEW.office IS DISTINCT FROM OLD.office THEN
    RAISE EXCEPTION 'meal snapshot content is immutable';
  END IF;
  IF OLD.status IN ('locked', 'cancelled') THEN RAISE EXCEPTION 'terminal meal snapshot cannot change'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER meal_snapshot_immutable BEFORE UPDATE OR DELETE ON hr_internal.meal_submissions
FOR EACH ROW EXECUTE FUNCTION hr_internal.protect_meal_snapshot();
--> statement-breakpoint
ALTER TABLE hr_internal.meal_submissions ADD CONSTRAINT meal_status_check CHECK (status IN ('submitted', 'approved', 'locked', 'cancelled'));
--> statement-breakpoint
CREATE FUNCTION hr_internal.protect_locked_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hr_internal.meal_submissions WHERE id = OLD.submission_id AND status = 'locked') THEN RAISE EXCEPTION 'locked claim cannot change'; END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER locked_claim_immutable BEFORE UPDATE OR DELETE ON hr_internal.meal_claimed_days
FOR EACH ROW EXECUTE FUNCTION hr_internal.protect_locked_claim();
