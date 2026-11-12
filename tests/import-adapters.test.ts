import { describe, expect, test } from 'vitest'
import { parseDuration } from '../src/engine/dates.ts'
import { parseWorkbook } from '../src/engine/parse.ts'
import type { Sheet, SourceFile } from '../src/engine/types.ts'
import { emptyWorkspace, type User } from '../shared/workspace.ts'
import { workspaceSchema } from '../shared/validation.ts'
import { previewImport } from '../server/imports.ts'

const id = '6f591470-18dd-47c8-a112-334d1f868cb4'
const superadmin: User = { id: 'superadmin-test', name: 'Superadmin Uji', email: 'superadmin@example.test', role: 'superadmin', offices: null }

describe('KPPU source adapters', () => {
  test('offline 11-column header needs no No. ID, applies DMY, keeps zero duration and WFA exception', () => {
    const sheet: Sheet = { name: 'April', rows: [
      ['NIK', 'Nama', 'Tanggal', 'Jam Kerja', 'Jam Masuk', 'Jam Pulang', 'Scan Masuk', 'Scan Pulang', 'Jml Jam Kerja', 'Pengecualian', 'Departemen'],
      ['198001012020011001', 'Nama Sumber', '01/04/2026', 'Sen-Kam (2016)', '08:00', '16:00', '07:50:12', '16:01', '0:00', 'WFA', 'Biro SDM'],
    ] }
    const parsed = parseWorkbook('April.xls', [sheet], id)
    expect(parsed.evidence).toHaveLength(1)
    expect(parsed.evidence[0]).toMatchObject({ date: '2026-04-01', mode: 'WFA', clockIn: '07:50:12', clockOut: '16:01', sourceDurationMin: 0 })
    expect(parsed.evidence[0].sourceValues).toMatchObject({ date: '01/04/2026', duration: '0:00', exception: 'WFA', schedule: 'Sen-Kam (2016)' })
    expect(parsed.quarantined).toHaveLength(0)
  })

  test('offline compact 11-column format is distinguished by headers and keeps No. ID separate', () => {
    const sheet: Sheet = { name: 'Sheet1', rows: [
      ['NIK', 'No. ID', 'Nama', 'Tanggal', 'Jam Kerja', 'Jam Masuk', 'Jam Pulang', 'Scan Masuk', 'Scan Pulang', 'Pengecualian', 'Departemen'],
      ['198001012020011001', '07', 'Nama Mesin', '05/10/2026', 'Sen-Kam', '08:00', '16:00', '07:55', '16:02', '', 'Biro SDM'],
    ] }
    const parsed = parseWorkbook('Pusat.xls', [sheet], id)
    expect(parsed.evidence).toHaveLength(1)
    expect(parsed.evidence[0]).toMatchObject({ date: '2026-10-05', ids: { nip: '198001012020011001', mesin: '07' }, schedule: { start: '08:00', end: '16:00' }, clockIn: '07:55', clockOut: '16:02' })
  })

  test('Kanwil II No. is retained as NIKA-like identifier, AC-No. remains a separate machine ID', () => {
    const sheet: Sheet = { name: 'Sheet1', rows: [
      ['Emp No.', 'AC-No.', 'No.', 'Name', 'Date', 'Timetable', 'On duty', 'Off duty', 'Clock In', 'Clock Out', 'Work Time', 'Exception', 'Department'],
      ['482', '103', '2.12.0482', 'Nama Mesin', '15/09/2026', 'Mon-Fri', '08:00', '16:00', '07:51', '16:02', '8 Jam', '', 'Pegawai Eksis'],
    ] }
    const parsed = parseWorkbook('kanwil 2 attendance.xls', [sheet], id)
    expect(parsed.evidence).toHaveLength(1)
    expect(parsed.evidence[0]).toMatchObject({ office: 'Kanwil II', ids: { nika: '2.12.0482', mesin: '103' }, sourceDurationMin: 480 })
    expect(parsed.evidence[0].ids.nip).toBeUndefined()
    expect(parsed.evidence[0].sourceValues?.employeeNumber).toBe('482')
  })

  test('machine date profile is inferred only when a valid source date disambiguates it', () => {
    const sheet: Sheet = { name: 'Machine', rows: [
      ['No. ID', 'Name', 'Date', 'Clock In', 'Clock Out'],
      ['01', 'Pegawai Satu', '10/05/2026', '07:55', '16:00'],
      ['02', 'Pegawai Dua', '10/31/2026', '07:56', '16:00'],
    ] }
    const parsed = parseWorkbook('machine.xls', [sheet], id)
    expect(parsed.evidence.map(e => e.date)).toEqual(['2026-10-05', '2026-10-31'])
    const mixed: Sheet = { ...sheet, rows: [sheet.rows[0], ['01', 'Pegawai Satu', '31/10/2026', '07:55', '16:00'], ['02', 'Pegawai Dua', '10/31/2026', '07:56', '16:00']] }
    expect(() => parseWorkbook('machine.xls', [mixed], id)).toThrow('mencampur pola DD/MM dan MM/DD')
  })

  test('extended machine export with M/D values does not inherit the compact KPPU DMY profile', () => {
    const headers = ['Emp No.', 'No. ID', 'NIK', 'Nama', 'Auto-Assign', 'Tanggal', 'Jam Kerja', 'Jam Masuk', 'Jam Pulang', 'Scan Masuk', 'Scan Pulang', 'Normal', 'Riil', 'Terlambat', 'Plg. Cepat', 'Absent', 'Lembur', 'Jml Jam Kerja', 'Pengecualian', 'Harus C/In', 'Harus C/Out', 'Departemen']
    const row = (date: string, id: string) => ['482', '103', id, 'Nama Mesin', '', date, 'Mon-Fri', '08:00', '16:00', '07:55', '16:00', '', '', '', '', '', '', '8 Jam', '', '', '', 'Biro SDM']
    const parsed = parseWorkbook('Pusat extended.xls', [{ name: 'Attendance', rows: [headers, row('9/1/2026', '198001012020011001'), row('9/30/2026', '198001012020011001')] }], id)
    expect(parsed.evidence.map(e => e.date)).toEqual(['2026-09-01', '2026-09-30'])
    expect(parsed.period).toEqual({ start: '2026-09-01', end: '2026-09-30' })
  })

  test('18-column Online export maps by headers and does not approve Not Approved', () => {
    const headers = ['No', 'Nama Pegawai', 'Tanggal', 'NIP', 'Jam Mulai', 'Jam Selesai', 'Durasi', 'Terlambat', 'Pulang Cepat', 'Lembur', 'Min. Durasi', 'Jenis', 'Foto', 'Nama Lokasi', 'Unit', 'Koordinat (IN)', 'Koordinat (OUT)', 'status']
    const row = [8, 'Nama Sumber', '30 September 2026', '198001012020011001', '07:55', '16:00', '0 Jam', '0 Menit', '0 Menit', '0 Jam', '8 Jam', 'WFA', '', '', 'Satuan Pelaksana Medan - Sekretaris Jenderal', '', '', 'Not Approved']
    const parsed = parseWorkbook('online.xlsx', [{ name: 'DOWNLOAD 30-09-2026', rows: [['Laporan presensi'], ['informasi lain'], headers, row] }], id)
    expect(parsed.evidence).toHaveLength(1)
    expect(parsed.evidence[0]).toMatchObject({
      office: 'Kanwil I', mode: 'WFA', approved: false, approvalStatus: 'unknown', sourceDurationMin: 0, minimumDurationMin: 480,
      clockIn: '07:55', clockOut: '16:00',
    })
    expect(parsed.evidence[0].schedule).toBeUndefined()
    expect(parsed.evidence[0].sourceValues).toMatchObject({ approval: 'Not Approved', duration: '0 Jam', minimumDuration: '8 Jam' })
  })

  test('12-column Online compact preserves optional WFA text and permits empty text', () => {
    const headers = ['Nama Pegawai', 'Tanggal', 'NIP', 'Jam Mulai', 'Jam Selesai', 'Min. Durasi', 'Jenis', 'Kantor', 'Unit', 'Status', 'Target Pekerjaan', 'Hasil Pekerjaan']
    const sheet: Sheet = { name: 'Compact', rows: [headers,
      ['Pegawai Dengan Teks', '2026-10-05', '198001012020011001', '07:55', '16:00', '8 Jam', 'WFA', 'Kanwil II', '', 'Approved', 'Koordinasi jarak jauh', 'Notulen selesai'],
      ['Pegawai Tanpa Teks', '2026-10-06', '198001012020011002', '08:00', '', '8 Jam', 'WFA', 'Kanwil II', '', 'Approved', '', ''],
    ] }
    const parsed = parseWorkbook('online-compact.xlsx', [sheet], id)
    expect(parsed.evidence).toHaveLength(2)
    expect(parsed.evidence[0]).toMatchObject({ office: 'Kanwil II', mode: 'WFA', approved: true, targetPekerjaan: 'Koordinasi jarak jauh', hasilPekerjaan: 'Notulen selesai' })
    expect(parsed.evidence[1]).toMatchObject({ office: 'Kanwil II', mode: 'WFA', approved: true })
    expect(parsed.evidence[1].targetPekerjaan).toBeUndefined()
    expect(parsed.evidence[1].hasilPekerjaan).toBeUndefined()
  })

  test('unknown office is kept pending and requires explicit scope confirmation at server preview', () => {
    const evidence = { id: `${id}:Online:2`, fileId: id, kind: 'daring' as const, office: 'Belum ditentukan', officePending: true, officeCandidate: 'Kanwil I', name: 'Nama Sumber', ids: { nip: '198001012020011001' }, date: '2026-10-05', clockIn: '07:50', clockOut: '16:00', mode: 'WFO' as const, approved: true, approvalStatus: 'approved' as const, ref: 'Online · baris 3' }
    const file: SourceFile = { id, fileName: 'online.xlsx', kind: 'daring', label: 'Mesin Online', office: 'Semua kantor', officeCandidate: 'Kanwil I', importedAt: '2026-10-06T00:00:00.000Z', period: { start: evidence.date, end: evidence.date }, evidence: [evidence], assignments: [], warnings: [], stats: { rows: 1, people: 1 } }
    const state = emptyWorkspace(), intent = { uploadId: id, expectedRevision: 0, office: 'Kanwil I', mode: 'add' as const, reason: 'Konfirmasi scope kantor dari admin', resolveUnmappedOffice: true }
    const resolved = previewImport(state, 0, file, superadmin, intent).next.files[0].evidence[0]
    expect(resolved).toMatchObject({ office: 'Kanwil I', officePending: false })
    expect(() => previewImport(state, 0, file, superadmin, { ...intent, resolveUnmappedOffice: false })).toThrow('belum terpetakan')
  })

  test('conflicting office candidates block import instead of defaulting to Pusat', () => {
    const evidence = { id: `${id}:Online:2`, fileId: id, kind: 'daring' as const, office: 'Belum ditentukan', officePending: true, officeConflict: true, officeCandidates: ['Pusat', 'Kanwil I'], name: 'Nama Sumber', ids: {}, date: '2026-10-05', ref: 'Online · baris 3' }
    const file: SourceFile = { id, fileName: 'online.xlsx', kind: 'daring', label: 'Mesin Online', office: 'Semua kantor', importedAt: '2026-10-06T00:00:00.000Z', period: { start: evidence.date, end: evidence.date }, evidence: [evidence], assignments: [], warnings: [], stats: { rows: 1, people: 1 } }
    expect(() => previewImport(emptyWorkspace(), 0, file, superadmin, { uploadId: id, expectedRevision: 0, office: 'Pusat', mode: 'add', reason: 'Konflik kantor harus diperiksa', resolveUnmappedOffice: true })).toThrow('konflik')
  })

  test('WFA text, source status, durations, and provenance survive JSON storage validation and reload', () => {
    const evidence = { id: `${id}:Online:2`, fileId: id, kind: 'daring' as const, office: 'Kanwil I', name: 'Nama Sumber', ids: { nip: '198001012020011001' }, date: '2026-10-05', mode: 'WFA' as const, approved: true, approvalStatus: 'approved' as const, sourceDurationMin: 480, minimumDurationMin: 480, targetPekerjaan: 'Koordinasi', hasilPekerjaan: 'Notulen selesai', sourceValues: { name: 'Nama Sumber', identifier: '198001012020011001', date: '05/10/2026', duration: '8 Jam', minimumDuration: '8 Jam', mode: 'WFA', approval: 'Approved', unit: 'Satuan Pelaksana Medan' }, ref: 'Online · baris 3' }
    const state = emptyWorkspace()
    state.files.push({ id, fileName: 'online.xlsx', kind: 'daring', label: 'Mesin Online', office: 'Semua kantor', importedAt: '2026-10-06T00:00:00.000Z', period: { start: evidence.date, end: evidence.date }, evidence: [evidence], assignments: [], warnings: [], stats: { rows: 1, people: 1 }, hash: 'a'.repeat(64), parserVersion: '2.2.0' })
    const reloaded = workspaceSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(reloaded.files[0].evidence[0]).toMatchObject({ targetPekerjaan: 'Koordinasi', hasilPekerjaan: 'Notulen selesai', sourceDurationMin: 480, minimumDurationMin: 480, sourceValues: { approval: 'Approved', identifier: '198001012020011001' } })
  })

  test('duplicate Online headers are rejected and zero duration differs from a blank cell', () => {
    const sheet: Sheet = { name: 'Online', rows: [['Nama Pegawai', 'Nama Pegawai', 'Tanggal', 'Jam Mulai', 'Jenis'], ['A', 'A', '2026-10-05', '08:00', 'WFO']] }
    expect(() => parseWorkbook('online.xlsx', [sheet], id)).toThrow('muncul lebih dari sekali')
    expect(parseDuration('0 Menit')).toBe(0)
    expect(parseDuration(null)).toBeUndefined()
  })
})
