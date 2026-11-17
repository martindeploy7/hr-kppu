import { describe, expect, test } from 'vitest'
import { splitPeople } from '../src/engine/names.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import type { Evidence, SourceFile } from '../src/engine/types.ts'

// Regressions found by the April/September/October E2E run (Nov 2026).
const file = (over: Partial<SourceFile>): SourceFile => ({ id: 'f', fileName: 'f.xlsx', kind: 'mesin', label: 'f', office: 'Pusat', importedAt: '2026-10-20T00:00:00Z', period: { start: '2026-10-01', end: '2026-10-31' }, evidence: [], assignments: [], warnings: [], stats: { rows: 0, people: 0 }, ...over })

describe('temuan E2E', () => {
  test('gelar setelah koma bukan peserta ST tambahan', () => {
    expect(splitPeople('Tisa Amelia Sapitri,Se.')).toEqual(['Tisa Amelia Sapitri'])
    expect(splitPeople('Budi, S.H., M.H.')).toEqual(['Budi'])
    expect(splitPeople('Deny, Hafis, Hasan')).toEqual(['Deny', 'Hafis', 'Hasan'])
    expect(splitPeople('Sri, Ana')).toEqual(['Sri', 'Ana'])
  })

  test('sheet Data Pegawai di workbook Rekap ST tidak menambah pegawai', () => {
    const master = [{ ...blankEmployee('m1'), nama: 'Pegawai Resmi', nip: '198001012020011001', kantor: 'Pusat' }]
    const st = file({ id: 'st', kind: 'surat-tugas', master: [{ nama: 'Orang Lampiran', nip: '199001012020011002', kantor: 'Pusat' }] })
    const roster = buildRoster([st], master, {}, [])
    expect(roster.employees.map(e => e.nama)).toEqual(['Pegawai Resmi'])
  })

  const dayOf = (evs: Evidence[]) => {
    const person = { ...blankEmployee('p'), nama: 'Idham', nip: '199203172025211161', kantor: 'Pusat', statusKepegawaian: 'PPPK' as const, golongan: 'V' }
    const files = [file({ id: 'mesin', kind: 'mesin', evidence: evs.filter(e => e.kind === 'mesin') }), file({ id: 'on', kind: 'daring', office: 'Semua kantor', evidence: evs.filter(e => e.kind === 'daring') })]
    const roster = buildRoster(files, [person], {}, [])
    return reconcile(files, roster, { start: '2026-09-03', end: '2026-09-03' }, DEFAULT_POLICY, [], '2026-10-20', [], () => true).months[0].days[0]
  }
  const ids = { nip: '199203172025211161' }
  test('kode WFA mesin tanpa jam + pasangan WFO online lengkap bukan clash', () => {
    const day = dayOf([
      { id: 'm', fileId: 'mesin', kind: 'mesin', office: 'Pusat', name: 'Idham', ids, date: '2026-09-03', ref: 'A1', code: 'WFA', present: true } as Evidence,
      { id: 'o', fileId: 'on', kind: 'daring', office: 'Pusat', name: 'Idham', ids, date: '2026-09-03', ref: 'B1', mode: 'WFO', approvalStatus: 'approved', clockIn: '07:58', clockOut: '16:43', present: true } as Evidence,
    ])
    expect(day.issues.filter(i => i.blocksMeal)).toEqual([])
    expect(day.meal.state).toBe('eligible')
  })
  test('jam identik di mesin kantor dan presensi WFA bukan clash', () => {
    const day = dayOf([
      { id: 'm', fileId: 'mesin', kind: 'mesin', office: 'Pusat', name: 'Idham', ids, date: '2026-09-03', ref: 'A1', clockIn: '07:57', clockOut: '16:48', present: true } as Evidence,
      { id: 'o', fileId: 'on', kind: 'daring', office: 'Pusat', name: 'Idham', ids, date: '2026-09-03', ref: 'B1', mode: 'WFA', approvalStatus: 'approved', clockIn: '07:57', clockOut: '16:48', present: true } as Evidence,
    ])
    expect(day.issues.filter(i => i.blocksMeal)).toEqual([])
    expect(day.status).toBe('hadir')
    expect(day.meal.state).toBe('eligible')
  })
  test('status grid daring tanpa jam: bukti tidak lengkap, tanpa UM, tidak masuk antrean', () => {
    const person = { ...blankEmployee('p'), nama: 'Arif', nip: '199201102025211149', kantor: 'Kanwil I', statusKepegawaian: 'PPPK' as const, golongan: 'IX' }
    const ev: Evidence = { id: 'e', fileId: 'on', kind: 'daring', office: 'Kanwil I', name: 'Arif', ids: { nip: person.nip }, date: '2026-10-09', ref: 'Laporan!A2', present: true, mode: 'WFA', codeLabel: 'WFA - hadir' } as Evidence
    const files = [file({ id: 'on', kind: 'daring', office: 'Semua kantor', evidence: [ev] })]
    const roster = buildRoster(files, [person], {}, [])
    const day = reconcile(files, roster, { start: '2026-10-09', end: '2026-10-09' }, DEFAULT_POLICY, [], '2026-10-20', [], () => true).months[0].days[0]
    expect(day.status).toBe('tidak-lengkap')
    expect(day.basis).toContain('tanpa jam')
    expect(day.meal.state).toBe('excluded')
    expect(day.reviewState).toBe('valid')
  })
})

describe('aturan UM 08:00–16:30', () => {
  const person = { ...blankEmployee('um'), nama: 'Pegawai Aturan UM', nip: '198001012020011001', kantor: 'Pusat', statusKepegawaian: 'PNS' as const, golongan: 'III/a' }
  // 2026-10-05 Senin, 2026-10-09 Jumat; aturan sama untuk semua hari kerja dan tidak membaca jadwal sumber.
  const dayFor = (date: string, change: Partial<Evidence>) => {
    const ev: Evidence = { id: 'e', fileId: 'f', kind: 'mesin', office: 'Pusat', name: person.nama, ids: { nip: person.nip }, date, ref: 'A1', ...change }
    const files = [file({ id: 'f', kind: 'mesin', evidence: [ev] })]
    const roster = buildRoster(files, [person], {}, [])
    return reconcile(files, roster, { start: date, end: date }, { ...DEFAULT_POLICY, holidays: [] }, [], '2026-10-20', [], () => true).months[0].days[0]
  }

  test('Senin masuk 07:59 pulang 16:30: eligible', () => {
    expect(dayFor('2026-10-05', { clockIn: '07:59', clockOut: '16:30' })).toMatchObject({ scheduleKnown: true, earlyMin: 0, meal: { state: 'eligible' } })
  })
  test('Senin masuk 08:00 pulang 16:29: tanpa UM karena pulang cepat 1 menit', () => {
    const day = dayFor('2026-10-05', { clockIn: '08:00', clockOut: '16:29' })
    expect(day).toMatchObject({ earlyMin: 1, meal: { state: 'excluded' } })
    expect(day.meal.reason).toContain('Pulang 1 menit sebelum pukul 16:30')
  })
  test('Jumat masuk 08:01 pulang 17:00: tanpa UM karena terlambat', () => {
    const day = dayFor('2026-10-09', { clockIn: '08:01', clockOut: '17:00' })
    expect(day).toMatchObject({ lateMin: 1, meal: { state: 'excluded' } })
    expect(day.meal.reason).toContain('Terlambat 1 menit')
  })
  test('hanya jam masuk 07:45: tanpa UM, bukan ditahan', () => {
    const day = dayFor('2026-10-05', { clockIn: '07:45' })
    expect(day.meal.state).toBe('excluded')
    expect(day.meal.reason).toContain('tanpa jam pulang')
  })
  test('hanya jam pulang 16:45: tanpa UM, bukan ditahan', () => {
    const day = dayFor('2026-10-05', { clockOut: '16:45' })
    expect(day.meal.state).toBe('excluded')
    expect(day.meal.reason).toContain('tanpa jam masuk')
  })
})
