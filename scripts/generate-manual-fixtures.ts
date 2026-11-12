import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { MASTER_COLUMNS, parseMasterSheets, previewMasterImport } from '../src/lib/masterImport.ts'
import { readSheets } from '../src/lib/xlsx.ts'
import { parseWorkbook } from '../src/engine/parse.ts'
import { blankEmployee, buildRoster, matchKey } from '../src/engine/roster.ts'
import { eachDay, isWeekend, monthBounds } from '../src/engine/dates.ts'
import { OFFICES } from '../src/engine/ids.ts'
import { DEFAULT_POLICY, golGroup } from '../src/engine/policy.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { dayReviewProblem } from '../src/engine/dayReview.ts'
import { inspectMonthlyPackage } from '../src/engine/monthlyFlow.ts'
import type { DayReview, Employee, SourceFile } from '../src/engine/types.ts'

const period = '2026-09', bounds = monthBounds(period)
const out = path.resolve('artifacts/presentasi-manual-2026-09')
const workdays = eachDay(bounds.start, bounds.end).filter(date => !isWeekend(date))
const cities = ['Jakarta', 'Medan', 'Lampung', 'Bandung', 'Surabaya', 'Samarinda', 'Makassar', 'Yogyakarta']
const units = ['Biro Sumber Daya Manusia', ...cities.slice(1).map(city => `Satuan Pelaksana ${city}`)]
const coords = ['-6.20,106.82', '3.59,98.67', '-5.43,105.26', '-6.91,107.61', '-7.26,112.75', '-0.50,117.15', '-5.14,119.41', '-7.80,110.37']
const configs = [
  [0, 'Aditya Pratama', 'PNS', 'III/a', '1985-11-10', '2010-01-01', 'Laki-laki'],
  [0, 'Kirana Wulandari', 'PPPK', 'IX', '1992-10-30', '2025-01-01', 'Perempuan'],
  [1, 'Bagas Saputra', 'PNS', 'II/c', '1988-02-12', '2012-01-01', 'Laki-laki'],
  [2, 'Citra Paramita', 'PPPK', 'VIII', '1994-03-14', '2025-01-01', 'Perempuan'],
  [3, 'Dimas Mahendra', 'PNS', 'IV/a', '1980-04-16', '2005-01-01', 'Laki-laki'],
  [4, 'Elena Saraswati', 'PPPK', 'XIII', '1989-05-18', '2025-01-01', 'Perempuan'],
  [5, 'Fajar Nugraha', 'Non-ASN', '', '1996-06-20', '2024-01-01', 'Laki-laki'],
  [6, 'Gita Ayuningtyas', 'PNS', 'I/c', '1990-07-22', '2013-01-01', 'Perempuan'],
  [7, 'Hendra Kusuma', 'PPPK', 'XII', '1991-08-24', '2025-01-01', 'Laki-laki'],
] as const
const people: Employee[] = configs.map(([office, nama, status, golongan, birth, start, gender], index) => {
  const seq = String(index + 1).padStart(3, '0')
  const nip = status === 'Non-ASN' ? '' : birth.replaceAll('-', '') + start.slice(0, 4) + (status === 'PPPK' ? '21' : '01') + (gender === 'Laki-laki' ? '1' : '2') + seq
  return {
    ...blankEmployee(`pegawai-${seq}`), nama, nip, nika: `9.26.${String(index + 1).padStart(4, '0')}`,
    statusKepegawaian: status, statusPegawai: 'Aktif', kantor: OFFICES[office], unit: units[office], golongan,
    jabatan: ['Analis SDM', 'Analis Persaingan Usaha', 'Pengelola Administrasi'][index % 3],
    tanggalMulaiKerja: start, tanggalLahir: birth, jenisKelamin: gender, tempatLahir: cities[office],
    nomorWhatsApp: `6200000000${seq}`, email: `presentasi.${seq}@example.invalid`,
    agama: (['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'] as const)[index % 6],
    pendidikan: index % 3 === 0 ? 'S2' : 'S1', disiplinIlmu: ['Hukum', 'Manajemen', 'Ekonomi'][index % 3],
    alamat: `Jl. Mawar No. ${index + 1}, ${cities[office]}`,
    statusPerkawinan: index % 2 ? 'Belum Kawin' : 'Kawin',
    pelatihan: ['Pelatihan Persaingan Usaha 2025', 'Pelatihan Administrasi 2026'],
    namaKontakDarurat: `Kontak Keluarga ${seq}`, kontakDarurat: `6200001000${seq}`,
    aliases: [{ kind: 'app', value: `9.26.${String(index + 1).padStart(4, '0')}`, source: 'ID aplikasi presentasi' }, { kind: 'mesin', value: `${OFFICES[office]}:${101 + index}`, source: `PERANGKAT-${String(office + 1).padStart(2, '0')}` }],
    sources: ['Data master presentasi'],
  }
})
const special = [
  { person: people[7], kind: 'tugas-belajar' as const, start: '2026-09-14', end: '2026-09-18', basis: 'SK/TB/001/2026' },
  { person: people[8], kind: 'diperbantukan' as const, start: '2026-09-21', end: '2026-09-25', basis: 'SK/DPB/001/2026' },
]
const slug = (office: string) => office.replaceAll(' ', '_')
const identity = (p: Employee) => p.nip || p.nika
const officeIndex = (p: Employee) => OFFICES.indexOf(p.kantor)
const dutyPerson = (p: Employee) => p !== people[1]
const dutyDay = (p: Employee, date: string) => dutyPerson(p) && ['2026-09-09', '2026-09-10'].includes(date)
const missing = (p: Employee, date: string) => p === people[1] && date === '2026-09-17'
const leave = (p: Employee, date: string) => p === people[1] && date === '2026-09-15'
const wfa = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5
const times = (p: Employee, date: string) => {
  const index = people.indexOf(p), day = Number(date.slice(8))
  return { in: `07:${String(35 + (index + day) % 20).padStart(2, '0')}:00`, out: `${wfa(date) ? '16:35' : '16:05'}:00` }
}
const files: { file: string; type: string; office: string; rows: number }[] = []
await mkdir(out, { recursive: true })
async function workbook(relative: string, sheets: { name: string; rows: unknown[][] }[]) {
  const book = XLSX.utils.book_new()
  for (const { name, rows } of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = (rows[0] ?? []).map(header => ({ wch: Math.min(65, Math.max(18, String(header).length + 3)) }))
    sheet['!autofilter'] = { ref: sheet['!ref']! }
    for (const address of Object.keys(sheet).filter(key => !key.startsWith('!'))) if (typeof sheet[address].v === 'string') sheet[address].z = '@'
    XLSX.utils.book_append_sheet(book, sheet, name)
  }
  const target = path.join(out, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }))
}
const importRows = people.map(p => MASTER_COLUMNS.map(column => Array.isArray(p[column.key]) ? (p[column.key] as string[]).join('; ') : p[column.key]))
await workbook('01_MASTER_SIAP_IMPOR.xlsx', [{ name: 'Master Pegawai', rows: [MASTER_COLUMNS.map(c => c.header), ...importRows] }])
const fullHeaders = [
  'NIP / NI PPPK', 'NIKA / ID pegawai resmi KPPU', 'Nama lengkap', 'Status kepegawaian', 'Status aktif',
  'Kantor penempatan', 'Unit kerja', 'Jabatan', 'Golongan asli', 'Golongan setara UM', 'Tarif bruto harian acuan',
  'Tanggal mulai kerja', 'Tanggal lahir', 'Jenis kelamin', 'Nomor WhatsApp pegawai', 'Agama', 'Email pegawai',
  'Pendidikan terakhir', 'Jurusan / disiplin ilmu', 'Tempat lahir', 'Alamat', 'Status perkawinan', 'Riwayat pelatihan',
  'Nama kontak darurat', 'Nomor kontak darurat', 'Tanggal efektif perubahan status kepegawaian',
  'Jenis status khusus', 'Tanggal mulai status khusus', 'Tanggal selesai status khusus', 'Dasar dokumen status khusus',
  'Tanggal efektif mutasi', 'Riwayat perubahan kantor / unit / golongan / status aktif',
  'ID aplikasi absensi', 'ID pengguna mesin absensi', 'Identitas perangkat mesin', 'Kantor terkait mesin',
]
const history: unknown[][] = [], aliases: unknown[][] = []
const fullRows = people.map((p, index) => {
  const group = golGroup(p.golongan, p.statusKepegawaian, 'III'), periodStatus = special.find(s => s.person === p)
  const priorOffice = OFFICES[(officeIndex(p) + 1) % OFFICES.length]
  const priorGrade = ({ 'III/a': 'II/d', IX: 'VIII', 'II/c': 'II/b', VIII: 'VII', 'IV/a': 'III/d', XIII: 'XII', 'I/c': 'I/b', XII: 'XI' } as Record<string, string>)[p.golongan] ?? 'Tidak berlaku ASN'
  const historyText = `2026-08-01: ${priorOffice} / Unit Lama -> ${p.kantor} / ${p.unit}; ${priorGrade} -> ${p.golongan || 'Tidak berlaku ASN'}; Nonaktif -> Aktif; SK/MUT/${index + 1}/2026`
  history.push([p.nika, p.nama, '2026-08-01', priorOffice, p.kantor, 'Unit Lama', p.unit, priorGrade, p.golongan || 'Tidak berlaku ASN', 'Nonaktif', 'Aktif', p.statusKepegawaian, p.statusKepegawaian, `SK/MUT/${index + 1}/2026`])
  aliases.push([p.nika, p.nama, p.nip, p.nika, String(101 + index), `PERANGKAT-${String(officeIndex(p) + 1).padStart(2, '0')}`, p.kantor])
  return [p.nip, p.nika, p.nama, p.statusKepegawaian, p.statusPegawai, p.kantor, p.unit, p.jabatan, p.golongan || 'Tidak berlaku ASN', group.assumed ? 'Belum ditetapkan' : group.group, group.assumed ? '' : DEFAULT_POLICY.rates[group.group],
    p.tanggalMulaiKerja, p.tanggalLahir, p.jenisKelamin, p.nomorWhatsApp, p.agama, p.email, p.pendidikan, p.disiplinIlmu, p.tempatLahir, p.alamat, p.statusPerkawinan, p.pelatihan.join('; '), p.namaKontakDarurat, p.kontakDarurat,
    p.tanggalMulaiKerja, periodStatus?.kind ?? 'Tidak ada', periodStatus?.start ?? '', periodStatus?.end ?? '', periodStatus?.basis ?? '', '2026-08-01', historyText,
    p.nika, String(101 + index), `PERANGKAT-${String(officeIndex(p) + 1).padStart(2, '0')}`, p.kantor]
})
await workbook('02_MASTER_LENGKAP_DAN_RIWAYAT.xlsx', [
  { name: 'Master Lengkap Referensi', rows: [fullHeaders, ...fullRows] },
  { name: 'Riwayat Mutasi', rows: [['ID referensi pegawai', 'Pegawai referensi', 'Tanggal efektif', 'Kantor lama', 'Kantor baru', 'Unit lama', 'Unit baru', 'Golongan lama', 'Golongan baru', 'Status aktif lama', 'Status aktif baru', 'Status ASN lama', 'Status ASN baru', 'Dasar dokumen'], ...history] },
  { name: 'Riwayat Status Kepegawaian', rows: [['ID referensi pegawai', 'Pegawai referensi', 'Tanggal efektif', 'Status sebelumnya', 'Status saat ini', 'Dasar dokumen'], ...people.map((p, index) => [p.nika, p.nama, p.tanggalMulaiKerja, p.statusKepegawaian === 'Non-ASN' ? 'Belum bekerja' : 'Non-ASN', p.statusKepegawaian, `SK/ASN/${index + 1}`])] },
  { name: 'Status Khusus', rows: [['ID referensi pegawai', 'Pegawai referensi', 'Jenis status', 'Mulai', 'Selesai', 'Dasar dokumen'], ...special.map(s => [s.person.nika, s.person.nama, s.kind, s.start, s.end, s.basis])] },
  { name: 'Identitas Absensi', rows: [['ID referensi pegawai', 'Pegawai referensi', 'NIP referensi', 'ID aplikasi', 'ID pengguna mesin', 'Identitas perangkat', 'Kantor terkait'], ...aliases] },
  { name: 'Riwayat Pelatihan', rows: [['ID referensi pegawai', 'Pegawai referensi', 'Pelatihan', 'Tanggal', 'Penyelenggara'], ...people.flatMap(p => p.pelatihan.map((course, i) => [p.nika, p.nama, course, i ? '2026-06-10' : '2025-07-15', 'Pusat Pelatihan']))] },
])

const machineHeaders = ['NIK', 'No. ID', 'Nama', 'Tanggal', 'Jam Kerja', 'Jam Masuk', 'Jam Pulang', 'Scan Masuk', 'Scan Pulang', 'Terlambat', 'Plg. Cepat', 'Absent', 'Lembur', 'Pengecualian', 'Departemen']
for (const office of OFFICES) {
  const rows: unknown[][] = []
  for (const p of people.filter(person => person.kantor === office)) for (const date of workdays) {
    if (missing(p, date)) continue
    const duty = dutyDay(p, date), local = p.kantor === 'Kanwil I', time = times(p, date)
    const code = duty ? local ? 'DL' : 'PD' : leave(p, date) ? 'Cuti' : wfa(date) ? 'WFA' : ''
    const ddmmyyyy = date.split('-').reverse().join('/')
    rows.push([identity(p), String(101 + people.indexOf(p)), p.nama, ddmmyyyy, 'Jadwal Normal', '08:00', wfa(date) ? '16:30' : '16:00', code ? '' : time.in, code ? '' : time.out, '', '', code ? 'True' : 'False', '', code, p.unit])
  }
  const file = `absensi/mesin-offline/Mesin_Offline_${slug(office)}_2026-09.xlsx`
  await workbook(file, [{ name: 'Absensi', rows: [machineHeaders, ...rows] }])
  files.push({ file, type: 'mesin', office, rows: rows.length })
}
const onlineRows: unknown[][] = []
for (const p of people) for (const date of workdays) {
  if (missing(p, date) || leave(p, date) || dutyDay(p, date)) continue
  const time = times(p, date), mismatch = p === people[0] && date === '2026-09-07', office = officeIndex(p)
  onlineRows.push([p.nama, date.split('-').reverse().join('/'), identity(p), mismatch ? '08:05:00' : time.in, time.out, mismatch ? '00:05' : '', '', '', wfa(date) ? '08:30' : '08:00', wfa(date) ? 'WFA' : 'WFO', `${p.nika}_${date}.jpg`, `Lokasi ${cities[office]}`, p.unit, coords[office], coords[office], 'Approved'])
}
const onlineFile = 'absensi/mesin-online/Mesin_Online_Seluruh_KPPU_2026-09.xlsx'
await workbook(onlineFile, [{ name: 'Presensi Daring', rows: [['Nama Pegawai', 'Tanggal', 'NIP', 'Jam Mulai', 'Jam Selesai', 'Terlambat', 'Pulang Cepat', 'Lembur', 'Min. Durasi', 'Jenis', 'Foto', 'Nama Lokasi', 'Unit', 'Koordinat (In)', 'Koordinat (Out)', 'Status'], ...onlineRows] }])
files.push({ file: onlineFile, type: 'daring', office: 'Semua kantor', rows: onlineRows.length })
for (const office of OFFICES) {
  const local = office === 'Kanwil I', participants = people.filter(p => p.kantor === office && dutyPerson(p))
  const rows = participants.map((p, i) => [String(i + 1), `ST/${slug(office)}/001/2026`, '01/09/2026', p.nama, p.nip, '9-10 September 2026', `Kota ${cities[officeIndex(p)]}`])
  const file = `absensi/surat-tugas/Rekap_ST_${slug(office)}_2026-09.xlsx`
  await workbook(file, [{ name: local ? 'ST Lokal' : 'ST Dinas Luar', rows: [['No', 'No. ST', 'Tanggal ST', 'Nama Pegawai', 'NIP PPPK', 'Tanggal Kegiatan', 'Tujuan'], ...rows] }])
  files.push({ file, type: 'surat-tugas', office, rows: rows.length })
}

// Validate actual XLSX bytes with the same readers used in the application.
const sheets = async (relative: string) => readSheets(new File([await readFile(path.join(out, relative))], path.basename(relative)))
const masterParsed = parseMasterSheets(await sheets('01_MASTER_SIAP_IMPOR.xlsx'))
const plan = previewMasterImport(masterParsed, [])
if (plan.invalid || plan.rows.length !== people.length || masterParsed.notices.length) throw new Error(`Master validation failed: ${JSON.stringify(plan.entries.filter(e => e.errors.length))}`)
const importedPeople = plan.rows.map((row, index) => ({ ...blankEmployee(people[index].id), ...row }))
const sources: SourceFile[] = []
for (const [index, file] of files.entries()) {
  const source = parseWorkbook(path.basename(file.file), await sheets(file.file), `presentasi-source-${index + 1}`)
  if (source.kind !== file.type || source.office !== file.office || source.stats.rows !== file.rows || source.quarantined?.length) throw new Error(`Parser mismatch ${file.file}: ${JSON.stringify({ kind: source.kind, office: source.office, rows: source.stats.rows, quarantineCount: source.quarantined?.length, example: source.quarantined?.[0] })}`)
  source.completeThrough = bounds.end
  sources.push(source)
}
if (!inspectMonthlyPackage(sources, period).ready) throw new Error('Monthly package incomplete')
const decisions = [{ key: matchKey(people[6].kantor, people[6].nama), employeeId: people[6].id, reviewer: 'Validator', at: '2026-10-26T00:00:00Z' }]
const roster = buildRoster(sources, importedPeople, {}, decisions)
if (roster.employees.length !== people.length || roster.conflicts.length) throw new Error('Roster duplicated or conflicting')
const policy = { ...structuredClone(DEFAULT_POLICY), parametersApproved: true, arrivalBoundary: 'inclusive' as const, taxParametersApproved: false }
const initial = reconcile(sources, roster, bounds, policy, [], '2026-10-26', [])
const reviews: DayReview[] = initial.months.flatMap(month => month.days.filter(day => day.workday).map(day => {
  const p = people.find(person => person.id === month.employee.id)!, st = day.assignments[0]
  const selected = wfa(day.date) ? day.evidence.find(e => e.kind === 'daring') : day.evidence.find(e => e.kind === 'mesin')
  const status = st ? st.local ? 'dinas-lokal' : 'dinas-luar' : missing(p, day.date) ? 'tanpa-keterangan' : leave(p, day.date) ? 'cuti' : wfa(day.date) ? 'hadir-wfa' : 'hadir'
  const review: DayReview = { employeeId: p.id, date: day.date, status, evidenceIds: st || !selected ? [] : [selected.id], assignmentIds: st ? [st.id] : [], note: 'Keputusan contoh untuk validasi; gunakan sumber sesuai panduan manual', reviewer: 'Validator', actorId: 'validator-contoh', at: '2026-10-26T00:00:00Z', signature: day.reviewSignature }
  const problem = dayReviewProblem(review, day.evidence, day.assignments)
  if (problem) throw new Error(`${p.nama} ${day.date}: ${problem}`)
  return review
}))
const result = reconcile(sources, roster, bounds, policy, [], '2026-10-26', reviews)
if (result.months.some(m => m.openIssues || m.reviewedDays !== workdays.length || (m.employee.statusKepegawaian !== 'Non-ASN' && (m.heldDays || m.amountPendingDays)))) throw new Error(`Unexpected final state: ${JSON.stringify(result.months.map(m => ({ name: m.employee.nama, valid: m.reviewedDays, held: m.heldDays, pending: m.amountPendingDays, issues: m.openIssues })))}`)
const afterSpecialPeople = importedPeople.map(p => ({ ...p, workStatusPeriods: special.filter(s => s.person.id === p.id).map(({ kind, start, end, basis }) => ({ kind, start, end, basis })) }))
const afterSpecial = reconcile(sources, buildRoster(sources, afterSpecialPeople, {}, decisions), bounds, policy, [], '2026-10-26', reviews)
// Optional test-only policy allows the complete approval flow, including Non-ASN.
// These figures are intentionally not an assertion about KPPU's official rules.
const submissionTestPolicy = { ...policy, includeNonAsn: true, taxParametersApproved: true }
const submissionTestPeople = afterSpecialPeople.map(p => p.statusKepegawaian === 'Non-ASN' ? { ...p, rateHistory: [{ start: bounds.start, end: bounds.end, rate: 35000, pph: 0, basis: 'SK-UM-NON-ASN-2026-09-CONTOH' }] } : p)
const submissionTest = reconcile(sources, buildRoster(sources, submissionTestPeople, {}, decisions), bounds, submissionTestPolicy, [], '2026-10-26', reviews)
if (submissionTest.months.some(m => m.heldDays || m.amountPendingDays || m.openIssues || !m.nettoReady)) throw new Error('Optional synthetic submission fixture is not complete')
const summary = result.months.map(month => {
  const changed = afterSpecial.months.find(m => m.employee.id === month.employee.id)!
  return [month.employee.nama, month.employee.kantor, month.employee.nip, month.employee.nika, month.employee.statusKepegawaian, month.employee.golongan, month.workdays, month.reviewedDays, month.mealDays, month.heldDays, month.bruto, changed.bruto, 'PPh / netto belum ditetapkan']
})
await workbook('03_PANDUAN_REKONSILIASI_DAN_HASIL.xlsx', [
  { name: 'Ringkasan Bruto', rows: [['Pegawai', 'Kantor', 'NIP', 'NIKA', 'Status', 'Golongan', 'Hari Kerja', 'Hari Valid', 'Hari UM', 'Hari Ditahan', 'Bruto sebelum status khusus', 'Bruto setelah status khusus', 'Pajak'], ...summary] },
  { name: 'Keputusan per Hari', rows: [['Pegawai', 'Kantor', 'Tanggal', 'Status yang dipilih', 'Sumber dipilih', 'Jam masuk', 'Jam pulang', 'Keadaan UM', 'Bruto harian', 'Alasan'], ...result.months.flatMap(month => month.days.filter(d => d.workday).map(day => {
    const review = reviews.find(r => r.employeeId === month.employee.id && r.date === day.date)!
    return [month.employee.nama, month.employee.kantor, day.date, review.status, review.assignmentIds.length ? 'ST' : review.status === 'hadir-wfa' ? 'Mesin Online' : review.evidenceIds.length ? 'Mesin Offline' : 'Tidak ada bukti: konfirmasi tanpa keterangan', day.clockIn ?? '', day.clockOut ?? '', day.meal.state, day.meal.amount, day.meal.reason]
  }))] },
  { name: 'Status Khusus Manual', rows: [['Pegawai', 'Jenis', 'Mulai', 'Selesai', 'Dasar dokumen'], ...special.map(s => [s.person.nama, s.kind, s.start, s.end, s.basis])] },
  { name: 'Pengajuan Simulasi', rows: [['Pegawai', 'Kantor', 'Hari UM', 'Bruto', 'PPh simulasi 0%', 'Netto simulasi', 'Catatan'], ...submissionTest.months.map(m => [m.employee.nama, m.employee.kantor, m.mealDays, m.bruto, m.pph, m.netto, m.employee.statusKepegawaian === 'Non-ASN' ? 'Tarif efektif Non-ASN Rp35.000 hanya untuk simulasi' : 'PPh 0% hanya untuk simulasi'])] },
])
const manifest = { dataset: 'SYNTHETIC ONLY - NOT OFFICIAL KPPU DATA', period, employees: people.length, workdays: workdays.length, targetEmployeeDays: people.length * workdays.length, attendanceFiles: files, validMasterRows: plan.rows.length, parserQuarantinedRows: sources.reduce((n, f) => n + (f.quarantined?.length ?? 0), 0), rosterEmployees: roster.employees.length, validationOnlyDecisions: decisions.length, initialReviewedDays: initial.months.reduce((n, m) => n + m.reviewedDays, 0), validationReviews: reviews.length, totalBrutoBeforeSpecial: result.months.reduce((n, m) => n + m.bruto, 0), totalBrutoAfterSpecial: afterSpecial.months.reduce((n, m) => n + m.bruto, 0), contacts: 'All contact values are fictional placeholders; email addresses use example.invalid. Do not send messages.', notes: 'Validation decisions were used only in this offline check. No data was uploaded to the live database.' }
Object.assign(manifest, { fullMasterColumns: fullHeaders.length, syntheticSubmissionReady: true, syntheticSubmissionBruto: submissionTest.months.reduce((n, m) => n + m.bruto, 0), syntheticSubmissionNetto: submissionTest.months.reduce((n, m) => n + m.netto, 0) })
await writeFile(path.join(out, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(path.join(out, 'README.md'), `# Panduan paket presentasi KPPU

Data pada paket ini bersifat fiktif untuk presentasi. Periode **September 2026**, **${people.length} pegawai**, **${workdays.length} hari kerja**, mencakup seluruh **8 kantor**. NIP dan NIKA hanya mengikuti bentuk format, bukan identitas resmi. Nomor kontak dan alamat email adalah nilai contoh; jangan kirim pesan ke nomor pada paket.

## Urutan penggunaan

1. **Tambah Data → Bulk Import:** unggah **01_MASTER_SIAP_IMPOR.xlsx**. Preview berisi ${people.length} baris valid. File **02_MASTER_LENGKAP_DAN_RIWAYAT.xlsx** adalah referensi lengkap, bukan file impor utama.
2. Pilih periode **2026-09**.
3. **Impor Sumber → Mesin Offline:** unggah 8 workbook di folder **absensi/mesin-offline**, satu per kantor. Periksa preview sebelum menyimpan.
4. Unggah **Mesin Online** dari satu workbook gabungan di **absensi/mesin-online**.
5. Unggah 8 workbook ST dari **absensi/surat-tugas**. Pada setiap kantor, konfirmasikan cakupan sampai **2026-09-30**. Paket menyediakan register ST untuk semua kantor, jadi jangan pilih pernyataan nihil.
6. **Pencocokan Identitas:** peserta Non-ASN Fajar perlu dipetakan manual ke profilnya. Tujuh peserta ST PNS/PPPK cocok melalui NIP.
7. **Rekonsiliasi:** seluruh ${people.length * workdays.length} hari-orang menunggu keputusan admin. Gunakan **03_PANDUAN_REKONSILIASI_DAN_HASIL.xlsx** sebagai pembanding; keputusan di file itu tidak dipraisi ke aplikasi.
8. **Uang Makan:** tinjau hasil menggunakan aturan yang sudah disahkan di aplikasi. Jangan mengubah tarif atau parameter pajak produksi untuk mengikuti angka simulasi. Non-ASN tetap tertahan sampai ada dasar tarif yang disahkan.

## Batas impor master

Importer saat ini mengenali ${MASTER_COLUMNS.length} kolom: ${MASTER_COLUMNS.map(c => c.header).join(', ')}. File 01 berisi kolom yang dapat diimpor. File 02 memuat 36 kolom referensi dan sheet **Riwayat Mutasi**, **Riwayat Status Kepegawaian**, **Status Khusus**, **Identitas Absensi**, dan **Riwayat Pelatihan**. Sebagian kolom tambahan belum dapat dimasukkan lewat bulk import.

Status khusus Gita dan Hendra pada sheet **Status Khusus** dapat ditambahkan lewat profil jika ingin mendemokan perubahan status bertanggal. Identitas perangkat, sejarah mutasi, dan detail pelatihan disediakan sebagai referensi; aplikasi belum mengimpor seluruh riwayat tersebut.

## Contoh yang tersedia

- Kehadiran WFO pada hari kerja biasa dan WFA pada hari Jumat.
- Perbedaan jam Mesin Offline dan Mesin Online pada Aditya, 7 September.
- Dinas tanggal 9–10 September dengan ST di masing-masing kantor.
- Cuti Kirana pada 15 September dan hari tanpa bukti pada 17 September.
- Status tugas belajar Gita dan diperbantukan Hendra pada sheet referensi.

## Validasi file

Workbook sudah dibaca dengan parser master dan absensi aplikasi. Hasil validasi berisi **${plan.rows.length} master valid**, **${sources.reduce((n, f) => n + (f.quarantined?.length ?? 0), 0)} baris sumber dikarantina**, dan roster **${roster.employees.length} pegawai**. Keputusan yang dipakai untuk menghitung angka pembanding hanya validasi lokal; tidak ada data yang diunggah ke database.
`)
const hashes: Record<string, string> = {}
for (const filename of ['01_MASTER_SIAP_IMPOR.xlsx', '02_MASTER_LENGKAP_DAN_RIWAYAT.xlsx', '03_PANDUAN_REKONSILIASI_DAN_HASIL.xlsx', ...files.map(f => f.file)]) hashes[filename] = createHash('sha256').update(await readFile(path.join(out, filename))).digest('hex')
await writeFile(path.join(out, 'SHA256SUMS.json'), JSON.stringify(hashes, null, 2) + '\n')
console.log(JSON.stringify({ directory: out, ...manifest }, null, 2))
