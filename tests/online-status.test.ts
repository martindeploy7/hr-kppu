import { describe, expect, test } from 'vitest'
import { parseOnline } from '../src/engine/parsers/online.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import type { Sheet, SourceFile } from '../src/engine/types.ts'

const person = { ...blankEmployee('online-person'), nama: 'Pegawai Online', nip: '198001012020011001', kantor: 'Pusat', statusKepegawaian: 'PNS' as const, golongan: 'III/a' }
const row = (type: string, status: string): Sheet => ({ name: 'Online', rows: [
  ['Nama Pegawai', 'Tanggal', 'NIP', 'Jam Mulai', 'Jam Selesai', 'Jenis', 'Status', 'Kantor'],
  [person.nama, '5 Oktober 2026', person.nip, '07:50', '16:00', type, status, 'Pusat'],
] })

function dayFor(type: string, status: string) {
  const evidence = parseOnline(row(type, status), 'online-file', [])[0]
  const file: SourceFile = { id: 'online-file', fileName: 'online.xlsx', kind: 'daring', label: 'Mesin Online', office: 'Semua kantor', importedAt: '2026-10-06T00:00:00Z', period: { start: '2026-10-05', end: '2026-10-05' }, evidence: [{ ...evidence, office: 'Pusat' }], assignments: [], warnings: [], stats: { rows: 1, people: 1 } }
  const roster = buildRoster([file], [person], {}, [])
  const policy = { ...DEFAULT_POLICY, parametersApproved: true, arrivalBoundary: 'inclusive' as const, holidays: [] }
  const result = reconcile([file], roster, { start: '2026-10-05', end: '2026-10-05' }, policy, [], '2026-10-06')
  return { evidence, day: result.months[0].days[0] }
}

describe('status approval Mesin Online', () => {
  test('presensi Pending tidak diperlakukan sebagai Approved/WFO', () => {
    const { evidence, day } = dayFor('WFO', 'Pending')
    expect(evidence).toMatchObject({ mode: 'WFO', approved: false, approvalStatus: 'pending' })
    expect(day).toMatchObject({ status: 'tidak-lengkap', reviewState: 'flag', meal: { state: 'held' } })
    expect(day.issues.some(issue => issue.type === 'daring-ditolak')).toBe(false)
  })

  test('status approval tidak dikenal dan jenis kehadiran tidak dikenal tetap ditahan', () => {
    const status = dayFor('WFO', 'Processing')
    expect(status.evidence).toMatchObject({ mode: 'WFO', approvalStatus: 'unknown', approved: false })
    expect(status.day).toMatchObject({ status: 'tidak-lengkap', meal: { state: 'held' } })
    const type = dayFor('Hybrid', 'Approved')
    expect(type.evidence).toMatchObject({ approvalStatus: 'approved', mode: undefined, code: 'T' })
    expect(type.day).toMatchObject({ status: 'tidak-lengkap', meal: { state: 'held' } })
  })

  test('Reject tetap berbeda dari Pending', () => {
    const { evidence, day } = dayFor('WFA', 'Reject')
    expect(evidence).toMatchObject({ mode: 'WFA', approved: false, approvalStatus: 'rejected' })
    expect(day.status).toBe('tidak-lengkap')
    expect(day.issues.some(issue => issue.type === 'daring-ditolak')).toBe(true)
    // Reject bukan clash: hari valid otomatis tanpa UM; admin tetap dapat mengoreksi.
    expect(day.meal.state).toBe('excluded')
  })
})
