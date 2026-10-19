import type { Assignment, DayStatus, Employee, Evidence, ISODate, Issue, IssueType, Resolution, Severity, SourceFile, SourceKind } from './types.ts'
import type { Roster } from './roster.ts'
import { eachDay, formatID, isWeekend, toMinutes } from './dates.ts'
import { enforcePolicy, golGroup, type GolGroup, type MealPolicy } from './policy.ts'
import { nameKey } from './names.ts'
import { DAY_CODE_LABEL } from './parsers/common.ts'

export type MealState = 'eligible' | 'held' | 'excluded'

export type DayRecord = {
  employeeId: string
  date: ISODate
  workday: boolean
  covered: boolean
  evidence: Evidence[]
  assignments: Assignment[]
  status: DayStatus
  basis: string
  clockIn?: string
  clockOut?: string
  lateMin: number
  earlyMin: number
  overtimeMin: number
  complete: boolean
  timeKnown: boolean
  issues: Issue[]
  resolved: Resolution[]
  meal: { state: MealState; reason: string; amount: number; amountReady?: boolean; taxPct?: number }
}

export type EmployeeMonth = {
  employee: Employee
  days: DayRecord[]
  workdays: number
  present: number
  wfa: number
  dutyOut: number
  dutyLocal: number
  leave: number
  absent: number
  incomplete: number
  noData: number
  lateDays: number
  lateMinutes: number
  earlyDays: number
  overtimeMinutes: number
  mealDays: number
  heldDays: number
  group: GolGroup
  groupAssumed: boolean
  rate: number
  bruto: number
  pphPct: number
  pph: number
  netto: number
  openIssues: number
  amountPendingDays: number
}

export type Reconciliation = {
  period: { start: ISODate; end: ISODate }
  workdays: ISODate[]
  months: EmployeeMonth[]
  issues: Issue[]
  officeCentroids: Record<string, [number, number]>
}

export const STATUS_LABEL: Record<DayStatus, string> = {
  hadir: 'Hadir di kantor', 'hadir-wfa': 'Hadir WFA', 'dinas-lokal': 'Dinas lokal / dalam kota', 'dinas-luar': 'Perjalanan dinas',
  diklat: 'Diklat / konsinyering', cuti: 'Cuti', sakit: 'Sakit', izin: 'Izin', 'tanpa-keterangan': 'Tanpa keterangan',
  'belum-berlangsung': 'Belum berlangsung',
  'tidak-lengkap': 'Bukti tidak lengkap', libur: 'Libur', 'tidak-ada-data': 'Belum ada data',
}

export const ISSUE_LABEL: Record<IssueType, string> = {
  'scan-berbeda': 'Pasangan scan berbeda antar sumber',
  'dinas-vs-scan-kantor': 'Dinas luar tapi scan di kantor',
  'cuti-vs-hadir': 'Cuti/sakit tapi ada absen hadir',
  'st-tumpang-tindih': 'Surat tugas tumpang tindih',
  'pd-tanpa-st': 'Dinas di mesin, ST tidak ditemukan',
  'daring-ditolak': 'Presensi daring ditolak',
  'scan-tidak-lengkap': 'Scan tidak lengkap',
  'wfo-di-luar-kantor': 'WFO dengan koordinat di luar kantor',
  'jam-duplikat': 'Jam identik dengan hari sebelumnya',
  'jam-manual': 'Jam diisi manual (absen error)',
  'jadwal-tidak-sesuai': 'Jadwal kerja mesin tidak sesuai',
  'hadir-hari-libur': 'Absen di hari libur',
  'wfa-saat-dinas': 'Presensi WFA saat dinas',
  'st-tanpa-nomor': 'Penugasan tanpa nomor ST',
}

const OFFICE_KINDS: SourceKind[] = ['mesin', 'matriks-kanwil', 'jadwal-kanwil', 'laporan-kanwil']
const ROSTER_KINDS: SourceKind[] = ['mesin', 'matriks-kanwil', 'jadwal-kanwil', 'laporan-kanwil']

function haversine(a: [number, number], b: [number, number]) {
  const R = 6371, toRad = (x: number) => x * Math.PI / 180
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

/** Titik pusat tiap lokasi WFO dihitung dari median koordinat check-in yang disetujui. */
export function locationCentroids(files: SourceFile[]): Record<string, [number, number]> {
  const pts = new Map<string, [number, number][]>()
  for (const f of files) for (const e of f.evidence) if (e.kind === 'daring' && e.mode === 'WFO' && e.coordIn && e.location && e.approved !== false) {
    const list = pts.get(e.location) ?? []
    list.push(e.coordIn); pts.set(e.location, list)
  }
  const out: Record<string, [number, number]> = {}
  for (const [loc, list] of pts) if (list.length >= 5) out[loc] = [median(list.map(p => p[0])), median(list.map(p => p[1]))]
  return out
}

export function reconcile(files: SourceFile[], roster: Roster, period: { start: ISODate; end: ISODate }, policy: MealPolicy, resolutions: Resolution[], asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())): Reconciliation {
  files = files.filter(f => f.active !== false)
  policy = enforcePolicy(policy)
  const holidays = new Set(policy.holidays)
  const days = eachDay(period.start, period.end)
  const workdays = days.filter(d => !isWeekend(d) && !holidays.has(d))
  const centroids = locationCentroids(files)
  const resolutionMap = new Map(resolutions.map(r => [r.issueId, r]))
  const partial = new Set(files.flatMap(f => (f.partialDates ?? []).map(d => `${f.id}|${d}`)))

  const evByEmp = new Map<string, Evidence[]>()
  const coverage = new Map<string, { start: ISODate; end: ISODate }[]>()
  const fileById = new Map(files.map(f => [f.id, f]))
  for (const f of files) for (const e of f.evidence) {
    if (e.date < period.start || e.date > period.end) continue
    const id = roster.evidenceLink.get(e.id)
    if (!id) continue
    const list = evByEmp.get(id) ?? []
    list.push(e); evByEmp.set(id, list)
  }
  for (const [id, list] of evByEmp) {
    const spans = new Map<string, { start: ISODate; end: ISODate }>()
    for (const e of list) if (ROSTER_KINDS.includes(e.kind)) {
      const f = fileById.get(e.fileId)!
      const fileSpan = e.kind === 'jadwal-kanwil' ? monthSpan(e.date) : f.period
      if (fileSpan && f.completeThrough) spans.set(`${e.fileId}:${fileSpan.start}`, { start: fileSpan.start, end: f.completeThrough < fileSpan.end ? f.completeThrough : fileSpan.end })
    }
    coverage.set(id, [...spans.values()])
  }
  const stByEmp = new Map<string, Assignment[]>()
  const officesWithRegister = new Set<string>()
  for (const f of files) if (f.kind === 'surat-tugas') {
    officesWithRegister.add(f.office)
    for (const a of f.assignments) {
      if (a.end < period.start || a.start > period.end) continue
      const id = roster.assignmentLink.get(a.id)
      if (!id) continue
      const list = stByEmp.get(id) ?? []
      list.push(a); stByEmp.set(id, list)
    }
  }

  const unresolvedAssignments = files.flatMap(f => f.assignments).filter(a => !roster.assignmentLink.has(a.id))
  const months: EmployeeMonth[] = []
  const allIssues: Issue[] = []
  for (const employee of roster.employees) {
    const empId = employee.id
    const evs = evByEmp.get(empId) ?? []
    const sts = stByEmp.get(empId) ?? []
    const spans = coverage.get(empId) ?? []
    const evByDate = groupBy(evs, e => e.date)
    const records: DayRecord[] = []
    for (const date of days) {
      const dayEv = evByDate.get(date) ?? []
      const daySt = sts.filter(a => a.start <= date && a.end >= date)
      const workday = workdays.includes(date)
      if (!workday && !dayEv.some(hasPresence)) continue
      const covered = spans.some(s => date >= s.start && date <= s.end) || dayEv.length > 0
      const isPartial = dayEv.some(e => partial.has(`${e.fileId}|${date}`))
      const rec = evaluateDay(employee, date, workday, covered, isPartial ? dayEv.filter(e => !(e.code === 'X' && partial.has(`${e.fileId}|${date}`))) : dayEv, daySt, sts, officesWithRegister, centroids, policy, resolutionMap, isPartial)
      if (rec.meal.state === 'eligible' && unresolvedAssignments.some(a => a.office === employee.kantor && a.start <= date && a.end >= date)) rec.meal = { state: 'held', amount: 0, reason: 'Peserta ST pada kantor/tanggal ini belum terpetakan; selesaikan pencocokan identitas' }
      if (dayEv.some(e => e.identityPending && !roster.identity.some(i => i.context === 'absensi' && i.method === 'manual' && i.employeeId === employee.id && i.office === e.office && nameKey(i.name) === nameKey(e.name)))) rec.meal = { state: 'held', amount: 0, reason: 'Identifier numerik belum terverifikasi; perbaiki/mapping sumber' }
      if (date > asOf) {
        rec.status = 'belum-berlangsung'; rec.basis = 'Tanggal setelah waktu analisis'
        rec.meal = { state: 'held', amount: 0, reason: 'Tanggal belum berlangsung' }
        rec.issues = []; rec.resolved = []
      }
      records.push(rec)
      allIssues.push(...rec.issues)
    }
    months.push(summarize(employee, records, workdays.length, policy))
  }
  months.sort((a, b) => a.employee.kantor.localeCompare(b.employee.kantor) || a.employee.nama.localeCompare(b.employee.nama))
  return { period, workdays, months, issues: allIssues, officeCentroids: centroids }
}

const monthSpan = (date: ISODate) => { const [y, m] = date.split('-').map(Number); const end = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-${String(end).padStart(2, '0')}` } }

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>()
  for (const x of xs) { const k = key(x); const l = m.get(k); if (l) l.push(x); else m.set(k, [x]) }
  return m
}

const hasTimes = (e: Evidence) => !!(e.clockIn || e.clockOut)
const hasPresence = (e: Evidence) => hasTimes(e) || !!e.present
const LEAVE = new Set(['S', 'C', 'CB', 'I'])

function evaluateDay(employee: Employee, date: ISODate, workday: boolean, covered: boolean, evs: Evidence[], sts: Assignment[], periodSts: Assignment[], registers: Set<string>, centroids: Record<string, [number, number]>, policy: MealPolicy, resolutions: Map<string, Resolution>, partialDay = false): DayRecord {
  const issues: Issue[] = []
  const add = (type: IssueType, severity: Severity, detail: string, blocksMeal: boolean, evidenceIds = evs.map(e => e.id), assignmentIds = sts.map(a => a.id)) =>
    issues.push({ id: `${employee.id}|${date}|${type}`, type, severity, employeeId: employee.id, date, title: ISSUE_LABEL[type], detail, evidenceIds, assignmentIds, blocksMeal })

  const codes = new Set(evs.map(e => e.code).filter(Boolean) as string[])
  const daring = evs.filter(e => e.kind === 'daring')
  const officeEv = evs.filter(e => OFFICE_KINDS.includes(e.kind) && hasPresence(e) && !(e.code && LEAVE.has(e.code)) && e.mode !== 'WFA')
  const daringWfo = daring.filter(e => e.mode === 'WFO' && e.approved !== false && e.clockIn)
  const remoteEv = [...daring.filter(e => e.mode === 'WFA' && e.approved !== false && e.clockIn), ...evs.filter(e => e.kind !== 'daring' && e.mode === 'WFA' && hasPresence(e))]
  const rejected = daring.filter(e => e.approved === false)
  const stOut = sts.filter(a => !a.local), stLocal = sts.filter(a => a.local)
  const presenceEv = [...officeEv, ...daringWfo, ...remoteEv]

  // Satu pasangan berasal dari satu bukti, bukan min masuk/max pulang lintas sumber.
  const paired = presenceEv.filter(e => e.clockIn && e.clockOut && e.clockOut >= e.clockIn)
  const selected = paired[0] ?? presenceEv[0]
  const clockIn = selected?.clockIn, clockOut = selected?.clockOut
  const timeKnown = !!(clockIn || clockOut)
  const complete = !!(clockIn && clockOut && clockOut >= clockIn)
  const official = evs.find(e => e.kind === 'mesin' && e.schedule && !e.notes?.includes('jadwal-puasa'))?.schedule ?? evs.find(e => e.schedule && e.kind !== 'mesin')?.schedule ?? defaultSchedule(date)
  const lateMin = clockIn ? Math.max(0, Math.ceil(toMinutes(clockIn)! - toMinutes(official.start)!)) : 0
  const earlyMin = clockOut && clockIn ? Math.max(0, Math.ceil(toMinutes(official.end)! - toMinutes(clockOut)!)) : 0
  const overtimeMin = Math.max(0, ...evs.map(e => e.overtimeMin ?? 0))

  const leaveCode = [...codes].find(c => LEAVE.has(c))
  const pdCode = codes.has('PD')
  const officePresence = evs.some(e => e.present && e.mode === 'WFO') || officeEv.some(hasTimes) || daringWfo.length > 0 || officeEv.some(e => e.present)

  let status: DayStatus
  let basis: string
  if (!workday) { status = presenceEv.length ? 'hadir' : 'libur'; basis = presenceEv.length ? 'Ada absen pada hari libur' : 'Hari libur' }
  else if (leaveCode) { status = leaveCode === 'S' ? 'sakit' : leaveCode === 'I' ? 'izin' : 'cuti'; basis = DAY_CODE_LABEL[leaveCode as 'S'] + ' (sumber absensi)' }
  else if (pdCode || stOut.length) { status = 'dinas-luar'; basis = pdCode && stOut.length ? `Kode PD + ST ${stOut[0].letterNo ?? 'tanpa nomor'}` : pdCode ? 'Kode perjalanan dinas di mesin/rekap' : `ST ${stOut[0].letterNo ?? 'tanpa nomor'} (${stOut[0].destination ?? 'tujuan tidak tercatat'})` }
  else if (codes.has('DIKLAT') || codes.has('KO')) { status = 'diklat'; basis = codes.has('KO') ? 'Konsinyering' : 'Diklat' }
  else if (codes.has('DL') || stLocal.length) { status = 'dinas-lokal'; basis = stLocal.length ? `ST lokal ${stLocal[0].letterNo ?? ''}`.trim() : 'Dinas dalam kota (≤ 8 jam dihitung hadir)' }
  else if (officePresence) { status = complete ? 'hadir' : 'tidak-lengkap'; basis = describePresence(officeEv, daringWfo) }
  else if (remoteEv.length) { status = complete ? 'hadir-wfa' : 'tidak-lengkap'; basis = 'Presensi WFA' + (remoteEv[0].kind === 'daring' ? ' via aplikasi' : ' (rekap Kanwil)') }
  else if (codes.has('WFA')) { status = 'tidak-lengkap'; basis = 'Jadwal WFA tercatat, tetapi tidak ada presensi daring yang disetujui' }
  else if (rejected.length) { status = 'tidak-lengkap'; basis = 'Presensi daring ditolak (Reject)' }
  else if (codes.has('T')) { status = 'tidak-lengkap'; basis = `Keterangan "${evs.find(e => e.code === 'T')?.codeLabel}" perlu diperjelas` }
  else if (partialDay) { status = 'tidak-ada-data'; basis = 'Data mesin tanggal ini belum lengkap saat diekspor' }
  else if (covered && codes.has('X')) { status = 'tanpa-keterangan'; basis = codes.has('X') ? 'Mesin mencatat Absent tanpa pengecualian' : 'Tidak ada scan maupun keterangan' }
  else { status = 'tidak-ada-data'; basis = 'Sumber absensi pegawai ini tidak mencakup tanggal ini' }

  // ---- deteksi isu ----
  if (new Set(paired.map(e => `${e.clockIn}|${e.clockOut}`)).size > 1) add('scan-berbeda', 'tinggi', 'Pasangan jam berbeda; koreksi sumber sebelum mengesahkan kehadiran.', true)
  const scanAtOffice = officeEv.some(hasTimes) || daringWfo.length > 0
  if ((pdCode || stOut.length) && scanAtOffice) {
    const edge = stOut.some(a => a.start === date || a.end === date)
    const sev: Severity = stOut.length ? (edge ? 'rendah' : 'tinggi') : 'sedang'
    add('dinas-vs-scan-kantor', sev, `${stOut.length ? `ST ${stOut.map(a => a.letterNo ?? '(tanpa nomor)').join(', ')} ${stOut[0].start === stOut[0].end ? formatID(stOut[0].start) : `${formatID(stOut[0].start, { year: false })}–${formatID(stOut[0].end)}`}` : 'Kode perjalanan dinas'} tetapi ada absen kantor ${clockIn ?? ''}${clockOut ? `–${clockOut}` : ''}.${edge ? ' Tanggal ini hari berangkat/pulang, sehingga scan pagi masih wajar.' : ''}`, true)
  }
  if (leaveCode && presenceEv.some(hasTimes)) add('cuti-vs-hadir', 'sedang', `${DAY_CODE_LABEL[leaveCode as 'S']} tercatat, namun ada jam hadir ${clockIn ?? '—'}–${clockOut ?? '—'}.`, true)
  const letters = new Map<string, Assignment>()
  for (const a of stOut) { const k = (a.letterNo ?? a.id).replace(/[^\w]/g, '').toLowerCase().replace(/^0+/, ''); if (!letters.has(k)) letters.set(k, a) }
  if (letters.size >= 2) {
    const list = [...letters.values()]
    const distinct = list.some(a => a.destination !== list[0].destination || a.start !== list[0].start || a.end !== list[0].end)
    const handover = list.length === 2 && list.some(a => a.end === date) && list.some(a => a.start === date) && list[0].start !== list[1].start
    if (distinct) add('st-tumpang-tindih', handover ? 'sedang' : 'tinggi', `${list.length} surat tugas berbeda pada tanggal yang sama: ${list.map(a => `${a.letterNo ?? 'tanpa nomor'} → ${a.destination ?? '?'} (${a.rawDate})`).join('; ')}. ${handover ? 'Hanya bersinggungan di hari peralihan — pastikan uang harian hari ini dibayar sekali.' : 'Berisiko uang harian ganda.'}`, true)
  }
  if (pdCode && !stOut.length && registers.has(employee.kantor) && workday) {
    const other = periodSts.filter(a => !a.local)
    add('pd-tanpa-st', 'sedang', other.length
      ? `Mesin/rekap mencatat perjalanan dinas, tetapi ST pegawai ini (${other.slice(0, 3).map(a => `${a.letterNo ?? 'tanpa nomor'}: ${a.rawDate}`).join('; ')}) tidak mencakup tanggal ini.`
      : 'Mesin/rekap mencatat perjalanan dinas, tetapi nama pegawai tidak ditemukan di rekap surat tugas mana pun pada periode ini (atau namanya belum dicocokkan).', false)
  }
  if (sts.some(a => !a.letterNo)) add('st-tanpa-nomor', 'sedang', `Penugasan ${sts.filter(a => !a.letterNo).map(a => `ke ${a.destination ?? '?'} (${a.rawDate})`).join(', ')} tercatat tanpa nomor surat tugas.`, false, [], sts.filter(a => !a.letterNo).map(a => a.id))
  if (rejected.length && !officePresence && !remoteEv.length && workday && status !== 'dinas-luar') add('daring-ditolak', 'rendah', `Presensi daring ${rejected[0].mode} pukul ${rejected[0].clockIn ?? '—'} berstatus Reject${rejected[0].clockOut ? '' : ' (tanpa jam selesai)'}.`, false)
  if ((status === 'tidak-lengkap') && timeKnown && workday && !partialDay) add('scan-tidak-lengkap', 'rendah', clockIn ? `Hanya ada jam masuk ${clockIn}.` : `Hanya ada jam pulang ${clockOut}.`, false)
  for (const e of daringWfo) {
    const c = e.location ? centroids[e.location] : undefined
    if (c && e.coordIn) {
      const km = haversine(c, e.coordIn)
      if (km > policy.wfoRadiusKm) add('wfo-di-luar-kantor', km > 25 ? 'tinggi' : 'sedang', `Presensi WFO di "${e.location}" tetapi koordinat check-in berjarak ${km < 10 ? km.toFixed(1) : Math.round(km)} km dari median koordinat (indikasi, bukan geofence resmi).`, false, [e.id])
    }
  }
  if (evs.some(e => e.notes?.includes('jam-sama-hari-sebelumnya'))) add('jam-duplikat', 'sedang', 'Jam masuk dan pulang persis sama dengan hari kerja sebelumnya — indikasi untuk diperiksa, bukan bukti pelanggaran.', false)
  if (evs.some(e => e.notes?.includes('jam-manual-absen-error'))) add('jam-manual', 'sedang', 'Keterangan "Absen Eror" dengan jam yang diketik manual; perlu bukti pendukung (mis. log mesin/CCTV/atasan).', true)
  const puasa = evs.find(e => e.notes?.includes('jadwal-puasa'))
  if (puasa && (date < policy.ramadan.start || date > policy.ramadan.end)) add('jadwal-tidak-sesuai', 'rendah', `Mesin memakai jadwal "${puasa.schedule?.label}" (${puasa.schedule?.start}–${puasa.schedule?.end}) di luar Ramadan; keterlambatan dihitung ulang dengan jadwal normal.`, false, [puasa.id])
  if (!workday && presenceEv.some(hasTimes)) add('hadir-hari-libur', 'rendah', `Absen ${clockIn ?? '—'}–${clockOut ?? '—'} pada hari libur. Jika lembur, pastikan ada SPKL.`, false)
  if ((pdCode || stOut.length) && remoteEv.some(e => e.kind === 'daring')) add('wfa-saat-dinas', 'rendah', 'Presensi WFA diisi pada hari perjalanan dinas.', false)

  // ---- keputusan HR ----
  const resolved: Resolution[] = []
  let finalStatus = status, finalBasis = basis
  for (const issue of issues) {
    issue.signature = JSON.stringify({ employee: [employee.id, employee.kantor, employee.workStatusPeriods?.filter(s => s.start <= date && s.end >= date)], date, workday, partialDay, evs: [...new Set(evs.map(({ id, fileId, ref, ...e }) => JSON.stringify(e)))].sort(), sts: [...new Set(sts.map(({ id, fileId, ref, dateRef, ...a }) => JSON.stringify(a)))].sort() })
    const r = resolutions.get(issue.id)
    if (!r || r.signature !== issue.signature) continue
    resolved.push(r)
    if (r.decision === 'akui-hadir' && !sts.length && !pdCode && !codes.has('DL')) { finalStatus = complete ? (remoteEv.length && !officePresence ? 'hadir-wfa' : 'hadir') : 'tidak-lengkap'; finalBasis = `Diputuskan HR: hadir (${r.reviewer})` }
    if (r.decision === 'akui-dinas') { finalStatus = 'dinas-luar'; finalBasis = `Diputuskan HR: dinas (${r.reviewer})` }
    if (r.decision === 'tidak-hadir') { finalStatus = 'tanpa-keterangan'; finalBasis = `Diputuskan HR: tidak sah (${r.reviewer})` }
  }
  const open = issues.filter(i => !resolved.some(r => r.issueId === i.id))
  if (partialDay && finalStatus === 'tidak-lengkap' && clockIn && !clockOut) { finalStatus = remoteEv.length && !officePresence ? 'hadir-wfa' : 'hadir'; finalBasis = `${finalBasis} — jam pulang belum tersinkron (ekspor belum lengkap)` }
  const meal = partialDay && workday && (['tidak-lengkap', 'tidak-ada-data'].includes(finalStatus) || (['hadir', 'hadir-wfa'].includes(finalStatus) && !clockOut && timeKnown)) ? { state: 'held' as const, reason: 'Ditahan: data mesin belum lengkap, tunggu ekspor ulang', amount: 0 } : mealFor(employee, date, finalStatus, workday, complete, timeKnown, lateMin, earlyMin, open, policy)
  return { employeeId: employee.id, date, workday, covered, evidence: evs, assignments: sts, status: finalStatus, basis: finalBasis, clockIn, clockOut, lateMin, earlyMin, overtimeMin, complete, timeKnown, issues, resolved, meal }
}

function describePresence(office: Evidence[], wfo: Evidence[]) {
  const parts: string[] = []
  if (office.some(e => e.kind === 'mesin')) parts.push('mesin')
  if (office.some(e => e.kind === 'matriks-kanwil')) parts.push('mesin Kanwil')
  if (office.some(e => e.kind === 'jadwal-kanwil')) parts.push('rekap manual Kanwil')
  if (office.some(e => e.kind === 'laporan-kanwil')) parts.push('laporan kode Kanwil')
  if (wfo.length) parts.push('aplikasi (WFO)')
  return `Scan ${parts.join(' + ')}`
}

export function defaultSchedule(date: ISODate) {
  const fri = new Date(`${date}T00:00:00Z`).getUTCDay() === 5
  return fri ? { start: '08:00', end: '16:30', label: 'Jumat 08:00–16:30' } : { start: '08:00', end: '16:00', label: 'Sen–Kam 08:00–16:00' }
}

function mealFor(employee: Employee, date: ISODate, status: DayStatus, workday: boolean, complete: boolean, timeKnown: boolean, lateMin: number, earlyMin: number, open: Issue[], policy: MealPolicy): DayRecord['meal'] {
  const no = (reason: string): DayRecord['meal'] => ({ state: 'excluded', reason, amount: 0 })
  if (!workday) return no('Bukan hari kerja')
  const excludedStatus = employee.workStatusPeriods?.find(s => s.start <= date && s.end >= date)
  if (excludedStatus) return no(`${excludedStatus.kind === 'tugas-belajar' ? 'Tugas belajar' : 'Diperbantukan ke instansi lain'}: ${excludedStatus.basis}`)
  if (employee.statusPegawai === 'Tugas Belajar' && !employee.workStatusPeriods?.length) return { state: 'held', amount: 0, reason: 'Lengkapi rentang efektif tugas belajar' }
  if (employee.statusPegawai === 'Nonaktif') return no('Pegawai nonaktif')
  if (status === 'tidak-ada-data' || status === 'tidak-lengkap') return { state: 'held', amount: 0, reason: 'Bukti masuk dan pulang belum lengkap/tersedia' }
  const counts = status === 'hadir' || (status === 'hadir-wfa' && policy.countWfa)
  if (!counts) {
    const reasons: Partial<Record<DayStatus, string>> = {
      'hadir-wfa': 'WFA tidak dihitung pada aturan aktif', 'dinas-lokal': 'Dinas lokal tidak dihitung pada aturan aktif',
      'dinas-luar': 'Perjalanan dinas — menerima uang harian, bukan uang makan', diklat: 'Diklat/konsinyering', cuti: 'Cuti', sakit: 'Sakit', izin: 'Izin',
      'tanpa-keterangan': 'Tidak hadir tanpa keterangan', 'tidak-lengkap': 'Bukti kehadiran tidak lengkap', 'tidak-ada-data': 'Belum ada data absensi',
    }
    const blocking = open.filter(i => i.blocksMeal)
    if (policy.holdOnIssues && blocking.length && status === 'dinas-luar') return { state: 'held', reason: `Ditahan: ${blocking[0].title.toLowerCase()}`, amount: 0 }
    return no(reasons[status] ?? 'Tidak memenuhi syarat')
  }
  {
    if (policy.requireComplete && !complete) return no('Scan masuk/pulang tidak lengkap')
    if (policy.requireOnTime && timeKnown && lateMin > policy.lateToleranceMin) return no(`Terlambat ${lateMin} menit`)
    if (policy.requireNoEarlyLeave && timeKnown && earlyMin > 0) return no(`Pulang ${earlyMin} menit sebelum jadwal`)
  }
  const blocking = open.filter(i => i.blocksMeal)
  if (policy.holdOnIssues && blocking.length) return { state: 'held', reason: `Ditahan: ${blocking[0].title.toLowerCase()}`, amount: 0 }
  if (employee.statusKepegawaian === 'Non-ASN' && !policy.includeNonAsn) return { state: 'held', reason: 'Non-ASN — pastikan dasar pembayaran', amount: 0 }
  if (!timeKnown || !complete) return { state: 'held', amount: 0, reason: 'Status hadir tanpa pasangan jam tidak membuktikan ketepatan waktu' }
  if (employee.statusKepegawaian === 'Belum diketahui') return { state: 'held', amount: 0, reason: 'Status kepegawaian belum diverifikasi' }
  const { group, assumed } = golGroup(employee.golongan, employee.statusKepegawaian, policy.defaultGroup)
  const effectiveRates = employee.rateHistory?.filter(r => r.start <= date && r.end >= date) ?? []
  const ready = policy.parametersApproved === true && (effectiveRates.length === 1 || (!assumed && !employee.rateHistory?.length))
  const rate = effectiveRates.length === 1 ? effectiveRates[0].rate : policy.rates[group]
  const taxPct = effectiveRates.length === 1 ? effectiveRates[0].pph : policy.pph[group]
  return { state: 'eligible', reason: ready ? 'Hadir tepat waktu dan lengkap' : 'Hari memenuhi syarat; nominal pending: golongan/tarif atau parameter belum disahkan', amount: ready ? rate : 0, amountReady: ready, taxPct: ready ? taxPct : undefined }
}

function summarize(employee: Employee, days: DayRecord[], workdayCount: number, policy: MealPolicy): EmployeeMonth {
  const wd = days.filter(d => d.workday)
  const count = (s: DayStatus[]) => wd.filter(d => s.includes(d.status)).length
  const { group, assumed } = golGroup(employee.golongan, employee.statusKepegawaian, policy.defaultGroup)
  const mealDays = wd.filter(d => d.meal.state === 'eligible').length
  const rate = policy.rates[group]
  const bruto = wd.reduce((sum, d) => sum + d.meal.amount, 0)
  const pphPct = policy.pph[group]
  const pph = Math.round(wd.reduce((sum, d) => sum + d.meal.amount * (d.meal.taxPct ?? 0) / 100, 0))
  return {
    employee, days, workdays: workdayCount,
    present: count(['hadir', 'hadir-wfa', 'dinas-lokal']),
    wfa: count(['hadir-wfa']),
    dutyOut: count(['dinas-luar']), dutyLocal: count(['dinas-lokal']),
    leave: count(['cuti', 'sakit', 'izin']),
    absent: count(['tanpa-keterangan']),
    incomplete: count(['tidak-lengkap']),
    noData: count(['tidak-ada-data']) + Math.max(0, workdayCount - wd.length),
    lateDays: wd.filter(d => d.lateMin > 0 && ['hadir', 'hadir-wfa', 'tidak-lengkap'].includes(d.status)).length,
    lateMinutes: wd.reduce((s, d) => s + (['hadir', 'hadir-wfa', 'tidak-lengkap'].includes(d.status) ? d.lateMin : 0), 0),
    earlyDays: wd.filter(d => d.earlyMin > 0 && ['hadir', 'hadir-wfa'].includes(d.status)).length,
    overtimeMinutes: days.reduce((s, d) => s + d.overtimeMin, 0),
    mealDays, heldDays: wd.filter(d => d.meal.state === 'held').length,
    amountPendingDays: wd.filter(d => d.meal.state === 'eligible' && !d.meal.amountReady).length,
    group, groupAssumed: assumed, rate, bruto, pphPct, pph, netto: bruto - pph,
    openIssues: days.reduce((s, d) => s + d.issues.filter(i => !d.resolved.some(r => r.issueId === i.id)).length, 0),
  }
}
