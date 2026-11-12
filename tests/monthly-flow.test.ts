import { describe, expect, test } from 'vitest'
import { inspectMonthlyPackage, inspectOfficeCoverage } from '../src/engine/monthlyFlow.ts'
import { OFFICES } from '../src/engine/ids.ts'
import type { SourceFile } from '../src/engine/types.ts'

const file = (kind: SourceFile['kind'], office: string, change: Partial<SourceFile> = {}): SourceFile => ({
  id: `${kind}-${office}`, fileName: `${kind}.xlsx`, kind, label: kind, office, importedAt: '2026-10-01T00:00:00Z',
  period: { start: '2026-10-01', end: '2026-10-31' }, evidence: [], assignments: [], warnings: [], stats: { rows: 1, people: 1 }, ...change,
})

describe('Paket perhitungan bulanan seluruh KPPU', () => {
  test('belum boleh lanjut bila satu sumber inti hilang atau periode berbeda', () => {
    const online = file('daring', 'Semua kantor', { evidence: [{ id: 'on', fileId: 'daring-Semua kantor', kind: 'daring', office: 'Pusat', name: 'Pegawai', ids: {}, date: '2026-10-05', clockIn: '07:50', clockOut: '16:00', ref: 'baris 1' }] })
    const st = OFFICES.map(office => file('surat-tugas', office, { completeThrough: '2026-10-31', declaration: { actorId: 'admin', basis: 'Register lengkap', at: '2026-10-31T00:00:00Z' } }))
    expect(inspectMonthlyPackage([...st, online], '2026-10').ready).toBe(false)
    const offline = file('mesin', 'Pusat', { evidence: [{ id: 'off', fileId: 'mesin-Pusat', kind: 'mesin', office: 'Pusat', name: 'Pegawai', ids: {}, date: '2026-09-30', clockIn: '07:50', clockOut: '16:00', ref: 'baris 1' }] })
    expect(inspectMonthlyPackage([...st, online, offline], '2026-10').ready).toBe(false)
  })

  test('menerima satu paket sumber bulan yang sama dan memastikan ST tiap kantor', () => {
    const declaration = (status: 'complete' | 'nil' | 'not-applicable') => [{ start: '2026-10-01', end: '2026-10-31', status, basis: 'Konfirmasi cakupan fixture bulanan', actorId: 'admin', at: '2026-10-31T00:00:00Z' }]
    const online = file('daring', 'Semua kantor', { coverageDeclarations: declaration('complete'), evidence: [{ id: 'on', fileId: 'daring-Semua kantor', kind: 'daring', office: 'Pusat', name: 'Pegawai', ids: {}, date: '2026-10-05', clockIn: '07:50', clockOut: '16:00', ref: 'baris 1' }] })
    const offline = file('mesin', 'Pusat', { coverageDeclarations: declaration('complete'), evidence: [{ id: 'off', fileId: 'mesin-Pusat', kind: 'mesin', office: 'Pusat', name: 'Pegawai', ids: {}, date: '2026-10-05', clockIn: '07:50', clockOut: '16:00', ref: 'baris 1' }] })
    const noOffline = OFFICES.filter(office => office !== 'Pusat').map(office => file('mesin', office, { coverageDeclarations: declaration('not-applicable'), declaration: { actorId: 'admin', basis: 'Kantor tidak menggunakan mesin offline', at: '2026-10-31T00:00:00Z' } }))
    const st = OFFICES.map(office => file('surat-tugas', office, {
      completeThrough: '2026-10-31',
      coverageDeclarations: declaration(office === 'Pusat' ? 'complete' : 'nil'),
      ...(office === 'Pusat' ? { assignments: [{ id: 'st-pusat', fileId: 'surat-tugas-Pusat', office, name: 'Pegawai', start: '2026-10-06', end: '2026-10-06', rawDate: '6 Okt', local: false, ref: 'baris 2' }] } : { declaration: { actorId: 'admin', basis: 'Register lengkap, nihil ST', at: '2026-10-31T00:00:00Z' } }),
    }))
    const result = inspectMonthlyPackage([...st, offline, online, ...noOffline], '2026-10')
    expect(result.ready).toBe(true)
    expect(result.suratTugas).toHaveLength(8)
    expect(result.suratTugas.find(item => item.office === 'Pusat')?.declaredNil).toBe(false)
  })

  test('pernyataan nihil tidak menutupi register ST baru yang cakupannya belum dikonfirmasi', () => {
    const online = file('daring', 'Semua kantor', { evidence: [{ id: 'on', fileId: 'daring-Semua kantor', kind: 'daring', office: 'Pusat', name: 'Pegawai', ids: {}, date: '2026-10-05', clockIn: '07:50', clockOut: '16:00', ref: 'baris 1' }] })
    const offline = file('mesin', 'Pusat', { evidence: [{ id: 'off', fileId: 'mesin-Pusat', kind: 'mesin', office: 'Pusat', name: 'Pegawai', ids: {}, date: '2026-10-05', clockIn: '07:50', clockOut: '16:00', ref: 'baris 1' }] })
    const st = OFFICES.map(office => file('surat-tugas', office, { completeThrough: '2026-10-31', declaration: { actorId: 'admin', basis: 'Register lengkap', at: '2026-10-31T00:00:00Z' } }))
    st[0].assignments.push({ id: 'new-st', fileId: st[0].id, office: 'Pusat', name: 'Pegawai', start: '2026-10-06', end: '2026-10-06', rawDate: '6 Okt', local: false, ref: 'baris 2' })
    st[0].completeThrough = undefined
    const result = inspectMonthlyPackage([...st, offline, online], '2026-10')
    expect(result.suratTugas[0]).toMatchObject({ ready: false, declaredNil: false })
    expect(result.ready).toBe(false)
  })

  test('setoran ST mingguan bersifat seluruh KPPU: satu setoran yang dinyatakan lengkap mencakup register lain', () => {
    const coverage = [{ start: '2026-10-01', end: '2026-10-31', status: 'complete' as const, basis: 'Register dikonfirmasi lengkap', actorId: 'hr', at: '2026-10-31T00:00:00Z' }]
    const first = file('surat-tugas', 'Pusat', { coverageDeclarations: coverage, assignments: [{ id: 'st-a', fileId: 'surat-tugas-Pusat', office: 'Pusat', unit: 'Deputi A', letterNo: 'ST-A/2026', name: 'Pegawai A', start: '2026-10-05', end: '2026-10-05', rawDate: '5 Oktober 2026', local: false, ref: 'Register A2' }] })
    const second = file('surat-tugas', 'Pusat', { id: 'st-b', assignments: [{ id: 'st-b-row', fileId: 'st-b', office: 'Pusat', unit: 'Deputi B', letterNo: 'ST-B/2026', name: 'Pegawai B', start: '2026-10-06', end: '2026-10-06', rawDate: '6 Oktober 2026', local: false, ref: 'Register B2' }] })
    expect(inspectOfficeCoverage([first, second], '2026-10-01', '2026-10-31', ['Pusat']).find(item => item.source === 'surat-tugas')).toMatchObject({ ready: true, state: 'complete' })
    expect(inspectOfficeCoverage([second], '2026-10-01', '2026-10-31', ['Pusat']).find(item => item.source === 'surat-tugas')).toMatchObject({ ready: false, state: 'unconfirmed' })
    second.coverageDeclarations = coverage
    expect(inspectOfficeCoverage([first, second], '2026-10-01', '2026-10-31', ['Pusat']).find(item => item.source === 'surat-tugas')).toMatchObject({ ready: true, state: 'complete' })
  })

  test('cakupan interval menggabungkan rentang berurutan tetapi tetap menunjukkan celah', () => {
    const offlineA = file('mesin', 'Pusat', { coverageDeclarations: [
      { start: '2026-10-01', end: '2026-10-07', status: 'complete', basis: 'Ekspor dikonfirmasi', actorId: 'hr', at: '2026-10-08T00:00:00Z' },
      { start: '2026-10-15', end: '2026-10-21', status: 'complete', basis: 'Ekspor dikonfirmasi', actorId: 'hr', at: '2026-10-22T00:00:00Z' },
    ] })
    const offlineB = file('mesin', 'Pusat', { id: 'offline-gap', coverageDeclarations: [
      { start: '2026-10-08', end: '2026-10-14', status: 'complete', basis: 'Ekspor dikonfirmasi', actorId: 'hr', at: '2026-10-15T00:00:00Z' },
    ] })
    const base = [
      file('daring', 'Semua kantor', { coverageDeclarations: [{ start: '2026-10-01', end: '2026-10-31', status: 'complete', basis: 'Ekspor dikonfirmasi', actorId: 'hr', at: '2026-10-31T00:00:00Z' }] }),
      file('surat-tugas', 'Pusat', { coverageDeclarations: [{ start: '2026-10-01', end: '2026-10-07', status: 'nil', basis: 'Register nihil diverifikasi', actorId: 'hr', at: '2026-10-08T00:00:00Z' }] }),
    ]
    expect(inspectOfficeCoverage([offlineA, ...base], '2026-10-01', '2026-10-21', ['Pusat']).find(item => item.source === 'offline')).toMatchObject({ ready: false, state: 'partial' })
    expect(inspectOfficeCoverage([offlineA, offlineB, ...base], '2026-10-01', '2026-10-21', ['Pusat']).find(item => item.source === 'offline')).toMatchObject({ ready: true, state: 'complete' })
    expect(inspectOfficeCoverage([offlineA, offlineB, ...base], '2026-10-01', '2026-10-14', ['Pusat']).find(item => item.source === 'surat-tugas')).toMatchObject({ ready: false, state: 'partial' })
  })

  test('konfirmasi tidak berlaku bertentangan dengan cakupan lengkap pada rentang yang sama', () => {
    const complete = file('mesin', 'Pusat', { coverageDeclarations: [{ start: '2026-10-01', end: '2026-10-31', status: 'complete', basis: 'Ekspor lengkap terkonfirmasi', actorId: 'hr', at: '2026-10-31T00:00:00Z' }] })
    const notApplicable = file('mesin', 'Pusat', { id: 'offline-na', coverageDeclarations: [{ start: '2026-10-01', end: '2026-10-31', status: 'not-applicable', basis: 'Kantor tidak menggunakan mesin', actorId: 'hr', at: '2026-10-31T00:00:00Z' }] })
    expect(inspectOfficeCoverage([complete, notApplicable], '2026-10-01', '2026-10-31', ['Pusat']).find(item => item.source === 'offline')).toMatchObject({ ready: false, state: 'partial' })
  })
})
