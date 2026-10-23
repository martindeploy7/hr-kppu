import { describe, expect, test } from 'vitest'
import { inspectMonthlyPackage } from '../src/engine/monthlyFlow.ts'
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
    const online = file('daring', 'Semua kantor', { evidence: [{ id: 'on', fileId: 'daring-Semua kantor', kind: 'daring', office: 'Pusat', name: 'Pegawai', ids: {}, date: '2026-10-05', clockIn: '07:50', clockOut: '16:00', ref: 'baris 1' }] })
    const offline = file('mesin', 'Pusat', { evidence: [{ id: 'off', fileId: 'mesin-Pusat', kind: 'mesin', office: 'Pusat', name: 'Pegawai', ids: {}, date: '2026-10-05', clockIn: '07:50', clockOut: '16:00', ref: 'baris 1' }] })
    const st = OFFICES.map(office => file('surat-tugas', office, {
      completeThrough: '2026-10-31',
      ...(office === 'Pusat' ? { assignments: [{ id: 'st-pusat', fileId: 'surat-tugas-Pusat', office, name: 'Pegawai', start: '2026-10-06', end: '2026-10-06', rawDate: '6 Okt', local: false, ref: 'baris 2' }] } : { declaration: { actorId: 'admin', basis: 'Register lengkap, nihil ST', at: '2026-10-31T00:00:00Z' } }),
    }))
    const result = inspectMonthlyPackage([...st, offline, online], '2026-10')
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
})
