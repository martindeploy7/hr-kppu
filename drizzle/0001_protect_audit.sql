CREATE FUNCTION hr_internal.reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON hr_internal.audit_events
FOR EACH ROW EXECUTE FUNCTION hr_internal.reject_audit_mutation();
--> statement-breakpoint
CREATE FUNCTION hr_internal.protect_source_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hash IS DISTINCT FROM OLD.hash OR NEW.bytes IS DISTINCT FROM OLD.bytes OR NEW.parsed IS DISTINCT FROM OLD.parsed OR NEW.name IS DISTINCT FROM OLD.name OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'source archive is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER uploads_immutable BEFORE UPDATE ON hr_internal.uploads
FOR EACH ROW EXECUTE FUNCTION hr_internal.protect_source_archive();
--> statement-breakpoint
REVOKE ALL ON SCHEMA hr_internal FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE hr_internal.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'hr', 'reviewer', 'finance', 'viewer'));
--> statement-breakpoint
ALTER TABLE hr_internal.workspaces ADD CONSTRAINT revision_nonnegative CHECK (revision >= 0);
