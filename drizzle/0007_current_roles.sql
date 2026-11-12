ALTER TABLE hr_internal.users DROP CONSTRAINT users_role_check;
--> statement-breakpoint
ALTER TABLE hr_internal.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'admin', 'operator_st', 'hr', 'reviewer', 'finance', 'viewer'));
