import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { hash, verify } from '@node-rs/argon2'
import { and, eq, gt, sql } from 'drizzle-orm'
import { z, ZodError } from 'zod'
import type { Database } from './db.ts'
import { auditEvents, loginAttempts, sessions, uploads, users, workspaces } from './schema.ts'
import { migrateWorkspace, workspaceEditSchema } from '../shared/validation.ts'
import { canonicalRole, emptyWorkspace, isRole, roles, type User, type Workspace } from '../shared/workspace.ts'
import { enforcePolicy } from '../src/engine/policy.ts'
import { readSheets } from '../src/lib/xlsx.ts'
import { parseWorkbook, withOffice } from '../src/engine/parse.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { dayReviewKey, dayReviewProblem, stableStringify, unresolvedIdentityEvidence } from '../src/engine/dayReview.ts'
import { createCoverageLookup, inspectMonthlyPackage } from '../src/engine/monthlyFlow.ts'
import { monthBounds, splitByMonth } from '../src/engine/dates.ts'
import { OFFICES } from '../src/engine/ids.ts'
import { createUser } from './create-user.ts'
import { decisionOwned, globalAccess, officeAllowed, requireOffice, sourceAllowed, scopeWorkspace } from './scope.ts'
import { registerSubmissions, withSubmissionWarnings } from './submissions.ts'
import { validateMasterChange } from './master.ts'
import { previewRecordReview, recordReviewInput } from './recordReviews.ts'
import { canRetryImport, importCommitSchema, importIntentSchema, previewImport } from './imports.ts'
import type { WhatsAppConnector } from './whatsapp.ts'
import { registerRekapSt } from './rekapStRoutes.ts'
import { AutomationInputError, AutomationService, canReadAutomation, canWriteAutomation } from './automation.ts'

const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const stableValue = (value: unknown): unknown => Array.isArray(value)
  ? value.map(stableValue)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]))
    : value
const sameValue = (a: unknown, b: unknown) => JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b))
const publicUser = (u: typeof users.$inferSelect): User => ({ id: u.id, email: u.email, name: u.name, role: canonicalRole(u.role), offices: u.offices })
const requireSuperadmin = (user: User) => { if (user.role !== 'superadmin') throw new HTTPException(403, { message: 'Hanya Superadmin yang dapat mengubah data' }) }
const roleOffices = (role: User['role'], offices: string[] | null | undefined) => {
  if (role === 'operator_st') {
    if (!offices || offices.length !== 1 || !OFFICES.includes(offices[0])) throw new HTTPException(400, { message: 'Operator Rekap ST harus dibatasi ke tepat satu kantor' })
    return offices
  }
  if (offices?.length) throw new HTTPException(400, { message: 'Superadmin dan Admin memiliki akses seluruh kantor' })
  return null
}
export function createApp(db: Database, config: { origin: string; production: boolean }, whatsapp?: WhatsAppConnector, automation: AutomationService = new AutomationService(db, whatsapp)) {
  const app = new Hono<{ Variables: { user: User; sessionHash: string } }>()
  const cookie = config.production ? '__Host-kppu_session' : 'kppu_session'
  const dummyHash = hash(randomBytes(32).toString('hex'))
  app.use('*', secureHeaders({ referrerPolicy: 'same-origin', xFrameOptions: 'DENY', contentSecurityPolicy: config.production ? { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] } : undefined }))
  app.use('/api/*', bodyLimit({ maxSize: 20 * 1024 * 1024, onError: c => c.json({ error: 'File/request melebihi 20 MB' }, 413) }))
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('origin') !== config.origin) throw new HTTPException(403, { message: 'Origin request tidak diizinkan' })
    await next()
  })
  app.get('/api/health', async c => {
    try { await db.execute(sql`select 1`); return c.json({ ok: true, service: 'kppu-hr', revision: process.env.RENDER_GIT_COMMIT?.slice(0, 12) ?? 'local' }) }
    catch { return c.json({ ok: false, error: 'Database belum tersedia' }, 503) }
  })
  app.post('/api/auth/login', async c => {
    const { email, password } = z.object({ email: z.email().max(254).transform(v => v.toLowerCase().trim()), password: z.string().min(1).max(256) }).parse(await c.req.json())
    // Persisted limiter survives restarts/free-tier sleep. No client supplied IP is trusted.
    const key = digest(email)
    const [attempt] = await db.insert(loginAttempts).values({ key, count: 1, resetAt: new Date(Date.now() + 10 * 60000) }).onConflictDoUpdate({ target: loginAttempts.key, set: {
      count: sql`case when ${loginAttempts.resetAt} < now() then 1 else ${loginAttempts.count} + 1 end`,
      resetAt: sql`case when ${loginAttempts.resetAt} < now() then now() + interval '10 minutes' else ${loginAttempts.resetAt} end`,
    } }).returning()
    if (attempt.count > 10) { c.header('Retry-After', '600'); throw new HTTPException(429, { message: 'Terlalu banyak percobaan; coba lagi dalam 10 menit' }) }
    const [u] = await db.select().from(users).where(eq(users.email, email))
    const valid = await verify(u?.passwordHash ?? await dummyHash, password)
    if (!u?.active || !valid) throw new HTTPException(401, { message: 'Email atau password tidak sesuai' })
    if (!isRole(u.role)) throw new HTTPException(403, { message: 'Peran akun ini sudah tidak berlaku; minta Superadmin menetapkan peran baru' })
    await db.delete(loginAttempts).where(eq(loginAttempts.key, key))
    const token = randomBytes(32).toString('base64url')
    await db.insert(sessions).values({ tokenHash: digest(token), userId: u.id, expiresAt: new Date(Date.now() + 8 * 3600000) })
    setCookie(c, cookie, token, { httpOnly: true, secure: config.production, sameSite: 'Lax', path: '/', maxAge: 8 * 3600 })
    return c.json({ user: publicUser(u) })
  })
  app.use('/api/*', async (c, next) => {
    const token = getCookie(c, cookie)
    if (!token) throw new HTTPException(401, { message: 'Silakan masuk terlebih dahulu' })
    const tokenHash = digest(token)
    const [s] = await db.select({ user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date()), eq(users.active, true)))
    if (!s) throw new HTTPException(401, { message: 'Sesi berakhir; silakan masuk kembali' })
    // Least privilege: a legacy role must never inherit admin's reconciliation write access.
    if (!isRole(s.user.role)) throw new HTTPException(403, { message: 'Peran akun ini sudah tidak berlaku; minta Superadmin menetapkan peran baru' })
    const user = publicUser(s.user)
    c.set('user', user); c.set('sessionHash', tokenHash)
    const path = new URL(c.req.url).pathname
    const readMethod = ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)
    const accountSelfService = ['POST /api/auth/logout', 'POST /api/auth/password'].includes(`${c.req.method} ${path}`)
    const reconciliationMutation = (c.req.method === 'PUT' && path === '/api/workspace')
      || (c.req.method === 'POST' && /^\/api\/sources\/[^/]+\/record-review(?:\/preview)?$/.test(path))
    // Read-only computations sent as POST because they carry a body; they change nothing.
    const readOnlyPost = c.req.method === 'POST' && path === '/api/automation/campaigns/preview'
    if (readOnlyPost && user.role === 'admin') { await next(); return }
    if (user.role === 'admin' && !readMethod && !accountSelfService && !reconciliationMutation) throw new HTTPException(403, { message: 'Admin hanya dapat mengubah keputusan rekonsiliasi' })
    // Operator Rekap ST: kelola ST (tambah, koreksi, batalkan, lampiran) di kantor register sendiri; pembatasan kantor ada di tiap rute.
    const operatorStRoute = (readMethod && ['/api/auth/me', '/api/rekap-st', '/api/rekap-st/employees'].includes(path))
      || (c.req.method === 'GET' && /^\/api\/rekap-st\/attachments\/[^/]+\/file$/.test(path))
      || (readMethod && /^\/api\/rekap-st\/groups\/[^/]+$/.test(path))
      || (c.req.method === 'POST' && (path === '/api/rekap-st' || /^\/api\/rekap-st\/(?:groups\/)?[^/]+\/void$/.test(path) || /^\/api\/rekap-st\/groups\/[^/]+\/attachments$/.test(path)))
      || (c.req.method === 'PUT' && /^\/api\/rekap-st\/groups\/[^/]+$/.test(path))
      || (c.req.method === 'DELETE' && /^\/api\/rekap-st\/attachments\/[^/]+$/.test(path))
    if (user.role === 'operator_st' && !(operatorStRoute || accountSelfService)) throw new HTTPException(403, { message: 'Operator Rekap ST hanya dapat mengelola rekap ST di kantor cakupannya' })
    await next()
  })
  app.get('/api/auth/me', c => c.json({ user: c.get('user') }))
  app.post('/api/auth/logout', async c => { await db.delete(sessions).where(eq(sessions.tokenHash, c.get('sessionHash'))); deleteCookie(c, cookie, { path: '/', secure: config.production }); return c.json({ ok: true }) })
  app.get('/api/whatsapp/status', c => {
    requireSuperadmin(c.get('user'))
    if (!whatsapp) throw new HTTPException(503, { message: 'Layanan koneksi WhatsApp belum aktif di server' })
    return c.json(whatsapp.status())
  })
  app.post('/api/whatsapp/connect', async c => {
    requireSuperadmin(c.get('user'))
    if (!whatsapp) throw new HTTPException(503, { message: 'Layanan koneksi WhatsApp belum aktif di server' })
    try { await whatsapp.connect() }
    catch (error) { throw new HTTPException(503, { message: error instanceof Error ? error.message : 'Koneksi WhatsApp gagal dimulai' }) }
    return c.json(whatsapp.status(), 202)
  })
  app.post('/api/whatsapp/disconnect', async c => {
    requireSuperadmin(c.get('user'))
    if (!whatsapp) throw new HTTPException(503, { message: 'Layanan koneksi WhatsApp belum aktif di server' })
    try { await whatsapp.disconnect() }
    catch { throw new HTTPException(503, { message: 'Sesi WhatsApp gagal dihapus. Coba kembali.' }) }
    return c.json(whatsapp.status())
  })
  // ===== Automation WhatsApp =====
  const automationRead = (user: User) => { if (!canReadAutomation(user.role)) throw new HTTPException(403, { message: 'Automation WhatsApp hanya dapat dilihat Superadmin dan Admin' }) }
  const automationWrite = (user: User) => { if (!canWriteAutomation(user.role)) throw new HTTPException(403, { message: 'Hanya Superadmin yang dapat mengubah automation WhatsApp' }) }
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work() }
    catch (error) { if (error instanceof AutomationInputError) throw new HTTPException(400, { message: error.message }); throw error }
  }
  const body = async (c: { req: { json: () => Promise<unknown> } }) => { try { return (await c.req.json()) as Record<string, any> } catch { throw new HTTPException(400, { message: 'Body JSON tidak valid' }) } }
  app.get('/api/automation', async c => { automationRead(c.get('user')); return c.json(await automation.overview()) })
  app.put('/api/automation/settings', async c => { const u = c.get('user'); automationWrite(u); const b = await body(c); await guarded(() => automation.updateSettings(b, u)); return c.json(await automation.overview()) })
  app.put('/api/automation/rules/:id', async c => { const u = c.get('user'); automationWrite(u); const b = await body(c); await guarded(() => automation.updateRule(c.req.param('id'), b, u)); return c.json(await automation.overview()) })
  app.put('/api/automation/holidays', async c => { const u = c.get('user'); automationWrite(u); const b = await body(c); await guarded(() => automation.setHolidays(b.holidays, u)); return c.json(await automation.overview()) })
  app.get('/api/automation/outbox', async c => { automationRead(c.get('user')); return c.json({ items: await automation.outbox({ status: c.req.query('status') || undefined, ruleId: c.req.query('ruleId') || undefined, limit: Number(c.req.query('limit') ?? 100) || 100 }) }) })
  app.post('/api/automation/outbox/:id/retry', async c => { const u = c.get('user'); automationWrite(u); return c.json({ item: await guarded(() => automation.retry(c.req.param('id'), u)) }) })
  app.post('/api/automation/outbox/:id/cancel', async c => { const u = c.get('user'); automationWrite(u); return c.json({ item: await guarded(() => automation.cancel(c.req.param('id'), u)) }) })
  app.get('/api/automation/preview', async c => { automationRead(c.get('user')); return c.json(await guarded(() => automation.preview(c.req.query('ruleId') ?? '', c.req.query('date') ?? ''))) })
  app.post('/api/automation/test', async c => { const u = c.get('user'); automationWrite(u); const b = await body(c); return c.json({ item: await guarded(() => automation.sendTest(String(b.ruleId ?? ''), b.employeeId ? String(b.employeeId) : undefined, u)) }) })
  app.get('/api/automation/campaigns', async c => { automationRead(c.get('user')); return c.json({ campaigns: await automation.campaigns() }) })
  app.post('/api/automation/campaigns/preview', async c => { automationRead(c.get('user')); const b = await body(c); return c.json(await guarded(() => automation.previewCampaign(b))) })
  app.post('/api/automation/campaigns', async c => { const u = c.get('user'); automationWrite(u); const b = await body(c); return c.json({ campaign: await guarded(() => automation.createCampaign(b, u)) }, 201) })
  app.post('/api/automation/campaigns/:id/cancel', async c => { const u = c.get('user'); automationWrite(u); return c.json({ campaign: await guarded(() => automation.cancelCampaign(c.req.param('id'), u)) }) })
  app.post('/api/automation/run', async c => { const u = c.get('user'); automationWrite(u); await automation.tick(); return c.json(await automation.overview()) })
  app.post('/api/auth/password', async c => {
    const v = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(14).max(256) }).parse(await c.req.json()), actor = c.get('user')
    const [account] = await db.select().from(users).where(eq(users.id, actor.id))
    if (!await verify(account.passwordHash, v.currentPassword)) throw new HTTPException(401, { message: 'Password saat ini tidak sesuai' })
    const passwordHash = await hash(v.newPassword)
    await db.transaction(async tx => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, actor.id))
      await tx.delete(sessions).where(and(eq(sessions.userId, actor.id), sql`${sessions.tokenHash} <> ${c.get('sessionHash')}`))
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'user.password-change', revision: 0, reason: 'Pemilik akun mengganti password; sesi lain dicabut', details: { userId: actor.id } })
    })
    return c.json({ ok: true })
  })

  const read = async () => {
    await db.insert(workspaces).values({ id: 'default', state: emptyWorkspace() }).onConflictDoNothing()
    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, 'default'))
    return { ...w, state: { ...w.state, dayReviews: w.state.dayReviews ?? [], policy: enforcePolicy(w.state.policy) } }
  }
  const change = async (expectedRevision: number, actor: User, action: string, reason: string, mutate: (state: Workspace, tx: Database) => Promise<Workspace> | Workspace, extra: Record<string, unknown> = {}) => {
    await read()
    return db.transaction(async tx => {
      const [w] = await tx.select().from(workspaces).where(eq(workspaces.id, 'default')).for('update')
      if (w.revision !== expectedRevision) throw new HTTPException(409, { message: 'Data berubah oleh admin lain. Simpan backup pekerjaan, lalu muat ulang data server.' })
      const currentState = { ...w.state, dayReviews: w.state.dayReviews ?? [], policy: enforcePolicy(w.state.policy) }
      const next = await mutate(structuredClone(currentState), tx as unknown as Database)
      next.policy = enforcePolicy(next.policy)
      const revision = w.revision + 1
      await tx.update(workspaces).set({ state: next, revision, updatedAt: new Date() }).where(eq(workspaces.id, 'default'))
      const changed = Object.keys(next).filter(k => JSON.stringify(next[k as keyof Workspace]) !== JSON.stringify(w.state[k as keyof Workspace]))
      const priorReviews = new Map(w.state.files.flatMap(f => (f.recordReviews ?? []).map(r => [r.id, { sourceId: f.id, review: r }] as const)))
      const currentReviews = new Map(next.files.flatMap(f => (f.recordReviews ?? []).map(r => [r.id, { sourceId: f.id, review: r }] as const)))
      const recordReviewChanges = [...new Set([...priorReviews.keys(), ...currentReviews.keys()])].flatMap(id => JSON.stringify(priorReviews.get(id)) === JSON.stringify(currentReviews.get(id)) ? [] : [{ id, sourceId: currentReviews.get(id)?.sourceId ?? priorReviews.get(id)?.sourceId, before: priorReviews.get(id)?.review, after: currentReviews.get(id)?.review }])
      const priorDayReviews = new Map((w.state.dayReviews ?? []).map(r => [dayReviewKey(r.employeeId, r.date), r]))
      const currentDayReviews = new Map((next.dayReviews ?? []).map(r => [dayReviewKey(r.employeeId, r.date), r]))
      const dayReviewChanges = [...new Set([...priorDayReviews.keys(), ...currentDayReviews.keys()])].flatMap(key => JSON.stringify(priorDayReviews.get(key)) === JSON.stringify(currentDayReviews.get(key)) ? [] : [{ key, before: priorDayReviews.get(key), after: currentDayReviews.get(key) }])
      const priorSources = new Map(w.state.files.map(f => [f.id, f])), currentSources = new Map(next.files.map(f => [f.id, f]))
      const assignmentScopeChanges = [...new Set([...priorSources.keys(), ...currentSources.keys()])].flatMap(id => {
        const before = priorSources.get(id), after = currentSources.get(id), beforeScope = before?.assignmentImport, afterScope = after?.assignmentImport
        if (JSON.stringify(beforeScope) === JSON.stringify(afterScope) && JSON.stringify(before?.importCommit) === JSON.stringify(after?.importCommit)) return []
        const beforeSelected = new Set(beforeScope?.selectedIds ?? []), afterSelected = new Set(afterScope?.selectedIds ?? [])
        const priorSupersessions = new Set((beforeScope?.supersessions ?? []).map(s => `${s.bySourceId}|${s.registerKey}|${s.at}`))
        return [{ sourceId: id, selectedAdded: [...afterSelected].filter(x => !beforeSelected.has(x)), selectedRemoved: [...beforeSelected].filter(x => !afterSelected.has(x)), supersessionsAdded: (afterScope?.supersessions ?? []).filter(s => !priorSupersessions.has(`${s.bySourceId}|${s.registerKey}|${s.at}`)), importCommit: after?.importCommit ? { mode: after.importCommit.mode, confirmation: after.importCommit.confirmation, replacedScopes: after.importCommit.replacedScopes } : undefined }]
      })
      const evidenceScopeChanges = [...new Set([...priorSources.keys(), ...currentSources.keys()])].flatMap(id => {
        const before = priorSources.get(id), after = currentSources.get(id), beforeScope = before?.evidenceImport, afterScope = after?.evidenceImport
        if (JSON.stringify(beforeScope) === JSON.stringify(afterScope) && JSON.stringify(before?.importCommit) === JSON.stringify(after?.importCommit)) return []
        const beforeSelected = new Set(beforeScope?.selectedIds ?? []), afterSelected = new Set(afterScope?.selectedIds ?? [])
        return [{ sourceId: id, selectedAdded: [...afterSelected].filter(x => !beforeSelected.has(x)), selectedRemoved: [...beforeSelected].filter(x => !afterSelected.has(x)), importMode: after?.importCommit?.mode, importConfirmation: after?.importCommit?.confirmation }]
      })
      const sourceSummary = (f: Workspace['files'][number]) => ({ id: f.id, active: f.active, hash: f.hash, revision: f.revision, recordReviewCount: f.recordReviews?.length ?? 0, evidenceSelectedCount: f.evidenceImport?.selectedIds?.length, assignmentSelectedCount: f.assignmentImport?.selectedIds?.length, assignmentSupersessionCount: f.assignmentImport?.supersessions?.length ?? 0, importMode: f.importCommit?.mode, importConfirmation: f.importCommit?.confirmation, coverageDeclarations: f.coverageDeclarations ?? [] })
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action, revision, reason, details: { checksum: digest(JSON.stringify(next)), changed, recordReviewChanges, dayReviewChanges, dayReviewCountBefore: w.state.dayReviews?.length ?? 0, dayReviewCountAfter: next.dayReviews?.length ?? 0, assignmentScopeChanges, evidenceScopeChanges, restorePoint: action === 'workspace.restore' ? w.state : undefined, before: Object.fromEntries(changed.filter(k => k !== 'files' && k !== 'dayReviews').map(k => [k, w.state[k as keyof Workspace]])), after: Object.fromEntries(changed.filter(k => k !== 'files' && k !== 'dayReviews').map(k => [k, next[k as keyof Workspace]])), sourcesBefore: w.state.files.map(sourceSummary), sourcesAfter: next.files.map(sourceSummary), ...extra } })
      return { state: scopeWorkspace(next, actor), revision }
    })
  }
  app.get('/api/workspace', async c => { const w = await read(); return c.json({ state: scopeWorkspace(w.state, c.get('user')), revision: w.revision }) })
  app.get('/api/monthly-package', async c => {
    const { period } = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse({ period: c.req.query('period') })
    const actor = c.get('user'), w = await read(), state = scopeWorkspace(w.state, actor)
    const offices = actor.offices?.length ? actor.offices : undefined
    return c.json({ package: inspectMonthlyPackage(state.files, period, offices) })
  })
  registerRekapSt(app, { db, read, change })
  app.get('/api/workspace/revision', async c => { const [w] = await db.select({ revision: workspaces.revision }).from(workspaces).where(eq(workspaces.id, 'default')); return c.json({ revision: w?.revision ?? 0 }) })
  app.put('/api/workspace', async c => {
    const { expectedRevision, patch, reason } = workspaceEditSchema.parse(await c.req.json())
    const actor = c.get('user')
    const allowed: Record<string, string[]> = {
      master: ['superadmin'], overrides: ['superadmin'], decisions: ['superadmin', 'admin'],
      resolutions: ['superadmin', 'admin'], dayReviews: ['superadmin', 'admin'],
      policy: ['superadmin'], period: ['superadmin'],
    }
    if (Object.keys(patch).some(k => !allowed[k].includes(actor.role))) throw new HTTPException(403, { message: 'Peran akun tidak dapat mengubah bagian data ini' })
    return c.json(await change(expectedRevision, actor, 'workspace.update', reason, state => {
      if (!globalAccess(actor)) {
        const fullRoster = buildRoster(state.files, state.master, state.overrides, state.decisions)
        const allowedIds = new Set(fullRoster.employees.filter(e => officeAllowed(actor, e.kantor)).map(e => e.id))
        if (patch.policy) throw new HTTPException(403, { message: 'Hanya Superadmin yang dapat mengubah parameter bersama' })
        if (patch.master) {
          for (const e of patch.master) {
            requireOffice(actor, e.kantor)
            if (fullRoster.byId.has(e.id) && !allowedIds.has(e.id)) throw new HTTPException(403)
            if (e.nip && fullRoster.employees.some(old => old.nip === e.nip && !allowedIds.has(old.id))) throw new HTTPException(409, { message: 'Identifier tidak dapat digunakan dalam cakupan akun ini' })
          }
          patch.master = [...state.master.filter(e => !allowedIds.has(e.id)), ...patch.master]
        }
        if (patch.overrides) {
          for (const [id, p] of Object.entries(patch.overrides)) { if (!allowedIds.has(id)) throw new HTTPException(403); if (p.kantor) requireOffice(actor, p.kantor) }
          patch.overrides = { ...Object.fromEntries(Object.entries(state.overrides).filter(([id]) => !allowedIds.has(id))), ...patch.overrides }
        }
        if (patch.decisions) {
          const ownKey = (d: { key: string; employeeId: string | null }) => decisionOwned(actor, d, allowedIds)
          if (patch.decisions.some(d => !ownKey(d))) throw new HTTPException(403)
          patch.decisions = [...state.decisions.filter(d => !ownKey(d)), ...patch.decisions]
        }
        if (patch.resolutions) {
          if (patch.resolutions.some(r => !allowedIds.has(r.issueId.split('|')[0]))) throw new HTTPException(403)
          patch.resolutions = [...state.resolutions.filter(r => !allowedIds.has(r.issueId.split('|')[0])), ...patch.resolutions]
        }
        if (patch.dayReviews) {
          if (patch.dayReviews.some(r => !allowedIds.has(r.employeeId))) throw new HTTPException(403)
          patch.dayReviews = [...state.dayReviews.filter(r => !allowedIds.has(r.employeeId)), ...patch.dayReviews]
        }
      }
      if (patch.master && actor.role !== 'superadmin' && patch.master.some(e => !sameValue(e.rateHistory, state.master.find(old => old.id === e.id)?.rateHistory))) throw new HTTPException(403, { message: 'Tarif efektif hanya dapat diubah Superadmin' })
      if (patch.resolutions) {
        const previous = new Map(state.resolutions.map(r => [r.issueId, r]))
        const roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
        const issuesByPeriod = new Map<string, Map<string, ReturnType<typeof reconcile>['issues'][number]>>()
        patch.resolutions = patch.resolutions.map(r => {
          if (JSON.stringify(r) === JSON.stringify(previous.get(r.issueId))) return r
          if (r.note.trim().length < 3) throw new HTTPException(400, { message: 'Catatan review wajib diisi minimal 3 karakter' })
          const period = r.issueId.split('|')[1]?.slice(0, 7)
          if (!period || !/^\d{4}-\d{2}$/.test(period)) throw new HTTPException(400, { message: 'Kasus review tidak valid' })
          // Satu perhitungan per bulan untuk seluruh keputusan dalam patch (sebelumnya dihitung ulang per keputusan).
          let issues = issuesByPeriod.get(period)
          if (!issues) { issues = new Map(reconcile(state.files, roster, monthBounds(period), state.policy, [], undefined, state.dayReviews).issues.map(i => [i.id, i])); issuesByPeriod.set(period, issues) }
          const issue = issues.get(r.issueId)
          if (!issue || !r.signature || issue.signature !== r.signature) throw new HTTPException(409, { message: 'Bukti kasus telah berubah; tinjau ulang sebelum memutuskan' })
          return { ...r, reviewer: actor.name, at: new Date().toISOString() }
        })
      }
      if (patch.dayReviews) {
        const previous = new Map(state.dayReviews.map(r => [dayReviewKey(r.employeeId, r.date), r]))
        const roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
        const calculations = new Map<string, ReturnType<typeof reconcile>>()
        patch.dayReviews = patch.dayReviews.map(review => {
          const key = dayReviewKey(review.employeeId, review.date)
          if (stableStringify(review) === stableStringify(previous.get(key))) return review
          const period = review.date.slice(0, 7)
          let calculation = calculations.get(period)
          if (!calculation) { calculation = reconcile(state.files, roster, monthBounds(period), state.policy, state.resolutions, undefined, state.dayReviews, createCoverageLookup(state.files)); calculations.set(period, calculation) }
          const day = calculation.months.find(m => m.employee.id === review.employeeId)?.days.find(d => d.date === review.date)
          if (!day || day.reviewSignature !== review.signature) throw new HTTPException(409, { message: 'Bukti hari ini berubah; muat ulang dan tinjau ulang sebelum menyimpan' })
          const problem = dayReviewProblem(review, day.evidence, day.assignments)
          if (problem) throw new HTTPException(400, { message: problem })
          if (unresolvedIdentityEvidence(day.evidence.filter(e => review.evidenceIds.includes(e.id)), review.employeeId, roster.identity).length) throw new HTTPException(409, { message: 'Pencocokan identitas bukti terpilih belum diselesaikan; selesaikan identitas terlebih dahulu' })
          return { ...review, reviewer: actor.name, actorId: actor.id, at: new Date().toISOString() }
        })
      }
      if (patch.decisions) patch.decisions = patch.decisions.map(d => state.decisions.some(old => JSON.stringify(old) === JSON.stringify(d)) ? d : { ...d, reviewer: actor.name, at: new Date().toISOString() })
      const next = { ...state, ...patch, reviewer: actor.name }
      if (patch.master || patch.overrides) {
        try { validateMasterChange(state, next) } catch (e) { throw new HTTPException(400, { message: (e as Error).message }) }
      }
      return next
    }))
  })
  app.post('/api/imports/preview', async c => {
    const actor = c.get('user')
    requireSuperadmin(actor)
    const body = await c.req.parseBody()
    const file = body.file
    if (!(file instanceof File) || !/\.xlsx?$/i.test(file.name)) throw new HTTPException(400, { message: 'Pilih workbook .xls atau .xlsx' })
    if (!file.size || file.size > 15 * 1024 * 1024) throw new HTTPException(413, { message: 'Ukuran file maksimal 15 MB' })
    const bytes = Buffer.from(await file.arrayBuffer()), checksum = digest(bytes)
    const w = await read()
    const duplicate = w.state.files.find(f => f.hash === checksum)
    // Setoran mingguan boleh memakai file kumulatif yang sama untuk pekan berikutnya; baris ganda disaring saat commit.
    const weekly = body.weekly === '1'
    if (duplicate && !weekly) { if (!sourceAllowed(actor, duplicate)) throw new HTTPException(403); return c.json({ duplicate: true, file: duplicate }) }
    const id = randomUUID()
    const dateOrder = body.dateOrder ? z.enum(['DMY', 'MDY']).parse(body.dateOrder) : undefined
    let parsed: ReturnType<typeof parseWorkbook>
    try { parsed = { ...parseWorkbook(file.name, await readSheets(file), id, { dateOrder }), hash: checksum, parserVersion: '2.2.0', revision: 1, active: true } }
    catch (e) { throw new HTTPException(422, { message: `Workbook tidak dapat diimpor: ${(e as Error).message.slice(0, 500)}` }) }
    if (parsed.kind === 'surat-tugas' && !weekly) throw new HTTPException(422, { message: 'Rekap ST kini diinput melalui halaman Rekap ST. Excel ST tidak lagi menjadi sumber input baru.' })
    if (!globalAccess(actor) && !sourceAllowed(actor, parsed)) throw new HTTPException(403, { message: 'Sumber berisi kantor di luar cakupan akun. Gunakan ekspor khusus kantor.' })
    if (!parsed.stats.rows && !parsed.master?.length) throw new HTTPException(422, { message: 'Tidak ada baris terbaca; periksa format dan laporan parser' })
    await db.insert(uploads).values({ id, hash: checksum, name: file.name, bytes, parsed, userId: actor.id })
    return c.json({ duplicate: false, file: parsed })
  })
  app.post('/api/imports/impact', async c => {
    const actor = c.get('user'), intent = importIntentSchema.parse(await c.req.json())
    const [upload] = await db.select().from(uploads).where(eq(uploads.id, intent.uploadId))
    if (!upload || upload.userId !== actor.id) throw new HTTPException(404, { message: 'Preview tidak ditemukan' })
    const current = await read(), committed = current.state.files.find(f => f.id === upload.id)
    if (committed) throw new HTTPException(409, { message: 'Workbook sudah di-commit; unggah sumber baru untuk perubahan berikutnya' })
    return c.json(await withSubmissionWarnings(db, previewImport(current.state, current.revision, upload.parsed as Workspace['files'][number], actor, intent).impact))
  })
  app.post('/api/imports/commit', async c => {
    const actor = c.get('user')
    requireSuperadmin(actor)
    const v = importCommitSchema.parse(await c.req.json())
    const [upload] = await db.select().from(uploads).where(eq(uploads.id, v.uploadId))
    if (!upload || upload.userId !== actor.id) throw new HTTPException(404, { message: 'Preview tidak ditemukan' })
    const current = await read(), committed = current.state.files.find(f => f.id === upload.id)
    if (committed) {
      if (!canRetryImport(committed, actor, v.confirmedImpact)) throw new HTTPException(409, { message: 'Upload sudah di-commit dengan konfirmasi yang berbeda' })
      return c.json({ state: scopeWorkspace(current.state, actor), revision: current.revision })
    }
    return c.json(await change(v.expectedRevision, actor, `import.${v.mode}`, v.reason, async (state, tx) => {
      // Setoran mingguan boleh memakai file kumulatif yang sama untuk pekan lain; ditolak hanya bila pekan yang sama sudah disetor dari file itu.
      const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && a.end >= b.start
      const sameWeek = (f: Workspace['files'][number]) => !v.range || (f.coverageDeclarations?.length ? f.coverageDeclarations.some(d => overlaps(d, v.range!)) : !f.period || overlaps(f.period, v.range))
      if (state.files.some(f => f.hash === upload.hash && sameWeek(f))) throw new HTTPException(409, { message: v.range ? 'File yang sama sudah disetor untuk pekan ini; tidak ada bukti yang ditambahkan' : 'File identik sudah aktif atau diarsipkan; tidak ada bukti yang ditambahkan' })
      const { confirmedImpact, ...intent } = v
      const result = previewImport(state, v.expectedRevision, upload.parsed as Workspace['files'][number], actor, intent)
      if (result.impact.checksum !== confirmedImpact) throw new HTTPException(409, { message: 'Dampak impor berubah; buka preview terbaru sebelum menyimpan' })
      const file = result.next.files.find(f => f.id === upload.id)
      if (!file) throw new HTTPException(500, { message: 'Hasil preview impor tidak lengkap' })
      file.importCommit = { mode: v.mode, confirmation: v.confirmedImpact, actorId: actor.id, committedAt: new Date().toISOString(), selectedRegisterKeys: file.assignmentImport?.selectedRegisterKeys, replacedScopes: result.impact.replacedScopes.map(s => ({ sourceId: s.sourceId, registerKey: s.registerKey, label: s.label })) }
      await tx.update(uploads).set({ committed: true }).where(eq(uploads.id, upload.id))
      return result.next
    }))
  })
  app.post('/api/sources/:id/record-review/preview', async c => {
    const input = recordReviewInput.parse(await c.req.json()), w = await read()
    return c.json(previewRecordReview(w.state, w.revision, c.req.param('id'), input, c.get('user')).preview)
  })
  app.post('/api/sources/:id/record-review', async c => {
    const input = recordReviewInput.parse(await c.req.json()), actor = c.get('user')
    if (!['superadmin', 'admin'].includes(actor.role)) throw new HTTPException(403, { message: 'Hanya Admin dan Superadmin yang dapat meninjau bukti rekonsiliasi' })
    if (!input.confirmedImpact) throw new HTTPException(400, { message: 'Preview dampak dan konfirmasi wajib sebelum menyimpan' })
    return c.json(await change(input.expectedRevision, actor, 'source.record-review', input.reason, state => {
      const result = previewRecordReview(state, input.expectedRevision, c.req.param('id'), input, actor)
      if (result.preview.checksum !== input.confirmedImpact) throw new HTTPException(409, { message: 'Dampak telah berubah; periksa preview kembali' })
      return result.next
    }))
  })
  app.post('/api/sources/:id/withdraw', async c => {
    const actor = c.get('user'); requireSuperadmin(actor)
    const { expectedRevision, reason } = z.object({ expectedRevision: z.number().int(), reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    return c.json(await change(expectedRevision, actor, 'source.withdraw', reason, state => { const f = state.files.find(f => f.id === c.req.param('id')); if (!f) throw new HTTPException(404); if (!sourceAllowed(actor, f)) throw new HTTPException(403); f.active = false; return state }))
  })
  app.post('/api/sources/:id/office', async c => {
    const actor = c.get('user'); requireSuperadmin(actor)
    const { expectedRevision, office, reason } = z.object({ expectedRevision: z.number().int(), office: z.string().min(1).max(100), reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    return c.json(await change(expectedRevision, actor, 'source.office', reason, state => { const index = state.files.findIndex(f => f.id === c.req.param('id') && f.active !== false); if (index < 0) throw new HTTPException(404); requireOffice(actor, office); if (!sourceAllowed(actor, state.files[index])) throw new HTTPException(403); state.files[index] = withOffice(state.files[index], office); return state }))
  })
  app.post('/api/coverage/nil-st', async c => {
    const actor = c.get('user'); requireSuperadmin(actor)
    const v = z.object({ expectedRevision: z.number().int().nonnegative(), office: z.string().min(1).max(100), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), start: z.iso.date().optional(), end: z.iso.date().optional(), basis: z.string().min(10).max(2000) }).refine(value => (!!value.period && !value.start && !value.end) || (!value.period && !!value.start && !!value.end), 'Kirim periode lama atau rentang tanggal awal dan akhir').parse(await c.req.json())
    requireOffice(actor, v.office)
    const bounds = v.period ? monthBounds(v.period) : { start: v.start!, end: v.end! }, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
    if (bounds.start > bounds.end) throw new HTTPException(400, { message: 'Rentang tanggal terbalik' })
    if (bounds.end > today) throw new HTTPException(422, { message: 'Pernyataan nihil hanya dapat mencakup tanggal yang sudah berlangsung' })
    return c.json(await change(v.expectedRevision, actor, 'coverage.nil-st', v.basis, state => {
      if (state.files.some(file => file.active !== false && file.kind === 'surat-tugas' && file.office === v.office && file.assignments.some(row => row.start <= bounds.end && row.end >= bounds.start))) throw new HTTPException(409, { message: 'Register ST aktif ditemukan pada rentang ini; periksa konflik sebelum menyatakan nihil' })
      const id = randomUUID(), at = new Date().toISOString()
      state.files.push({ id, fileName: `Pernyataan nihil ST ${v.office} ${bounds.start}_${bounds.end}`, kind: 'surat-tugas', label: 'Pernyataan nihil ST oleh SDM', office: v.office, importedAt: at, period: bounds, evidence: [], assignments: [], warnings: [v.basis], stats: { rows: 0, people: 0 }, completeThrough: bounds.end, coverageDeclarations: splitByMonth(bounds.start, bounds.end).map(part => ({ start: part.start, end: part.end, status: 'nil' as const, actorId: actor.id, basis: v.basis, at })), revision: 1, active: true, declaration: { actorId: actor.id, basis: v.basis, at } })
      return state
    }))
  })
  app.post('/api/coverage/not-applicable', async c => {
    const actor = c.get('user'); requireSuperadmin(actor)
    const v = z.object({ expectedRevision: z.number().int().nonnegative(), office: z.string().min(1).max(100), source: z.enum(['offline', 'online', 'surat-tugas']), start: z.iso.date(), end: z.iso.date(), basis: z.string().min(10).max(2000) }).strict().parse(await c.req.json())
    requireOffice(actor, v.office)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
    if (v.start > v.end || v.end > today) throw new HTTPException(422, { message: 'Rentang tidak valid atau mencakup tanggal mendatang' })
    return c.json(await change(v.expectedRevision, actor, 'coverage.not-applicable', v.basis, state => {
      const kind = v.source === 'online' ? 'daring' : v.source === 'surat-tugas' ? 'surat-tugas' : 'mesin'
      const sourceKinds = v.source === 'offline' ? new Set(['mesin', 'matriks-kanwil', 'jadwal-kanwil', 'laporan-kanwil']) : new Set([kind])
      const hasRecords = state.files.some(file => file.active !== false && sourceKinds.has(file.kind) && (file.office === v.office || (v.source === 'online' && file.office === 'Semua kantor')) && (file.evidence.some(row => row.office === v.office && row.date >= v.start && row.date <= v.end) || file.assignments.some(row => row.office === v.office && row.start <= v.end && row.end >= v.start)))
      if (hasRecords) throw new HTTPException(409, { message: 'Data sumber aktif ditemukan pada rentang ini; tidak dapat dinyatakan tidak berlaku' })
      const id = randomUUID(), at = new Date().toISOString(), range = { start: v.start, end: v.end }
      state.files.push({ id, fileName: `Konfirmasi sumber tidak berlaku ${v.source} ${v.office} ${v.start}_${v.end}`, kind, label: 'Konfirmasi cakupan sumber', office: v.office, importedAt: at, period: range, evidence: [], assignments: [], warnings: [v.basis], stats: { rows: 0, people: 0 }, coverageDeclarations: splitByMonth(range.start, range.end).map(part => ({ start: part.start, end: part.end, status: 'not-applicable' as const, actorId: actor.id, basis: v.basis, at })), revision: 1, active: true, declaration: { actorId: actor.id, basis: v.basis, at } })
      return state
    }))
  })
  app.post('/api/sources/:id/coverage', async c => {
    const actor = c.get('user'); requireSuperadmin(actor)
    const v = z.object({ expectedRevision: z.number().int().nonnegative(), start: z.iso.date(), end: z.iso.date(), status: z.enum(['complete', 'partial', 'not-applicable']), basis: z.string().min(10).max(2000) }).strict().parse(await c.req.json())
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
    if (v.start > v.end || v.end > today) throw new HTTPException(422, { message: 'Rentang tidak valid atau mencakup tanggal mendatang' })
    return c.json(await change(v.expectedRevision, actor, 'source.coverage', v.basis, state => {
      const file = state.files.find(source => source.id === c.req.param('id') && source.active !== false)
      if (!file) throw new HTTPException(404)
      if (!sourceAllowed(actor, file)) throw new HTTPException(403)
      const declarations = file.coverageDeclarations ?? []
      if (declarations.some(d => d.start <= v.end && d.end >= v.start && d.status !== v.status)) throw new HTTPException(409, { message: 'Deklarasi bertentangan pada rentang yang sama; buat revisi sumber dengan alasan dan scope jelas' })
      if (v.status === 'not-applicable' && (file.evidence.some(row => row.date >= v.start && row.date <= v.end) || file.assignments.some(row => row.start <= v.end && row.end >= v.start))) throw new HTTPException(409, { message: 'Sumber berisi catatan aktif pada rentang ini; tidak dapat dinyatakan tidak berlaku' })
      // Deklarasi lintas bulan disimpan terbelah per bulan kalender; bagian yang sudah tercatat persis sama dilewati.
      const parts = splitByMonth(v.start, v.end).filter(part => !declarations.some(d => d.start === part.start && d.end === part.end && d.status === v.status && d.basis === v.basis))
      if (!parts.length) return state
      const at = new Date().toISOString()
      file.coverageDeclarations = [...declarations, ...parts.map(part => ({ start: part.start, end: part.end, status: v.status, basis: v.basis, actorId: actor.id, at }))]
      return state
    }))
  })
  app.get('/api/calculations/:period', async c => {
    const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(c.req.param('period')), w = await read()
    const state = scopeWorkspace(w.state, c.get('user'))
    return c.json({ revision: w.revision, calculation: reconcile(state.files, buildRoster(state.files, state.master, state.overrides, state.decisions), monthBounds(period), state.policy, state.resolutions, undefined, state.dayReviews, createCoverageLookup(state.files)) })
  })
  app.get('/api/backup', async c => { const w = await read(); c.header('Content-Disposition', 'attachment; filename="kppu-hr-backup.json"'); return c.json({ application: 'kppu-hr', exportedAt: new Date().toISOString(), revision: w.revision, state: scopeWorkspace(w.state, c.get('user')) }) })
  app.post('/api/backup/preview', async c => {
    requireSuperadmin(c.get('user'))
    const body = z.object({ state: z.unknown() }).parse(await c.req.json()), state = migrateWorkspace(body.state)
    return c.json({ state, files: state.files.length, master: state.master.length, reviews: state.resolutions.length, warnings: ['Backup lama tetap perlu ditinjau: policy wajib dikunci dan keputusan tanpa signature menjadi stale.', 'Backup JSON tidak memuat byte workbook asli; unggah ulang diperlukan untuk replay parser.'] })
  })
  app.post('/api/backup/restore', async c => {
    const actor = c.get('user'); requireSuperadmin(actor)
    const v = z.object({ state: z.unknown(), expectedRevision: z.number().int().nonnegative(), reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    const state = migrateWorkspace(v.state)
    return c.json(await change(v.expectedRevision, actor, 'workspace.restore', v.reason, () => state))
  })
  app.get('/api/backup/restore-points/:id', async c => {
    requireSuperadmin(c.get('user'))
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.id, c.req.param('id')))
    const previous = (event?.details as { restorePoint?: Workspace } | undefined)?.restorePoint
    if (!previous) throw new HTTPException(404)
    return c.json({ application: 'kppu-hr', state: previous, revision: event.revision - 1 })
  })
  app.get('/api/audit', async c => { if (!globalAccess(c.get('user')) || !['admin', 'superadmin'].includes(c.get('user').role)) throw new HTTPException(403); return c.json({ events: await db.select({ id: auditEvents.id, actorName: users.name, action: auditEvents.action, revision: auditEvents.revision, reason: auditEvents.reason, at: auditEvents.at }).from(auditEvents).innerJoin(users, eq(users.id, auditEvents.actorId)).orderBy(sql`${auditEvents.at} desc`).limit(100) }) })
  app.post('/api/users', async c => {
    const actor = c.get('user'); requireSuperadmin(actor)
    const v = z.object({ email: z.email(), name: z.string().min(2).max(100), password: z.string().min(14).max(256), role: z.enum(roles), offices: z.array(z.string().min(1).max(100)).max(20).nullable().optional() }).parse(await c.req.json())
    const offices = roleOffices(v.role, v.offices)
    await db.transaction(async tx => {
      await createUser(tx as unknown as Database, v.email, v.name, v.password, v.role, offices)
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'user.create', revision: 0, reason: 'Superadmin membuat akun', details: { email: v.email.toLowerCase(), role: v.role, offices } })
    })
    return c.json({ ok: true }, 201)
  })
  app.get('/api/users', async c => {
    requireSuperadmin(c.get('user'))
    const accounts = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role, offices: users.offices, active: users.active }).from(users)
    return c.json({ users: accounts.map(account => ({ ...account, role: canonicalRole(account.role), legacyRole: isRole(account.role) ? null : account.role })) })
  })
  app.post('/api/users/:id/role', async c => {
    const actor = c.get('user'); requireSuperadmin(actor)
    if (actor.id === c.req.param('id')) throw new HTTPException(403, { message: 'Gunakan akun Superadmin lain untuk mengubah peran sendiri' })
    const v = z.object({ role: z.enum(roles), offices: z.array(z.string().min(1).max(100)).max(20).nullable().optional() }).parse(await c.req.json())
    const offices = roleOffices(v.role, v.offices)
    await db.transaction(async tx => {
      const [target] = await tx.select().from(users).where(eq(users.id, c.req.param('id'))).for('update')
      if (!target) throw new HTTPException(404)
      const previousRole = canonicalRole(target.role)
      if (previousRole === 'superadmin' && v.role !== 'superadmin') {
        const others = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, 'superadmin'), eq(users.active, true)))
        if (others.filter(item => item.id !== target.id).length === 0) throw new HTTPException(409, { message: 'Tidak dapat menurunkan Superadmin terakhir' })
      }
      await tx.update(users).set({ role: v.role, offices }).where(eq(users.id, target.id))
      await tx.delete(sessions).where(eq(sessions.userId, target.id))
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'user.role-change', revision: 0, reason: 'Superadmin mengubah peran akun', details: { userId: target.id, before: previousRole, after: v.role, offices } })
    })
    return c.json({ ok: true })
  })
  app.post('/api/users/:id/disable', async c => {
    const actor = c.get('user'); requireSuperadmin(actor); if (actor.id === c.req.param('id')) throw new HTTPException(403)
    const v = z.object({ reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    await db.transaction(async tx => {
      const [target] = await tx.select().from(users).where(eq(users.id, c.req.param('id'))).for('update')
      if (!target) throw new HTTPException(404)
      if (canonicalRole(target.role) === 'superadmin') {
        const others = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, 'superadmin'), eq(users.active, true)))
        if (others.filter(item => item.id !== target.id).length === 0) throw new HTTPException(409, { message: 'Tidak dapat menonaktifkan Superadmin terakhir' })
      }
      await tx.update(users).set({ active: false }).where(eq(users.id, target.id))
      await tx.delete(sessions).where(eq(sessions.userId, target.id))
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'user.disable', revision: 0, reason: v.reason, details: { userId: target.id } })
    })
    return c.json({ ok: true })
  })
  registerSubmissions(app, db)
  app.all('/api/*', c => c.json({ error: 'Endpoint tidak ditemukan' }, 404))
  app.onError((err, c) => {
    if (err instanceof SyntaxError) return c.json({ error: 'Format JSON tidak valid' }, 400)
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    if (err instanceof ZodError) return c.json({ error: 'Data tidak valid', fields: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }, 400)
    console.error('Request failed', { name: err.name, code: (err as { code?: string }).code })
    return c.json({ error: 'Permintaan gagal. Data sebelumnya tetap tersimpan; coba kembali.' }, 500)
  })
  return app
}
