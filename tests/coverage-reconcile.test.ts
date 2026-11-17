import { describe, expect, test } from 'vitest'
import { createCoverageLookup } from '../src/engine/monthlyFlow.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import type { DayReview, Evidence, SourceFile } from '../src/engine/types.ts'

const person = { ...blankEmployee('staff'), nama: 'Pegawai Uji', nip: '198001012020011001', kantor: 'Pusat', statusKepegawaian: 'PNS' as const, golongan: 'III/a' }
const evidence: Evidence = { id: 'scan', fileId: 'offline', kind: 'mesin', office: 'Pusat', name: person.nama, ids: { nip: person.nip }, date: '2026-10-05', schedule: { start: '08:00', end: '16:30', label: 'Jadwal resmi fixture' }, clockIn: '07:50', clockOut: '16:30', ref: 'baris 2' }
const source = (change: Partial<SourceFile> = {}): SourceFile => ({ id: 'offline', fileName: 'offline.xlsx', kind: 'mesin', label: 'Mesin Offline', office: 'Pusat', importedAt: '2026-10-06T00:00:00Z', period: { start: '2026-10-05', end: '2026-10-05' }, evidence: [evidence], assignments: [], warnings: [], stats: { rows: 1, people: 1 }, ...change })
const policy = { ...DEFAULT_POLICY, parametersApproved: true, arrivalBoundary: 'inclusive' as const, holidays: [] }
const range = { start: '2026-10-05', end: '2026-10-05' }

describe('cakupan setoran pada rekonsiliasi', () => {
  test('bukti boleh direview saat parsial, tetapi nominal tetap ditahan', () => {
    const files = [source(), { ...source({ id: 'st', kind: 'surat-tugas', evidence: [], assignments: [] }), kind: 'surat-tugas' as const }]
    const roster = buildRoster(files, [person], {}, [])
    const pending = reconcile(files, roster, range, policy, [], '2026-10-06').months[0].days[0]
    const review: DayReview = { employeeId: person.id, date: evidence.date, status: 'hadir', evidenceIds: [evidence.id], assignmentIds: [], note: 'Bukti dikonfirmasi', reviewer: 'Admin', actorId: 'admin', at: '2026-10-06T00:00:00Z', signature: pending.reviewSignature }
    const result = reconcile(files, roster, range, policy, [], '2026-10-06', [review], () => false).months[0].days[0]
    expect(result.reviewState).toBe('valid')
    expect(result.sourceCoverageComplete).toBe(false)
    expect(result.meal.state).toBe('held')
    expect(result.meal.heldBy).toBe('coverage')
    expect(result.meal.reason).toContain('Menunggu setoran')
    // With a real lookup the reason names exactly the sources that are still missing.
    const named = reconcile(files, roster, range, policy, [], '2026-10-06', [review], createCoverageLookup(files)).months[0].days[0]
    expect(named.meal.reason).toMatch(/Menunggu setoran .*Mesin Online/)
  })

  test('cakupan yang baru dilengkapi membuat hari valid masuk hitungan progresif', () => {
    const declarations = [{ start: evidence.date, end: evidence.date, status: 'complete' as const, basis: 'Ekspor terkonfirmasi', actorId: 'admin', at: '2026-10-06T00:00:00Z' }]
    const files: SourceFile[] = [source({ coverageDeclarations: declarations }), { ...source({ id: 'online', kind: 'daring', office: 'Semua kantor', evidence: [], coverageDeclarations: declarations }), kind: 'daring', office: 'Semua kantor' }, { ...source({ id: 'st', kind: 'surat-tugas', evidence: [], assignments: [], coverageDeclarations: [{ ...declarations[0], status: 'nil' }] }), kind: 'surat-tugas' }]
    const roster = buildRoster(files, [person], {}, [])
    const lookup = createCoverageLookup(files)
    expect(lookup(person.kantor, evidence.date)).toBe(true)
    const before = reconcile(files, roster, range, policy, [], '2026-10-06', [], lookup).months[0].days[0]
    const review: DayReview = { employeeId: person.id, date: evidence.date, status: 'hadir', evidenceIds: [evidence.id], assignmentIds: [], note: 'Bukti dikonfirmasi', reviewer: 'Admin', actorId: 'admin', at: '2026-10-06T00:00:00Z', signature: before.reviewSignature }
    const result = reconcile(files, roster, range, policy, [], '2026-10-06', [review], lookup).months[0].days[0]
    expect(result.sourceCoverageComplete).toBe(true)
    expect(result.meal.state).toBe('eligible')
    expect(result.meal.amount).toBe(37000)
  })

  test('tanggal sebelum mulai kerja tidak masuk denominator maupun matriks pegawai', () => {
    const newHire = { ...person, tanggalMulaiKerja: '2026-10-06' }
    const files = [source()]
    const roster = buildRoster(files, [newHire], {}, [])
    const result = reconcile(files, roster, range, policy, [], '2026-10-06')
    expect(result.months[0].workdays).toBe(0)
    expect(result.months[0].days).toHaveLength(0)
  })

  test('hari kerja setelah tanggal analisis tidak masuk denominator atau hari ditahan', () => {
    const emptySource = source({ period: { start: '2026-10-26', end: '2026-10-30' }, evidence: [] })
    const roster = buildRoster([emptySource], [person], {}, [])
    const result = reconcile([emptySource], roster, { start: '2026-10-26', end: '2026-10-30' }, policy, [], '2026-10-28').months[0]

    expect(result.workdays).toBe(3)
    expect(result.futureDays).toBe(2)
    expect(result.notFoundDays).toBe(3)
    // Tanpa lookup cakupan, setoran dianggap lengkap: hari tanpa bukti tidak berhak UM, bukan ditahan.
    expect(result.heldDays).toBe(0)
    expect(result.days.filter(day => day.reviewState === 'not-found').every(day => day.meal.state === 'excluded')).toBe(true)
    expect(result.days.filter(day => day.reviewState === 'future')).toHaveLength(2)
  })
})
