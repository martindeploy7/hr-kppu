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
import { emptyWorkspace, roles, type User, type Workspace } from '../shared/workspace.ts'
import { enforcePolicy } from '../src/engine/policy.ts'
import { readSheets } from '../src/lib/xlsx.ts'
import { parseWorkbook, withOffice } from '../src/engine/parse.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { monthBounds } from '../src/engine/dates.ts'
import { createUser } from './create-user.ts'
import { decisionOwned, globalAccess, officeAllowed, requireOffice, sourceAllowed, scopeWorkspace } from './scope.ts'
import { registerSubmissions } from './submissions.ts'
import { validateMasterChange } from './master.ts'

const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const publicUser = (u: typeof users.$inferSelect): User => ({ id: u.id, email: u.email, name: u.name, role: u.role, offices: u.offices })
export function createApp(db: Database, config: { origin: string; production: boolean }) {
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
    c.set('user', publicUser(s.user)); c.set('sessionHash', tokenHash); await next()
  })
  app.get('/api/auth/me', c => c.json({ user: c.get('user') }))
  app.post('/api/auth/logout', async c => { await db.delete(sessions).where(eq(sessions.tokenHash, c.get('sessionHash'))); deleteCookie(c, cookie, { path: '/', secure: config.production }); return c.json({ ok: true }) })
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
    return w
  }
  const change = async (expectedRevision: number, actor: User, action: string, reason: string, mutate: (state: Workspace, tx: Database) => Promise<Workspace> | Workspace) => {
    await read()
    return db.transaction(async tx => {
      const [w] = await tx.select().from(workspaces).where(eq(workspaces.id, 'default')).for('update')
      if (w.revision !== expectedRevision) throw new HTTPException(409, { message: 'Data berubah oleh admin lain. Simpan backup pekerjaan, lalu muat ulang data server.' })
      const next = await mutate(structuredClone(w.state), tx as unknown as Database)
      next.policy = enforcePolicy(next.policy)
      const revision = w.revision + 1
      await tx.update(workspaces).set({ state: next, revision, updatedAt: new Date() }).where(eq(workspaces.id, 'default'))
      const changed = Object.keys(next).filter(k => JSON.stringify(next[k as keyof Workspace]) !== JSON.stringify(w.state[k as keyof Workspace]))
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action, revision, reason, details: { checksum: digest(JSON.stringify(next)), changed, restorePoint: action === 'workspace.restore' ? w.state : undefined, before: Object.fromEntries(changed.filter(k => k !== 'files').map(k => [k, w.state[k as keyof Workspace]])), after: Object.fromEntries(changed.filter(k => k !== 'files').map(k => [k, next[k as keyof Workspace]])), sourcesBefore: w.state.files.map(f => ({ id: f.id, active: f.active, hash: f.hash })), sourcesAfter: next.files.map(f => ({ id: f.id, active: f.active, hash: f.hash })) } })
      return { state: scopeWorkspace(next, actor), revision }
    })
  }
  app.get('/api/workspace', async c => { const w = await read(); return c.json({ state: scopeWorkspace(w.state, c.get('user')), revision: w.revision }) })
  app.get('/api/workspace/revision', async c => { const [w] = await db.select({ revision: workspaces.revision }).from(workspaces).where(eq(workspaces.id, 'default')); return c.json({ revision: w?.revision ?? 0 }) })
  app.put('/api/workspace', async c => {
    const { expectedRevision, patch, reason } = workspaceEditSchema.parse(await c.req.json())
    const actor = c.get('user')
    const allowed: Record<string, string[]> = { master: ['admin', 'hr'], overrides: ['admin', 'hr', 'finance'], decisions: ['admin', 'hr'], resolutions: ['admin', 'hr', 'reviewer'], policy: ['admin', 'finance'], period: ['admin', 'hr', 'reviewer', 'finance'] }
    if (Object.keys(patch).some(k => !allowed[k].includes(actor.role))) throw new HTTPException(403, { message: 'Peran akun tidak dapat mengubah bagian data ini' })
    return c.json(await change(expectedRevision, actor, 'workspace.update', reason, state => {
      if (!globalAccess(actor)) {
        const fullRoster = buildRoster(state.files, state.master, state.overrides, state.decisions)
        const allowedIds = new Set(fullRoster.employees.filter(e => officeAllowed(actor, e.kantor)).map(e => e.id))
        if (patch.policy) throw new HTTPException(403, { message: 'Hanya akun Keuangan global/admin yang dapat mengubah parameter bersama' })
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
      }
      if (patch.master && actor.role !== 'admin' && patch.master.some(e => JSON.stringify(e.rateHistory) !== JSON.stringify(state.master.find(old => old.id === e.id)?.rateHistory))) throw new HTTPException(403, { message: 'Tarif efektif hanya dapat diubah Keuangan/admin' })
      if (patch.overrides && actor.role !== 'admin') {
        const ids = new Set([...Object.keys(state.overrides), ...Object.keys(patch.overrides)])
        for (const id of ids) {
          const before = state.overrides[id] ?? {}, after = patch.overrides[id] ?? {}
          for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (JSON.stringify(before[key as keyof typeof before]) === JSON.stringify(after[key as keyof typeof after])) continue
            if (actor.role === 'finance' ? key !== 'rateHistory' : key === 'rateHistory') throw new HTTPException(403, { message: 'Perubahan tarif efektif dan profil memakai kewenangan berbeda' })
          }
        }
      }
      if (patch.resolutions) {
        const previous = new Map(state.resolutions.map(r => [r.issueId, r]))
        const roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
        patch.resolutions = patch.resolutions.map(r => {
          if (JSON.stringify(r) === JSON.stringify(previous.get(r.issueId))) return r
          if (r.note.trim().length < 3) throw new HTTPException(400, { message: 'Catatan review wajib diisi minimal 3 karakter' })
          const period = r.issueId.split('|')[1]?.slice(0, 7)
          if (!period || !/^\d{4}-\d{2}$/.test(period)) throw new HTTPException(400, { message: 'Kasus review tidak valid' })
          const issue = reconcile(state.files, roster, monthBounds(period), state.policy, []).issues.find(i => i.id === r.issueId)
          if (!issue || !r.signature || issue.signature !== r.signature) throw new HTTPException(409, { message: 'Bukti kasus telah berubah; tinjau ulang sebelum memutuskan' })
          return { ...r, reviewer: actor.name, at: new Date().toISOString() }
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
    if (!['admin', 'hr'].includes(actor.role)) throw new HTTPException(403, { message: 'Hanya admin/SDM dapat mengimpor sumber' })
    const body = await c.req.parseBody()
    const file = body.file
    if (!(file instanceof File) || !/\.xlsx?$/i.test(file.name)) throw new HTTPException(400, { message: 'Pilih workbook .xls atau .xlsx' })
    if (!file.size || file.size > 15 * 1024 * 1024) throw new HTTPException(413, { message: 'Ukuran file maksimal 15 MB' })
    const bytes = Buffer.from(await file.arrayBuffer()), checksum = digest(bytes)
    const w = await read()
    const duplicate = w.state.files.find(f => f.hash === checksum)
    if (duplicate) { if (!sourceAllowed(actor, duplicate)) throw new HTTPException(403); return c.json({ duplicate: true, file: duplicate }) }
    const id = randomUUID()
    const dateOrder = body.dateOrder ? z.enum(['DMY', 'MDY']).parse(body.dateOrder) : undefined
    let parsed: ReturnType<typeof parseWorkbook>
    try { parsed = { ...parseWorkbook(file.name, await readSheets(file), id, { dateOrder }), hash: checksum, parserVersion: '2.1.0', revision: 1, active: true } }
    catch (e) { throw new HTTPException(422, { message: `Workbook tidak dapat diimpor: ${(e as Error).message.slice(0, 500)}` }) }
    if (!globalAccess(actor) && !sourceAllowed(actor, parsed)) throw new HTTPException(403, { message: 'Sumber berisi kantor di luar cakupan akun. Gunakan ekspor khusus kantor.' })
    if (!parsed.stats.rows && !parsed.master?.length) throw new HTTPException(422, { message: 'Tidak ada baris terbaca; periksa format dan laporan parser' })
    await db.insert(uploads).values({ id, hash: checksum, name: file.name, bytes, parsed, userId: actor.id })
    return c.json({ duplicate: false, file: parsed })
  })
  app.post('/api/imports/commit', async c => {
    const actor = c.get('user')
    if (!['admin', 'hr'].includes(actor.role)) throw new HTTPException(403, { message: 'Hanya admin/SDM dapat mengimpor sumber' })
    const v = z.object({ uploadId: z.uuid(), expectedRevision: z.number().int().nonnegative(), office: z.string().min(1).max(100), replaces: z.string().optional(), completeThrough: z.iso.date().optional(), reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    requireOffice(actor, v.office)
    const [upload] = await db.select().from(uploads).where(eq(uploads.id, v.uploadId))
    if (!upload || upload.userId !== actor.id) throw new HTTPException(404, { message: 'Preview tidak ditemukan' })
    const current = await read(), committed = current.state.files.find(f => f.id === upload.id)
    if (committed) {
      if (committed.office !== v.office || committed.supersedes !== v.replaces || committed.completeThrough !== v.completeThrough) throw new HTTPException(409, { message: 'Upload sudah di-commit dengan parameter berbeda' })
      return c.json({ state: scopeWorkspace(current.state, actor), revision: current.revision })
    }
    return c.json(await change(v.expectedRevision, actor, 'import.commit', v.reason, async (state, tx) => {
      if (state.files.some(f => f.hash === upload.hash)) return state
      const old = v.replaces ? state.files.find(f => f.id === v.replaces && f.active !== false) : undefined
      if (v.replaces && !old) throw new HTTPException(409, { message: 'Dataset pengganti sudah berubah' })
      const file = { ...withOffice(upload.parsed, v.office), completeThrough: v.completeThrough, supersedes: old?.id, revision: old ? (old.revision ?? 1) + 1 : 1 }
      if (old && (old.kind !== file.kind || old.office !== file.office)) throw new HTTPException(400, { message: 'Jenis dan kantor dataset pengganti harus sama' })
      if (old && !sourceAllowed(actor, old)) throw new HTTPException(403)
      if (!sourceAllowed(actor, file)) throw new HTTPException(403)
      if (old) old.active = false
      state.files.push(file)
      await tx.update(uploads).set({ committed: true }).where(eq(uploads.id, upload.id))
      return state
    }))
  })
  app.post('/api/sources/:id/withdraw', async c => {
    const actor = c.get('user'); if (!['admin', 'hr'].includes(actor.role)) throw new HTTPException(403)
    const { expectedRevision, reason } = z.object({ expectedRevision: z.number().int(), reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    return c.json(await change(expectedRevision, actor, 'source.withdraw', reason, state => { const f = state.files.find(f => f.id === c.req.param('id')); if (!f) throw new HTTPException(404); if (!sourceAllowed(actor, f)) throw new HTTPException(403); f.active = false; return state }))
  })
  app.post('/api/sources/:id/office', async c => {
    const actor = c.get('user'); if (!['admin', 'hr'].includes(actor.role)) throw new HTTPException(403)
    const { expectedRevision, office, reason } = z.object({ expectedRevision: z.number().int(), office: z.string().min(1).max(100), reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    return c.json(await change(expectedRevision, actor, 'source.office', reason, state => { const index = state.files.findIndex(f => f.id === c.req.param('id') && f.active !== false); if (index < 0) throw new HTTPException(404); requireOffice(actor, office); if (!sourceAllowed(actor, state.files[index])) throw new HTTPException(403); state.files[index] = withOffice(state.files[index], office); return state }))
  })
  app.post('/api/coverage/nil-st', async c => {
    const actor = c.get('user'); if (!['admin', 'hr'].includes(actor.role)) throw new HTTPException(403)
    const v = z.object({ expectedRevision: z.number().int().nonnegative(), office: z.string().min(1).max(100), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), basis: z.string().min(10).max(2000) }).parse(await c.req.json())
    requireOffice(actor, v.office)
    const bounds = monthBounds(v.period), today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
    if (bounds.end > today) throw new HTTPException(422, { message: 'Pernyataan nihil sebulan tidak dapat dibuat sebelum periode selesai' })
    return c.json(await change(v.expectedRevision, actor, 'coverage.nil-st', v.basis, state => {
      const id = randomUUID(), at = new Date().toISOString()
      state.files.push({ id, fileName: `Pernyataan nihil ST ${v.office} ${v.period}`, kind: 'surat-tugas', label: 'Pernyataan nihil ST oleh SDM', office: v.office, importedAt: at, period: bounds, evidence: [], assignments: [], warnings: [v.basis], stats: { rows: 0, people: 0 }, completeThrough: bounds.end, revision: 1, active: true, declaration: { actorId: actor.id, basis: v.basis, at } })
      return state
    }))
  })
  app.get('/api/calculations/:period', async c => {
    const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(c.req.param('period')), w = await read()
    const state = scopeWorkspace(w.state, c.get('user'))
    return c.json({ revision: w.revision, calculation: reconcile(state.files, buildRoster(state.files, state.master, state.overrides, state.decisions), monthBounds(period), state.policy, state.resolutions) })
  })
  app.get('/api/backup', async c => { const w = await read(); c.header('Content-Disposition', 'attachment; filename="kppu-hr-backup.json"'); return c.json({ application: 'kppu-hr', exportedAt: new Date().toISOString(), revision: w.revision, state: scopeWorkspace(w.state, c.get('user')) }) })
  app.post('/api/backup/preview', async c => {
    if (c.get('user').role !== 'admin') throw new HTTPException(403)
    const body = z.object({ state: z.unknown() }).parse(await c.req.json()), state = migrateWorkspace(body.state)
    return c.json({ state, files: state.files.length, master: state.master.length, reviews: state.resolutions.length, warnings: ['Backup lama tetap perlu ditinjau: policy wajib dikunci dan keputusan tanpa signature menjadi stale.', 'Backup JSON tidak memuat byte workbook asli; unggah ulang diperlukan untuk replay parser.'] })
  })
  app.post('/api/backup/restore', async c => {
    const actor = c.get('user'); if (actor.role !== 'admin') throw new HTTPException(403)
    const v = z.object({ state: z.unknown(), expectedRevision: z.number().int().nonnegative(), reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    const state = migrateWorkspace(v.state)
    return c.json(await change(v.expectedRevision, actor, 'workspace.restore', v.reason, () => state))
  })
  app.get('/api/backup/restore-points/:id', async c => {
    if (c.get('user').role !== 'admin') throw new HTTPException(403)
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.id, c.req.param('id')))
    const previous = (event?.details as { restorePoint?: Workspace } | undefined)?.restorePoint
    if (!previous) throw new HTTPException(404)
    return c.json({ application: 'kppu-hr', state: previous, revision: event.revision - 1 })
  })
  app.get('/api/audit', async c => { if (!globalAccess(c.get('user')) || !['admin', 'reviewer', 'finance'].includes(c.get('user').role)) throw new HTTPException(403); return c.json({ events: await db.select({ id: auditEvents.id, actorName: users.name, action: auditEvents.action, revision: auditEvents.revision, reason: auditEvents.reason, at: auditEvents.at }).from(auditEvents).innerJoin(users, eq(users.id, auditEvents.actorId)).orderBy(sql`${auditEvents.at} desc`).limit(100) }) })
  app.post('/api/users', async c => {
    if (c.get('user').role !== 'admin') throw new HTTPException(403)
    const v = z.object({ email: z.email(), name: z.string().min(2).max(100), password: z.string().min(14).max(256), role: z.enum(roles), offices: z.array(z.string().min(1).max(100)).max(20).nullable().optional() }).parse(await c.req.json())
    if (v.role === 'admin' && v.offices?.length) throw new HTTPException(400, { message: 'Administrator memakai akses semua kantor' })
    await db.transaction(async tx => {
      await createUser(tx as unknown as Database, v.email, v.name, v.password, v.role, v.offices ?? null)
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: c.get('user').id, action: 'user.create', revision: 0, reason: 'Administrator membuat akun', details: { email: v.email.toLowerCase(), role: v.role, offices: v.offices } })
    })
    return c.json({ ok: true }, 201)
  })
  app.get('/api/users', async c => {
    if (c.get('user').role !== 'admin') throw new HTTPException(403)
    return c.json({ users: await db.select({ id: users.id, email: users.email, name: users.name, role: users.role, offices: users.offices, active: users.active }).from(users) })
  })
  app.post('/api/users/:id/disable', async c => {
    const actor = c.get('user'); if (actor.role !== 'admin' || actor.id === c.req.param('id')) throw new HTTPException(403)
    const v = z.object({ reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    await db.transaction(async tx => {
      const [account] = await tx.update(users).set({ active: false }).where(eq(users.id, c.req.param('id'))).returning({ id: users.id })
      if (!account) throw new HTTPException(404)
      await tx.delete(sessions).where(eq(sessions.userId, account.id))
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'user.disable', revision: 0, reason: v.reason, details: { userId: account.id } })
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
