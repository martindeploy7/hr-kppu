import type { Employee } from '../../engine/types.ts'
import { OFFICES } from '../../engine/ids.ts'
import { monthLabel } from '../../engine/dates.ts'
import { ageFrom } from '../../lib/format.ts'

/* Pure data helpers for the people dashboard (no React). */

export type EmployeeGroup = { name: string; employees: Employee[]; missing: boolean }
export type EmployeeEvent = { employee: Employee; date: string }
export type MonthBucket = { key: string; label: string; full: string; employees: Employee[] }
export type AgeBand = { label: string; employees: Employee[]; male: Employee[]; female: Employee[] }
export type WindowMonths = 3 | 6 | 12

export const WINDOWS: WindowMonths[] = [3, 6, 12]
export const ALL_OFFICES = 'all'

export const FIELDS: { key: keyof Employee; label: string; why: string }[] = [
  { key: 'nip', label: 'NIP', why: 'Identitas pegawai' },
  { key: 'golongan', label: 'Golongan', why: 'Tarif uang makan' },
  { key: 'jabatan', label: 'Jabatan', why: 'Profil pegawai' },
  { key: 'peringkatJabatan', label: 'Peringkat jabatan', why: 'Pengelompokan jabatan' },
  { key: 'jenisJabatan', label: 'Jenis jabatan', why: 'Klasifikasi jabatan fungsional' },
  { key: 'pendidikan', label: 'Pendidikan', why: 'Profil pegawai' },
  { key: 'tanggalMulaiKerja', label: 'Tanggal mulai kerja', why: 'Pegawai baru' },
  { key: 'tanggalPensiun', label: 'Tanggal pensiun', why: 'Perkiraan pegawai pensiun' },
  { key: 'tanggalPengunduranDiri', label: 'Tanggal pengunduran diri', why: 'Riwayat pegawai keluar' },
  { key: 'nomorWhatsApp', label: 'Nomor WhatsApp', why: 'Pesan pegawai' },
  { key: 'agama', label: 'Agama', why: 'Pesan hari raya' },
  { key: 'email', label: 'Email', why: 'Notifikasi resmi' },
  { key: 'tanggalLahir', label: 'Tanggal lahir', why: 'Kelompok usia' },
]

/* ---------- formatting ---------- */

export function share(count: number, total: number) {
  if (!total || !count) return '0%'
  const value = (count / total) * 100
  return value < 1 ? '<1%' : `${Math.round(value)}%`
}

export function employeeMeta(employee: Employee) {
  return [employee.jabatan, employee.kantor, employee.unit].filter(Boolean).join(' · ') || employee.statusKepegawaian
}

/* ---------- grouping ---------- */

export function isMissingName(name: string) {
  return /belum diisi$|belum diketahui$/i.test(name.trim())
}

export function makeGroup(name: string, employees: Employee[]): EmployeeGroup {
  return { name, employees, missing: isMissingName(name) }
}

export function groupEmployees(employees: Employee[], value: (employee: Employee) => string): EmployeeGroup[] {
  const groups = new Map<string, EmployeeGroup>()
  for (const employee of employees) {
    const name = value(employee).trim() || 'Belum diisi'
    const key = name.toLocaleLowerCase('id-ID')
    const group = groups.get(key) ?? makeGroup(name, [])
    group.employees.push(employee)
    groups.set(key, group)
  }
  return orderGroups([...groups.values()], 'count')
}

/** Missing buckets always sink to the bottom so real categories lead. */
export function orderGroups(groups: EmployeeGroup[], mode: 'count' | 'name') {
  return [...groups].sort((a, b) => {
    if (a.missing !== b.missing) return a.missing ? 1 : -1
    if (mode === 'name') return a.name.localeCompare(b.name, 'id', { numeric: true })
    return b.employees.length - a.employees.length || a.name.localeCompare(b.name, 'id', { numeric: true })
  })
}

/* ---------- dates ---------- */

export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function shiftMonths(dateText: string, amount: number) {
  const [year, month, day] = dateText.split('-').map(Number)
  const total = year * 12 + (month - 1) + amount
  const nextYear = Math.floor(total / 12)
  const nextMonth = (total % 12) + 1
  const lastDay = new Date(nextYear, nextMonth, 0).getDate()
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** One bucket per calendar month between two ISO dates (inclusive), even when empty. */
export function monthBuckets(items: EmployeeEvent[], startDate: string, endDate: string): MonthBucket[] {
  const [startYear, startMonth] = startDate.split('-').map(Number)
  const [endYear, endMonth] = endDate.split('-').map(Number)
  const buckets: MonthBucket[] = []
  let year = startYear
  let month = startMonth
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const key = `${year}-${String(month).padStart(2, '0')}`
    buckets.push({ key, label: SHORT_MONTHS[month - 1], full: monthLabel(key), employees: [] })
    month++
    if (month > 12) { month = 1; year++ }
  }
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]))
  for (const item of items) byKey.get(item.date.slice(0, 7))?.employees.push(item.employee)
  return buckets
}

/* ---------- education ---------- */

export const EDUCATION_ORDER = ['S3', 'S2', 'S1', 'D4 / Sarjana Terapan', 'D3', 'D2', 'D1', 'SMA / sederajat', 'SMP / sederajat', 'SD / sederajat']

export function educationLevel(value: string) {
  const raw = value.trim()
  if (!raw) return 'Pendidikan belum diisi'
  const compact = raw.toLocaleUpperCase('id-ID').replace(/[\s._]/g, '').replace(/STRATA/g, 'S')
  if (/^(S3|DOKTOR|DOKTORAL|PH\.D)/.test(compact)) return 'S3'
  if (/^(S2|MAGISTER|MASTER)/.test(compact)) return 'S2'
  if (/^SARJANATERAPAN/.test(compact)) return 'D4 / Sarjana Terapan'
  if (/^(S1|SARJANA|BACHELOR)/.test(compact)) return 'S1'
  if (/^(D4|DIV|D-IV|DIPLOMAIV)/.test(compact)) return 'D4 / Sarjana Terapan'
  if (/^(D3|DIII|D-III|DIPLOMAIII)/.test(compact)) return 'D3'
  if (/^(D2|DII|D-II|DIPLOMAII)/.test(compact)) return 'D2'
  if (/^(D1|DI|D-I|DIPLOMAI)/.test(compact)) return 'D1'
  if (/^(SMA|SMK|SLTA|PAKETC|MADRASAHALIYAH)/.test(compact) || compact === 'MA') return 'SMA / sederajat'
  if (/^(SMP|SLTP|MTS)/.test(compact)) return 'SMP / sederajat'
  if (/^(SD|MI)/.test(compact)) return 'SD / sederajat'
  return raw
}

/** Education runs highest to lowest; unrecognised raw values follow by size; missing is last. */
export function orderEducation(groups: EmployeeGroup[]) {
  const rank = (group: EmployeeGroup) => {
    if (group.missing) return 1000
    const index = EDUCATION_ORDER.indexOf(group.name)
    return index < 0 ? 500 : index
  }
  return [...groups].sort((a, b) => rank(a) - rank(b) || b.employees.length - a.employees.length || a.name.localeCompare(b.name, 'id'))
}

export function peringkatLabel(value: string | undefined) {
  const raw = (value ?? '').trim()
  if (!raw) return 'Peringkat jabatan belum diisi'
  return /^\d+$/.test(raw) ? `Peringkat ${raw}` : raw
}

/* ---------- age ---------- */

const BAND_EDGES: { label: string; min: number; max: number }[] = [
  { label: '< 25', min: 0, max: 24 },
  { label: '25–29', min: 25, max: 29 },
  { label: '30–34', min: 30, max: 34 },
  { label: '35–39', min: 35, max: 39 },
  { label: '40–44', min: 40, max: 44 },
  { label: '45–49', min: 45, max: 49 },
  { label: '50–54', min: 50, max: 54 },
  { label: '55–59', min: 55, max: 59 },
  { label: '60+', min: 60, max: 200 },
]

export const COARSE_AGES: { label: string; min: number; max: number }[] = [
  { label: '< 30 tahun', min: 0, max: 29 },
  { label: '30–39 tahun', min: 30, max: 39 },
  { label: '40–49 tahun', min: 40, max: 49 },
  { label: '50+ tahun', min: 50, max: 200 },
]

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/* ---------- stats ---------- */

export function officeGroups(employees: Employee[]) {
  return groupEmployees(employees, e => e.kantor || 'Kantor belum diisi').sort((a, b) => {
    if (a.missing !== b.missing) return a.missing ? 1 : -1
    const rankA = OFFICES.indexOf(a.name), rankB = OFFICES.indexOf(b.name)
    return (rankA < 0 ? 99 : rankA) - (rankB < 0 ? 99 : rankB) || a.name.localeCompare(b.name, 'id')
  })
}

const STATUS_ORDER = ['PNS', 'PPPK', 'Non-ASN', 'Belum diketahui'] as const
const GENDERS = ['Laki-laki', 'Perempuan'] as const

export function buildStats(emps: Employee[], today: string) {
  const units = groupEmployees(emps, e => (e.unit || 'Unit belum diisi').replace(/ - Sekretaris Jenderal$/, ''))
  const education = orderEducation(groupEmployees(emps, e => educationLevel(e.pendidikan)))
  const rank = groupEmployees(emps, e => peringkatLabel(e.peringkatJabatan))

  const functionalEmployees = emps.filter(e => /^(?:jabatan\s+)?fungsional(?:\b|$)/i.test(e.jenisJabatan?.trim() ?? ''))
  const functional = groupEmployees(functionalEmployees, e => e.jabatan || 'Jabatan belum diisi')
  const unclassifiedJobs = emps.filter(e => !e.jenisJabatan?.trim())
  if (unclassifiedJobs.length) functional.push(makeGroup('Jenis jabatan belum diisi', unclassifiedJobs))
  const functionalTotal = functionalEmployees.length + unclassifiedJobs.length

  const status = STATUS_ORDER
    .map(name => makeGroup(name, emps.filter(e => e.statusKepegawaian === name)))
    .filter(group => group.employees.length)
  const male = emps.filter(e => e.jenisKelamin === 'Laki-laki')
  const female = emps.filter(e => e.jenisKelamin === 'Perempuan')
  const unknownGender = emps.filter(e => e.jenisKelamin !== 'Laki-laki' && e.jenisKelamin !== 'Perempuan')
  const gender = [
    ...GENDERS.map(name => makeGroup(name, name === 'Laki-laki' ? male : female)),
    makeGroup('Jenis kelamin belum diisi', unknownGender),
  ].filter(group => group.employees.length)

  const withAge = emps.filter(e => e.tanggalLahir)
  const unknownAge = emps.filter(e => !e.tanggalLahir)
  const ages = withAge.map(e => ageFrom(e.tanggalLahir))
  const avgAge = ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0
  const bands: AgeBand[] = BAND_EDGES.map(edge => {
    const employees = withAge.filter(e => { const age = ageFrom(e.tanggalLahir); return age >= edge.min && age <= edge.max })
    return {
      label: edge.label,
      employees,
      male: employees.filter(e => e.jenisKelamin === 'Laki-laki'),
      female: employees.filter(e => e.jenisKelamin === 'Perempuan'),
    }
  })
  const coarseAges = COARSE_AGES.map(edge => makeGroup(edge.label, withAge.filter(e => { const age = ageFrom(e.tanggalLahir); return age >= edge.min && age <= edge.max })))

  const birthdays = withAge
    .map(e => ({ e, days: daysToBirthday(e.tanggalLahir) }))
    .filter(x => x.days <= 30)
    .sort((a, b) => a.days - b.days)

  const completeness = FIELDS.map(field => ({ ...field, filled: emps.filter(e => Boolean(e[field.key])).length }))

  const active = emps.filter(e => e.statusPegawai !== 'Nonaktif')
  const missingPension = active.filter(e => !e.tanggalPensiun)
  const overduePension = active.filter(e => e.tanggalPensiun && e.tanggalPensiun < today)
  const missingStartDate = emps.filter(e => !e.tanggalMulaiKerja)
  const inactiveWithoutResignationDate = emps.filter(e => e.statusPegawai === 'Nonaktif' && !e.tanggalPengunduranDiri)
  const unitCount = new Set(emps.map(e => (e.unit || '').trim().toLocaleLowerCase('id-ID')).filter(Boolean)).size

  return {
    units, unitCount, education, rank, functional, functionalTotal, functionalCount: functionalEmployees.length, status, gender, male: male.length, female: female.length,
    withAge: withAge.length, unknownAge, avgAge, medianAge: median(ages), bands, coarseAges,
    birthdays, completeness,
    missingPension, overduePension, missingStartDate, inactiveWithoutResignationDate,
  }
}

function daysToBirthday(date: string) {
  const [, m, d] = date.split('-').map(Number)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  let next = new Date(now.getFullYear(), m - 1, d)
  if (next < now) next = new Date(now.getFullYear() + 1, m - 1, d)
  return Math.round((next.getTime() - now.getTime()) / 86400000)
}

/* ---------- movement (depends on the chosen window) ---------- */

export function buildMovement(emps: Employee[], months: WindowMonths, today: string) {
  const past = shiftMonths(today, -months)
  const future = shiftMonths(today, months)
  const within = (date: string | undefined, start: string, end: string) => Boolean(date && date >= start && date <= end)
  const pensions: EmployeeEvent[] = emps
    .filter(e => e.statusPegawai !== 'Nonaktif' && within(e.tanggalPensiun, today, future))
    .map(employee => ({ employee, date: employee.tanggalPensiun! }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const newHires: EmployeeEvent[] = emps
    .filter(e => within(e.tanggalMulaiKerja, past, today))
    .map(employee => ({ employee, date: employee.tanggalMulaiKerja }))
    .sort((a, b) => b.date.localeCompare(a.date))
  const resignations: EmployeeEvent[] = emps
    .filter(e => within(e.tanggalPengunduranDiri, past, today))
    .map(employee => ({ employee, date: employee.tanggalPengunduranDiri! }))
    .sort((a, b) => b.date.localeCompare(a.date))
  return {
    past, future, pensions, newHires, resignations,
    pensionBuckets: monthBuckets(pensions, today, future),
    hireBuckets: monthBuckets(newHires, past, today),
    resignBuckets: monthBuckets(resignations, past, today),
  }
}
