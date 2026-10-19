import type { Hono } from 'hono'
import { randomUUID, createHash } from 'node:crypto'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { User } from '../shared/workspace.ts'
import type { Database } from './db.ts'
import { auditEvents, mealClaimedDays, mealSubmissions, users, workspaces } from './schema.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { monthBounds } from '../src/engine/dates.ts'
import { loadXlsx } from '../src/lib/xlsx.ts'
import { globalAccess, requireOffice } from './scope.ts'
import type { MealSnapshot } from '../shared/submissions.ts'
export function registerSubmissions(app: Hono<{ Variables: { user: User; sessionHash: string } }>, db: Database) {
  app.get('/api/meal-submissions', async c => c.json({ submissions: await db.select({ id: mealSubmissions.id, period: mealSubmissions.period, office: mealSubmissions.office, status: mealSubmissions.status, revision: mealSubmissions.revision, workspaceRevision: mealSubmissions.workspaceRevision, checksum: mealSubmissions.checksum, createdAt: mealSubmissions.createdAt, creator: users.name }).from(mealSubmissions).innerJoin(users, eq(users.id, mealSubmissions.createdBy)).where(globalAccess(c.get('user')) ? undefined : inArray(mealSubmissions.office, c.get('user').offices!)).orderBy(sql`${mealSubmissions.createdAt} desc`).limit(100) }))
  app.get('/api/meal-submissions/:id', async c => {
    const [submission] = await db.select().from(mealSubmissions).where(eq(mealSubmissions.id, c.req.param('id')))
    if (!submission) throw new HTTPException(404)
    requireOffice(c.get('user'), submission.office)
    return c.json({ submission })
  })
  app.get('/api/meal-submissions/:id/export', async c => {
    const [s] = await db.select().from(mealSubmissions).where(eq(mealSubmissions.id, c.req.param('id')))
    if (!s) throw new HTTPException(404)
    requireOffice(c.get('user'), s.office)
    const data = s.snapshot, XLSX = await loadXlsx(), wb = XLSX.utils.book_new()
    const sheets: { name: string; rows: (string | number)[][] }[] = [
      { name: 'Nominatif', rows: [[`NOMINATIF ${s.status.toUpperCase()} — ${s.period} — ${s.office}`], ['Snapshot', s.id, 'Checksum', s.checksum], ['Nama', 'NIP', 'NIKA', 'Kantor', 'Unit', 'Hari UM', 'Bruto', 'PPh', 'Netto'], ...data.months.map(m => [m.employee.nama, m.employee.nip, m.employee.nika, m.employee.kantor, m.employee.unit, m.mealDays, m.bruto, m.pph, m.netto])] },
      { name: 'Rincian Harian', rows: [['Nama', 'NIP', 'Tanggal', 'Status', 'Masuk', 'Pulang', 'Hak UM', 'Alasan', 'Nominal', 'PPh % efektif', 'Bukti', 'ST'], ...data.months.flatMap(m => m.days.map(d => [m.employee.nama, m.employee.nip, d.date, d.status, d.clockIn ?? '', d.clockOut ?? '', d.meal.state, d.meal.reason, d.meal.amount, d.meal.taxPct ?? '', d.evidenceIds.join(';'), d.assignmentIds.join(';')]))] },
      { name: 'Parameter', rows: [['Versi kalkulasi', data.calculationVersion], ['Revisi workspace', data.workspaceRevision], ['Snapshot dibuat', data.generatedAt], ['Pengaju', s.createdBy], ['Penyetuju', s.approvedBy ?? 'Belum disetujui'], ['Status', s.status], ['Parameter', JSON.stringify(data.policy)]] },
      { name: 'Sumber', rows: [['ID', 'File', 'SHA-256', 'Revisi', 'Lengkap sampai'], ...data.sources.map(f => [f.id, f.name, f.hash ?? 'legacy', f.revision ?? 1, f.completeThrough ?? 'Belum dikonfirmasi'])] },
    ]
    for (const sheet of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name)
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); c.header('Content-Disposition', `attachment; filename="Nominatif_${s.period}_${s.id}.xlsx"`)
    return c.body(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  })
  app.post('/api/meal-submissions', async c => {
    const actor = c.get('user'); if (!['admin', 'hr'].includes(actor.role)) throw new HTTPException(403)
    const v = z.object({ id: z.uuid(), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), office: z.string().min(1).max(100), expectedRevision: z.number().int().nonnegative() }).parse(await c.req.json())
    requireOffice(actor, v.office)
    return c.json(await db.transaction(async tx => {
      const [previous] = await tx.select().from(mealSubmissions).where(eq(mealSubmissions.id, v.id))
      if (previous) { if (previous.createdBy !== actor.id || previous.period !== v.period || previous.office !== v.office) throw new HTTPException(409); return { submission: previous } }
      const [w] = await tx.select().from(workspaces).where(eq(workspaces.id, 'default')).for('update')
      const [retry] = await tx.select().from(mealSubmissions).where(eq(mealSubmissions.id, v.id))
      if (retry?.createdBy === actor.id && retry.period === v.period && retry.office === v.office) return { submission: retry }
      if (!w || w.revision !== v.expectedRevision) throw new HTTPException(409, { message: 'Workspace berubah; muat ulang sebelum mengajukan' })
      const overlap = await tx.select({ id: mealSubmissions.id }).from(mealSubmissions).where(and(eq(mealSubmissions.period, v.period), ne(mealSubmissions.status, 'cancelled'), v.office === 'Semua' ? undefined : or(eq(mealSubmissions.office, v.office), eq(mealSubmissions.office, 'Semua')))).limit(1)
      if (overlap.length) throw new HTTPException(409, { message: 'Scope periode ini sudah diajukan. Koreksi membutuhkan versi/adjustment tersendiri.' })
      const state = w.state, bounds = monthBounds(v.period), roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
      const calculation = reconcile(state.files, roster, bounds, state.policy, state.resolutions)
      const months = calculation.months.filter(m => v.office === 'Semua' || m.employee.kantor === v.office)
      if (!months.length || !state.policy.parametersApproved || months.some(m => m.heldDays || m.amountPendingDays || m.openIssues)) throw new HTTPException(422, { message: 'Pengajuan ditahan: lengkapi bukti, mapping, review, dan pengesahan parameter/nominal terlebih dahulu' })
      const offices = new Set(months.map(m => m.employee.kantor))
      if ([...offices].some(office => !state.files.some(f => f.active !== false && f.kind === 'surat-tugas' && f.office === office && (f.completeThrough ?? '') >= bounds.end))) throw new HTTPException(422, { message: 'Kelengkapan register ST sampai akhir periode belum dikonfirmasi untuk semua kantor dalam pengajuan' })
      if (roster.conflicts.some(i => i.employeeIds.some(id => months.some(m => m.employee.id === id)))) throw new HTTPException(422, { message: 'Konflik identitas harus selesai sebelum pengajuan' })
      const eligible = months.flatMap(m => m.days.filter(d => d.meal.state === 'eligible').map(d => ({ key: `${m.employee.nip || m.employee.nika || m.employee.id}|${d.date}`, employeeId: m.employee.id, date: d.date })))
      if (new Set(eligible.map(d => d.key)).size !== eligible.length) throw new HTTPException(422, { message: 'Identitas ganda menghasilkan hak employee-date yang sama' })
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kppu-meal-claims'))`)
      if (eligible.length && (await tx.select().from(mealClaimedDays).where(inArray(mealClaimedDays.key, eligible.map(d => d.key))).limit(1)).length) throw new HTTPException(409, { message: 'Hari pegawai sudah masuk pengajuan lain; pengajuan ganda ditolak' })
      const snapshot: MealSnapshot = { calculationVersion: '2.0.0', generatedAt: new Date().toISOString(), period: v.period, office: v.office, workspaceRevision: w.revision, policy: state.policy, sources: state.files.filter(f => f.active !== false).map(f => ({ id: f.id, hash: f.hash, name: f.fileName, revision: f.revision, completeThrough: f.completeThrough })), months: months.map(m => ({ employee: m.employee, mealDays: m.mealDays, bruto: m.bruto, pph: m.pph, netto: m.netto, days: m.days.map(d => ({ date: d.date, status: d.status, clockIn: d.clockIn, clockOut: d.clockOut, meal: d.meal, evidenceIds: d.evidence.map(e => e.id), assignmentIds: d.assignments.map(a => a.id) })) })) }
      const checksum = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
      const [submission] = await tx.insert(mealSubmissions).values({ id: v.id, period: v.period, office: v.office, workspaceRevision: w.revision, snapshot, checksum, createdBy: actor.id }).returning()
      if (eligible.length) await tx.insert(mealClaimedDays).values(eligible.map(d => ({ ...d, submissionId: submission.id })))
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'meal.submit', revision: w.revision, reason: 'Pengajuan nominatif snapshot', details: { submissionId: v.id, checksum } })
      return { submission }
    }))
  })
  app.post('/api/meal-submissions/:id/:action', async c => {
    const actor = c.get('user')
    const action = z.enum(['approve', 'lock', 'cancel']).parse(c.req.param('action'))
    if (!(action === 'cancel' ? ['admin', 'hr', 'finance'] : ['admin', 'finance']).includes(actor.role)) throw new HTTPException(403)
    const v = z.object({ expectedRevision: z.number().int().positive(), reason: z.string().min(3).max(2000) }).parse(await c.req.json())
    return c.json(await db.transaction(async tx => {
      const [s] = await tx.select().from(mealSubmissions).where(eq(mealSubmissions.id, c.req.param('id'))).for('update')
      if (!s) throw new HTTPException(404)
      requireOffice(actor, s.office)
      if (action === 'cancel') {
        if (s.revision !== v.expectedRevision || s.status === 'locked' || s.status === 'cancelled') throw new HTTPException(409, { message: 'Pengajuan locked tidak dapat dibatalkan; perlu adjustment terpisah' })
        if (actor.role === 'hr' && s.createdBy !== actor.id) throw new HTTPException(403)
        const [submission] = await tx.update(mealSubmissions).set({ revision: s.revision + 1, status: 'cancelled' }).where(eq(mealSubmissions.id, s.id)).returning()
        await tx.delete(mealClaimedDays).where(eq(mealClaimedDays.submissionId, s.id))
        await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'meal.cancel', revision: s.workspaceRevision, reason: v.reason, details: { submissionId: s.id, checksum: s.checksum } })
        return { submission }
      }
      if (s.revision !== v.expectedRevision || s.status !== (action === 'approve' ? 'submitted' : 'approved')) throw new HTTPException(409, { message: 'Status/revisi pengajuan telah berubah' })
      if (s.createdBy === actor.id) throw new HTTPException(403, { message: 'Pengaju tidak dapat menyetujui atau mengunci pengajuannya sendiri' })
      {
        const [w] = await tx.select().from(workspaces).where(eq(workspaces.id, 'default'))
        if (!w || w.revision !== s.workspaceRevision) throw new HTTPException(409, { message: 'Data berubah setelah pengajuan; periksa revisi sebelum menyetujui' })
      }
      const [submission] = await tx.update(mealSubmissions).set({ revision: s.revision + 1, status: action === 'approve' ? 'approved' : 'locked', ...(action === 'approve' ? { approvedBy: actor.id, approvedAt: new Date() } : { lockedAt: new Date() }) }).where(eq(mealSubmissions.id, s.id)).returning()
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: `meal.${action}`, revision: s.workspaceRevision, reason: v.reason, details: { submissionId: s.id, checksum: s.checksum, from: s.status, to: submission.status } })
      return { submission }
    }))
  })
}
