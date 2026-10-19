import { pgSchema, text, integer, jsonb, timestamp, boolean, customType, index, type AnyPgColumn } from 'drizzle-orm/pg-core'
import type { SourceFile } from '../src/engine/types.ts'
import type { Role, Workspace } from '../shared/workspace.ts'
import type { MealSnapshot } from '../shared/submissions.ts'
// Private schema is not exposed by Supabase's public Data API.
export const hr = pgSchema('hr_internal')
const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
export const users = hr.table('users', {
  id: text('id').primaryKey(), email: text('email').notNull().unique(), name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(), role: text('role').$type<Role>().notNull(), active: boolean('active').default(true).notNull(), createdAt: time('created_at').defaultNow().notNull(),
  offices: jsonb('offices').$type<string[] | null>(),
})
export const sessions = hr.table('sessions', { tokenHash: text('token_hash').primaryKey(), userId: text('user_id').references(() => users.id).notNull(), expiresAt: time('expires_at').notNull() }, t => [index('sessions_expiry_idx').on(t.expiresAt)])
export const workspaces = hr.table('workspaces', { id: text('id').primaryKey(), revision: integer('revision').default(0).notNull(), state: jsonb('state').$type<Workspace>().notNull(), updatedAt: time('updated_at').defaultNow().notNull() })
const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' })
export const uploads = hr.table('uploads', {
  id: text('id').primaryKey(), hash: text('hash').notNull(), name: text('name').notNull(), bytes: bytes('bytes').notNull(), parsed: jsonb('parsed').$type<SourceFile>().notNull(),
  userId: text('user_id').references(() => users.id).notNull(), createdAt: time('created_at').defaultNow().notNull(), committed: boolean('committed').default(false).notNull(),
}, t => [index('uploads_hash_idx').on(t.hash)])
export const auditEvents = hr.table('audit_events', {
  id: text('id').primaryKey(), actorId: text('actor_id').references(() => users.id).notNull(), action: text('action').notNull(),
  revision: integer('revision').notNull(), reason: text('reason').notNull(), details: jsonb('details').notNull(), at: time('at').defaultNow().notNull(),
})
export const loginAttempts = hr.table('login_attempts', { key: text('key').primaryKey(), count: integer('count').default(0).notNull(), resetAt: time('reset_at').notNull() })
export const mealSubmissions = hr.table('meal_submissions', {
  id: text('id').primaryKey(), period: text('period').notNull(), office: text('office').notNull(), revision: integer('revision').default(1).notNull(),
  workspaceRevision: integer('workspace_revision').notNull(), status: text('status').$type<'submitted' | 'approved' | 'locked' | 'cancelled'>().default('submitted').notNull(),
  snapshot: jsonb('snapshot').$type<MealSnapshot>().notNull(), checksum: text('checksum').notNull(), createdBy: text('created_by').references(() => users.id).notNull(),
  approvedBy: text('approved_by').references(() => users.id), createdAt: time('created_at').defaultNow().notNull(), approvedAt: time('approved_at'), lockedAt: time('locked_at'),
  supersedesId: text('supersedes_id').references((): AnyPgColumn => mealSubmissions.id), version: integer('version').default(1).notNull(), correctionReason: text('correction_reason'),
})
export const mealClaimedDays = hr.table('meal_claimed_days', {
  key: text('key').primaryKey(), submissionId: text('submission_id').references(() => mealSubmissions.id).notNull(), employeeId: text('employee_id').notNull(), date: text('date').notNull(),
})
