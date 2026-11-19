import { createHash, randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from './db.ts'
import { auditEvents, stAttachments, users } from './schema.ts'
import type { User, Workspace } from '../shared/workspace.ts'
import { ST_CATATAN_MAX, ST_MAX_ATTACHMENTS, ST_MAX_ATTACHMENT_BYTES, ST_MAX_DAYS, ST_MAX_PARTICIPANTS, type StAttachmentMeta } from '../shared/rekapSt.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { addDays, eachDay, monthBounds } from '../src/engine/dates.ts'
import { OFFICES } from '../src/engine/ids.ts'
import { sourceRecordState } from '../src/engine/recordReviews.ts'
import type { Assignment, Employee, SourceFile } from '../src/engine/types.ts'
import { requireOffice } from './scope.ts'
import { attachmentDisposition, detectAttachmentType, groupIdOf, isLocalDestination, manualStSourceId, normalizeStText, participantKey, publicStRecord, safeAttachmentName } from './rekapSt.ts'

type Ctx = {
  db: Database
  read: () => Promise<{ revision: number; state: Workspace }>
  change: (expectedRevision: number, actor: User, action: string, reason: string, mutate: (state: Workspace, tx: Database) => Promise<Workspace> | Workspace, extra?: Record<string, unknown>) => Promise<{ state: Workspace; revision: number }>
}
type Part = { key: string; employee?: Employee; external?: { name: string; note?: string } }
type Meta = { letterNo: string; letterDate: string; destination: string; catatan?: string }

const stFields = {
  expectedRevision: z.number().int().nonnegative(), registerOffice: z.enum(OFFICES).optional(),
  letterNo: z.string().trim().min(1).max(100), letterDate: z.iso.date(),
  employeeIds: z.array(z.string().min(1).max(200)).max(ST_MAX_PARTICIPANTS).default([]),
  externalParticipants: z.array(z.object({ name: z.string().trim().min(2).max(120), note: z.string().trim().max(200).optional() }).strict()).max(ST_MAX_PARTICIPANTS).default([]),
  startDate: z.iso.date(), endDate: z.iso.date(), destination: z.string().trim().min(1).max(250),
  catatan: z.string().trim().max(ST_CATATAN_MAX).optional(),
}
const stRules = (value: { startDate: string; endDate: string; employeeIds: string[]; externalParticipants: { name: string }[] }, ctx: z.RefinementCtx) => {
  if (value.endDate < value.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Tanggal tugas selesai tidak boleh sebelum tanggal mulai' })
  else if (eachDay(value.startDate, value.endDate).length > ST_MAX_DAYS) ctx.addIssue({ code: 'custom', path: ['endDate'], message: `Rentang tanggal tugas maksimal ${ST_MAX_DAYS} hari` })
  const total = new Set(value.employeeIds).size + new Set(value.externalParticipants.map(item => normalizeStText(item.name))).size
  if (total < 1) ctx.addIssue({ code: 'custom', path: ['employeeIds'], message: 'Pilih minimal satu peserta' })
  if (total > ST_MAX_PARTICIPANTS) ctx.addIssue({ code: 'custom', path: ['employeeIds'], message: `Maksimal ${ST_MAX_PARTICIPANTS} peserta per ST` })
}
const createInput = z.object(stFields).strict().superRefine(stRules)
const editInput = z.object({ ...stFields, reason: z.string().trim().min(3).max(500).optional() }).strict().superRefine(stRules)
const voidInput = z.object({ expectedRevision: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(500) }).strict()

/**
 * Konfirmasi kelengkapan ST berlaku untuk seluruh KPPU: ST baru atau koreksi ST dari kantor mana pun membuka kembali
 * setiap konfirmasi "lengkap"/"nihil" pada bulan terkait. Deklarasi pada sumber bulan itu sendiri dihapus (rekap sedang berubah).
 * Mengembalikan true bila ada konfirmasi yang dibuka kembali.
 */
export function reopenStCoverage(state: Workspace, host: SourceFile | undefined, period: string, label: { letterNo: string; office: string; actorName: string; verb: string }) {
  const bounds = monthBounds(period)
  let reopened = false
  if (host) host.coverageDeclarations = (host.coverageDeclarations ?? []).filter(declaration => declaration.end < bounds.start || declaration.start > bounds.end)
  for (const source of state.files) {
    if (source === host || source.kind !== 'surat-tugas' || source.active === false) continue
    let invalidated = false
    source.coverageDeclarations = (source.coverageDeclarations ?? []).flatMap(declaration => {
      if ((declaration.status !== 'nil' && declaration.status !== 'complete') || declaration.end < bounds.start || declaration.start > bounds.end) return [declaration]
      invalidated = true
      const overlapStart = declaration.start < bounds.start ? bounds.start : declaration.start
      const overlapEnd = declaration.end > bounds.end ? bounds.end : declaration.end
      const suffix = ` [${declaration.status === 'nil' ? 'Nihil' : 'Konfirmasi lengkap'} dibuka kembali setelah ${label.verb} ST ${label.letterNo} (${label.office}) oleh ${label.actorName}]`
      const invalidatedRange = { ...declaration, start: overlapStart, end: overlapEnd, status: 'partial' as const, basis: `${declaration.basis.slice(0, Math.max(0, 2000 - suffix.length))}${suffix}` }
      return [
        ...(declaration.start < overlapStart ? [{ ...declaration, end: addDays(overlapStart, -1) }] : []),
        invalidatedRange,
        ...(declaration.end > overlapEnd ? [{ ...declaration, start: addDays(overlapEnd, 1) }] : []),
      ]
    })
    if (invalidated) { source.revision = (source.revision ?? 0) + 1; reopened = true }
  }
  return reopened
}

const refreshStats = (file: SourceFile) => { file.stats = { rows: file.assignments.length, people: new Set(file.assignments.map(row => row.employeeId ?? row.nip ?? row.name)).size } }
function ensureFile(state: Workspace, office: string, period: string, at: string) {
  const id = manualStSourceId(office, period)
  let file = state.files.find(candidate => candidate.id === id)
  if (!file) {
    file = { id, fileName: `Rekap ST manual · ${office} · ${period}`, kind: 'surat-tugas', label: 'Rekap ST manual', office, importedAt: at, period: monthBounds(period), evidence: [], assignments: [], warnings: [], stats: { rows: 0, people: 0 }, revision: 1, active: true }
    state.files.push(file)
  }
  return file
}
const manualFiles = (state: Workspace) => state.files.filter(file => file.id.startsWith('manual-st:'))
const groupRows = (state: Workspace, groupId: string) => manualFiles(state).flatMap(file => file.assignments.filter(row => groupIdOf(file, row) === groupId).map(row => ({ file, row })))
const sameStText = (a: string | undefined, b: string | undefined) => normalizeStText(a ?? '') === normalizeStText(b ?? '')
const snapshot = (rows: { row: Assignment }[]) => {
  const dates = rows.map(item => item.row.start).sort(), first = rows[0]?.row
  const people = new Map(rows.map(({ row }) => [participantKey(row), { name: row.name, nip: row.nip, employeeId: row.employeeId, external: row.external || undefined, note: row.note }]))
  return { letterNo: first?.letterNo, letterDate: first?.letterDate, destination: first?.destination, catatan: first?.catatan ?? '', start: dates[0], end: dates.at(-1), rows: rows.length, participants: [...people.values()] }
}

export function registerRekapSt(app: Hono<{ Variables: { user: User; sessionHash: string } }>, { db, read, change }: Ctx) {
  const requireRole = (actor: User) => { if (!['superadmin', 'operator_st'].includes(actor.role)) throw new HTTPException(403) }
  const participantsOf = (state: Workspace, input: z.infer<typeof createInput>): Part[] => {
    const roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
    const parts: Part[] = []
    for (const id of new Set(input.employeeIds)) {
      const employee = roster.byId.get(id)
      // Peserta boleh pegawai master dari kantor mana pun; hanya kantor register yang dibatasi pada akun operator.
      if (!employee || !employee.sources.includes('Master pegawai')) throw new HTTPException(422, { message: 'Pegawai tidak ditemukan di master resmi. Perbarui master pegawai terlebih dahulu.' })
      parts.push({ key: `emp:${employee.id}`, employee })
    }
    const seen = new Set<string>()
    for (const item of input.externalParticipants) {
      const key = `ext:${normalizeStText(item.name)}`
      if (seen.has(key)) continue
      seen.add(key); parts.push({ key, external: { name: item.name, note: item.note || undefined } })
    }
    return parts
  }
  const makeRow = (part: Part, date: string, sourceId: string, o: Meta & { office: string; groupId: string; version: number; actor: User; at: string; ref: string }): Assignment => {
    const base = { id: randomUUID(), fileId: sourceId, groupId: o.groupId, version: o.version, createdBy: o.actor.id, createdAt: o.at, office: o.office, letterNo: o.letterNo, letterDate: o.letterDate, start: date, end: date, rawDate: date, destination: o.destination, local: isLocalDestination(o.office, o.destination), ref: o.ref, ...(o.catatan ? { catatan: o.catatan } : {}) }
    return part.employee
      ? { ...base, employeeId: part.employee.id, unit: part.employee.unit || undefined, name: part.employee.nama, nip: part.employee.nip || undefined }
      : { ...base, external: true, name: part.external!.name, ...(part.external!.note ? { note: part.external!.note } : {}) }
  }
  /** Baris aktif ST lain (grup berbeda) dengan nomor dan tujuan sama pada bulan itu: dipakai agar ST yang sama tidak tercatat ganda. */
  const duplicateIndex = (file: SourceFile | undefined, meta: Meta, ignoreGroupId?: string) => new Set((file?.assignments ?? [])
    .filter(row => sameStText(row.letterNo, meta.letterNo) && sameStText(row.destination, meta.destination) && sourceRecordState(file!, 'assignment', row.id) === 'active' && (!ignoreGroupId || groupIdOf(file!, row) !== ignoreGroupId))
    .map(row => `${participantKey(row)}|${row.start}`))

  app.get('/api/rekap-st/employees', async c => {
    const actor = c.get('user')
    requireRole(actor)
    const query = z.object({ office: z.enum(OFFICES).optional() }).parse({ office: c.req.query('office') || undefined })
    const state = (await read()).state
    const roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
    // Peserta ST boleh dari kantor mana pun, jadi seluruh master dikirim (hanya kolom identitas dasar). `office` hanya penyaring.
    const employees = roster.employees
      .filter(employee => employee.nama && employee.sources.includes('Master pegawai') && (!query.office || employee.kantor === query.office))
      .map(({ id, nama, nip, kantor, unit, jabatan }) => ({ id, nama, nip, kantor, unit, jabatan }))
      .sort((a, b) => a.nama.localeCompare(b.nama, 'id'))
    return c.json({ employees })
  })

  app.get('/api/rekap-st', async c => {
    const actor = c.get('user')
    const input = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), office: z.enum(OFFICES).optional() }).parse({ period: c.req.query('period'), office: c.req.query('office') || undefined })
    const office = actor.role === 'operator_st' ? actor.offices?.[0] : input.office
    if (office) requireOffice(actor, office)
    const w = await read()
    // Operator hanya melihat register kantornya (peserta lintas kantor tetap tampil karena register yang dipakai sebagai batas).
    const files = w.state.files.filter(file => file.kind === 'surat-tugas' && file.id.startsWith('manual-st:') && file.period?.start.slice(0, 7) === input.period && (!office || file.office === office) && (actor.role !== 'operator_st' || file.office === actor.offices?.[0]))
    const creatorIds = [...new Set(files.flatMap(file => file.assignments.map(row => row.createdBy).filter((id): id is string => !!id)))]
    const creators = creatorIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, creatorIds)) : []
    const creatorNames = new Map(creators.map(user => [user.id, user.name]))
    const records = files.flatMap(file => file.assignments.map(row => publicStRecord(file, row, creatorNames.get(row.createdBy ?? ''))))
      .sort((a, b) => b.activityDate.localeCompare(a.activityDate) || a.name.localeCompare(b.name, 'id'))
    const groupIds = [...new Set(records.map(record => record.groupId))]
    const attachments = await attachmentsFor(groupIds)
    return c.json({ revision: w.revision, records, attachments, sourceIds: files.map(file => ({ office: file.office, id: file.id, coverage: file.coverageDeclarations ?? [] })) })
  })

  const attachmentsFor = async (groupIds: string[]): Promise<StAttachmentMeta[]> => {
    if (!groupIds.length) return []
    const rows = await db.select({ id: stAttachments.id, groupId: stAttachments.groupId, fileName: stAttachments.fileName, mime: stAttachments.mime, size: stAttachments.size, createdAt: stAttachments.createdAt, uploadedBy: users.name })
      .from(stAttachments).innerJoin(users, eq(users.id, stAttachments.uploadedBy)).where(and(inArray(stAttachments.groupId, groupIds), isNull(stAttachments.deletedAt))).orderBy(asc(stAttachments.createdAt))
    return rows.map(item => ({ ...item, createdAt: item.createdAt.toISOString() }))
  }
  // Seluruh baris satu ST (semua bulan, termasuk yang dibatalkan): dipakai formulir koreksi agar ST lintas bulan tidak terpotong.
  app.get('/api/rekap-st/groups/:groupId', async c => {
    const actor = c.get('user')
    const groupId = c.req.param('groupId'), w = await read(), rows = groupRows(w.state, groupId)
    if (!rows.length) throw new HTTPException(404, { message: 'ST tidak ditemukan' })
    for (const { file } of rows) requireOffice(actor, file.office)
    const records = rows.map(({ file, row }) => publicStRecord(file, row)).sort((a, b) => a.activityDate.localeCompare(b.activityDate) || a.name.localeCompare(b.name, 'id'))
    return c.json({ revision: w.revision, records, attachments: await attachmentsFor([groupId]) })
  })

  app.post('/api/rekap-st', async c => {
    const actor = c.get('user')
    requireRole(actor)
    const input = createInput.parse(await c.req.json())
    const office = actor.role === 'operator_st' ? actor.offices?.[0] : input.registerOffice
    if (!office || !OFFICES.includes(office)) throw new HTTPException(400, { message: 'Pilih kantor register ST' })
    requireOffice(actor, office)
    const dates = eachDay(input.startDate, input.endDate), groupId = randomUUID(), at = new Date().toISOString()
    const meta: Meta = { letterNo: input.letterNo, letterDate: input.letterDate, destination: input.destination, catatan: input.catatan || undefined }
    const createdIds: { sourceId: string; id: string }[] = []
    let skipped = 0, parts: Part[] = []
    const result = await change(input.expectedRevision, actor, 'rekap-st.create', `Tambah ST ${input.letterNo} untuk ${new Set(input.employeeIds).size + input.externalParticipants.length} peserta, ${input.startDate} s.d. ${input.endDate}`, state => {
      parts = participantsOf(state, input)
      for (const period of new Set(dates.map(date => date.slice(0, 7)))) {
        const sourceId = manualStSourceId(office, period)
        const existing = duplicateIndex(state.files.find(candidate => candidate.id === sourceId), meta)
        const rows: Assignment[] = []
        for (const date of dates.filter(day => day.startsWith(period))) for (const part of parts) {
          if (existing.has(`${part.key}|${date}`)) { skipped++; continue }
          rows.push(makeRow(part, date, sourceId, { ...meta, office, groupId, version: 1, actor, at, ref: `Input Rekap ST · ${actor.name}` }))
        }
        if (!rows.length) continue
        const file = ensureFile(state, office, period, at)
        reopenStCoverage(state, file, period, { letterNo: input.letterNo, office, actorName: actor.name, verb: 'input' })
        file.assignments.push(...rows)
        createdIds.push(...rows.map(row => ({ sourceId, id: row.id })))
        refreshStats(file); file.revision = (file.revision ?? 0) + 1
      }
      if (!createdIds.length) throw new HTTPException(409, { message: 'Rekap ST yang sama sudah tercatat untuk seluruh peserta dan tanggal ini' })
      return state
    }, {})
    const records = createdIds.flatMap(({ sourceId, id }) => {
      const file = result.state.files.find(candidate => candidate.id === sourceId), row = file?.assignments.find(item => item.id === id)
      return file && row ? [publicStRecord(file, row, actor.name)] : []
    })
    if (records.length !== createdIds.length) throw new HTTPException(500, { message: 'Rekap tersimpan tetapi tidak dapat dibaca ulang' })
    return c.json({ created: records.length, skipped, groupId, records, revision: result.revision }, 201)
  })

  // Koreksi ST: baris diperbarui di tempat (ID baris yang tidak berubah dipertahankan) dan jejak audit memuat sebelum/sesudah.
  app.put('/api/rekap-st/groups/:groupId', async c => {
    const actor = c.get('user')
    requireRole(actor)
    const groupId = c.req.param('groupId')
    const input = editInput.parse(await c.req.json())
    const dates = eachDay(input.startDate, input.endDate), at = new Date().toISOString()
    const meta: Meta = { letterNo: input.letterNo, letterDate: input.letterDate, destination: input.destination, catatan: input.catatan || undefined }
    const audit: Record<string, unknown> = {}
    let created = 0, removed = 0, kept = 0, office = '', unchanged = false
    const touchedFiles = new Set<SourceFile>()
    const pre = await read()
    if (pre.revision === input.expectedRevision) {
      // Tanpa perubahan apa pun: jangan menaikkan revisi atau membuka konfirmasi.
      const current = groupRows(pre.state, groupId).filter(({ file, row }) => sourceRecordState(file, 'assignment', row.id) === 'active')
      if (current.length) {
        const parts = participantsOf(pre.state, input), desired = new Set(parts.flatMap(part => dates.map(date => `${part.key}|${date}`)))
        const present = new Set(current.map(({ row }) => `${participantKey(row)}|${row.start}`))
        const first = current[0].row
        const sameNotes = current.every(({ row }) => (row.note ?? '') === (parts.find(part => part.key === participantKey(row))?.external?.note ?? ''))
        unchanged = desired.size === present.size && [...desired].every(key => present.has(key)) && first.letterNo === meta.letterNo && first.letterDate === meta.letterDate && first.destination === meta.destination && (first.catatan ?? '') === (meta.catatan ?? '') && sameNotes
      }
    }
    if (unchanged) return c.json({ unchanged: true, created: 0, removed: 0, kept: 0, groupId, revision: pre.revision })
    const result = await change(input.expectedRevision, actor, 'rekap-st.edit', `Koreksi ST ${input.letterNo}: ${input.reason ?? 'perubahan data ST'}`, state => {
      const all = groupRows(state, groupId)
      if (!all.length) throw new HTTPException(404, { message: 'ST tidak ditemukan' })
      office = all[0].file.office
      requireOffice(actor, office)
      if (input.registerOffice && input.registerOffice !== office) throw new HTTPException(400, { message: 'Kantor register ST tidak dapat diubah. Batalkan ST ini lalu buat ST baru bila register salah.' })
      const active = all.filter(({ file, row }) => sourceRecordState(file, 'assignment', row.id) === 'active')
      if (!active.length) throw new HTTPException(409, { message: 'ST ini sudah dibatalkan dan tidak dapat diubah' })
      const parts = participantsOf(state, input), partByKey = new Map(parts.map(part => [part.key, part]))
      const before = snapshot(active), version = Math.max(...active.map(({ row }) => row.version ?? 1)) + 1
      const desired = new Set(parts.flatMap(part => dates.map(date => `${part.key}|${date}`)))
      const byKey = new Map(active.map(item => [`${participantKey(item.row)}|${item.row.start}`, item]))
      const calcBefore = { n: before.letterNo, d: before.letterDate, t: before.destination, p: [...new Set(active.map(({ row }) => participantKey(row)))].sort(), dates: [...new Set(active.map(({ row }) => row.start))].sort() }
      const calcAfter = { n: meta.letterNo, d: meta.letterDate, t: meta.destination, p: [...partByKey.keys()].sort(), dates: [...dates].sort() }
      const calcChanged = JSON.stringify(calcBefore) !== JSON.stringify(calcAfter) || JSON.stringify(calcBefore.p) !== JSON.stringify(calcAfter.p)
      // Duplikat dengan ST lain bernomor dan bertujuan sama ditolak: koreksi tidak boleh membuat register ganda.
      for (const period of new Set(dates.map(date => date.slice(0, 7)))) {
        const other = duplicateIndex(state.files.find(candidate => candidate.id === manualStSourceId(office, period)), meta, groupId)
        for (const date of dates.filter(day => day.startsWith(period))) for (const part of parts) if (other.has(`${part.key}|${date}`)) throw new HTTPException(409, { message: 'Perubahan ini menggandakan ST lain dengan nomor dan tujuan yang sama' })
      }
      const affectedMonths = new Set<string>(calcChanged ? [...active.map(({ row }) => row.start.slice(0, 7)), ...dates.map(date => date.slice(0, 7))] : [])
      // Hapus baris yang tidak lagi termasuk (beserta keputusan review yang menunjuknya).
      for (const [key, { file, row }] of byKey) if (!desired.has(key)) {
        file.assignments = file.assignments.filter(item => item.id !== row.id)
        file.recordReviews = file.recordReviews?.filter(review => !(review.kind === 'assignment' && review.recordId === row.id))
        refreshStats(file); touchedFiles.add(file); removed++
      }
      // Perbarui baris yang tetap dan tambah baris baru.
      for (const period of new Set(dates.map(date => date.slice(0, 7)))) for (const date of dates.filter(day => day.startsWith(period))) for (const part of parts) {
        const existing = byKey.get(`${part.key}|${date}`)
        if (existing) {
          const { row, file } = existing
          Object.assign(row, { letterNo: meta.letterNo, letterDate: meta.letterDate, destination: meta.destination, local: isLocalDestination(office, meta.destination), version, note: part.external?.note || undefined })
          if (meta.catatan) row.catatan = meta.catatan; else delete row.catatan
          if (!row.note) delete row.note
          touchedFiles.add(file); kept++
          continue
        }
        const file = ensureFile(state, office, period, at)
        file.assignments.push(makeRow(part, date, file.id, { ...meta, office, groupId, version, actor, at, ref: `Koreksi Rekap ST · ${actor.name}` }))
        refreshStats(file); touchedFiles.add(file); created++
      }
      for (const file of touchedFiles) file.revision = (file.revision ?? 0) + 1
      const reopened: string[] = []
      for (const period of [...affectedMonths].sort()) if (reopenStCoverage(state, state.files.find(file => file.id === manualStSourceId(office, period)), period, { letterNo: meta.letterNo, office, actorName: actor.name, verb: 'koreksi' })) reopened.push(period)
      const after = snapshot(groupRows(state, groupId).filter(({ file, row }) => sourceRecordState(file, 'assignment', row.id) === 'active'))
      Object.assign(audit, { stEdit: { groupId, office, version, calcChanged, reopenedMonths: reopened, added: created, removed, kept, before, after } })
      return state
    }, audit)
    const records = groupRows(result.state, groupId).filter(({ file, row }) => sourceRecordState(file, 'assignment', row.id) === 'active').map(({ file, row }) => publicStRecord(file, row))
    return c.json({ unchanged: false, created, removed, kept, groupId, records, revision: result.revision })
  })

  const voidRows = (actor: User, reason: string, pick: (state: Workspace) => { file: SourceFile; row: Assignment }[]) => (state: Workspace) => {
    const targets = pick(state)
    if (!targets.length) throw new HTTPException(404)
    for (const { file } of targets) requireOffice(actor, file.office)
    const active = targets.filter(({ file, row }) => sourceRecordState(file, 'assignment', row.id) === 'active')
    if (!active.length) throw new HTTPException(409, { message: 'Catatan ini sudah dibatalkan' })
    const at = new Date().toISOString(), touched = new Set<SourceFile>()
    for (const { file, row } of active) {
      file.recordReviews = [...file.recordReviews ?? [], { id: randomUUID(), kind: 'assignment', recordId: row.id, disposition: 'excluded', reason, actorId: actor.id, reviewer: actor.name, at }]
      touched.add(file)
    }
    for (const file of touched) { file.revision = (file.revision ?? 1) + 1; refreshStats(file) }
    return state
  }
  // Batalkan satu baris peserta-tanggal.
  app.post('/api/rekap-st/:id/void', async c => {
    const actor = c.get('user'); requireRole(actor)
    const input = voidInput.parse(await c.req.json()), id = c.req.param('id')
    return c.json(await change(input.expectedRevision, actor, 'rekap-st.void', input.reason, voidRows(actor, input.reason, state => manualFiles(state).flatMap(file => file.assignments.filter(row => row.id === id).map(row => ({ file, row }))))))
  })
  // Batalkan seluruh ST (semua baris aktif dalam grup).
  app.post('/api/rekap-st/groups/:groupId/void', async c => {
    const actor = c.get('user'); requireRole(actor)
    const input = voidInput.parse(await c.req.json()), groupId = c.req.param('groupId')
    return c.json(await change(input.expectedRevision, actor, 'rekap-st.void-group', input.reason, voidRows(actor, input.reason, state => groupRows(state, groupId))))
  })

  // ===== Lampiran scan ST =====
  const attachmentLimit = bodyLimit({ maxSize: ST_MAX_ATTACHMENT_BYTES + 256 * 1024, onError: c => c.json({ error: 'File melebihi 10 MB' }, 413) })
  app.post('/api/rekap-st/groups/:groupId/attachments', attachmentLimit, async c => {
    const actor = c.get('user'); requireRole(actor)
    const groupId = c.req.param('groupId')
    const w = await read()
    const rows = groupRows(w.state, groupId)
    if (!rows.length) throw new HTTPException(404, { message: 'ST tidak ditemukan' })
    const office = rows[0].file.office
    requireOffice(actor, office)
    if (!rows.some(({ file, row }) => sourceRecordState(file, 'assignment', row.id) === 'active')) throw new HTTPException(409, { message: 'ST ini sudah dibatalkan; lampiran tidak dapat ditambah' })
    let form: Record<string, unknown>
    try { form = await c.req.parseBody() } catch { throw new HTTPException(400, { message: 'Permintaan unggah tidak valid' }) }
    const file = form.file
    if (!(file instanceof File)) throw new HTTPException(400, { message: 'Pilih file lampiran' })
    if (file.size === 0) throw new HTTPException(400, { message: 'File kosong' })
    if (file.size > ST_MAX_ATTACHMENT_BYTES) throw new HTTPException(413, { message: 'File melebihi 10 MB' })
    const bytes = Buffer.from(await file.arrayBuffer())
    const kind = detectAttachmentType(bytes)
    const fileName = safeAttachmentName(file.name)
    const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : ''
    if (!kind || !kind.extensions.includes(extension)) throw new HTTPException(415, { message: 'Hanya file PDF, JPG, atau PNG yang isinya sesuai dengan ekstensinya yang dapat dilampirkan' })
    const sha256 = createHash('sha256').update(bytes).digest('hex'), id = randomUUID()
    const meta = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`st-attachments:${groupId}`}))`)
      const current = await tx.select({ sha256: stAttachments.sha256 }).from(stAttachments).where(and(eq(stAttachments.groupId, groupId), isNull(stAttachments.deletedAt)))
      if (current.length >= ST_MAX_ATTACHMENTS) throw new HTTPException(409, { message: `Maksimal ${ST_MAX_ATTACHMENTS} lampiran per ST` })
      if (current.some(item => item.sha256 === sha256)) throw new HTTPException(409, { message: 'File yang sama sudah dilampirkan pada ST ini' })
      const [row] = await tx.insert(stAttachments).values({ id, groupId, registerOffice: office, fileName, mime: kind.mime, size: bytes.length, sha256, content: bytes, uploadedBy: actor.id }).returning({ createdAt: stAttachments.createdAt })
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'rekap-st.attachment-add', revision: w.revision, reason: `Lampiran scan ST ${rows[0].row.letterNo ?? ''}: ${fileName}`, details: { attachmentId: id, groupId, office, fileName, mime: kind.mime, size: bytes.length, sha256 } })
      return { id, groupId, fileName, mime: kind.mime, size: bytes.length, createdAt: row.createdAt.toISOString(), uploadedBy: actor.name } satisfies StAttachmentMeta
    })
    return c.json({ attachment: meta }, 201)
  })
  const loadAttachment = async (actor: User, id: string) => {
    const [row] = await db.select().from(stAttachments).where(and(eq(stAttachments.id, id), isNull(stAttachments.deletedAt)))
    if (!row) throw new HTTPException(404, { message: 'Lampiran tidak ditemukan' })
    requireOffice(actor, row.registerOffice)
    return row
  }
  app.get('/api/rekap-st/attachments/:id/file', async c => {
    const actor = c.get('user')
    if (!['superadmin', 'admin', 'operator_st'].includes(actor.role)) throw new HTTPException(403)
    const row = await loadAttachment(actor, c.req.param('id'))
    // Hanya tiga jenis yang lolos validasi byte awal yang pernah tersimpan; tampil di tab hanya bila diminta eksplisit.
    const inline = c.req.query('inline') === '1'
    c.header('Content-Type', row.mime)
    c.header('Content-Disposition', attachmentDisposition(row.fileName, inline))
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Content-Length', String(row.content.length))
    return c.body(new Uint8Array(row.content))
  })
  app.delete('/api/rekap-st/attachments/:id', async c => {
    const actor = c.get('user'); requireRole(actor)
    const row = await loadAttachment(actor, c.req.param('id'))
    const w = await read()
    await db.transaction(async tx => {
      await tx.update(stAttachments).set({ deletedAt: new Date(), deletedBy: actor.id }).where(eq(stAttachments.id, row.id))
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'rekap-st.attachment-remove', revision: w.revision, reason: `Lampiran scan ST dihapus: ${row.fileName}`, details: { attachmentId: row.id, groupId: row.groupId, office: row.registerOffice, fileName: row.fileName, sha256: row.sha256 } })
    })
    return c.json({ ok: true })
  })
}
