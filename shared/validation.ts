import { z } from 'zod'
import { DEFAULT_POLICY, enforcePolicy } from '../src/engine/policy.ts'
import { emptyWorkspace, type Workspace } from './workspace.ts'

const text = z.string().max(2000)
const date = z.iso.date()
const identifierKey = z.string().min(1).max(200).refine(v => !v.includes('|') && !['__proto__', 'constructor', 'prototype'].includes(v), 'ID internal tidak valid')
const span = { start: date, end: date }
const range = <T extends z.ZodRawShape>(shape: T) => z.object({ ...span, ...shape }).refine(v => { const r = v as { start: string; end: string }; return r.start <= r.end }, 'Rentang tanggal terbalik')
const noOverlappingRanges = (label: string) => (rows: { start: string; end: string }[], ctx: z.RefinementCtx) => {
  const ordered = rows.map((row, index) => ({ ...row, index })).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
  let active: typeof ordered[number] | undefined
  for (const current of ordered) {
    if (active && current.start <= active.end) ctx.addIssue({ code: 'custom', path: [current.index, 'start'], message: `Rentang ${label} bertumpang tindih dengan periode lain` })
    if (!active || current.end > active.end) active = current
  }
}
const alias = z.object({ kind: z.enum(['nip', 'nika', 'mesin', 'app', 'nama']), value: text, source: text })
const workStatusPeriodsSchema = z.array(range({ kind: z.enum(['tugas-belajar', 'diperbantukan']), basis: text.min(1) })).max(1000).superRefine(noOverlappingRanges('status kerja'))
const rateHistorySchema = z.array(range({ rate: z.number().int().min(0).max(10000000), pph: z.number().min(0).max(100), basis: text.min(1) })).max(1000).superRefine(noOverlappingRanges('tarif efektif'))
export const employeeSchema = z.object({
  id: identifierKey, nama: text.min(1), nip: z.string().max(32), nika: z.string().max(64), kantor: text, unit: text,
  statusKepegawaian: z.enum(['PPPK', 'PNS', 'Non-ASN', 'Belum diketahui']), golongan: text, jabatan: text,
  tanggalLahir: text, jenisKelamin: z.enum(['Laki-laki', 'Perempuan', '']), tempatLahir: text,
  pendidikan: text, disiplinIlmu: text, pelatihan: z.array(text).max(500), tanggalMulaiKerja: text,
  alamat: text, kontakDarurat: text, namaKontakDarurat: text, statusPerkawinan: text,
  agama: z.enum(['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu', 'Lainnya', '']), nomorWhatsApp: text, email: text,
  statusPegawai: z.enum(['Aktif', 'Cuti', 'Tugas Belajar', 'Nonaktif']), aliases: z.array(alias), sources: z.array(text), derived: z.array(text),
  workStatusPeriods: workStatusPeriodsSchema.optional(),
  rateHistory: rateHistorySchema.optional(),
})
const group = z.enum(['I', 'II', 'III', 'IV'])
export const policySchema = z.object({
  parametersApproved: z.boolean().optional(), arrivalBoundary: z.enum(['exclusive', 'inclusive']).optional(), requireComplete: z.boolean(), requireOnTime: z.boolean(), lateToleranceMin: z.number().min(0).max(120),
  requireNoEarlyLeave: z.boolean(), countWfa: z.boolean(), countLocalDuty: z.boolean(), holdOnIssues: z.boolean(), includeNonAsn: z.boolean(),
  rates: z.record(group, z.number().int().min(0).max(10000000)), pph: z.record(group, z.number().min(0).max(100)),
  defaultGroup: group, holidays: z.array(date).max(1000), ramadan: range({}), wfoRadiusKm: z.number().positive().max(100),
})
export const resolutionSchema = z.object({ issueId: text, decision: z.enum(['akui-hadir', 'akui-dinas', 'tidak-hadir', 'valid']), note: text, reviewer: text, at: z.iso.datetime(), signature: z.string().max(200000).optional() })
const decisionSchema = z.object({ key: text, employeeId: text.nullable(), reviewer: text, at: z.iso.datetime() })
export const workspaceEditSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  patch: z.object({ master: z.array(employeeSchema).max(10000).optional(), overrides: z.record(identifierKey, employeeSchema.partial()).optional(), decisions: z.array(decisionSchema).optional(), resolutions: z.array(resolutionSchema).optional(), policy: policySchema.optional(), period: z.string().regex(/^$|^\d{4}-(0[1-9]|1[0-2])$/).optional() }).strict(),
  reason: text.min(3),
}).strict()
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
const evidenceSchema = z.object({
  id: text, fileId: text, kind: z.enum(['mesin', 'daring', 'matriks-kanwil', 'jadwal-kanwil', 'laporan-kanwil', 'surat-tugas']), office: text, name: text,
  ids: z.object({ nip: text.optional(), nika: text.optional(), mesin: text.optional(), appId: text.optional(), nonAsn: z.boolean().optional() }), date,
  clockIn: time.optional(), clockOut: time.optional(), ref: text,
  schedule: z.object({ start: time, end: time, label: text }).optional(), identityPending: z.boolean().optional(),
  present: z.boolean().optional(), incomplete: z.boolean().optional(), approved: z.boolean().optional(),
  mode: z.enum(['WFO', 'WFA']).optional(), code: z.enum(['PD', 'DL', 'WFA', 'S', 'C', 'CB', 'I', 'DIKLAT', 'KO', 'X', 'ERR', 'T']).optional(),
  codeLabel: text.optional(), location: text.optional(), coordIn: z.tuple([z.number(), z.number()]).optional(), coordOut: z.tuple([z.number(), z.number()]).optional(),
  lateMin: z.number().optional(), earlyMin: z.number().optional(), overtimeMin: z.number().optional(), unit: text.optional(), notes: z.array(z.enum(['jadwal-puasa', 'jam-sama-hari-sebelumnya', 'jam-manual-absen-error', 'tanpa-jam'])).optional(),
})
const assignmentSchema = range({ id: text, fileId: text, office: text, name: text, nip: text.optional(), unit: text.optional(), letterNo: text.optional(), letterDate: date.optional(), rawDate: text, dateRef: text.optional(), destination: text.optional(), local: z.boolean(), ref: text })
const assignmentSupersessionSchema = z.object({ recordIds: z.array(text).min(1).max(20000), bySourceId: text, registerKey: text.max(1000), registerLabel: text, reason: text.min(10), actorId: text, reviewer: text, at: z.iso.datetime() })
const assignmentImportSchema = z.object({ selectedIds: z.array(text).max(20000).optional(), selectedRegisterKeys: z.array(text.max(1000)).max(1000).optional(), supersessions: z.array(assignmentSupersessionSchema).max(10000).optional(), omittedMasterCount: z.number().int().nonnegative().max(10000).optional() })
const evidenceImportSchema = z.object({ selectedIds: z.array(text).max(100000).optional() })
const importCommitSchema = z.object({ mode: z.enum(['add', 'replace-file', 'replace-registers']), confirmation: z.string().regex(/^[a-f0-9]{64}$/), actorId: text, committedAt: z.iso.datetime(), selectedRegisterKeys: z.array(text.max(1000)).max(1000).optional(), replacedScopes: z.array(z.object({ sourceId: text, registerKey: text.max(1000), label: text })).max(1000).optional() })
const sourceSchema = z.object({
  id: text, fileName: text, kind: evidenceSchema.shape.kind, label: text, office: text, importedAt: z.iso.datetime(), period: range({}).nullable(),
  evidence: z.array(evidenceSchema).max(100000), assignments: z.array(assignmentSchema).max(20000), warnings: z.array(text), stats: z.object({ rows: z.number().int().nonnegative(), people: z.number().int().nonnegative() }),
  hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), parserVersion: text.optional(), revision: z.number().int().positive().optional(), supersedes: text.optional(), active: z.boolean().optional(), completeThrough: date.optional(),
  declaration: z.object({ actorId: text, basis: text, at: z.iso.datetime() }).optional(),
  recordReviews: z.array(z.object({ id: z.uuid(), kind: z.enum(['evidence', 'assignment']), recordId: text, disposition: z.enum(['excluded', 'active']), reason: text.min(10), actorId: text, reviewer: text, at: z.iso.datetime() })).max(10000).optional(),
  assignmentImport: assignmentImportSchema.optional(), evidenceImport: evidenceImportSchema.optional(), importCommit: importCommitSchema.optional(),
  master: z.array(employeeSchema.partial()).optional(), partialDates: z.array(date).optional(), quarantined: z.array(z.object({ ref: text, reason: text, raw: text })).optional(),
  summaries: z.array(z.object({ name: text, mesin: text.optional(), duty: z.number().optional(), actual: z.number().optional(), absent: z.number().optional(), late: z.number().optional(), early: z.number().optional(), overtimeHours: z.number().optional() })).optional(),
})
export const workspaceSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), files: z.array(sourceSchema).max(2000), master: z.array(employeeSchema).max(10000),
  overrides: z.record(identifierKey, employeeSchema.partial()), decisions: z.array(decisionSchema), resolutions: z.array(resolutionSchema), policy: policySchema, reviewer: text, period: z.string().regex(/^$|^\d{4}-(0[1-9]|1[0-2])$/),
}).superRefine((workspace, ctx) => {
  const ids = new Set<string>()
  const sourceIds = new Set(workspace.files.map(f => f.id))
  for (const [i, file] of workspace.files.entries()) {
    const evidenceIds = new Set(file.evidence.map(e => e.id)), assignmentIds = new Set(file.assignments.map(a => a.id))
    const selectedEvidence = file.evidenceImport?.selectedIds ?? []
    if (new Set(selectedEvidence).size !== selectedEvidence.length) ctx.addIssue({ code: 'custom', path: ['files', i, 'evidenceImport', 'selectedIds'], message: 'Cakupan impor presensi memiliki ID berulang' })
    for (const [j, id] of selectedEvidence.entries()) if (!evidenceIds.has(id)) ctx.addIssue({ code: 'custom', path: ['files', i, 'evidenceImport', 'selectedIds', j], message: 'Cakupan impor merujuk bukti presensi yang tidak ada' })
    const selected = file.assignmentImport?.selectedIds ?? []
    if (new Set(selected).size !== selected.length) ctx.addIssue({ code: 'custom', path: ['files', i, 'assignmentImport', 'selectedIds'], message: 'Cakupan impor penugasan memiliki ID berulang' })
    for (const [j, id] of selected.entries()) if (!assignmentIds.has(id)) ctx.addIssue({ code: 'custom', path: ['files', i, 'assignmentImport', 'selectedIds', j], message: 'Cakupan impor merujuk penugasan yang tidak ada' })
    for (const [j, supersession] of (file.assignmentImport?.supersessions ?? []).entries()) {
      if (!sourceIds.has(supersession.bySourceId)) ctx.addIssue({ code: 'custom', path: ['files', i, 'assignmentImport', 'supersessions', j, 'bySourceId'], message: 'Pengganti register tidak ada dalam workspace' })
      for (const [k, id] of supersession.recordIds.entries()) if (!assignmentIds.has(id)) ctx.addIssue({ code: 'custom', path: ['files', i, 'assignmentImport', 'supersessions', j, 'recordIds', k], message: 'Penggantian merujuk penugasan yang tidak ada' })
    }
    for (const [j, review] of (file.recordReviews ?? []).entries()) {
      if (ids.has(review.id)) ctx.addIssue({ code: 'custom', path: ['files', i, 'recordReviews', j, 'id'], message: 'ID keputusan sumber berulang' })
      ids.add(review.id)
      if (!(review.kind === 'evidence' ? evidenceIds : assignmentIds).has(review.recordId)) ctx.addIssue({ code: 'custom', path: ['files', i, 'recordReviews', j, 'recordId'], message: 'Keputusan merujuk catatan sumber yang tidak ada' })
    }
  }
})
export function migrateWorkspace(input: unknown): Workspace {
  const v = workspaceSchema.parse(input)
  return { ...emptyWorkspace(), ...v, version: 2, policy: enforcePolicy({ ...DEFAULT_POLICY, ...v.policy }) } as Workspace
}

