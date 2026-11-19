import type { Assignment, DayReview, DayStatus, Employee, Evidence, ISODate, Issue, IssueType, Resolution, Severity, SourceFile, SourceKind } from './types.ts'
import type { Roster } from './roster.ts'
import { eachDay, formatID, isWeekend, toMinutes } from './dates.ts'
import { enforcePolicy, golGroup, MEAL_CLOCK_IN, MEAL_CLOCK_OUT, type GolGroup, type MealPolicy } from './policy.ts'
import { DAY_CODE_LABEL } from './parsers/common.ts'
import { OFFICES } from './ids.ts'
import { effectiveSource } from './recordReviews.ts'
import { dayReviewKey, dayReviewProblem, daySourceSignature, stableStringify, unresolvedIdentityEvidence } from './dayReview.ts'
import { nameKey } from './names.ts'
import { sourceRecordState } from './recordReviews.ts'

export type MealState = 'eligible' | 'held' | 'excluded'

export type DayRecord = {
  employeeId: string
  date: ISODate
  workday: boolean
  covered: boolean
  sourceCoverageComplete: boolean
  reviewState: 'valid' | 'flag' | 'not-found' | 'future'
  /** Hari tanpa clash disahkan otomatis oleh sistem; admin tetap dapat menimpa lewat keputusan harian. */
  autoValidated?: boolean
  reviewSignature: string
  decision?: DayReview
  reviewError?: string
  evidence: Evidence[]
  assignments: Assignment[]
  status: DayStatus
  basis: string
  clockIn?: string
  clockOut?: string
  scheduleKnown: boolean
  lateMin: number
  earlyMin: number
  overtimeMin: number
  complete: boolean
  timeKnown: boolean
  issues: Issue[]
  resolved: Resolution[]
  /** estimate: nominal yang akan dibayar bila hari ini hanya tertahan karena setoran pekan belum lengkap. */
  meal: { state: MealState; reason: string; amount: number; amountReady?: boolean; taxPct?: number; estimate?: number
    /** Why a held day is held, so summaries can tell "waiting for a weekly submission" from "waiting for an admin decision". */
    heldBy?: 'coverage' | 'decision' | 'identity' | 'future' | 'other' }
}

export type EmployeeMonth = {
  employee: Employee
  days: DayRecord[]
  workdays: number
  reviewedDays: number
  flaggedDays: number
  notFoundDays: number
  futureDays: number
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
  /** Hari eligible yang hanya menunggu setoran pekan lengkap, beserta perkiraan nominalnya. */
  estimateDays: number
  estimateBruto: number
  group: GolGroup
  groupAssumed: boolean
  rate: number
  bruto: number
  pphPct: number
  pph: number
  netto: number
  openIssues: number
  /** Isu pemblokir (clash) yang belum diputuskan; isu informasi tidak menahan pengajuan. */
  openClashes: number
  amountPendingDays: number
  nettoReady: boolean
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
  'jadwal-tidak-sesuai': 'Jadwal kerja perlu dipastikan',
  'hadir-hari-libur': 'Absen di hari libur',
  'wfa-saat-dinas': 'Presensi WFA saat dinas',
  'st-tanpa-nomor': 'Penugasan tanpa nomor ST',
  'status-berbeda': 'Status harian berbeda antar sumber',
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

export function reconcile(files: SourceFile[], roster: Roster, period: { start: ISODate; end: ISODate }, policy: MealPolicy, resolutions: Resolution[], asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()), dayReviews: DayReview[] = [], isSourceCoverageComplete?: ((office: string, date: ISODate) => boolean) & { missing?: (date: ISODate) => string[] }): Reconciliation {
  const sourceFiles = files.filter(f => f.active !== false)
  files = sourceFiles.map(effectiveSource)
  policy = enforcePolicy(policy)
  const holidays = new Set(policy.holidays)
  const days = eachDay(period.start, period.end)
  const workdays = days.filter(d => !isWeekend(d) && !holidays.has(d))
  const centroids = locationCentroids(files)
  const resolutionMap = new Map(resolutions.map(r => [r.issueId, r]))
  const dayReviewMap = new Map(dayReviews.map(r => [dayReviewKey(r.employeeId, r.date), r]))
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
    // Setoran ST mingguan bersifat seluruh KPPU; register juga dicatat per kantor peserta.
    officesWithRegister.add(f.office)
    for (const a of f.assignments) officesWithRegister.add(a.office)
    if (f.office === 'Semua kantor') for (const office of OFFICES) officesWithRegister.add(office)
    for (const a of f.assignments) {
      if (a.end < period.start || a.start > period.end) continue
      const id = roster.assignmentLink.get(a.id)
      if (!id) continue
      const list = stByEmp.get(id) ?? []
      list.push(a); stByEmp.set(id, list)
    }
  }

  // Performa: nama dinormalisasi sekali per nama dan status/fakta baris disimpan sekali per baris (bukan per pegawai-hari).
  const nkCache = new Map<string, string>()
  const nameKeyCache = (name: string) => { let v = nkCache.get(name); if (v === undefined) { v = nameKey(name); nkCache.set(name, v) } return v }
  const rowStateCache = new Map<string, string>()
  const rawRowsByOfficeDate = new Map<string, { nk?: string; file: SourceFile; kind: 'evidence' | 'assignment'; id: string; name: string; office: string; date?: ISODate; start?: ISODate; end?: ISODate; ids?: Evidence['ids']; nip?: string; employeeId?: string }[]>()
  const addRawRow = (key: string, row: { file: SourceFile; kind: 'evidence' | 'assignment'; id: string; name: string; office: string; date?: ISODate; start?: ISODate; end?: ISODate; ids?: Evidence['ids']; nip?: string; employeeId?: string }) => {
    const list = rawRowsByOfficeDate.get(key) ?? []
    list.push({ ...row, nk: nameKeyCache(row.name) }); rawRowsByOfficeDate.set(key, list)
  }
  for (const file of sourceFiles) {
    for (const evidence of file.evidence) if (evidence.date >= period.start && evidence.date <= period.end) addRawRow(`${evidence.office}|${evidence.date}`, { file, kind: 'evidence', id: evidence.id, name: evidence.name, office: evidence.office, date: evidence.date, ids: evidence.ids })
    for (const assignment of file.assignments) {
      if (assignment.external) continue // peserta eksternal tidak terkait pegawai mana pun
      const start = assignment.start > period.start ? assignment.start : period.start
      const end = assignment.end < period.end ? assignment.end : period.end
      if (start > end) continue
      for (const date of eachDay(start, end)) addRawRow(`${assignment.office}|${date}`, { file, kind: 'assignment', id: assignment.id, name: assignment.name, office: assignment.office, start: assignment.start, end: assignment.end, nip: assignment.nip, employeeId: assignment.employeeId })
    }
  }

  const unresolvedAssignments = files.flatMap(f => f.assignments).filter(a => !a.external && !roster.assignmentLink.has(a.id) && a.end >= period.start && a.start <= period.end)
  // Peserta ST yang belum tertaut hanya menahan pegawai yang namanya mungkin cocok, bukan seluruh kantor.
  const unresolvedStByEmployee = new Map<string, Assignment[]>()
  if (unresolvedAssignments.length) {
    // Tahan hanya kandidat yang diusulkan pencocok nama ST (status ambigu); nama tanpa kandidat tidak menahan siapa pun.
    const candidatesByName = new Map<string, string[]>()
    for (const item of roster.identity) if (item.context === 'surat-tugas' && item.status === 'ambiguous') candidatesByName.set(`${item.office}|${item.name}`, item.candidates.map(c => c.employeeId))
    for (const a of unresolvedAssignments) for (const id of candidatesByName.get(`${a.office}|${a.name}`) ?? []) {
      const list = unresolvedStByEmployee.get(id) ?? []
      list.push(a); unresolvedStByEmployee.set(id, list)
    }
  }

  const months: EmployeeMonth[] = []
  const allIssues: Issue[] = []
  for (const employee of roster.employees) {
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(employee.tanggalMulaiKerja) ? employee.tanggalMulaiKerja : undefined
    const employeeWorkdays = workdays.filter(date => (!startDate || date >= startDate) && date <= asOf)
    const empId = employee.id
    const evs = evByEmp.get(empId) ?? []
    const sts = stByEmp.get(empId) ?? []
    const spans = coverage.get(empId) ?? []
    const evByDate = groupBy(evs, e => e.date)
    const employeeNameKey = nameKeyCache(employee.nama)
    const identityContext = roster.identity.filter(i => i.employeeId === employee.id).map(({ sampleRefs: _sampleRefs, ...stable }) => stableStringify(stable)).sort()
    const records: DayRecord[] = []
    for (const date of days) {
      if (startDate && date < startDate) continue
      const dayEv = evByDate.get(date) ?? []
      const daySt = sts.filter(a => a.start <= date && a.end >= date)
      const workday = workdays.includes(date)
      if (!workday && !dayEv.some(hasPresence)) continue
      const sourceCoverageComplete = isSourceCoverageComplete?.(employee.kantor, date) ?? false
      const covered = spans.some(s => date >= s.start && date <= s.end) || dayEv.length > 0 || sourceCoverageComplete
      const isPartial = dayEv.some(e => partial.has(`${e.fileId}|${date}`))
      const recordStates = (rawRowsByOfficeDate.get(`${employee.kantor}|${date}`) ?? []).filter(row => {
        if (row.kind === 'evidence') {
          const ids = row.ids ?? {}
          const aliases = employee.aliases ?? []
          const numericMatch = (!!employee.nip && ids.nip === employee.nip) || (!!employee.nika && ids.nika === employee.nika) || aliases.some(a => (a.kind === 'nip' && a.value === ids.nip) || (a.kind === 'nika' && a.value === ids.nika) || (a.kind === 'mesin' && a.value === ids.mesin) || (a.kind === 'app' && a.value === ids.appId))
          return numericMatch || row.nk === employeeNameKey
        }
        return row.employeeId ? row.employeeId === employee.id : (!!employee.nip && row.nip === employee.nip) || row.nk === employeeNameKey
      }).map(row => {
        const cacheKey = `${row.file.id}|${row.kind}|${row.id}`
        const cached = rowStateCache.get(cacheKey)
        if (cached !== undefined) return cached
        const record = row.kind === 'evidence' ? row.file.evidence.find(item => item.id === row.id) : row.file.assignments.find(item => item.id === row.id)
        if (!record) return `${row.kind}:${sourceRecordState(row.file, row.kind, row.id)}`
        const facts = row.kind === 'evidence'
          ? (({ id: _id, fileId: _fileId, ref: _ref, ...value }) => value)(record as Evidence)
          : (({ id: _id, fileId: _fileId, ref: _ref, dateRef: _dateRef, ...value }) => value)(record as Assignment)
        const reviewHistory = (row.file.recordReviews ?? []).filter(review => review.kind === row.kind && review.recordId === row.id).map(review => review.disposition)
        const value = `${row.kind}:${stableStringify(facts)}:${sourceRecordState(row.file, row.kind, row.id)}:${stableStringify(reviewHistory)}`
        rowStateCache.set(cacheKey, value)
        return value
      }).sort()
      const reviewSignature = daySourceSignature(employee, date, dayEv, daySt, { covered, partial: isPartial, identity: identityContext, recordStates })
      const proposedReview = dayReviewMap.get(dayReviewKey(employee.id, date))
      const reviewError = proposedReview && proposedReview.signature === reviewSignature ? dayReviewProblem(proposedReview, dayEv, daySt) : undefined
      const dayReview = proposedReview?.signature === reviewSignature && !reviewError ? proposedReview : undefined
      const visibleEvidence = isPartial ? dayEv.filter(e => !(e.code === 'X' && partial.has(`${e.fileId}|${date}`))) : dayEv
      const selectedEvidence = dayReview ? visibleEvidence.filter(e => dayReview.evidenceIds.includes(e.id)) : visibleEvidence
      const selectedAssignments = dayReview ? daySt.filter(a => dayReview.assignmentIds.includes(a.id)) : daySt
      const rec = evaluateDay(employee, date, workday, covered, selectedEvidence, selectedAssignments, sts, officesWithRegister, centroids, policy, resolutionMap, isPartial, reviewSignature, dayReview, dayEv, daySt, reviewError)
      rec.sourceCoverageComplete = isSourceCoverageComplete?.(employee.kantor, date) ?? true
      // Nama peserta ST yang belum dicocokkan diperiksa sebelum cakupan setoran, agar perkiraan UM tidak memuat hari yang mungkin dinas.
      const unresolvedSt = unresolvedStByEmployee.get(employee.id)?.find(a => a.start <= date && a.end >= date)
      if (rec.meal.state === 'eligible' && unresolvedSt) { rec.meal = { state: 'held', heldBy: 'identity', amount: 0, reason: `Nama "${unresolvedSt.name}" pada ST ${unresolvedSt.letterNo ?? ''} belum dicocokkan dan bisa jadi pegawai ini; selesaikan di Pencocokan Identitas` }; rec.reviewState = 'flag'; rec.autoValidated = false }
      const missingSources = rec.sourceCoverageComplete ? [] : isSourceCoverageComplete?.missing?.(date) ?? []
      const missingText = missingSources.length ? missingSources.join(', ').replace(/, ([^,]*)$/, ' dan $1') : 'Mesin Offline, Mesin Online, dan Rekap ST'
      if (workday && rec.meal.state === 'eligible' && !rec.sourceCoverageComplete) {
        rec.meal = { state: 'held', heldBy: 'coverage', amount: 0, estimate: rec.meal.amountReady ? rec.meal.amount : undefined, reason: `Menunggu setoran ${missingText} pekan ini; UM final setelah semua sumber dinyatakan lengkap` }
      }
      if (workday && rec.reviewState === 'not-found' && !rec.decision) {
        rec.meal = rec.sourceCoverageComplete
          ? { state: 'excluded', amount: 0, reason: 'Tidak ada bukti kehadiran pada setoran pekan ini' }
          : { state: 'held', heldBy: 'coverage', amount: 0, reason: `Belum ada data; menunggu setoran ${missingText} pekan ini` }
      }
      if (unresolvedIdentityEvidence(selectedEvidence, employee.id, roster.identity).length) { rec.meal = { state: 'held', heldBy: 'identity', amount: 0, reason: 'Identifier numerik belum terverifikasi; perbaiki/mapping sumber' }; rec.reviewState = 'flag' }
      if (selectedEvidence.some(e => e.officePending)) { rec.meal = { state: 'held', heldBy: 'identity', amount: 0, reason: 'Kantor sumber belum terpetakan; konfirmasi kantor sebelum mereview hari ini' }; rec.reviewState = 'flag' }
      if (date > asOf) {
        rec.status = 'belum-berlangsung'; rec.basis = 'Tanggal setelah waktu analisis'
        rec.meal = { state: 'held', heldBy: 'future', amount: 0, reason: 'Tanggal belum berlangsung' }
        rec.issues = []; rec.resolved = []; rec.reviewState = 'future'; rec.decision = undefined
      }
      records.push(rec)
      allIssues.push(...rec.issues)
    }
    months.push(summarize(employee, records, employeeWorkdays.length, policy))
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

function evaluateDay(employee: Employee, date: ISODate, workday: boolean, covered: boolean, evs: Evidence[], sts: Assignment[], periodSts: Assignment[], registers: Set<string>, centroids: Record<string, [number, number]>, policy: MealPolicy, resolutions: Map<string, Resolution>, partialDay = false, reviewSignature = '', dayReview?: DayReview, rawEvidence = evs, rawAssignments = sts, reviewError?: string): DayRecord {
  const issues: Issue[] = []
  const add = (type: IssueType, severity: Severity, detail: string, blocksMeal: boolean, evidenceIds = evs.map(e => e.id), assignmentIds = sts.map(a => a.id)) =>
    issues.push({ id: `${employee.id}|${date}|${type}`, type, severity, employeeId: employee.id, date, title: ISSUE_LABEL[type], detail, evidenceIds, assignmentIds, blocksMeal })

  const codes = new Set(evs.map(e => e.code).filter(Boolean) as string[])
  const daring = evs.filter(e => e.kind === 'daring')
  const officeEv = evs.filter(e => OFFICE_KINDS.includes(e.kind) && hasPresence(e) && !(e.code && LEAVE.has(e.code)) && e.mode !== 'WFA')
  const daringWfo = daring.filter(e => e.mode === 'WFO' && e.approved !== false && e.clockIn)
  const remoteEv = [...daring.filter(e => e.mode === 'WFA' && e.approved !== false && e.clockIn), ...evs.filter(e => e.kind !== 'daring' && e.mode === 'WFA' && hasPresence(e))]
  const rejected = daring.filter(e => e.approvalStatus === 'rejected' || (!e.approvalStatus && e.approved === false))
  // Laporan matriks online tidak memuat kolom persetujuan ('not-reported'): itu batas format, bukan status Pending.
  const approvalPending = daring.some(e => e.approvalStatus === 'pending' || e.approvalStatus === 'unknown')
  const stOut = sts.filter(a => !a.local), stLocal = sts.filter(a => a.local)
  const presenceEv = [...officeEv, ...daringWfo, ...remoteEv]

  // Do not take the first source. A time is usable only when the selected set has one unambiguous value.
  const paired = presenceEv.filter(e => e.clockIn && e.clockOut && e.clockOut >= e.clockIn)
  const unique = (values: (string | undefined)[]) => [...new Set(values.filter((value): value is string => !!value))]
  const clockIns = unique(presenceEv.map(e => e.clockIn)), clockOuts = unique(presenceEv.map(e => e.clockOut))
  // Aturan UM tetap: pulang paling cepat 16:30 setiap hari kerja; jadwal yang tercantum di sumber tidak dipakai.
  const official = { end: MEAL_CLOCK_OUT }
  // Jam berbeda tipis antar sumber (mis. mesin 07:30–16:42 dan online 07:31–16:34) bukan clash bila semua pasangan
  // memberi putusan UM yang sama. Dipakai satu pasangan utuh dari satu sumber (mesin lebih dulu), tidak dirakit.
  const onTime = (time: string) => time <= MEAL_CLOCK_IN
  const allPaired = presenceEv.filter(hasTimes).every(e => paired.includes(e))
  const pairVerdicts = new Set(paired.map(e => onTime(e.clockIn!) && e.clockOut! >= official.end))
  // Signature isu dihitung lebih awal agar keputusan "pakai jam mesin offline" bisa memilih pasangan jam sebelum evaluasi.
  const issueSignature = stableStringify({ employee: [employee.id, employee.kantor, employee.workStatusPeriods?.filter(s => s.start <= date && s.end >= date)], date, workday, partialDay, evs: [...new Set(evs.map(({ id, fileId, ref, ...e }) => stableStringify(e)))].sort(), sts: [...new Set(sts.map(({ id, fileId, ref, dateRef, ...a }) => stableStringify(a)))].sort() })
  const scanDecision = resolutions.get(`${employee.id}|${date}|scan-berbeda`)
  const machinePair = paired.find(e => OFFICE_KINDS.includes(e.kind))
  const agreedByVerdict = (clockIns.length > 1 || clockOuts.length > 1) && allPaired && paired.length > 1 && new Set(paired.map(e => e.kind)).size === paired.length && pairVerdicts.size === 1 ? (paired.find(e => e.kind === 'mesin') ?? paired[0]) : undefined
  // Hari WFA: baris mesin berkode WFA hanya mencerminkan status WFA (scan parsial); jam sah berasal dari presensi online WFA.
  const unpairedTimed = presenceEv.filter(hasTimes).filter(e => !paired.includes(e))
  const onlineWfaPairs = paired.filter(e => e.kind === 'daring' && e.mode === 'WFA')
  const wfaPair = !agreedByVerdict && (clockIns.length > 1 || clockOuts.length > 1) && paired.length === 1 && onlineWfaPairs.length === 1 && unpairedTimed.length > 0 && unpairedTimed.every(e => e.kind !== 'daring' && e.mode === 'WFA') ? onlineWfaPairs[0] : undefined
  // Satu pasangan lengkap + scan parsial di sumber lain yang tidak bertentangan (mis. mesin 06:43–— dan online 06:42–16:04):
  // scan parsial menguatkan, bukan clash. Bertentangan bila jam parsial memberi putusan tepat waktu/pulang yang berbeda.
  const soloPair = paired.length === 1 ? paired[0] : undefined
  const partialAgrees = !!soloPair && unpairedTimed.length > 0 && unpairedTimed.every(e =>
    (!e.clockIn || onTime(e.clockIn) === onTime(soloPair.clockIn!)) && (!e.clockOut || (e.clockOut >= official.end) === (soloPair.clockOut! >= official.end)))
  const confirmedPair = !agreedByVerdict && !wfaPair && (clockIns.length > 1 || clockOuts.length > 1) && partialAgrees ? soloPair : undefined
  // Admin memutuskan jam mesin offline yang berlaku (decision akui-hadir pada isu scan-berbeda).
  const agreedPair = agreedByVerdict ?? wfaPair ?? confirmedPair ?? (scanDecision?.decision === 'akui-hadir' && scanDecision.signature === issueSignature && machinePair && (clockIns.length > 1 || clockOuts.length > 1) ? machinePair : undefined)
  const clockIn = agreedPair ? agreedPair.clockIn : clockIns.length === 1 ? clockIns[0] : undefined
  const clockOut = agreedPair ? agreedPair.clockOut : clockOuts.length === 1 ? clockOuts[0] : undefined
  const timeKnown = !!(clockIn || clockOut)
  const complete = !!agreedPair || !!(clockIn && clockOut && clockOut >= clockIn && paired.some(e => e.clockIn === clockIn && e.clockOut === clockOut) && new Set(paired.map(e => `${e.clockIn}|${e.clockOut}`)).size === 1)
  const scheduleKnown = true
  const lateMin = clockIn ? Math.max(0, Math.ceil(toMinutes(clockIn)! - toMinutes(MEAL_CLOCK_IN)!)) : 0
  const earlyMin = clockOut && clockIn ? Math.max(0, Math.ceil(toMinutes(official.end)! - toMinutes(clockOut)!)) : 0
  const overtimeMin = Math.max(0, ...evs.map(e => e.overtimeMin ?? 0))

  const leaveCode = [...codes].find(c => LEAVE.has(c))
  const pdCode = codes.has('PD')
  const officePresence = evs.some(e => e.present && e.mode === 'WFO') || officeEv.some(hasTimes) || daringWfo.length > 0 || officeEv.some(e => e.present)

  let status: DayStatus
  let basis: string
  const candidates = new Set<DayStatus>()
  for (const code of codes) if (LEAVE.has(code)) candidates.add(code === 'S' ? 'sakit' : code === 'I' ? 'izin' : 'cuti')
  if (pdCode || stOut.length) candidates.add('dinas-luar')
  if (codes.has('DIKLAT') || codes.has('KO')) candidates.add('diklat')
  if (codes.has('DL') || stLocal.length) candidates.add('dinas-lokal')
  if (officePresence) candidates.add(complete ? 'hadir' : 'tidak-lengkap')
  if (remoteEv.length) candidates.add(complete ? 'hadir-wfa' : 'tidak-lengkap')
  // Presensi online yang ditolak tidak menjadi clash bila sumber lain sudah membuktikan kehadiran.
  // Kode WFA di mesin tanpa jam hanyalah penanda status; bila sumber lain sudah memberi pasangan jam lengkap, itu bukan konflik.
  if (codes.has('WFA') && !remoteEv.length && !complete || (rejected.length && !officePresence && !remoteEv.length) || approvalPending || codes.has('T')) candidates.add('tidak-lengkap')
  // Hadir di kantor vs hadir WFA sama-sama kehadiran: bila satu pasangan jam sudah dipilih (putusan sama atau keputusan
  // admin), jenis kehadiran mengikuti pasangan itu dan tidak menjadi konflik status.
  if (agreedPair && candidates.has('hadir') && candidates.has('hadir-wfa')) candidates.delete(agreedPair.kind === 'daring' && agreedPair.mode === 'WFA' ? 'hadir' : 'hadir-wfa')
  // Jam identik di mesin kantor dan presensi WFA: putusan UM sama, jadi info saja; scan mesin kantor yang dipakai.
  else if (complete && candidates.has('hadir') && candidates.has('hadir-wfa')) candidates.delete(paired.some(e => OFFICE_KINDS.includes(e.kind)) ? 'hadir-wfa' : 'hadir')
  // Clash hanya bila salah satu sisi benar-benar bisa mendapat UM (pasangan jam lengkap, masuk ≤ 08:00, pulang ≥ 16:30).
  // Bila semua kemungkinan berujung tanpa UM (mis. kode DL + scan masuk saja), status dipilih otomatis dan dicatat sebagai info.
  const couldEarnMeal = complete && !!clockIn && !!clockOut && onTime(clockIn) && clockOut >= official.end
  const STATUS_PRIORITY: DayStatus[] = ['dinas-luar', 'dinas-lokal', 'diklat', 'sakit', 'cuti', 'izin', 'tidak-lengkap']
  if (candidates.size > 1) add('status-berbeda', 'tinggi', `Status berbeda antar-bukti: ${[...candidates].map(s => STATUS_LABEL[s]).join(', ')}. Admin perlu memilih catatan dan status harian yang berlaku.`, couldEarnMeal)
  if (!workday) { status = presenceEv.length ? 'hadir' : 'libur'; basis = presenceEv.length ? 'Ada absen pada hari libur' : 'Hari libur' }
  else if (candidates.size > 1 && couldEarnMeal) { status = 'tidak-lengkap'; basis = 'Sumber mencatat status berbeda; menunggu keputusan admin' }
  else if (candidates.size > 1) { status = STATUS_PRIORITY.find(c => candidates.has(c)) ?? 'tidak-lengkap'; basis = `Sumber berbeda (${[...candidates].map(c => STATUS_LABEL[c]).join(', ')}), tetapi tidak ada bukti hadir yang memenuhi syarat UM; dipakai ${STATUS_LABEL[status]}` }
  else if (candidates.size === 1) {
    const candidate = [...candidates][0]
    status = candidate
    basis = candidate === 'dinas-luar' ? (pdCode ? 'Kode perjalanan dinas pada bukti terpilih' : `ST ${stOut[0]?.letterNo ?? 'tanpa nomor'} (${stOut[0]?.destination ?? 'tujuan tidak tercatat'})`)
      : candidate === 'dinas-lokal' ? (stLocal.length ? `ST lokal ${stLocal[0].letterNo ?? ''}`.trim() : 'Dinas dalam kota pada bukti terpilih')
      : candidate === 'diklat' ? (codes.has('KO') ? 'Konsinyering' : 'Diklat')
      : candidate === 'hadir' ? describePresence(officeEv, daringWfo)
      : candidate === 'hadir-wfa' ? 'Presensi WFA pada bukti terpilih'
      : candidate === 'tidak-lengkap' ? (partialDay ? 'Data mesin tanggal ini belum lengkap saat diekspor' : 'Presensi atau keterangan belum lengkap')
      : `${DAY_CODE_LABEL[leaveCode as 'S'] ?? STATUS_LABEL[candidate]} (bukti absensi)`
    if ((candidate === 'hadir' || candidate === 'hadir-wfa') && !complete) status = 'tidak-lengkap'
  }
  else if (partialDay) { status = 'tidak-ada-data'; basis = 'Data mesin tanggal ini belum lengkap saat diekspor' }
  else if (covered && codes.has('X')) { status = 'tanpa-keterangan'; basis = 'Bukti absensi mencatat Absent tanpa pengecualian; menunggu keputusan admin' }
  // Status grid presensi daring (mis. "WFA - hadir" tanpa jam) adalah bukti, tetapi tidak membuktikan masuk ≤ 08:00.
  else if (evs.some(e => e.present && !e.clockIn && !e.clockOut)) { status = 'tidak-lengkap'; basis = 'Hanya status presensi daring tanpa jam; tidak cukup untuk uang makan' }
  else { status = 'tidak-ada-data'; basis = 'Belum ditemukan bukti absensi atau keterangan pada tanggal ini' }
  if (dayReview) { status = dayReview.status; basis = `Ditetapkan ${dayReview.reviewer}: ${STATUS_LABEL[dayReview.status]}` }

  // ---- deteksi isu ----
  // Clash jam hanya menahan bila setidaknya satu pasangan jam lengkap bisa mendapat UM (tepat waktu dan tidak pulang cepat).
  const anyPairEarns = paired.some(e => onTime(e.clockIn!) && e.clockOut! >= official.end)
  if (confirmedPair) add('scan-berbeda', 'rendah', `Scan parsial di sumber lain sejalan dengan pasangan jam ${SOURCE_NAME[confirmedPair.kind] ?? confirmedPair.kind} ${confirmedPair.clockIn}–${confirmedPair.clockOut}; pasangan itu dipakai.`, false)
  else if (wfaPair) add('scan-berbeda', 'rendah', `Mesin mencatat kode WFA dengan scan parsial; jam WFA dari presensi online (${wfaPair.clockIn}–${wfaPair.clockOut}) dipakai.`, false)
  else if (agreedByVerdict) add('scan-berbeda', 'rendah', `Jam berbeda tipis antar sumber (${paired.map(e => `${SOURCE_NAME[e.kind] ?? e.kind} ${e.clockIn}–${e.clockOut}`).join('; ')}), putusan UM sama; dipakai ${SOURCE_NAME[agreedByVerdict.kind] ?? agreedByVerdict.kind}.`, false)
  else if (new Set(paired.map(e => `${e.clockIn}|${e.clockOut}`)).size > 1 || clockIns.length > 1 || clockOuts.length > 1) add('scan-berbeda', 'tinggi', 'Jam masuk/pulang berbeda antar-bukti terpilih; pilih bukti absensi yang berlaku.', anyPairEarns)
  const scanAtOffice = officeEv.some(hasTimes) || daringWfo.length > 0
  if ((pdCode || stOut.length) && scanAtOffice) {
    const edge = stOut.some(a => a.start === date || a.end === date)
    const sev: Severity = stOut.length ? (edge ? 'sedang' : 'tinggi') : 'sedang'
    add('dinas-vs-scan-kantor', sev, `${stOut.length ? `ST ${stOut.map(a => a.letterNo ?? '(tanpa nomor)').join(', ')} ${stOut[0].start === stOut[0].end ? formatID(stOut[0].start) : `${formatID(stOut[0].start, { year: false })}–${formatID(stOut[0].end)}`}` : 'Kode perjalanan dinas'} tetapi ada absen kantor ${clockIn ?? ''}${clockOut ? `–${clockOut}` : ''}.${edge ? ' Tanggal ini hari berangkat/pulang, sehingga scan pagi masih wajar.' : ''}`, couldEarnMeal)
  }
  if (leaveCode && presenceEv.some(hasTimes)) add('cuti-vs-hadir', 'sedang', `${DAY_CODE_LABEL[leaveCode as 'S']} tercatat, namun ada jam hadir ${clockIn ?? '—'}–${clockOut ?? '—'}.`, couldEarnMeal)
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
    issue.signature = issueSignature
    const r = resolutions.get(issue.id)
    if (!r || r.signature !== issue.signature) continue
    resolved.push(r)
    // Admin memilih absensi sebagai bukti yang valid (mis. ST batal); berlaku juga bila ada ST/kode dinas.
    if (!dayReview && r.decision === 'akui-hadir') { finalStatus = complete ? (remoteEv.length && !officePresence ? 'hadir-wfa' : 'hadir') : 'tidak-lengkap'; finalBasis = `Diputuskan admin: hadir (${r.reviewer})` }
    if (!dayReview && r.decision === 'akui-dinas') { finalStatus = 'dinas-luar'; finalBasis = `Diputuskan admin: dinas (${r.reviewer})` }
    if (!dayReview && r.decision === 'tidak-hadir') { finalStatus = 'tanpa-keterangan'; finalBasis = `Diputuskan admin: tidak sah (${r.reviewer})` }
  }
  const open = issues.filter(i => !resolved.some(r => r.issueId === i.id))
  if (partialDay && finalStatus === 'tidak-lengkap' && clockIn && !clockOut) { finalStatus = remoteEv.length && !officePresence ? 'hadir-wfa' : 'hadir'; finalBasis = `${finalBasis} — jam pulang belum tersinkron (ekspor belum lengkap)` }
  const meal = partialDay && workday && (['tidak-lengkap', 'tidak-ada-data'].includes(finalStatus) || (['hadir', 'hadir-wfa'].includes(finalStatus) && !clockOut && timeKnown)) ? { state: 'held' as const, reason: 'Ditahan: data mesin belum lengkap, tunggu ekspor ulang', amount: 0 } : mealFor(employee, date, finalStatus, workday, complete, timeKnown, clockIn, lateMin, earlyMin, open, policy)
  const hasSource = rawEvidence.length > 0 || rawAssignments.length > 0
  // Clash = isu yang memblokir (status berbeda antar-sumber, ST vs absen kantor, jam berbeda, cuti vs hadir, dst.).
  const clash = open.some(i => i.blocksMeal)
  // Status persetujuan online Pending/tidak dikenal dan jenis kehadiran tak dikenal tetap menunggu admin.
  const needsReview = approvalPending || codes.has('T')
  // Hari yang clash-nya sudah diputuskan admin (resolusi isu pemblokir) sah, tetapi bukan "valid otomatis".
  const decidedByAdmin = resolved.some(r => issues.some(i => i.id === r.issueId && i.blocksMeal))
  const settled = workday && !dayReview && hasSource && !clash && !needsReview && !reviewError
  const autoValidated = settled && !decidedByAdmin
  const reviewState = !workday ? (hasSource ? 'flag' : 'not-found') : dayReview ? (open.length ? 'flag' : 'valid') : settled ? 'valid' : hasSource ? 'flag' : 'not-found'
  const reviewHeld = workday && !dayReview && !settled
  const incompleteReason = clockIn && !clockOut ? `Hanya ada jam masuk ${clockIn}, tanpa jam pulang; tidak dapat UM`
    : clockOut && !clockIn ? `Hanya ada jam pulang ${clockOut}, tanpa jam masuk; tidak dapat UM`
    : rawEvidence.some(e => e.present && !e.clockIn) ? `Sumber hanya mencatat kode ${rawEvidence.find(e => e.present && !e.clockIn)?.codeLabel ?? 'kehadiran'} tanpa jam; tidak membuktikan masuk ≤ 08:00`
    : 'Scan masuk/pulang tidak lengkap atau presensi online tidak disetujui; admin dapat mengoreksi lewat rekonsiliasi'
  const autoMeal = !partialDay && finalStatus === 'tidak-lengkap' && meal.state === 'excluded' ? { ...meal, reason: incompleteReason }
    : settled && meal.state === 'held' && finalStatus === 'tidak-ada-data' && !partialDay
    ? { state: 'excluded' as const, reason: rawEvidence.some(e => e.present && !e.clockIn) ? `Sumber hanya mencatat kode ${rawEvidence.find(e => e.present && !e.clockIn)?.codeLabel ?? 'kehadiran'} tanpa jam; tidak membuktikan masuk ≤ 08:00` : 'Sumber mencatat hari ini tanpa scan maupun keterangan; admin dapat mengoreksi lewat rekonsiliasi', amount: 0 }
    : meal
  const finalMeal = reviewHeld ? { state: 'held' as const, heldBy: 'decision' as const, reason: reviewError ? `Keputusan perlu diperbarui: ${reviewError}` : hasSource ? 'Clash antar-sumber: menunggu admin memilih bukti yang valid' : 'Belum ditemukan data absensi', amount: 0 } : autoMeal
  return { employeeId: employee.id, date, workday, covered, sourceCoverageComplete: true, reviewState, autoValidated, reviewSignature, decision: dayReview, reviewError, evidence: rawEvidence, assignments: rawAssignments, status: finalStatus, basis: finalBasis, clockIn, clockOut, scheduleKnown, lateMin, earlyMin, overtimeMin, complete, timeKnown, issues, resolved, meal: finalMeal }
}

const SOURCE_NAME: Partial<Record<SourceKind, string>> = { mesin: 'mesin offline', daring: 'online', 'matriks-kanwil': 'mesin Kanwil', 'jadwal-kanwil': 'rekap manual Kanwil', 'laporan-kanwil': 'laporan Kanwil' }

function describePresence(office: Evidence[], wfo: Evidence[]) {
  const parts: string[] = []
  if (office.some(e => e.kind === 'mesin')) parts.push('mesin')
  if (office.some(e => e.kind === 'matriks-kanwil')) parts.push('mesin Kanwil')
  if (office.some(e => e.kind === 'jadwal-kanwil')) parts.push('rekap manual Kanwil')
  if (office.some(e => e.kind === 'laporan-kanwil')) parts.push('laporan kode Kanwil')
  if (wfo.length) parts.push('aplikasi (WFO)')
  return `Scan ${parts.join(' + ')}`
}

function mealFor(employee: Employee, date: ISODate, status: DayStatus, workday: boolean, complete: boolean, timeKnown: boolean, clockIn: string | undefined, lateMin: number, earlyMin: number, open: Issue[], policy: MealPolicy): DayRecord['meal'] {
  const no = (reason: string): DayRecord['meal'] => ({ state: 'excluded', reason, amount: 0 })
  if (!workday) return no('Bukan hari kerja')
  const excludedStatus = employee.workStatusPeriods?.find(s => s.start <= date && s.end >= date)
  if (excludedStatus) return no(`${excludedStatus.kind === 'tugas-belajar' ? 'Tugas belajar' : 'Diperbantukan ke instansi lain'}: ${excludedStatus.basis}`)
  if (employee.statusPegawai === 'Tugas Belajar' && !employee.workStatusPeriods?.length) return { state: 'held', amount: 0, reason: 'Lengkapi rentang efektif tugas belajar' }
  if (employee.statusPegawai === 'Nonaktif') return no('Pegawai nonaktif')
  // Hanya jam masuk atau hanya jam pulang tidak membuktikan hari penuh: tidak dapat UM.
  if (status === 'tidak-lengkap') return no('Scan masuk/pulang tidak lengkap')
  if (status === 'tidak-ada-data') return { state: 'held', amount: 0, reason: 'Bukti masuk dan pulang belum tersedia' }
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
    const arrivalMinutes = toMinutes(clockIn)
    if (policy.requireOnTime && arrivalMinutes !== undefined && arrivalMinutes > 8 * 60) return no(`Terlambat ${lateMin} menit (melewati batas pukul 08:00)`)
    if (policy.requireOnTime && arrivalMinutes === 8 * 60) {
      if (!policy.arrivalBoundary) return { state: 'held', amount: 0, reason: 'Batas tepat pukul 08:00 belum ditetapkan; minta konfirmasi apakah batasnya < 08:00 atau ≤ 08:00' }
      if (policy.arrivalBoundary === 'exclusive') return no('Tepat pukul 08:00 tidak memenuhi batas hadir sebelum 08:00')
    }
    if (policy.requireNoEarlyLeave && timeKnown && earlyMin > 0) return no(`Pulang ${earlyMin} menit sebelum pukul ${MEAL_CLOCK_OUT}`)
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
  return { state: 'eligible', reason: ready ? 'Hadir tepat waktu dan lengkap' : 'Hari memenuhi syarat; nominal pending: golongan/tarif atau parameter belum disahkan', amount: ready ? rate : 0, amountReady: ready, taxPct: ready && policy.taxParametersApproved ? taxPct : undefined }
}

function summarize(employee: Employee, days: DayRecord[], workdayCount: number, policy: MealPolicy): EmployeeMonth {
  const wd = days.filter(d => d.workday && d.reviewState !== 'future')
  const count = (s: DayStatus[]) => wd.filter(d => d.reviewState === 'valid' && s.includes(d.status)).length
  const { group, assumed } = golGroup(employee.golongan, employee.statusKepegawaian, policy.defaultGroup)
  const mealDays = wd.filter(d => d.meal.state === 'eligible').length
  const rate = policy.rates[group]
  const bruto = wd.reduce((sum, d) => sum + d.meal.amount, 0)
  const pphPct = policy.pph[group]
  const pph = policy.taxParametersApproved ? Math.round(wd.reduce((sum, d) => sum + d.meal.amount * (d.meal.taxPct ?? 0) / 100, 0)) : 0
  return {
    employee, days, workdays: workdayCount,
    reviewedDays: wd.filter(d => d.reviewState === 'valid').length,
    flaggedDays: wd.filter(d => d.reviewState === 'flag').length,
    notFoundDays: wd.filter(d => d.reviewState === 'not-found').length,
    futureDays: days.filter(d => d.workday && d.reviewState === 'future').length,
    present: count(['hadir', 'hadir-wfa', 'dinas-lokal']),
    wfa: count(['hadir-wfa']),
    dutyOut: count(['dinas-luar']), dutyLocal: count(['dinas-lokal']),
    leave: count(['cuti', 'sakit', 'izin']),
    absent: count(['tanpa-keterangan']),
    incomplete: wd.filter(d => d.reviewState === 'flag').length,
    noData: wd.filter(d => d.reviewState === 'not-found').length + Math.max(0, workdayCount - wd.length),
    lateDays: wd.filter(d => d.reviewState === 'valid' && d.lateMin > 0).length,
    lateMinutes: wd.reduce((s, d) => s + (d.reviewState === 'valid' ? d.lateMin : 0), 0),
    earlyDays: wd.filter(d => d.reviewState === 'valid' && d.earlyMin > 0).length,
    overtimeMinutes: days.reduce((s, d) => s + (d.reviewState === 'valid' ? d.overtimeMin : 0), 0),
    mealDays, heldDays: wd.filter(d => d.meal.state === 'held').length,
    estimateDays: wd.filter(d => d.meal.estimate).length, estimateBruto: wd.reduce((sum, d) => sum + (d.meal.estimate ?? 0), 0),
    amountPendingDays: wd.filter(d => d.meal.state === 'eligible' && !d.meal.amountReady).length,
    group, groupAssumed: assumed, rate, bruto, pphPct, pph, netto: policy.taxParametersApproved ? bruto - pph : 0, nettoReady: policy.taxParametersApproved === true,
    openIssues: days.reduce((s, d) => s + d.issues.filter(i => !d.resolved.some(r => r.issueId === i.id)).length, 0),
    openClashes: days.reduce((s, d) => s + (d.workday && d.reviewState === 'flag' && !d.decision ? d.issues.filter(i => i.blocksMeal && !d.resolved.some(r => r.issueId === i.id)).length : 0), 0),
  }
}
