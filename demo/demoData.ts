import { emptyWorkspace, type Workspace } from '../shared/workspace.ts'
import { eachDay, isWeekend } from '../src/engine/dates.ts'
import { OFFICES, OFFICE_CITY } from '../src/engine/ids.ts'
import { DEFAULT_POLICY, enforcePolicy } from '../src/engine/policy.ts'
import { defaultSchedule } from '../src/engine/reconcile.ts'
import type { Assignment, Employee, Evidence, IssueType, SourceFile, SourceKind } from '../src/engine/types.ts'

const START = '2026-09-01'
const END = '2026-09-30'
const DUTY_DATES = ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']
const workdays = eachDay(START, END).filter(date => !isWeekend(date) && !DEFAULT_POLICY.holidays.includes(date))

const people: Pick<Employee, 'nama' | 'kantor' | 'unit' | 'statusKepegawaian' | 'golongan' | 'jabatan' | 'jenisKelamin' | 'tanggalLahir' | 'tempatLahir' | 'pendidikan' | 'disiplinIlmu' | 'tanggalMulaiKerja' | 'alamat' | 'namaKontakDarurat' | 'kontakDarurat' | 'statusPerkawinan' | 'agama' | 'nomorWhatsApp' | 'email' | 'statusPegawai'>[] = [
  { nama: 'Aditya Pratama', kantor: 'Pusat', unit: 'Biro Sumber Daya Manusia', statusKepegawaian: 'PNS', golongan: 'III/a', jabatan: 'Analis SDM Aparatur', jenisKelamin: 'Laki-laki', tanggalLahir: '1990-01-01', tempatLahir: 'Jakarta', pendidikan: 'S1', disiplinIlmu: 'Administrasi Publik', tanggalMulaiKerja: '2015-03-02', alamat: 'Alamat sintetis, Jakarta', namaKontakDarurat: 'Rina Pratama', kontakDarurat: '081200000001', statusPerkawinan: 'Kawin', agama: 'Islam', nomorWhatsApp: '6281200000001', email: 'aditya.pratama@example.test', statusPegawai: 'Aktif' },
  { nama: 'Nadia Siregar', kantor: 'Kanwil I', unit: 'Kantor Wilayah I', statusKepegawaian: 'PPPK', golongan: 'VIII', jabatan: 'Analis Persaingan Usaha', jenisKelamin: 'Perempuan', tanggalLahir: '1992-02-02', tempatLahir: 'Medan', pendidikan: 'S1', disiplinIlmu: 'Hukum', tanggalMulaiKerja: '2022-01-03', alamat: 'Alamat sintetis, Medan', namaKontakDarurat: 'Dedi Siregar', kontakDarurat: '081200000002', statusPerkawinan: 'Belum kawin', agama: 'Kristen', nomorWhatsApp: '6281200000002', email: 'nadia.siregar@example.test', statusPegawai: 'Aktif' },
  { nama: 'Bagas Saputra', kantor: 'Kanwil II', unit: 'Kantor Wilayah II', statusKepegawaian: 'PPPK', golongan: 'IX', jabatan: 'Analis Kebijakan', jenisKelamin: 'Laki-laki', tanggalLahir: '1988-03-03', tempatLahir: 'Bandar Lampung', pendidikan: 'S2', disiplinIlmu: 'Ekonomi', tanggalMulaiKerja: '2021-06-01', alamat: 'Alamat sintetis, Bandar Lampung', namaKontakDarurat: 'Maya Saputra', kontakDarurat: '081200000003', statusPerkawinan: 'Kawin', agama: 'Islam', nomorWhatsApp: '6281200000003', email: 'bagas.saputra@example.test', statusPegawai: 'Aktif' },
  { nama: 'Citra Lestari', kantor: 'Kanwil III', unit: 'Kantor Wilayah III', statusKepegawaian: 'PNS', golongan: 'IV/a', jabatan: 'Kepala Bagian', jenisKelamin: 'Perempuan', tanggalLahir: '1985-04-04', tempatLahir: 'Bandung', pendidikan: 'S2', disiplinIlmu: 'Manajemen', tanggalMulaiKerja: '2010-04-01', alamat: 'Alamat sintetis, Bandung', namaKontakDarurat: 'Rudi Lestari', kontakDarurat: '081200000004', statusPerkawinan: 'Kawin', agama: 'Islam', nomorWhatsApp: '6281200000004', email: 'citra.lestari@example.test', statusPegawai: 'Aktif' },
  { nama: 'Dimas Wibowo', kantor: 'Kanwil IV', unit: 'Kantor Wilayah IV', statusKepegawaian: 'PNS', golongan: 'II/c', jabatan: 'Pengelola Data', jenisKelamin: 'Laki-laki', tanggalLahir: '1991-05-05', tempatLahir: 'Surabaya', pendidikan: 'D3', disiplinIlmu: 'Komputer', tanggalMulaiKerja: '2018-02-01', alamat: 'Alamat sintetis, Surabaya', namaKontakDarurat: 'Sari Wibowo', kontakDarurat: '081200000005', statusPerkawinan: 'Belum kawin', agama: 'Katolik', nomorWhatsApp: '6281200000005', email: 'dimas.wibowo@example.test', statusPegawai: 'Aktif' },
  { nama: 'Eka Maharani', kantor: 'Kanwil V', unit: 'Kantor Wilayah V', statusKepegawaian: 'PPPK', golongan: 'XIII', jabatan: 'Analis Perkara', jenisKelamin: 'Perempuan', tanggalLahir: '1993-06-06', tempatLahir: 'Samarinda', pendidikan: 'S1', disiplinIlmu: 'Hukum', tanggalMulaiKerja: '2023-01-02', alamat: 'Alamat sintetis, Samarinda', namaKontakDarurat: 'Ari Maharani', kontakDarurat: '081200000006', statusPerkawinan: 'Kawin', agama: 'Hindu', nomorWhatsApp: '6281200000006', email: 'eka.maharani@example.test', statusPegawai: 'Aktif' },
  { nama: 'Farhan Ramadhan', kantor: 'Kanwil VI', unit: 'Kantor Wilayah VI', statusKepegawaian: 'PPPK', golongan: 'IV', jabatan: 'Analis Data', jenisKelamin: 'Laki-laki', tanggalLahir: '1989-07-07', tempatLahir: 'Makassar', pendidikan: 'S1', disiplinIlmu: 'Statistika', tanggalMulaiKerja: '2020-05-04', alamat: 'Alamat sintetis, Makassar', namaKontakDarurat: 'Nur Ramadhan', kontakDarurat: '081200000007', statusPerkawinan: 'Belum kawin', agama: 'Islam', nomorWhatsApp: '6281200000007', email: 'farhan.ramadhan@example.test', statusPegawai: 'Aktif' },
  { nama: 'Gita Anggraini', kantor: 'Kanwil VII', unit: 'Kantor Wilayah VII', statusKepegawaian: 'PNS', golongan: 'III/b', jabatan: 'Analis Kerja Sama', jenisKelamin: 'Perempuan', tanggalLahir: '1994-08-08', tempatLahir: 'Yogyakarta', pendidikan: 'S1', disiplinIlmu: 'Ilmu Pemerintahan', tanggalMulaiKerja: '2019-07-01', alamat: 'Alamat sintetis, Yogyakarta', namaKontakDarurat: 'Budi Anggraini', kontakDarurat: '081200000008', statusPerkawinan: 'Belum kawin', agama: 'Buddha', nomorWhatsApp: '6281200000008', email: 'gita.anggraini@example.test', statusPegawai: 'Aktif' },
]

const pad = (value: number) => String(value).padStart(2, '0')
const peopleWithIds: Employee[] = people.map((person, index) => {
  const seq = index + 1
  const birth = person.tanggalLahir.replaceAll('-', '')
  const pppk = person.statusKepegawaian === 'PPPK'
  const nip = `${birth}${pppk ? '202221' : '201812'}${person.jenisKelamin === 'Laki-laki' ? '1' : '2'}${String(seq).padStart(3, '0')}`
  const machineId = String(1001 + index)
  const appId = `APP-DEMO-${pad(seq)}`
  const nika = `1.${pad(seq)}.2026`
  return {
    ...person, id: `pegawai-demo-${pad(seq)}`, nip, nika, aliases: [
      { kind: 'mesin', value: `${person.kantor}:${machineId}`, source: 'Mesin Offline (contoh)' },
      { kind: 'app', value: appId, source: 'Mesin Online (contoh)' },
      { kind: 'nika', value: nika, source: 'Master demo' },
    ], sources: ['Master pegawai sintetis'], derived: [], pelatihan: ['Orientasi pegawai (contoh)'],
    workStatusPeriods: [], rateHistory: [],
  }
})

export const demoEmployees = peopleWithIds

export type DemoScenario = { id: string; employeeIndex: number; date: string; title: string; issues: IssueType[]; outcome: string }
export const demoScenarios: DemoScenario[] = [
  { id: 'scan-berbeda', employeeIndex: 0, date: '2026-09-02', title: 'Jam masuk berbeda antar sumber', issues: ['scan-berbeda'], outcome: 'Offline 07:50 dan online 08:10; admin memilih bukti yang berlaku.' },
  { id: 'telat', employeeIndex: 1, date: '2026-09-03', title: 'Terlambat check-in', issues: [], outcome: 'Kedua sumber 08:20; hari dapat disahkan, UM gugur karena terlambat 20 menit.' },
  { id: 'tanpa-checkout', employeeIndex: 2, date: '2026-09-04', title: 'Ada check-in, tidak ada check-out', issues: ['scan-tidak-lengkap'], outcome: 'Kedua sumber hanya mencatat masuk 07:50; UM ditahan sampai bukti lengkap.' },
  { id: 'tanpa-checkin', employeeIndex: 3, date: '2026-09-07', title: 'Ada check-out, tidak ada check-in', issues: ['scan-tidak-lengkap'], outcome: 'Kedua sumber hanya mencatat pulang; admin tidak bisa mengesahkan hadir dengan bukti ini.' },
  { id: 'cuti-vs-hadir', employeeIndex: 4, date: '2026-09-08', title: 'Cuti bertentangan dengan hadir', issues: ['cuti-vs-hadir', 'status-berbeda'], outcome: 'Offline mencatat cuti, online memiliki scan lengkap; pilih bukti dan status yang sah.' },
  { id: 'tiga-sumber', employeeIndex: 5, date: '2026-09-09', title: 'Tiga sumber pada hari yang sama', issues: ['dinas-vs-scan-kantor', 'status-berbeda'], outcome: 'Offline dan online mencatat WFO, ST mencatat dinas luar; ketiganya menunggu keputusan admin.' },
  { id: 'st-ganda', employeeIndex: 6, date: '2026-09-10', title: 'Dua ST tumpang tindih, satu tanpa nomor', issues: ['st-tumpang-tindih', 'st-tanpa-nomor'], outcome: 'Dua tujuan dinas berbeda pada tanggal yang sama; admin perlu memeriksa register ST.' },
  { id: 'pd-tanpa-st', employeeIndex: 7, date: '2026-09-11', title: 'Kode dinas tanpa ST pada tanggal itu', issues: ['pd-tanpa-st'], outcome: 'Offline berkode PD, register ST tidak mencakup tanggal ini; perlu verifikasi dokumen.' },
  { id: 'online-ditolak', employeeIndex: 0, date: '2026-09-14', title: 'Presensi online ditolak', issues: ['daring-ditolak'], outcome: 'Hanya ada online berstatus Reject; tidak cukup untuk mengesahkan hadir.' },
  { id: 'lokasi-wfo', employeeIndex: 1, date: '2026-09-15', title: 'Koordinat WFO jauh dari kantor', issues: ['wfo-di-luar-kantor'], outcome: 'Koordinat online menyimpang dari median kantor; indikasi lokasi perlu diperiksa.' },
  { id: 'jam-duplikat', employeeIndex: 2, date: '2026-09-16', title: 'Jam identik dengan hari sebelumnya', issues: ['jam-duplikat'], outcome: 'Catatan offline ditandai memiliki jam yang sama; online tetap terlihat sebagai alternatif.' },
  { id: 'jam-manual', employeeIndex: 3, date: '2026-09-17', title: 'Jam manual karena absen error', issues: ['jam-manual'], outcome: 'Hanya bukti offline dengan catatan Absen Eror; admin perlu bukti pendukung.' },
  { id: 'jadwal', employeeIndex: 4, date: '2026-09-18', title: 'Jadwal Ramadan di luar periode', issues: ['jadwal-tidak-sesuai'], outcome: 'Offline memakai jadwal puasa; online memakai jadwal normal untuk hari tersebut.' },
  { id: 'hari-libur', employeeIndex: 5, date: '2026-09-19', title: 'Hadir pada Sabtu', issues: ['hadir-hari-libur'], outcome: 'Ada scan pada akhir pekan; hari ini tidak masuk target hari kerja atau UM.' },
  { id: 'wfa-dinas', employeeIndex: 6, date: '2026-09-21', title: 'WFA bersamaan dengan ST dinas luar', issues: ['wfa-saat-dinas', 'status-berbeda'], outcome: 'Online mencatat WFA dan ST mencatat dinas luar; admin menentukan aktivitas yang berlaku.' },
  { id: 'data-kosong', employeeIndex: 0, date: '2026-09-23', title: 'Tidak ditemukan di ketiga sumber', issues: [], outcome: 'Matriks menampilkan tidak ditemukan; UM ditahan dan tidak otomatis dianggap TK.' },
  { id: 'tepat-batas', employeeIndex: 1, date: '2026-09-24', title: 'Check-in tepat pukul 08:00', issues: [], outcome: 'Demo memakai batas sebelum 08:00; hari dapat valid tetapi UM gugur pada aturan contoh.' },
  { id: 'pulang-awal', employeeIndex: 2, date: '2026-09-25', title: 'Pulang satu jam lebih awal', issues: [], outcome: 'Kedua sumber pulang 15:30 pada Jumat; UM gugur sesuai aturan demo.' },
  { id: 'wfa-normal', employeeIndex: 5, date: '2026-09-03', title: 'WFA lengkap dan tepat waktu', issues: [], outcome: 'Online mencatat WFA 07:55 sampai jadwal pulang; UM masuk setelah admin mengesahkan.' },
  { id: 'sakit', employeeIndex: 3, date: '2026-09-28', title: 'Sakit dengan kode yang konsisten', issues: [], outcome: 'Kedua sumber berkode S; dapat disahkan sakit dan tidak mendapat UM.' },
  { id: 'izin', employeeIndex: 4, date: '2026-09-29', title: 'Izin dengan kode yang konsisten', issues: [], outcome: 'Kedua sumber berkode I; dapat disahkan izin dan tidak mendapat UM.' },
  { id: 'tk', employeeIndex: 7, date: '2026-09-30', title: 'Absen eksplisit tanpa keterangan', issues: [], outcome: 'Kedua sumber berkode X; admin dapat menetapkan TK berdasarkan bukti tersebut.' },
  { id: 'diklat', employeeIndex: 6, date: '2026-09-28', title: 'Diklat dengan kode yang konsisten', issues: [], outcome: 'Kedua sumber berkode DIKLAT; hari sah sebagai diklat dan tidak mendapat UM.' },
  { id: 'dinas-lokal', employeeIndex: 7, date: '2026-09-29', title: 'ST dinas lokal', issues: [], outcome: 'ST dalam kota menjadi bukti dinas lokal; tidak mendapat UM pada aturan aktif.' },
]

export function freshDemoWorkspace(): Workspace {
  const state = emptyWorkspace()
  state.period = '2026-09'
  state.reviewer = 'Admin Demo'
  state.master = structuredClone(demoEmployees)
  state.policy = enforcePolicy({ ...DEFAULT_POLICY, arrivalBoundary: 'exclusive', parametersApproved: true, taxParametersApproved: false, countWfa: true })
  return state
}

function baseFile(id: string, fileName: string, kind: SourceKind, label: string, office: string): SourceFile {
  return {
    id, fileName, kind, label, office, importedAt: '2026-10-01T08:30:00.000Z', period: { start: START, end: END },
    coverageDeclarations: [{ start: START, end: END, status: 'complete', basis: 'Dataset demo sintetis mencakup seluruh rentang contoh', actorId: 'demo-admin', at: '2026-10-01T08:30:00.000Z' }],
    evidence: [], assignments: [], warnings: ['Data sintetis untuk demo lokal; tidak berasal dari data pegawai KPPU.'],
    stats: { rows: 0, people: 0 }, hash: 'DEMO-SYNTHETIC', parserVersion: 'demo-scripted-v1', completeThrough: END, active: true,
  }
}

function offlineFile(index: number): SourceFile {
  const employee = peopleWithIds[index]
  const id = `demo-offline-${index + 1}`
  const file = baseFile(id, `DUMMY_Mesin_Offline_${employee.kantor.replaceAll(' ', '_')}_2026-09.xlsx`, 'mesin', 'Mesin Offline · data simulasi', employee.kantor)
  file.evidence = attendanceDates(index).flatMap((date, row): Evidence[] => {
    const record = scenarioEvidence(index, date, {
      id: `${id}-e-${date}`, fileId: id, kind: 'mesin', office: employee.kantor, name: employee.nama,
      ids: { nip: employee.nip, nika: employee.nika, mesin: String(1001 + index) }, date,
      schedule: defaultSchedule(date), clockIn: arrivalTime(index, date), clockOut: defaultSchedule(date).end, mode: 'WFO', ref: `Data!${row + 2}`,
    })
    return record ? [record] : []
  })
  file.stats = { rows: file.evidence.length, people: 1 }
  return file
}

function onlineFile(): SourceFile {
  const id = 'demo-online-all'
  const file = baseFile(id, 'DUMMY_Mesin_Online_Seluruh_KPPU_2026-09.xlsx', 'daring', 'Mesin Online · data simulasi', 'Semua kantor')
  file.evidence = peopleWithIds.flatMap((employee, index) => attendanceDates(index).flatMap((date, row): Evidence[] => {
    const schedule = defaultSchedule(date)
    const record = scenarioEvidence(index, date, {
      id: `${id}-e-${index + 1}-${date}`, fileId: id, kind: 'daring', office: employee.kantor, name: employee.nama,
      ids: { nip: employee.nip, nika: employee.nika, appId: `APP-DEMO-${pad(index + 1)}` }, date,
      unit: `Satuan Pelaksana ${OFFICE_CITY[employee.kantor].split('/')[0]}`, schedule,
      clockIn: arrivalTime(index, date), clockOut: schedule.end, mode: 'WFO', approved: true,
      ref: `Rekap!${row + 2}`, location: employee.kantor, coordIn: officeCoordinates[index], coordOut: officeCoordinates[index],
    })
    return record ? [record] : []
  }))
  file.stats = { rows: file.evidence.length, people: peopleWithIds.length }
  return file
}

function suratTugasFile(index: number): SourceFile {
  const employee = peopleWithIds[index]
  const id = `demo-st-${index + 1}`
  const file = baseFile(id, `DUMMY_Rekap_ST_${employee.kantor.replaceAll(' ', '_')}_2026-09.xlsx`, 'surat-tugas', 'Surat Tugas · data simulasi', employee.kantor)
  const date = DUTY_DATES[index]
  const city = OFFICE_CITY[employee.kantor].split('/')[0]
  const assignment: Assignment = {
    id: `${id}-a-${date}`, fileId: id, office: employee.kantor, unit: employee.unit,
    letterNo: `ST-DEMO-${pad(index + 1)}/2026`, letterDate: `${date.slice(0, 7)}-01`,
    name: employee.nama, nip: employee.nip, start: date, end: date,
    rawDate: `${date.slice(-2)} September 2026`, destination: city === 'Jakarta' ? 'Bandung' : 'Jakarta',
    local: false, ref: `Register!${index + 2}`,
  }
  file.assignments = [assignment]
  const extra = (date: string, suffix: string, patch: Partial<Assignment> = {}): Assignment => ({
    ...assignment, id: `${id}-${suffix}`, letterNo: `ST-DEMO-${pad(index + 1)}-${suffix}/2026`,
    start: date, end: date, rawDate: `${date.slice(-2)} September 2026`, ref: `Register!${file.assignments.length + 3}`, ...patch,
  })
  if (index === 5) file.assignments.push(extra('2026-09-09', 'triple'))
  if (index === 6) {
    file.assignments.push(extra('2026-09-10', 'overlap-1', { destination: 'Bandung' }))
    file.assignments.push(extra('2026-09-10', 'overlap-2', { destination: 'Surabaya', letterNo: undefined }))
    file.assignments.push(extra('2026-09-21', 'wfa'))
  }
  if (index === 7) file.assignments.push(extra('2026-09-29', 'local', { destination: city, local: true }))
  file.stats = { rows: file.assignments.length, people: 1 }
  return file
}

export function demoSourceFiles(kind: 'offline' | 'online' | 'st'): SourceFile[] {
  if (kind === 'offline') return OFFICES.map((_, index) => offlineFile(index))
  if (kind === 'online') return [onlineFile()]
  return OFFICES.map((_, index) => suratTugasFile(index))
}

export function demoSourceForFilename(fileName: string): SourceFile | undefined {
  const text = fileName.toLowerCase()
  if (/online|darihp|daring/.test(text)) return onlineFile()
  const roman = text.match(/kanwil[_\s-]*(vii|vi|iv|v|iii|ii|i)(?:[_\s.-]|$)/i)?.[1]?.toUpperCase()
  const office = text.includes('pusat') ? 'Pusat' : roman ? `Kanwil ${roman}` : undefined
  const index = Math.max(0, OFFICES.indexOf(office ?? 'Pusat'))
  if (/st|surat.?tugas|rekap/.test(text) && office) return suratTugasFile(index)
  if (/offline|mesin/.test(text) && office) return offlineFile(index)
  return undefined
}

export function demoTripDates() { return [...DUTY_DATES] }

const officeCoordinates: [number, number][] = [[-6.20, 106.82], [3.59, 98.67], [-5.43, 105.26], [-6.91, 107.61], [-7.26, 112.75], [-0.50, 117.15], [-5.14, 119.41], [-7.80, 110.37]]
const arrivalTime = (index: number, date: string) => `07:${String(35 + (index + Number(date.slice(-2))) % 20).padStart(2, '0')}`
const attendanceDates = (index: number) => [...workdays.filter(date => date !== DUTY_DATES[index]), ...(index === 5 ? ['2026-09-19'] : [])]

function scenarioEvidence(index: number, date: string, evidence: Evidence): Evidence | undefined {
  const offline = evidence.kind === 'mesin'
  const key = `${index}|${date}`
  if (['0|2026-09-23', '6|2026-09-10', '7|2026-09-29'].includes(key)) return undefined
  if (offline && ['0|2026-09-14', '5|2026-09-03', '6|2026-09-21'].includes(key)) return undefined
  if (!offline && ['3|2026-09-17', '7|2026-09-11'].includes(key)) return undefined
  switch (key) {
    case '0|2026-09-02': return { ...evidence, clockIn: offline ? '07:50' : '08:10' }
    case '1|2026-09-03': return { ...evidence, clockIn: '08:20' }
    case '2|2026-09-04': return { ...evidence, clockIn: '07:50', clockOut: undefined, incomplete: true }
    case '3|2026-09-07': return { ...evidence, clockIn: undefined, incomplete: true }
    case '4|2026-09-08': return offline ? { ...evidence, clockIn: undefined, clockOut: undefined, code: 'C' } : evidence
    case '7|2026-09-11': return { ...evidence, clockIn: undefined, clockOut: undefined, code: 'PD' }
    case '0|2026-09-14': return { ...evidence, approved: false, clockOut: undefined }
    case '1|2026-09-15': return offline ? evidence : { ...evidence, coordIn: [-6.20, 106.82], coordOut: [-6.20, 106.82] }
    case '2|2026-09-16': return { ...evidence, clockIn: arrivalTime(index, '2026-09-15'), ...(offline ? { notes: ['jam-sama-hari-sebelumnya'] } : {}) }
    case '3|2026-09-17': return { ...evidence, notes: ['jam-manual-absen-error'] }
    case '4|2026-09-18': return offline ? { ...evidence, schedule: { start: '08:30', end: '15:00', label: 'Jadwal puasa' }, notes: ['jadwal-puasa'] } : evidence
    case '5|2026-09-03': return { ...evidence, clockIn: '07:55', mode: 'WFA', code: 'WFA' }
    case '6|2026-09-21': return { ...evidence, mode: 'WFA', code: 'WFA' }
    case '1|2026-09-24': return { ...evidence, clockIn: '08:00' }
    case '2|2026-09-25': return { ...evidence, clockOut: '15:30' }
    case '3|2026-09-28': return { ...evidence, clockIn: undefined, clockOut: undefined, code: 'S' }
    case '4|2026-09-29': return { ...evidence, clockIn: undefined, clockOut: undefined, code: 'I' }
    case '7|2026-09-30': return { ...evidence, clockIn: undefined, clockOut: undefined, code: 'X' }
    case '6|2026-09-28': return { ...evidence, clockIn: undefined, clockOut: undefined, code: 'DIKLAT' }
    default: return evidence
  }
}
