import { pgSchema, text, integer, jsonb, timestamp, boolean, customType, index, type AnyPgColumn } from 'drizzle-orm/pg-core'
import type { SourceFile } from '../src/engine/types.ts'
import type { Role, Workspace } from '../shared/workspace.ts'
import type { MealSnapshot } from '../shared/submissions.ts'
import type { AutomationRuleId, AutomationRuleOptions, AutomationSettings, CampaignAudience, CampaignStatus, OutboxStatus } from '../shared/automation.ts'
import type { Religion } from '../src/engine/types.ts'
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
export const whatsappAuthState = hr.table('whatsapp_auth_state', {
  id: text('id').primaryKey(), encryptedState: bytes('encrypted_state').notNull(), updatedAt: time('updated_at').defaultNow().notNull(),
})
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
// ===== Automation WhatsApp =====
export const waAutomationSettings = hr.table('wa_automation_settings', {
  id: text('id').primaryKey(), settings: jsonb('settings').$type<Partial<AutomationSettings>>().notNull(), updatedAt: time('updated_at').defaultNow().notNull(), updatedBy: text('updated_by'),
})
export const waAutomationRules = hr.table('wa_automation_rules', {
  id: text('id').primaryKey(), enabled: boolean('enabled').notNull(), sendTime: text('send_time').notNull(), template: text('template').notNull(),
  options: jsonb('options').$type<AutomationRuleOptions>().default({}).notNull(), updatedAt: time('updated_at').defaultNow().notNull(), updatedBy: text('updated_by'),
})
export const waHolidays = hr.table('wa_holidays', {
  id: text('id').primaryKey(), date: text('date').notNull(), name: text('name').notNull(), religions: jsonb('religions').$type<Religion[]>().notNull(),
  greeting: text('greeting').notNull(), confirmed: boolean('confirmed').default(false).notNull(), enabled: boolean('enabled').default(true).notNull(),
})
export const waCampaigns = hr.table('wa_campaigns', {
  id: text('id').primaryKey(), ruleId: text('rule_id').$type<AutomationRuleId>().notNull(), title: text('title').notNull(), template: text('template').notNull(),
  variables: jsonb('variables').$type<Record<string, string>>().default({}).notNull(), audience: jsonb('audience').$type<CampaignAudience>().notNull(),
  sendAt: time('send_at').notNull(), repeatMonthly: boolean('repeat_monthly').default(false).notNull(), status: text('status').$type<CampaignStatus>().default('scheduled').notNull(),
  createdBy: text('created_by').references(() => users.id).notNull(), createdAt: time('created_at').defaultNow().notNull(), lastRunOn: text('last_run_on'), recipients: integer('recipients'),
}, t => [index('wa_campaigns_status_idx').on(t.status, t.sendAt)])
export const waOutbox = hr.table('wa_outbox', {
  id: text('id').primaryKey(), dedupeKey: text('dedupe_key').notNull().unique(), ruleId: text('rule_id').$type<AutomationRuleId>().notNull(),
  campaignId: text('campaign_id'), employeeId: text('employee_id'), recipientName: text('recipient_name').notNull(),
  phone: text('phone').notNull(), deliverTo: text('deliver_to').notNull(), test: boolean('test').default(false).notNull(), message: text('message').notNull(),
  scheduledFor: time('scheduled_for').notNull(), expiresAt: time('expires_at').notNull(), status: text('status').$type<OutboxStatus>().notNull(),
  attempts: integer('attempts').default(0).notNull(), nextAttemptAt: time('next_attempt_at'), lastError: text('last_error'), waMessageId: text('wa_message_id'),
  sentAt: time('sent_at'), createdAt: time('created_at').defaultNow().notNull(), updatedAt: time('updated_at').defaultNow().notNull(),
}, t => [index('wa_outbox_due_idx').on(t.status, t.scheduledFor), index('wa_outbox_created_idx').on(t.createdAt)])
/** Sidik data jabatan terakhir per pegawai, pembanding untuk aturan perubahan jabatan. */
export const waEmployeeSnapshots = hr.table('wa_employee_snapshots', {
  employeeId: text('employee_id').primaryKey(), fingerprint: text('fingerprint').notNull(), updatedAt: time('updated_at').defaultNow().notNull(),
})
