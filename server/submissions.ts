import type { Hono } from 'hono'
import { randomUUID, createHash } from 'node:crypto'
import { and, eq, inArray, notInArray, ne, or, sql } from 'drizzle-orm'
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
import { reviewsForRecords } from '../src/engine/recordReviews.ts'
import { mealDelta, type MealSnapshot } from '../shared/submissions.ts'
const claimsOf = (snapshot: MealSnapshot) => snapshot.months.flatMap(m => m.days.filter(d => d.meal.state === 'eligible').map(d => ({ key: `${m.employee.nip || m.employee.nika || m.employee.id}|${d.date}`, employeeId: m.employee.id, date: d.date })))
const ancestorsOf = async (tx: Pick<Database, 'execute'>, id: string) => {
  const rows = await tx.execute(sql`WITH RECURSIVE chain AS (SELECT id, supersedes_id FROM hr_internal.meal_submissions WHERE id = ${id} UNION ALL SELECT p.id, p.supersedes_id FROM hr_internal.meal_submissions p JOIN chain c ON p.id = c.supersedes_id) SELECT id FROM chain`)
  return (rows as unknown as { id: string }[]).map(r => r.id)
}
export function registerSubmissions(app: Hono<{ Variables: { user: User; sessionHash: string } }>, db: Database) {
  app.get('/api/meal-submissions', async c => {
    const items = await db.select({ id: mealSubmissions.id, period: mealSubmissions.period, office: mealSubmissions.office, status: mealSubmissions.status, revision: mealSubmissions.revision, workspaceRevision: mealSubmissions.workspaceRevision, checksum: mealSubmissions.checksum, createdAt: mealSubmissions.createdAt, creator: users.name, createdBy: mealSubmissions.createdBy, version: mealSubmissions.version, supersedesId: mealSubmissions.supersedesId, correctionReason: mealSubmissions.correctionReason }).from(mealSubmissions).innerJoin(users, eq(users.id, mealSubmissions.createdBy)).where(globalAccess(c.get('user')) ? undefined : inArray(mealSubmissions.office, c.get('user').offices!)).orderBy(sql`${mealSubmissions.createdAt} desc`).limit(100)
    const children = items.length ? await db.select({ id: mealSubmissions.id, parent: mealSubmissions.supersedesId, status: mealSubmissions.status }).from(mealSubmissions).where(and(inArray(mealSubmissions.supersedesId, items.map(s => s.id)), ne(mealSubmissions.status, 'cancelled'))) : []
    return c.json({ submissions: items.map(s => ({ ...s, correctionId: children.find(child => child.parent === s.id)?.id, supersededBy: children.find(child => child.parent === s.id && child.status === 'locked')?.id })) })
  })
  app.get('/api/meal-submissions/:id', async c => {
    const [submission] = await db.select().from(mealSubmissions).where(eq(mealSubmissions.id, c.req.param('id')))
    if (!submission) throw new HTTPException(404)
    requireOffice(c.get('user'), submission.office)
    const children = await db.select({ id: mealSubmissions.id, status: mealSubmissions.status }).from(mealSubmissions).where(and(eq(mealSubmissions.supersedesId, submission.id), ne(mealSubmissions.status, 'cancelled')))
    return c.json({ submission: { ...submission, correctionId: children[0]?.id, supersededBy: children.find(child => child.status === 'locked')?.id } })
  })
  app.get('/api/meal-submissions/:id/export', async c => {
    const [s] = await db.select().from(mealSubmissions).where(eq(mealSubmissions.id, c.req.param('id')))
    if (!s) throw new HTTPException(404)
    requireOffice(c.get('user'), s.office)
    const [replacement] = await db.select({ id: mealSubmissions.id }).from(mealSubmissions).where(and(eq(mealSubmissions.supersedesId, s.id), eq(mealSubmissions.status, 'locked')))
    const data = s.snapshot, XLSX = await loadXlsx(), wb = XLSX.utils.book_new()
    const sheets: { name: string; rows: (string | number)[][] }[] = [
      { name: 'Nominatif', rows: [[`NOMINATIF ${replacement ? 'ARSIP DIGANTIKAN' : s.status.toUpperCase()} v${s.version} — ${s.period} — ${s.office}`], ['Snapshot', s.id, 'Checksum', s.checksum], ['Nama', 'NIP', 'NIKA', 'Kantor', 'Unit', 'Hari UM', 'Bruto', 'PPh', 'Netto'], ...data.months.map(m => [m.employee.nama, m.employee.nip, m.employee.nika, m.employee.kantor, m.employee.unit, m.mealDays, m.bruto, m.pph, m.netto])] },
      { name: 'Rincian Harian', rows: [['Nama', 'NIP', 'Tanggal', 'Status', 'Masuk', 'Pulang', 'Hak UM', 'Alasan', 'Nominal', 'PPh % efektif', 'Bukti', 'ST'], ...data.months.flatMap(m => m.days.map(d => [m.employee.nama, m.employee.nip, d.date, d.status, d.clockIn ?? '', d.clockOut ?? '', d.meal.state, d.meal.reason, d.meal.amount, d.meal.taxPct ?? '', d.evidenceIds.join(';'), d.assignmentIds.join(';')]))] },
      { name: 'Parameter', rows: [['Versi kalkulasi', data.calculationVersion], ['Versi pengajuan', s.version], ['Menggantikan', s.supersedesId ?? 'Versi awal'], ['Digantikan oleh', replacement?.id ?? 'Belum digantikan'], ['Alasan koreksi', s.correctionReason ?? ''], ['Revisi workspace', data.workspaceRevision], ['Snapshot dibuat', data.generatedAt], ['Pengaju', s.createdBy], ['Penyetuju', s.approvedBy ?? 'Belum disetujui'], ['Status', s.status], ['Parameter', JSON.stringify(data.policy)], ['Pemakaian', 'Nominatif adalah versi pengganti penuh. Selisih adalah referensi koreksi terhadap versi sebelumnya; bukan instruksi pembayaran tambahan otomatis.']] },
      { name: 'Sumber', rows: [['ID', 'File', 'SHA-256', 'Revisi', 'Lengkap sampai'], ...data.sources.map(f => [f.id, f.name, f.hash ?? 'legacy', f.revision ?? 1, f.completeThrough ?? 'Belum dikonfirmasi'])] },
    ]
    if (data.sources.some(f => f.recordReviews?.length)) sheets.push({ name: 'Review Sumber', rows: [['Sumber', 'ID keputusan', 'Jenis', 'ID catatan', 'Status', 'Alasan', 'Reviewer', 'Aktor', 'Waktu'], ...data.sources.flatMap(f => (f.recordReviews ?? []).map(r => [f.id, r.id, r.kind, r.recordId, r.disposition, r.reason, r.reviewer, r.actorId, r.at]))] })
    if (data.correction) sheets.push({ name: 'Selisih Koreksi', rows: [['PERBANDINGAN VERSI; BUKAN PEMBAYARAN TAMBAHAN OTOMATIS'], ['Versi sebelumnya', data.correction.parentId, data.correction.parentChecksum], ['Alasan', data.correction.reason], ['Nama', 'Identifier dan tanggal', 'Tanggal', 'Hari lama', 'Hari baru', 'Bruto lama', 'Bruto baru', 'Selisih bruto', 'PPh lama', 'PPh baru', 'Selisih PPh', 'Netto lama', 'Netto baru', 'Selisih netto'], ...data.correction.delta.map(d => [d.name, d.key, d.date, d.before.days, d.after.days, d.before.bruto, d.after.bruto, d.after.bruto - d.before.bruto, d.before.pph, d.after.pph, d.after.pph - d.before.pph, d.before.netto, d.after.netto, d.after.netto - d.before.netto])] })
    for (const sheet of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name)
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); c.header('Content-Disposition', `attachment; filename="Nominatif_${s.period}_${s.id}.xlsx"`)
    return c.body(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  })
  app.post('/api/meal-submissions', async c => {
    const actor = c.get('user'); if (!['admin', 'hr'].includes(actor.role)) throw new HTTPException(403)
    const v = z.object({ id: z.uuid(), supersedesId: z.uuid().optional(), reason: z.string().trim().min(10).max(2000).optional(), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), office: z.string().min(1).max(100), expectedRevision: z.number().int().nonnegative() }).parse(await c.req.json())
    requireOffice(actor, v.office)
    if (v.supersedesId && !v.reason) throw new HTTPException(400, { message: 'Alasan koreksi wajib minimal 10 karakter' })
    return c.json(await db.transaction(async tx => {
      const [previous] = await tx.select().from(mealSubmissions).where(eq(mealSubmissions.id, v.id))
      if (previous) { if (previous.createdBy !== actor.id || previous.period !== v.period || previous.office !== v.office || (previous.supersedesId ?? undefined) !== v.supersedesId || (previous.correctionReason ?? undefined) !== (v.supersedesId ? v.reason : undefined)) throw new HTTPException(409); return { submission: previous } }
      const [w] = await tx.select().from(workspaces).where(eq(workspaces.id, 'default')).for('update')
      const [retry] = await tx.select().from(mealSubmissions).where(eq(mealSubmissions.id, v.id))
      if (retry?.createdBy === actor.id && retry.period === v.period && retry.office === v.office && (retry.supersedesId ?? undefined) === v.supersedesId && (retry.correctionReason ?? undefined) === (v.supersedesId ? v.reason : undefined)) return { submission: retry }
      if (!w || w.revision !== v.expectedRevision) throw new HTTPException(409, { message: 'Workspace berubah; muat ulang sebelum mengajukan' })
      const [parent] = v.supersedesId ? await tx.select().from(mealSubmissions).where(eq(mealSubmissions.id, v.supersedesId)).for('update') : []
      if (v.supersedesId && (!parent || parent.status !== 'locked' || parent.period !== v.period || parent.office !== v.office)) throw new HTTPException(409, { message: 'Koreksi harus menggantikan snapshot terkunci dengan periode dan kantor yang sama' })
      if (parent && (await tx.select({ id: mealSubmissions.id }).from(mealSubmissions).where(and(eq(mealSubmissions.supersedesId, parent.id), ne(mealSubmissions.status, 'cancelled'))).limit(1)).length) throw new HTTPException(409, { message: 'Versi ini sudah memiliki koreksi aktif. Gunakan versi terkunci terbaru atau batalkan usulan koreksi yang belum dikunci.' })
      const ancestors = parent ? await ancestorsOf(tx, parent.id) : []
      const overlap = await tx.select({ id: mealSubmissions.id }).from(mealSubmissions).where(and(eq(mealSubmissions.period, v.period), ne(mealSubmissions.status, 'cancelled'), ancestors.length ? notInArray(mealSubmissions.id, ancestors) : undefined, v.office === 'Semua' ? undefined : or(eq(mealSubmissions.office, v.office), eq(mealSubmissions.office, 'Semua')))).limit(1)
      if (overlap.length) throw new HTTPException(409, { message: 'Scope periode ini sudah diajukan. Koreksi membutuhkan versi/adjustment tersendiri.' })
      const state = w.state, bounds = monthBounds(v.period), roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
      const calculation = reconcile(state.files, roster, bounds, state.policy, state.resolutions)
      const months = calculation.months.filter(m => v.office === 'Semua' || m.employee.kantor === v.office)
      if ((!months.length && !parent) || !state.policy.parametersApproved || months.some(m => m.heldDays || m.amountPendingDays || m.openIssues)) throw new HTTPException(422, { message: 'Pengajuan ditahan: lengkapi bukti, mapping, review, dan pengesahan parameter/nominal terlebih dahulu' })
      const offices = new Set([...months, ...(parent?.snapshot.months ?? [])].map(m => m.employee.kantor))
      if ([...offices].some(office => !state.files.some(f => f.active !== false && f.kind === 'surat-tugas' && f.office === office && (f.completeThrough ?? '') >= bounds.end))) throw new HTTPException(422, { message: 'Kelengkapan register ST sampai akhir periode belum dikonfirmasi untuk semua kantor dalam pengajuan' })
      if (roster.conflicts.some(i => i.employeeIds.some(id => months.some(m => m.employee.id === id)))) throw new HTTPException(422, { message: 'Konflik identitas harus selesai sebelum pengajuan' })
      const eligible = months.flatMap(m => m.days.filter(d => d.meal.state === 'eligible').map(d => ({ key: `${m.employee.nip || m.employee.nika || m.employee.id}|${d.date}`, employeeId: m.employee.id, date: d.date })))
      if (new Set(eligible.map(d => d.key)).size !== eligible.length) throw new HTTPException(422, { message: 'Identitas ganda menghasilkan hak employee-date yang sama' })
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kppu-meal-claims'))`)
      const existingClaims = eligible.length ? await tx.select().from(mealClaimedDays).where(inArray(mealClaimedDays.key, eligible.map(d => d.key))) : []
      if (existingClaims.some(d => !ancestors.includes(d.submissionId))) throw new HTTPException(409, { message: 'Hari pegawai sudah masuk pengajuan lain; pengajuan ganda ditolak' })
      const snapshot: MealSnapshot = { calculationVersion: '2.0.0', generatedAt: new Date().toISOString(), period: v.period, office: v.office, workspaceRevision: w.revision, policy: state.policy, sources: state.files.filter(f => f.active !== false && (v.office === 'Semua' || f.office === v.office || f.evidence.some(e => e.office === v.office) || f.assignments.some(a => a.office === v.office))).map(f => ({ id: f.id, hash: f.hash, name: f.fileName, revision: f.revision, completeThrough: f.completeThrough, recordReviews: reviewsForRecords(f, new Set(f.evidence.filter(e => v.office === 'Semua' || e.office === v.office).map(e => e.id)), new Set(f.assignments.filter(a => v.office === 'Semua' || a.office === v.office).map(a => a.id))) })), months: months.map(m => ({ employee: m.employee, mealDays: m.mealDays, bruto: m.bruto, pph: m.pph, netto: m.netto, days: m.days.map(d => ({ date: d.date, status: d.status, clockIn: d.clockIn, clockOut: d.clockOut, meal: d.meal, evidenceIds: d.evidence.map(e => e.id), assignmentIds: d.assignments.map(a => a.id) })) })) }
      if (parent) snapshot.correction = { parentId: parent.id, parentChecksum: parent.checksum, reason: v.reason!, delta: mealDelta(parent.snapshot, snapshot) }
      const checksum = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
      const [submission] = await tx.insert(mealSubmissions).values({ id: v.id, period: v.period, office: v.office, workspaceRevision: w.revision, snapshot, checksum, createdBy: actor.id, supersedesId: parent?.id, version: parent ? parent.version + 1 : 1, correctionReason: parent ? v.reason : undefined }).returning()
      const claimedKeys = new Set(existingClaims.map(d => d.key)), newClaims = eligible.filter(d => !claimedKeys.has(d.key))
      if (newClaims.length) await tx.insert(mealClaimedDays).values(newClaims.map(d => ({ ...d, submissionId: submission.id })))
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: parent ? 'meal.correct' : 'meal.submit', revision: w.revision, reason: parent ? v.reason! : 'Pengajuan nominatif snapshot', details: { submissionId: v.id, checksum, supersedesId: parent?.id, version: submission.version } })
      return { submission }
    }))
  })
  app.post('/api/meal-submissions/:id/:action', async c => {
    const actor = c.get('user')
    const action = z.enum(['approve', 'lock', 'cancel']).parse(c.req.param('action'))
    if (!(action === 'cancel' ? ['admin', 'hr', 'finance'] : ['admin', 'finance']).includes(actor.role)) throw new HTTPException(403)
    const v = z.object({ expectedRevision: z.number().int().positive(), reason: z.string().trim().min(3).max(2000) }).parse(await c.req.json())
    return c.json(await db.transaction(async tx => {
      const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, 'default')).for('update')
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
      if (!workspace || workspace.revision !== s.workspaceRevision) throw new HTTPException(409, { message: 'Data berubah setelah pengajuan; periksa revisi sebelum menyetujui' })
      if (action === 'lock' && s.supersedesId) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kppu-meal-claims'))`)
        const ancestors = await ancestorsOf(tx, s.supersedesId), claims = claimsOf(s.snapshot), owned = [...ancestors, s.id]
        const collisions = claims.length ? await tx.select().from(mealClaimedDays).where(and(inArray(mealClaimedDays.key, claims.map(d => d.key)), notInArray(mealClaimedDays.submissionId, owned))).limit(1) : []
        if (collisions.length) throw new HTTPException(409, { message: 'Hak pegawai-tanggal sudah dipakai pengajuan lain' })
        await tx.execute(sql`select set_config('hr_internal.correction_id', ${s.id}, true)`)
        await tx.delete(mealClaimedDays).where(inArray(mealClaimedDays.submissionId, owned))
        if (claims.length) await tx.insert(mealClaimedDays).values(claims.map(d => ({ ...d, submissionId: s.id })))
      }
      const [submission] = await tx.update(mealSubmissions).set({ revision: s.revision + 1, status: action === 'approve' ? 'approved' : 'locked', ...(action === 'approve' ? { approvedBy: actor.id, approvedAt: new Date() } : { lockedAt: new Date() }) }).where(eq(mealSubmissions.id, s.id)).returning()
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: `meal.${action}`, revision: s.workspaceRevision, reason: v.reason, details: { submissionId: s.id, checksum: s.checksum, from: s.status, to: submission.status } })
      return { submission }
    }))
  })
}
