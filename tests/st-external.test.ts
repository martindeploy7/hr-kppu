import { describe, expect, test } from 'vitest'
import { reconcile } from '../src/engine/reconcile.ts'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import type { Assignment, Evidence, SourceFile } from '../src/engine/types.ts'

const policy = { ...DEFAULT_POLICY, parametersApproved: true, arrivalBoundary: 'inclusive' as const, holidays: [] }
const DATE = '2026-10-05'
const range = { start: DATE, end: DATE }
const eko = { ...blankEmployee('eko'), nama: 'Eko Yulianto Putra', nip: '198001012020011001', kantor: 'Pusat', statusKepegawaian: 'PNS' as const, golongan: 'III/a' }
const ade = { ...blankEmployee('ade'), nama: 'Ade Supriyatna Jaya', nip: '198502022020011002', kantor: 'Pusat', statusKepegawaian: 'PNS' as const, golongan: 'III/a' }
const scan = (employee: typeof eko, id: string): Evidence => ({ id, fileId: 'offline', kind: 'mesin', office: 'Pusat', name: employee.nama, ids: { nip: employee.nip }, date: DATE, schedule: { start: '08:00', end: '16:30', label: 'Jadwal resmi fixture' }, clockIn: '07:50', clockOut: '16:30', ref: id })
const offline: SourceFile = { id: 'offline', fileName: 'offline.xlsx', kind: 'mesin', label: 'Mesin Offline', office: 'Pusat', importedAt: '2026-10-06T00:00:00Z', period: range, evidence: [scan(eko, 's1'), scan(ade, 's2')], assignments: [], warnings: [], stats: { rows: 2, people: 2 } }
const row = (name: string, extra: Partial<Assignment> = {}): Assignment => ({ id: `a-${name}`, fileId: 'manual-st:x', office: 'Pusat', name, start: DATE, end: DATE, rawDate: DATE, destination: 'Bogor, Jawa Barat', letterNo: '256/', letterDate: DATE, local: false, ref: 'Input Rekap ST', ...extra })
const stFile = (assignments: Assignment[]): SourceFile => ({ id: 'manual-st:x', fileName: 'Rekap ST manual', kind: 'surat-tugas', label: 'Rekap ST manual', office: 'Pusat', importedAt: '2026-10-06T00:00:00Z', period: range, evidence: [], assignments, warnings: [], stats: { rows: assignments.length, people: assignments.length } })
const allCovered = () => true
const run = (assignments: Assignment[]) => {
  const files = [offline, stFile(assignments)]
  const roster = buildRoster(files, [eko, ade], {}, [])
  const result = reconcile(files, roster, range, policy, [], '2026-10-06', [], allCovered)
  const day = (id: string) => result.months.find(m => m.employee.id === id)!.days[0]
  return { files, roster, result, day }
}

describe('peserta ST eksternal ("Lainnya", tanpa NIP)', () => {
  test('kontrol: tanpa penanda, nama ST yang mirip menautkan atau menunggu pegawai master', () => {
    const { roster, day } = run([row('Eko Yulianto'), row('Ade Supriyatna')])
    expect(roster.identity.filter(i => i.context === 'surat-tugas').length).toBeGreaterThan(0)
    // Kontrol bermakna: tanpa penanda eksternal, nama ST memengaruhi pegawai master (tertaut atau menahan uang makan).
    expect(day('eko').meal.state).not.toBe('eligible')
    expect(day('eko').assignments).toHaveLength(1)
  })

  test('eksternal tidak dicocokkan ke pegawai master dan tidak membuat tugas identitas', () => {
    const { roster } = run([row('Eko Yulianto', { external: true, note: 'Driver Komisi' }), row('Ade Supriyatna', { external: true, note: 'Driver Komisi' })])
    expect(roster.identity.filter(i => i.context === 'surat-tugas')).toHaveLength(0)
    expect(roster.assignmentLink.size).toBe(0)
    expect(roster.employees.find(e => e.id === 'eko')!.aliases.some(a => a.kind === 'nama' && a.value === 'Eko Yulianto')).toBe(false)
  })

  test('eksternal tidak mengubah hari pegawai bernama mirip dan tidak menahan uang makannya', () => {
    const control = run([]).day('eko')
    expect(control.meal.state).toBe('eligible')
    const { day, result } = run([row('Eko Yulianto', { external: true, note: 'Driver Komisi' }), row('Ade Supriyatna', { external: true, note: 'Driver Komisi' })])
    for (const id of ['eko', 'ade']) {
      const record = day(id)
      expect(record.assignments).toHaveLength(0)
      expect(record.status).toBe(control.status)
      expect(record.meal.state).toBe('eligible')
      expect(record.meal.heldBy).toBeUndefined()
      expect(record.issues.map(i => i.type)).toEqual(control.issues.map(i => i.type))
    }
    expect(result.months.flatMap(m => m.days).filter(d => d.meal.heldBy === 'identity')).toHaveLength(0)
  })

  test('eksternal tanpa tautan juga tidak menahan pegawai lain saat tidak ada kandidat pasti', () => {
    const { day } = run([row('Eko Y', { external: true }), row('Eko', { external: true })])
    expect(day('eko').meal.state).toBe('eligible')
    expect(day('ade').meal.state).toBe('eligible')
  })

  test('baris non-eksternal pada ST yang sama tetap dicocokkan seperti biasa', () => {
    const { roster } = run([row('Eko Yulianto', { external: true }), row('Ade', { employeeId: 'ade' })])
    expect(roster.assignmentLink.get('a-Ade')).toBe('ade')
    expect(roster.assignmentLink.has('a-Eko Yulianto')).toBe(false)
  })
})
