import { createHash, randomUUID } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Assignment, Evidence, SourceFile } from '../src/engine/types.ts'
import { effectiveSource, sourceRecordState } from '../src/engine/recordReviews.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { createCoverageLookup } from '../src/engine/monthlyFlow.ts'
import { eachDay, monthBounds } from '../src/engine/dates.ts'
import { groupAssignments, type ImportChange, type ImportCounts, type ImportDaySummary, type ImportImpactResponse, type ImportReviewImpact, type ImportValue } from '../shared/imports.ts'
import type { User, Workspace } from '../shared/workspace.ts'
import { globalAccess, requireOffice, scopeWorkspace, sourceAllowed } from './scope.ts'
import { OFFICES, officeFromText, officeFromUnit } from '../src/engine/ids.ts'

const text = z.string().max(2000)
const targetSchema = z.object({ sourceId: z.uuid(), registerKey: z.string().min(1).max(1000) }).strict()
const selectionSchema = z.object({ incomingKey: z.string().min(1).max(1000), targets: z.array(targetSchema).max(200) }).strict()
const importBaseSchema = z.object({
  uploadId: z.uuid(), expectedRevision: z.number().int().nonnegative(), office: text.trim().min(1),
  resolveUnmappedOffice: z.boolean().optional(),
  mode: z.enum(['add', 'replace-file', 'replace-registers']), replaces: z.uuid().optional(),
  completeThrough: z.iso.date().optional(),
  /** Setoran mingguan: hanya baris dengan tanggal kejadian di rentang ini yang dipakai; ST dipakai bila beririsan. */
  range: z.object({ start: z.iso.date(), end: z.iso.date() }).strict().refine(value => value.start <= value.end, 'Rentang pekan terbalik').optional(),
  coverage: z.object({ start: z.iso.date(), end: z.iso.date(), status: z.enum(['complete', 'partial']), basis: text.trim().min(10) }).strict().refine(value => value.start <= value.end, 'Rentang cakupan tanggal terbalik').optional(),
  completeSnapshot: z.boolean().optional(), selections: z.array(selectionSchema).max(1000).optional(),
  reason: text.trim().optional(), offset: z.number().int().min(0).max(100000).optional().default(0), limit: z.number().int().min(10).max(100).optional().default(50),
}).strict()
const validateImportIntent = (v: { mode: string; replaces?: string; selections?: { targets: unknown[] }[]; completeSnapshot?: boolean; coverage?: { status: string } }, ctx: z.RefinementCtx) => {
  if (v.mode === 'replace-file' && !v.replaces) ctx.addIssue({ code: 'custom', path: ['replaces'], message: 'Pilih dataset yang akan diganti' })
  if (v.mode !== 'replace-file' && v.replaces) ctx.addIssue({ code: 'custom', path: ['replaces'], message: 'Target dataset hanya berlaku untuk penggantian penuh' })
  if (v.mode === 'replace-registers' && !v.selections?.length) ctx.addIssue({ code: 'custom', path: ['selections'], message: 'Pilih minimal satu register dari workbook baru' })
  if (v.mode !== 'replace-registers' && v.selections?.length) ctx.addIssue({ code: 'custom', path: ['selections'], message: 'Pilihan register hanya berlaku untuk impor sebagian register' })
  if ((v.mode === 'replace-file' || v.selections?.some(s => s.targets.length)) && !v.completeSnapshot) ctx.addIssue({ code: 'custom', path: ['completeSnapshot'], message: 'Konfirmasi bahwa scope penggantian adalah snapshot lengkap' })
  if (v.mode === 'replace-registers' && v.selections?.some(s => s.targets.length) && v.coverage?.status !== 'complete') ctx.addIssue({ code: 'custom', path: ['coverage'], message: 'Penggantian register memerlukan deklarasi cakupan lengkap untuk rentang yang dipilih' })
}
export function mapImportOffices(rows: SourceFile['evidence'], master: Workspace['master']): SourceFile['evidence'] {
  return rows.map(row => {
    if (row.officeConflict) throw new HTTPException(422, { message: 'Ada konflik mapping kantor. Perbaiki kantor atau unit pada sumber.' })
    const matches = master.filter(employee => (row.ids.nip && employee.nip === row.ids.nip) || (row.ids.nika && employee.nika === row.ids.nika))
    const masterOffices = [...new Set(matches.map(employee => employee.kantor).filter(office => OFFICES.includes(office)))]
    // Ekspor mesin offline berformat Pusat (NIK/Nama/Tanggal/Jam Kerja/…/Departemen) berasal dari mesin Kantor Pusat;
    // file Kanwil dikenali dari nama file/judul sehingga row.office sudah terisi sebelum sampai di sini.
    const office = OFFICES.includes(row.office) ? row.office : officeFromUnit(row.unit) ?? officeFromText(row.location ?? '') ?? (masterOffices.length === 1 ? masterOffices[0] : undefined) ?? (row.kind === 'mesin' ? 'Pusat' : undefined)
    return { ...row, office: office ?? 'Belum ditentukan', officePending: !office }
  })
}

/** Kantor peserta ST mengikuti master pegawai (via NIP); bila belum diketahui, kantor register (default Pusat). */
export function mapAssignmentOffices(rows: SourceFile['assignments'], master: Workspace['master'], fallback: string): SourceFile['assignments'] {
  return rows.map(row => {
    const matches = row.nip ? master.filter(employee => employee.nip === row.nip) : []
    const offices = [...new Set(matches.map(employee => employee.kantor).filter(office => OFFICES.includes(office)))]
    const office = offices.length === 1 ? offices[0] : OFFICES.includes(row.office) ? row.office : fallback
    return { ...row, office }
  })
}

/** Batasi setoran ke pekan terpilih tanpa mengubah tanggal asli; ST lintas pekan tetap utuh. */
export function limitToRange(file: SourceFile, range: { start: string; end: string }): SourceFile {
  const evidence = file.evidence.filter(row => row.date >= range.start && row.date <= range.end)
  const assignments = file.assignments.filter(row => row.start <= range.end && row.end >= range.start)
  const outside = file.evidence.length - evidence.length + file.assignments.length - assignments.length
  if (!outside) return file
  const dates = [...evidence.map(row => row.date), ...assignments.flatMap(row => [row.start, row.end])].sort()
  const people = new Set([...evidence.map(row => row.ids.nip ?? row.ids.nika ?? `${row.office}|${row.name}`), ...assignments.map(row => row.name.toLowerCase())])
  return {
    ...file, evidence, assignments,
    partialDates: file.partialDates?.filter(date => date >= range.start && date <= range.end),
    period: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
    stats: { rows: evidence.length + assignments.length, people: people.size },
    warnings: [`${outside} baris di luar pekan ${range.start} s.d. ${range.end} tidak dipakai pada setoran ini (file asli tetap diarsipkan).`, ...file.warnings],
  }
}

export const importIntentSchema = importBaseSchema.superRefine(validateImportIntent)
export const importCommitSchema = importBaseSchema.extend({
  reason: text.trim().min(10), confirmedImpact: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine(validateImportIntent)
export type ImportIntent = z.infer<typeof importIntentSchema>

type ChangeKind = ImportChange['kind']
type Counts = ImportCounts
type ReviewImpact = ImportReviewImpact
type DaySummary = ImportDaySummary
type Value = ImportValue
type ImportImpact = ImportImpactResponse

const emptyCounts = (): Counts => ({ added: 0, changed: 0, removed: 0, ambiguous: 0, duplicate: 0, unchanged: 0 })
const norm = (s: string | undefined) => (s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, ' ').trim()
const json = (v: unknown) => JSON.stringify(v)
const sha = (v: unknown) => createHash('sha256').update(json(v)).digest('hex')

function evidenceData(e: Evidence) {
  return { kind: e.kind, office: e.office, officePending: e.officePending ?? false, officeConflict: e.officeConflict ?? false, officeCandidates: e.officeCandidates ?? [], name: norm(e.name), identityPending: e.identityPending ?? false, ids: { nip: e.ids.nip ?? '', nika: e.ids.nika ?? '', mesin: e.ids.mesin ?? '', appId: e.ids.appId ?? '', nonAsn: e.ids.nonAsn ?? false }, date: e.date, schedule: e.schedule ?? null, clockIn: e.clockIn ?? '', clockOut: e.clockOut ?? '', present: e.present ?? null, incomplete: e.incomplete ?? null, code: e.code ?? '', codeLabel: norm(e.codeLabel), mode: e.mode ?? '', approved: e.approved ?? null, approvalStatus: e.approvalStatus ?? '', sourceDurationMin: e.sourceDurationMin ?? null, minimumDurationMin: e.minimumDurationMin ?? null, targetPekerjaan: e.targetPekerjaan ?? '', hasilPekerjaan: e.hasilPekerjaan ?? '', sourceValues: e.sourceValues ?? null, location: norm(e.location), coordIn: e.coordIn ?? null, coordOut: e.coordOut ?? null, lateMin: e.lateMin ?? null, earlyMin: e.earlyMin ?? null, overtimeMin: e.overtimeMin ?? null, unit: norm(e.unit), notes: [...(e.notes ?? [])].sort() }
}
function assignmentData(a: Assignment) {
  return { office: a.office, unit: norm(a.unit), letterNo: norm(a.letterNo), letterDate: a.letterDate ?? '', name: norm(a.name), nip: a.nip ?? '', start: a.start, end: a.end, destination: norm(a.destination), local: a.local }
}
type MasterRow = NonNullable<SourceFile['master']>[number]
function masterData(row: MasterRow) {
  const { id: _id, sources: _sources, derived: _derived, ...data } = row
  return Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]))
}
function evidenceIdentity(e: Evidence) { return `${e.office}|${e.date}|${e.ids.nip ? `nip:${e.ids.nip}` : e.ids.nika ? `nika:${e.ids.nika}` : e.ids.appId ? `app:${e.ids.appId}` : e.ids.mesin ? `mesin:${e.ids.mesin}` : `name:${norm(e.name)}`}` }
function assignmentIdentity(a: Assignment) { return a.nip ? `nip:${a.nip}` : `name:${norm(a.name)}` }
function masterIdentity(row: MasterRow) { return row.nip ? `nip:${row.nip}` : row.nika ? `nika:${row.nika}` : `name:${norm(row.nama)}|${norm(row.kantor)}` }

function relinkUniqueFacts<T extends { id: string }>(previous: T[], incoming: T[], canonical: (row: T) => unknown) {
  const group = (rows: T[]) => {
    const result = new Map<string, T[]>()
    for (const row of rows) { const key = json(canonical(row)), values = result.get(key) ?? []; values.push(row); result.set(key, values) }
    return result
  }
  const oldGroups = group(previous), newGroups = group(incoming), pairs: { previousId: string; incomingId: string }[] = []
  for (const [key, oldRows] of oldGroups) {
    const newRows = newGroups.get(key)
    if (oldRows.length !== 1 || newRows?.length !== 1) continue
    const incomingId = newRows[0].id
    newRows[0].id = oldRows[0].id
    pairs.push({ previousId: oldRows[0].id, incomingId })
  }
  return pairs
}

function carryRecordReviews(previous: SourceFile, incoming: SourceFile, kind: 'evidence' | 'assignment', pairs: { previousId: string; incomingId: string }[]) {
  if (!pairs.length || !previous.recordReviews?.length) return
  const previousIds = new Set(pairs.map(pair => pair.previousId))
  const carried = previous.recordReviews.filter(review => review.kind === kind && previousIds.has(review.recordId)).map(review => ({ ...review, id: randomUUID() }))
  if (carried.length) incoming.recordReviews = [...incoming.recordReviews ?? [], ...carried]
}

function withinRange(start: string, end: string, range: { start: string; end: string }) { return start >= range.start && end <= range.end }
function overlapsRange(start: string, end: string, range: { start: string; end: string }) { return start <= range.end && end >= range.start }
const valueForEvidence = (e: Evidence): Value => ({ name: e.name, office: e.office, start: e.date, end: e.date, detail: [e.clockIn && e.clockOut ? `${e.clockIn}–${e.clockOut}` : '', e.code ?? e.mode ?? '', e.approvalStatus, e.sourceDurationMin === undefined ? '' : `durasi sumber ${e.sourceDurationMin} mnt`].filter(Boolean).join(' · ') || 'Tanpa rincian jam/status', ref: e.ref })
const valueForAssignment = (a: Assignment): Value => ({ name: a.name, office: a.office, start: a.start, end: a.end, detail: [`ST ${a.letterNo ?? '(tanpa nomor)'}`, a.unit, a.destination].filter(Boolean).join(' · '), ref: a.ref })
const valueForMaster = (m: MasterRow): Value => ({ name: m.nama ?? '(tanpa nama)', office: m.kantor ?? '(kantor tidak terbaca)', start: '', end: '', detail: [m.nip ? `NIP ${m.nip}` : '', m.jabatan, m.unit].filter(Boolean).join(' · ') || 'Profil pegawai', ref: 'Sheet master' })

function diffRecords<T>(oldRows: T[], newRows: T[], keyOf: (r: T) => string, canonical: (r: T) => unknown, value: (r: T) => Value, kind: ChangeKind): { counts: Counts; changes: ImportChange[] } {
  const counts = emptyCounts(), changes: ImportChange[] = []
  const oldGroups = new Map<string, T[]>(), newGroups = new Map<string, T[]>()
  for (const row of oldRows) { const key = keyOf(row), group = oldGroups.get(key) ?? []; group.push(row); oldGroups.set(key, group) }
  for (const row of newRows) { const key = keyOf(row), group = newGroups.get(key) ?? []; group.push(row); newGroups.set(key, group) }
  const keys = [...new Set([...oldGroups.keys(), ...newGroups.keys()])].sort()
  for (const key of keys) {
    const oldRemaining = [...(oldGroups.get(key) ?? [])], newRemaining = [...(newGroups.get(key) ?? [])]
    for (let i = oldRemaining.length - 1; i >= 0; i--) {
      const signature = json(canonical(oldRemaining[i]))
      const match = newRemaining.findIndex(r => json(canonical(r)) === signature)
      if (match >= 0) { counts.unchanged++; oldRemaining.splice(i, 1); newRemaining.splice(match, 1) }
    }
    if (oldRemaining.length === 1 && newRemaining.length === 1) {
      const before = value(oldRemaining[0]), after = value(newRemaining[0])
      const left = canonical(oldRemaining[0]) as Record<string, unknown>, right = canonical(newRemaining[0]) as Record<string, unknown>
      const changedFields = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(k => json(left[k]) !== json(right[k]))
      counts.changed++; changes.push({ kind, status: 'changed', before, after, changedFields })
    } else if (oldRemaining.length && newRemaining.length) {
      counts.ambiguous += oldRemaining.length + newRemaining.length
      changes.push({ kind, status: 'ambiguous', before: value(oldRemaining[0]), after: value(newRemaining[0]), changedFields: [], countBefore: oldRemaining.length, countAfter: newRemaining.length })
    } else {
      for (const row of oldRemaining) { counts.removed++; changes.push({ kind, status: 'removed', before: value(row), changedFields: [] }) }
      for (const row of newRemaining) { counts.added++; changes.push({ kind, status: 'added', after: value(row), changedFields: [] }) }
    }
  }
  return { counts, changes }
}

function addCounts(target: Counts, source: Counts) { for (const key of Object.keys(target) as (keyof Counts)[]) target[key] += source[key] }
function uniqueIncoming<T extends { id: string }>(rows: T[], kind: ChangeKind, canonical: (row: T) => unknown, value: (row: T) => Value) {
  const seen = new Set<string>(), selected: T[] = [], duplicates: ImportChange[] = []
  for (const row of rows) {
    const signature = json(canonical(row))
    if (seen.has(signature)) duplicates.push({ kind, status: 'duplicate', after: value(row), changedFields: [] })
    else { seen.add(signature); selected.push(row) }
  }
  return { selected, duplicates }
}
function activeTargetGroups(state: Workspace, office: string, actor: User) {
  return state.files.filter(f => f.active !== false && f.kind === 'surat-tugas').flatMap(file => {
    if (!sourceAllowed(actor, file) && !file.assignments.some(a => a.office === office && actor.offices?.includes(a.office))) return []
    const scoped = effectiveSource(file).assignments.filter(a => a.office === office && (globalAccess(actor) || actor.offices?.includes(a.office)))
    return groupAssignments(scoped).map(group => ({ sourceId: file.id, fileName: file.fileName, importedAt: file.importedAt, revision: file.revision ?? 1, ...group }))
  })
}
function listDays(files: SourceFile[]) {
  const out = new Set<string>()
  for (const file of files) {
    for (const e of file.evidence) out.add(e.date)
    for (const a of file.assignments) {
      const days = eachDay(a.start, a.end)
      if (days.length <= 400) days.forEach(d => out.add(d))
    }
  }
  return out
}
function summarizeDay(day?: { status: string; meal: { state: string; amount: number; amountReady?: boolean }; clockIn?: string; clockOut?: string; issues: { id: string }[]; resolved: { issueId: string }[] }): DaySummary {
  return { status: day?.status ?? 'tidak-dalam-roster', mealState: day?.meal.state ?? 'excluded', amount: day?.meal.amount ?? 0, amountReady: day?.meal.amountReady ?? false, clockIn: day?.clockIn ?? '', clockOut: day?.clockOut ?? '', issues: day?.issues.filter(i => !day.resolved.some(r => r.issueId === i.id)).length ?? 0 }
}
function reviewImpact(before: Workspace, after: Workspace, actor: User, touched: Set<string>): ReviewImpact {
  const months = [...new Set([...touched].map(d => d.slice(0, 7)))].sort()
  if (!touched.size) return { computed: true, touchedDates: 0, changedDays: 0, newlyHeld: 0, changedAmounts: 0, issuesBefore: 0, issuesAfter: 0, examples: [] }
  if (touched.size > 5000 || months.length > 48) return { computed: false, touchedDates: touched.size, changedDays: 0, newlyHeld: 0, changedAmounts: 0, issuesBefore: 0, issuesAfter: 0, examples: [], note: 'Scope tanggal melebihi 5.000 hari atau 48 bulan; periksa periode terkait setelah impor.' }
  const oldScope = scopeWorkspace(before, actor), newScope = scopeWorkspace(after, actor)
  const oldRoster = buildRoster(oldScope.files, oldScope.master, oldScope.overrides, oldScope.decisions), newRoster = buildRoster(newScope.files, newScope.master, newScope.overrides, newScope.decisions)
  const examples: ReviewImpact['examples'] = []; let changedDays = 0, newlyHeld = 0, changedAmounts = 0, issuesBefore = 0, issuesAfter = 0
  const touchedSet = touched
  for (const month of months) {
    // Hanya tanggal tersentuh yang dibandingkan; rekonsiliasi cukup untuk rentang itu (setoran mingguan ≈ 1 pekan), bukan sebulan penuh.
    const bounds = monthBounds(month), inMonth = [...touchedSet].filter(d => d.startsWith(month)).sort()
    const period = { start: inMonth[0] ?? bounds.start, end: inMonth.at(-1) ?? bounds.end }
    const oldCalc = reconcile(oldScope.files, oldRoster, period, oldScope.policy, oldScope.resolutions, undefined, oldScope.dayReviews, createCoverageLookup(oldScope.files))
    const newCalc = reconcile(newScope.files, newRoster, period, newScope.policy, newScope.resolutions, undefined, newScope.dayReviews, createCoverageLookup(newScope.files))
    const oldMonths = new Map(oldCalc.months.map(m => [m.employee.id, m])), newMonths = new Map(newCalc.months.map(m => [m.employee.id, m]))
    const ids = new Set([...oldMonths.keys(), ...newMonths.keys()])
    for (const id of ids) {
      const oldMonth = oldMonths.get(id), newMonth = newMonths.get(id), oldDays = new Map((oldMonth?.days ?? []).map(d => [d.date, d])), newDays = new Map((newMonth?.days ?? []).map(d => [d.date, d]))
      const dates = new Set([...oldDays.keys(), ...newDays.keys()])
      for (const date of dates) {
        if (!touchedSet.has(date)) continue
        const oldDay = oldDays.get(date), newDay = newDays.get(date), prior = summarizeDay(oldDay), current = summarizeDay(newDay)
        issuesBefore += prior.issues; issuesAfter += current.issues
        if (json(prior) === json(current)) continue
        changedDays++
        if (current.mealState === 'held' && prior.mealState !== 'held') newlyHeld++
        if (prior.amount !== current.amount || prior.amountReady !== current.amountReady) changedAmounts++
        if (examples.length < 40) examples.push({ employeeId: id, name: newMonth?.employee.nama ?? oldMonth?.employee.nama ?? id, date, before: prior, after: current })
      }
    }
  }
  return { computed: true, touchedDates: touched.size, changedDays, newlyHeld, changedAmounts, issuesBefore, issuesAfter, examples }
}

export function previewImport(state: Workspace, revision: number, parsed: SourceFile, actor: User, rawIntent: ImportIntent): { next: Workspace; impact: ImportImpact } {
  const intent = importIntentSchema.parse(rawIntent)
  if (intent.expectedRevision !== revision) throw new HTTPException(409, { message: 'Data berubah; muat ulang lalu periksa preview impor kembali' })
  if (actor.role !== 'superadmin') throw new HTTPException(403, { message: 'Hanya Superadmin yang dapat mengimpor sumber' })
  requireOffice(actor, intent.office)
  if (parsed.id !== intent.uploadId) throw new HTTPException(400, { message: 'ID upload tidak sesuai' })
  const mixedOffices = intent.office === 'Semua kantor'
  if (mixedOffices && (!globalAccess(actor) || intent.mode !== 'add')) throw new HTTPException(403, { message: 'Setoran gabungan hanya tersedia untuk penambahan oleh akun seluruh kantor.' })
  const parsedRows = parsed.stats.rows
  if (intent.range) parsed = limitToRange(parsed, intent.range)
  if (intent.range && !parsed.evidence.length && !parsed.assignments.length) throw new HTTPException(422, { message: `Tidak ada baris dengan tanggal di pekan ${intent.range.start} s.d. ${intent.range.end}. Periksa pekan yang dipilih atau isi file.` })
  let incomingEvidence = mixedOffices ? mapImportOffices(parsed.evidence, state.master) : parsed.evidence
  if (parsed.kind === 'daring' && !mixedOffices) {
    const conflicts = incomingEvidence.filter(e => e.officePending && (e.officeConflict || (e.officeCandidates?.length ?? 0) > 1))
    if (conflicts.length) throw new HTTPException(422, { message: `${conflicts.length} baris memiliki konflik antara kantor eksplisit dan mapping Unit. Perbaiki data sumber atau mapping sebelum commit.` })
    const pendingOffice = incomingEvidence.filter(e => e.officePending)
    if (pendingOffice.length) {
      if (!intent.resolveUnmappedOffice) throw new HTTPException(422, { message: `${pendingOffice.length} baris belum terpetakan ke kantor. Konfirmasikan kantor hanya jika seluruh baris tersebut memang satu kantor.` })
      if (!OFFICES.includes(intent.office)) throw new HTTPException(422, { message: 'Pilih satu kantor yang sah untuk menyelesaikan baris tanpa mapping kantor.' })
      incomingEvidence = incomingEvidence.map(e => e.officePending ? { ...e, office: intent.office, officePending: false, officeCandidates: undefined } : e)
    }
  }
  const incomingFile: SourceFile = { ...parsed, office: mixedOffices ? 'Semua kantor' : parsed.kind === 'daring' ? parsed.office : intent.office, evidence: mixedOffices || parsed.kind === 'daring' ? incomingEvidence : incomingEvidence.map(e => ({ ...e, office: intent.office })), assignments: mixedOffices ? mapAssignmentOffices(parsed.assignments, state.master, OFFICES.includes(parsed.office) ? parsed.office : 'Pusat') : parsed.assignments.map(a => ({ ...a, office: intent.office })) }
  if (intent.coverage && intent.coverage.end > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())) throw new HTTPException(422, { message: 'Cakupan hanya dapat dikonfirmasi sampai tanggal yang sudah berlangsung' })
  if (intent.mode !== 'replace-registers' && !sourceAllowed(actor, incomingFile)) throw new HTTPException(403, { message: 'Sumber berisi kantor di luar cakupan akun. Impor hanya dapat dilakukan untuk kantor yang diizinkan.' })
  const next = structuredClone(state), file = structuredClone(incomingFile)
  const changes: ImportChange[] = [], counts = emptyCounts(), replacedScopes: ImportImpact['replacedScopes'] = [], registerResults: NonNullable<ImportImpact['registers']> = []
  let selectedIds = file.assignments.map(a => a.id), selectedKeys: string[] = [], omittedMasterCount = 0
  const touchedFiles: SourceFile[] = []
  if (intent.mode === 'replace-file') {
    const old = next.files.find(f => f.id === intent.replaces && f.active !== false)
    if (!old) throw new HTTPException(409, { message: 'Dataset pengganti sudah berubah atau tidak aktif' })
    if (old.kind !== file.kind || old.office !== file.office) throw new HTTPException(400, { message: 'Jenis dan kantor dataset pengganti harus sama' })
    if (!sourceAllowed(actor, old)) throw new HTTPException(403)
    const oldActive = effectiveSource(old)
    const needsDateScope = !!old.period || !!file.period || !!old.coverageDeclarations?.length || oldActive.evidence.length > 0 || oldActive.assignments.length > 0 || file.evidence.length > 0 || file.assignments.length > 0
    if (needsDateScope) {
      const range = intent.coverage
      if (!range || range.status !== 'complete') throw new HTTPException(422, { message: 'Penggantian snapshot bertanggal memerlukan deklarasi cakupan lengkap untuk seluruh rentang dataset lama' })
      if (old.period && !withinRange(old.period.start, old.period.end, range)) throw new HTTPException(422, { message: `Rentang penggantian ${range.start}–${range.end} lebih kecil daripada dataset lama ${old.period.start}–${old.period.end}. Gunakan penambahan atau pilih snapshot pada minggu yang sama.` })
      if ((old.coverageDeclarations ?? []).some(declaration => !withinRange(declaration.start, declaration.end, range))) throw new HTTPException(422, { message: 'Dataset lama memiliki deklarasi cakupan di luar rentang penggantian. Ganti snapshot pada scope yang sama atau gunakan penambahan.' })
      if (oldActive.evidence.some(row => !withinRange(row.date, row.date, range)) || oldActive.assignments.some(row => !withinRange(row.start, row.end, range))) throw new HTTPException(422, { message: 'Dataset lama memiliki catatan aktif di luar rentang penggantian. Gunakan penambahan atau revisi penuh yang mencakup seluruh catatan.' })
      if (file.evidence.some(row => !withinRange(row.date, row.date, range)) || file.assignments.some(row => !withinRange(row.start, row.end, range))) throw new HTTPException(422, { message: 'Workbook baru memuat tanggal di luar cakupan yang dinyatakan. Periksa rentang atau unggah snapshot lengkap yang sesuai.' })
    }
    const uniqueEvidence = uniqueIncoming(file.evidence, 'presensi', evidenceData, valueForEvidence)
    const uniqueAssignments = uniqueIncoming(file.assignments, 'surat-tugas', assignmentData, valueForAssignment)
    const linkableEvidence = old.evidence.filter(row => ['active', 'excluded'].includes(sourceRecordState(old, 'evidence', row.id)))
    const linkableAssignments = old.assignments.filter(row => ['active', 'excluded'].includes(sourceRecordState(old, 'assignment', row.id)))
    const evidencePairs = relinkUniqueFacts(linkableEvidence, uniqueEvidence.selected, evidenceData)
    const assignmentPairs = relinkUniqueFacts(linkableAssignments, uniqueAssignments.selected, assignmentData)
    carryRecordReviews(old, file, 'evidence', evidencePairs)
    carryRecordReviews(old, file, 'assignment', assignmentPairs)
    if (uniqueEvidence.selected.length < file.evidence.length) file.evidenceImport = { selectedIds: uniqueEvidence.selected.map(e => e.id) }
    if (uniqueAssignments.selected.length < file.assignments.length) file.assignmentImport = { selectedIds: uniqueAssignments.selected.map(a => a.id) }
    const newActive = effectiveSource(file)
    for (const group of [
      diffRecords(oldActive.evidence, newActive.evidence, evidenceIdentity, evidenceData, valueForEvidence, 'presensi'),
      diffRecords(oldActive.assignments, newActive.assignments, assignmentIdentity, assignmentData, valueForAssignment, 'surat-tugas'),
      diffRecords(oldActive.master ?? [], newActive.master ?? [], masterIdentity, masterData, valueForMaster, 'master'),
    ]) { addCounts(counts, group.counts); changes.push(...group.changes) }
    counts.duplicate += uniqueEvidence.duplicates.length + uniqueAssignments.duplicates.length
    changes.push(...uniqueEvidence.duplicates, ...uniqueAssignments.duplicates)
    const oldRevision = old.revision ?? 1
    const target = next.files.find(f => f.id === old.id)!
    target.active = false
    target.revision = oldRevision + 1
    file.supersedes = old.id
    file.revision = oldRevision + 1
    touchedFiles.push(oldActive, newActive)
    replacedScopes.push({ sourceId: old.id, registerKey: '*', label: `Seluruh dataset · ${old.fileName}`, rows: old.stats.rows })
  } else if (intent.mode === 'replace-registers') {
    if (file.kind !== 'surat-tugas' || !file.assignments.length) throw new HTTPException(400, { message: 'Pilih register hanya tersedia untuk workbook surat tugas yang memiliki penugasan' })
    const incomingGroups = new Map(groupAssignments(file.assignments).map(g => [g.key, g]))
    const existingGroups = activeTargetGroups(state, intent.office, actor)
    const selections = intent.selections ?? []
    if (new Set(selections.map(s => s.incomingKey)).size !== selections.length) throw new HTTPException(400, { message: 'Register baru dipilih lebih dari satu kali' })
    const targetTokens = new Set<string>(), selectedAssignments: Assignment[] = []
    for (const selection of selections) {
      const incoming = incomingGroups.get(selection.incomingKey)
      if (!incoming || incoming.office !== intent.office) throw new HTTPException(400, { message: 'Register baru tidak termasuk upload atau kantor yang dipilih' })
      for (const a of incoming.assignments) requireOffice(actor, a.office)
      const uniqueAssignments = uniqueIncoming(incoming.assignments, 'surat-tugas', assignmentData, valueForAssignment)
      if (selection.targets.length && (!intent.coverage || intent.coverage.status !== 'complete')) throw new HTTPException(422, { message: 'Pilih cakupan lengkap sebelum mengganti register lama' })
      if (selection.targets.length && uniqueAssignments.selected.some(a => !withinRange(a.start, a.end, intent.coverage!))) throw new HTTPException(422, { message: 'Register baru memuat ST di luar rentang penggantian. Perluas cakupan atau tambahkan register tanpa mengganti data lama.' })
      selectedAssignments.push(...uniqueAssignments.selected); selectedKeys.push(incoming.key)
      const registerCounts = emptyCounts()
      const oldAssignments: Assignment[] = []
      for (const target of selection.targets) {
        const token = `${target.sourceId}|${target.registerKey}`
        if (targetTokens.has(token)) throw new HTTPException(400, { message: 'Register lama dipilih lebih dari satu kali' })
        targetTokens.add(token)
        const group = existingGroups.find(g => g.sourceId === target.sourceId && g.key === target.registerKey)
        if (!group || group.office !== intent.office) throw new HTTPException(409, { message: 'Register lama sudah berubah, tidak aktif, atau di luar kantor akun' })
        group.assignments.forEach(a => requireOffice(actor, a.office))
        const range = intent.coverage!
        const overlapping = group.assignments.filter(a => overlapsRange(a.start, a.end, range))
        if (overlapping.some(a => !withinRange(a.start, a.end, range))) throw new HTTPException(422, { message: 'ST lama melintasi batas rentang penggantian. Unggah revisi seluruh rentang ST agar hari di luar scope tidak hilang.' })
        const scopedAssignments = overlapping.filter(a => withinRange(a.start, a.end, range))
        if (!scopedAssignments.length) throw new HTTPException(422, { message: 'Register lama yang dipilih tidak memiliki catatan di dalam rentang penggantian' })
        oldAssignments.push(...scopedAssignments)
        replacedScopes.push({ sourceId: group.sourceId, registerKey: group.key, label: `${group.label} · ${range.start}–${range.end} · ${group.fileName}`, rows: scopedAssignments.length })
      }
      const diff = diffRecords(oldAssignments, uniqueAssignments.selected, assignmentIdentity, assignmentData, valueForAssignment, 'surat-tugas')
      addCounts(registerCounts, diff.counts); addCounts(counts, diff.counts); changes.push(...diff.changes)
      registerCounts.duplicate += uniqueAssignments.duplicates.length; counts.duplicate += uniqueAssignments.duplicates.length; changes.push(...uniqueAssignments.duplicates)
      registerResults.push({ incomingKey: incoming.key, label: incoming.label, selectedRows: uniqueAssignments.selected.length, targetCount: selection.targets.length, counts: registerCounts })
      const scopedOldGroups = existingGroups.filter(g => selection.targets.some(t => t.sourceId === g.sourceId && t.registerKey === g.key)).map(g => ({ group: g, assignments: g.assignments.filter(a => overlapsRange(a.start, a.end, intent.coverage!) && withinRange(a.start, a.end, intent.coverage!)) }))
      touchedFiles.push({ ...file, evidence: [], assignments: uniqueAssignments.selected }, ...scopedOldGroups.map(({ group, assignments }) => ({ ...state.files.find(f => f.id === group.sourceId)!, evidence: [], assignments })))
    }
    selectedIds = selectedAssignments.map(a => a.id)
    file.master = undefined
    omittedMasterCount = parsed.master?.length ?? 0
    file.assignmentImport = { selectedIds, selectedRegisterKeys: selectedKeys, supersessions: [], omittedMasterCount: omittedMasterCount || undefined }
  } else {
    const oldRows = state.files.filter(f => f.active !== false && f.kind === file.kind && (mixedOffices || file.kind === 'daring' || f.office === intent.office)).map(effectiveSource)
    const activeEvidence = oldRows.flatMap(f => f.evidence)
    const activeAssignments = oldRows.flatMap(f => f.assignments)
    const existingEvidence = new Set(activeEvidence.map(e => json(evidenceData(e))))
    const existingAssignments = new Set(activeAssignments.map(a => json(assignmentData(a))))
    const existingMaster = new Set(oldRows.flatMap(f => (f.master ?? []).map(m => json(masterData(m)))))
    const selectedEvidenceIds: string[] = [], selectedAssignmentIds: string[] = []
    for (const e of file.evidence) {
      const signature = json(evidenceData(e))
      if (existingEvidence.has(signature)) { counts.duplicate++; changes.push({ kind: 'presensi', status: 'duplicate', after: valueForEvidence(e), changedFields: [] }) }
      else { counts.added++; changes.push({ kind: 'presensi', status: 'added', after: valueForEvidence(e), changedFields: [] }); existingEvidence.add(signature); selectedEvidenceIds.push(e.id) }
    }
    for (const a of file.assignments) {
      const signature = json(assignmentData(a))
      if (existingAssignments.has(signature)) { counts.duplicate++; changes.push({ kind: 'surat-tugas', status: 'duplicate', after: valueForAssignment(a), changedFields: [] }) }
      else { counts.added++; changes.push({ kind: 'surat-tugas', status: 'added', after: valueForAssignment(a), changedFields: [] }); existingAssignments.add(signature); selectedAssignmentIds.push(a.id) }
    }
    for (const m of file.master ?? []) {
      const signature = json(masterData(m))
      if (existingMaster.has(signature)) { counts.duplicate++; changes.push({ kind: 'master', status: 'duplicate', after: valueForMaster(m), changedFields: [] }) }
      else { counts.added++; changes.push({ kind: 'master', status: 'added', after: valueForMaster(m), changedFields: [] }); existingMaster.add(signature) }
    }
    if (selectedEvidenceIds.length < file.evidence.length) file.evidenceImport = { selectedIds: selectedEvidenceIds }
    if (selectedAssignmentIds.length < file.assignments.length) file.assignmentImport = { selectedIds: selectedAssignmentIds }
    selectedIds = selectedAssignmentIds
    touchedFiles.push(effectiveSource(file))
  }
  if (file.assignments.length && !file.assignmentImport && selectedIds.length < file.assignments.length) file.assignmentImport = { selectedIds, selectedRegisterKeys: selectedKeys }
  const at = new Date().toISOString()
  const coverageDeclarations = intent.coverage ? [...(file.coverageDeclarations ?? []), { ...intent.coverage, actorId: actor.id, at }] : file.coverageDeclarations
  const selectedFile = { ...file, ...(intent.completeThrough ? { completeThrough: intent.completeThrough } : {}), ...(coverageDeclarations ? { coverageDeclarations } : {}), active: true, importCommit: undefined }
  const index = next.files.findIndex(f => f.id === selectedFile.id)
  if (index >= 0) next.files[index] = selectedFile; else next.files.push(selectedFile)
  if (intent.mode === 'replace-registers') {
    const selectionByTarget = new Map<string, { sourceId: string; registerKey: string; registerLabel: string; ids: Set<string> }>()
    for (const selection of intent.selections ?? []) {
      const incoming = groupAssignments(file.assignments).find(g => g.key === selection.incomingKey)!
      for (const target of selection.targets) {
        const oldGroup = activeTargetGroups(state, intent.office, actor).find(g => g.sourceId === target.sourceId && g.key === target.registerKey)!
        const key = `${target.sourceId}|${target.registerKey}`
        const entry = selectionByTarget.get(key) ?? { sourceId: target.sourceId, registerKey: target.registerKey, registerLabel: oldGroup.label, ids: new Set<string>() }
        oldGroup.assignments.filter(a => overlapsRange(a.start, a.end, intent.coverage!) && withinRange(a.start, a.end, intent.coverage!)).forEach(a => entry.ids.add(a.id)); selectionByTarget.set(key, entry)
        void incoming
      }
    }
    const at = new Date().toISOString()
    for (const entry of selectionByTarget.values()) {
      const old = next.files.find(f => f.id === entry.sourceId)!
      old.assignmentImport ??= { supersessions: [] }
      old.assignmentImport.supersessions ??= []
      old.assignmentImport.supersessions.push({ recordIds: [...entry.ids].sort(), bySourceId: file.id, registerKey: entry.registerKey, registerLabel: entry.registerLabel, reason: intent.reason ?? 'Register diganti melalui preview impor', actorId: actor.id, reviewer: actor.name, at })
      old.revision = (old.revision ?? 1) + 1
    }
  }
  const touched = listDays(touchedFiles)
  const review = reviewImpact(state, next, actor, touched)
  const allChanges = changes.sort((a, b) => `${a.kind}|${a.status}|${a.after?.start ?? a.before?.start ?? ''}|${a.after?.name ?? a.before?.name ?? ''}|${a.after?.ref ?? a.before?.ref ?? ''}`.localeCompare(`${b.kind}|${b.status}|${b.after?.start ?? b.before?.start ?? ''}|${b.after?.name ?? b.before?.name ?? ''}|${b.after?.ref ?? b.before?.ref ?? ''}`, 'id'))
  const confirmation = {
    actorId: actor.id, revision, uploadId: intent.uploadId, hash: parsed.hash, office: intent.office, mode: intent.mode, range: intent.range ?? null, replaces: intent.replaces ?? '', completeThrough: intent.completeThrough ?? '', coverage: intent.coverage ?? null, completeSnapshot: !!intent.completeSnapshot, reason: intent.reason?.trim() ?? '',
    selections: (intent.selections ?? []).map(s => ({ incomingKey: s.incomingKey, targets: [...s.targets].sort((a, b) => `${a.sourceId}|${a.registerKey}`.localeCompare(`${b.sourceId}|${b.registerKey}`)) })).sort((a, b) => a.incomingKey.localeCompare(b.incomingKey)),
    counts, allChanges, replacedScopes, review,
  }
  const checksum = sha(confirmation)
  const offset = intent.offset ?? 0, limit = intent.limit ?? 50
  const activeFile = effectiveSource(file)
  const selectedRows = intent.mode === 'replace-registers' ? selectedIds.length : activeFile.evidence.length + activeFile.assignments.length + (activeFile.master?.length ?? 0)
  return { next, impact: { checksum, revision, mode: intent.mode, source: { id: parsed.id, kind: parsed.kind, office: intent.office, parsedRows, selectedRows, omittedMasterCount }, counts, changes: allChanges.slice(offset, offset + limit), offset, limit, totalChanges: allChanges.length, hasMore: offset + limit < allChanges.length, registers: registerResults, replacedScopes, review } }
}

export function canRetryImport(file: SourceFile | undefined, actor: User, confirmedImpact: string) {
  return !!file?.importCommit && file.importCommit.actorId === actor.id && file.importCommit.confirmation === confirmedImpact
}
