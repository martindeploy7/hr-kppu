import type { DayCode, Evidence, ISODate, ReportSummary, Sheet } from '../types.ts'
import { excelSerialToParts, iso, parseTime, validDate, monthFromWord, parseDateRange, addDays } from '../dates.ts'
import { splitMachineName, cleanText } from '../names.ts'
import { findHeaderRow, low, rowRef, sheetText, str, toDayCode } from './common.ts'

// ---------- Kanwil I: "Data Transaksi Karyawan" (nama(ACNo) × tanggal, sel "07:07-\n18:03") ----------

export function isTransactionMatrix(sheet: Sheet) {
  return /data transaksi karyawan/i.test(sheetText(sheet, 4)) && findHeaderRow(sheet, [/^nama$/]) >= 0
}

function matrixPeriod(sheet: Sheet) {
  const m = sheetText(sheet, 5).match(/(\d{2})-(\d{2})-(\d{4})\s*s\/d\s*(\d{2})-(\d{2})-(\d{4})/i)
  if (!m) return null
  return { start: iso(+m[3], +m[2], +m[1]), end: iso(+m[6], +m[5], +m[4]) }
}

/** Header tanggal di file ini tercampur: serial Excel dengan hari/bulan tertukar (46031 = "9 Jan" padahal 1 Sep) dan teks "13/09". */
function headerDate(value: unknown, period: { start: ISODate; end: ISODate }): ISODate | null {
  const year = Number(period.start.slice(0, 4))
  if (typeof value === 'number') {
    const [y, m, d] = excelSerialToParts(value)
    const direct = iso(y, m, d), swapped = validDate(y, d, m) ? iso(y, d, m) : null
    if (direct >= period.start && direct <= addDays(period.end, 1)) return direct
    if (swapped && swapped >= period.start && swapped <= addDays(period.end, 1)) return swapped
    return null
  }
  const s = str(value as string).match(/^(\d{1,2})\/(\d{1,2})$/)
  if (s && validDate(year, +s[2], +s[1])) return iso(year, +s[2], +s[1])
  return null
}

function parseInOut(value: unknown): { in?: string; out?: string } {
  if (typeof value === 'number') {
    const t = parseTime(value)
    return value % 1 < 0.5 ? { in: t } : { out: t }
  }
  const s = str(value as string)
  if (!s) return {}
  const m = s.replace(/\s+/g, '').match(/^(\d{1,2}:\d{2})?(?::\d{2})?-?(\d{1,2}:\d{2})?$/)
  if (!m) return {}
  const single = !s.includes('-') && m[1]
  return single ? { in: parseTime(m[1]) } : { in: m[1] ? parseTime(m[1]) : undefined, out: m[2] ? parseTime(m[2]) : undefined }
}

export function parseTransactionMatrix(sheet: Sheet, fileId: string, office: string, warnings: string[]): Evidence[] {
  const period = matrixPeriod(sheet)
  if (!period) { warnings.push('Periode "Dari … s/d …" tidak ditemukan; file dilewati.'); return [] }
  const h = findHeaderRow(sheet, [/^nama$/])
  const header = sheet.rows[h]
  const dateCols: [number, ISODate][] = []
  header.forEach((v, c) => { if (c === 0) return; const d = headerDate(v, period); if (d && d >= period.start && d <= period.end) dateCols.push([c, d]) })
  if (dateCols.some(([, d], i) => i > 0 && d <= dateCols[i - 1][1])) warnings.push('Urutan kolom tanggal tidak berurutan — periksa header.')
  warnings.push('Header tanggal memakai format Excel campuran (hari/bulan tertukar); sudah dikoreksi otomatis berdasarkan periode laporan.')
  const out: Evidence[] = []
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    const first = str(row[0])
    if (!first || /^nama$/i.test(first) || !/\(\s*[\w.-]+\s*\)\s*$/.test(cleanText(first))) continue
    const { name, mesin } = splitMachineName(first)
    for (const [c, date] of dateCols) {
      const io = parseInOut(row[c])
      if (!io.in && !io.out) continue
      out.push({ id: `${fileId}:${sheet.name}:${r}:${c}`, fileId, kind: 'matriks-kanwil', office, name, ids: { mesin }, date, clockIn: io.in, clockOut: io.out, schedule: defaultSchedule(date), ref: `${rowRef(sheet, r)}, kolom ${c + 1}` })
    }
  }
  return out
}

export function defaultSchedule(date: ISODate) {
  const fri = new Date(`${date}T00:00:00Z`).getUTCDay() === 5
  return fri ? { start: '08:00', end: '16:30', label: 'Jumat (asumsi)' } : { start: '08:00', end: '16:00', label: 'Sen–Kam (asumsi)' }
}

// ---------- Kanwil V: "Jadwal Absen Pegawai" manual (per hari: Ket | Jam masuk | Jam pulang), satu sheet per bulan ----------

export function isScheduleWorkbook(sheets: Sheet[]) {
  return sheets.some(s => /jadwal absen pegawai|kunci jenis absen/i.test(sheetText(s, 4)))
}

export function parseScheduleSheet(sheet: Sheet, fileId: string, office: string, warnings: string[]): Evidence[] {
  const h = sheet.rows.findIndex((row, i) => i < 15 && row.some(c => /^no\.?$/i.test(str(c))) && row.some(c => /nama pegawai/i.test(str(c))))
  if (h < 0) return []
  const header = sheet.rows[h]
  const days: [number, ISODate][] = []
  header.forEach((v, c) => {
    const m = str(v).match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
    if (!m) return
    const month = monthFromWord(m[2])
    if (month && validDate(+m[3], month, +m[1])) days.push([c, iso(+m[3], month, +m[1])])
  })
  const nameCol = header.findIndex(c => /nama pegawai/i.test(str(c)))
  const out: Evidence[] = []
  let manual = 0, dup = 0
  for (let r = h + 2; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    const name = cleanText(row[nameCol])
    if (!name || /^\d+$/.test(name)) continue
    let prev: { in?: string; out?: string } | null = null
    for (const [c, date] of days) {
      const tin = parseTime(row[c + 1]), tout = parseTime(row[c + 2])
      // Sebagian sheet (mis. Januari) menaruh kode di kolom jam, bukan di kolom "Ket".
      const ket = str(row[c]) || (!tin && str(row[c + 1]) && !/^\d/.test(str(row[c + 1])) ? str(row[c + 1]) : '')
      if (!ket && !tin && !tout) { prev = null; continue }
      const ev: Evidence = { id: `${fileId}:${sheet.name}:${r}:${c}`, fileId, kind: 'jadwal-kanwil', office, name, ids: {}, date, clockIn: tin, clockOut: tout, schedule: defaultSchedule(date), ref: `${rowRef(sheet, r)}, kolom ${c + 1}` }
      if (ket) {
        const code = toDayCode(ket)
        if (code === 'WFA') ev.mode = 'WFA'
        else { ev.code = code; ev.codeLabel = ket }
        if (code === 'ERR') { ev.notes = ['jam-manual-absen-error']; manual++ }
      }
      if (tin && tout && prev && prev.in === tin && prev.out === tout) { ev.notes = [...(ev.notes ?? []), 'jam-sama-hari-sebelumnya']; dup++ }
      prev = tin || tout ? { in: tin, out: tout } : null
      out.push(ev)
    }
  }
  if (manual) warnings.push(`${sheet.name.trim()}: ${manual} sel "Absen Eror" berisi jam yang diketik manual.`)
  if (dup) warnings.push(`${sheet.name.trim()}: ${dup} sel memiliki jam masuk & pulang identik dengan hari sebelumnya.`)
  return out
}

// ---------- Kanwil VI: "Daily Attendance Checking Report" (hanya kode harian + ringkasan) ----------

export function isCheckingReport(sheet: Sheet) {
  return /daily attendance checking report/i.test(sheetText(sheet, 3))
}

const REPORT_LEGEND: Record<string, DayCode | 'normal' | 'no-in' | 'no-out'> = {
  '': 'normal', '[': 'no-in', ']': 'no-out', X: 'X', S: 'S', PD: 'PD', T: 'T', D: 'DIKLAT', KO: 'KO', I: 'I', C: 'C', WF: 'WFA', DL: 'DL',
}

export function parseCheckingReport(sheet: Sheet, fileId: string, office: string, warnings: string[], summaries: ReportSummary[]): Evidence[] {
  const text = sheetText(sheet, 4)
  const range = text.match(/from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i)
  if (!range) { warnings.push('Rentang "From … to …" tidak ditemukan.'); return [] }
  const [start, end] = [range[1], range[2]]
  const h = findHeaderRow(sheet, [/^name$/, /^ac-no\.?$/])
  const header = sheet.rows[h]
  const days: [number, ISODate][] = []
  let y = +start.slice(0, 4), m = +start.slice(5, 7), lastDay = 0
  header.forEach((v, c) => {
    const d = str(v).match(/^(\d{1,2})\s*\n?\s*[A-Za-z]{3}$/)
    if (!d) return
    const day = +d[1]
    if (day < lastDay) { m++; if (m > 12) { m = 1; y++ } }
    lastDay = day
    if (validDate(y, m, day)) days.push([c, iso(y, m, day)])
  })
  const label = (name: RegExp) => header.findIndex(c => name.test(low(c)))
  const sumCols = { duty: label(/^duty$/), actual: label(/^actual$/), absent: label(/^absent$/), late: label(/^late$/), early: label(/^early$/), ot: label(/^ot$/) }
  const num = (row: unknown[], c: number) => { if (c < 1) return undefined; const v = row[c - 1] ?? row[c]; return typeof v === 'number' ? v : undefined }
  const out: Evidence[] = []
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    const first = str(row[0])
    if (!first || !/\(\s*\d+\s*\)\s*$/.test(cleanText(first))) continue
    const { name, mesin } = splitMachineName(first)
    summaries.push({ name, mesin, duty: num(row, sumCols.duty), actual: num(row, sumCols.actual), absent: num(row, sumCols.absent), late: num(row, sumCols.late), early: num(row, sumCols.early), overtimeHours: num(row, sumCols.ot) })
    for (const [c, date] of days) {
      if (date < start || date > end) continue
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay()
      const raw = str(row[c]).replace(/\s+/g, '').toUpperCase()
      const legend = REPORT_LEGEND[raw] ?? (raw ? 'T' : 'normal')
      if ((wd === 0 || wd === 6) && legend === 'normal') continue
      const ev: Evidence = { id: `${fileId}:${sheet.name}:${r}:${c}`, fileId, kind: 'laporan-kanwil', office, name, ids: { mesin }, date, schedule: defaultSchedule(date), notes: ['tanpa-jam'], ref: `${rowRef(sheet, r)}, kolom ${c + 1}` }
      if (legend === 'WFA') { ev.mode = 'WFA'; ev.present = true }
      else if (legend === 'normal') ev.present = true
      else if (legend === 'no-in' || legend === 'no-out') { ev.present = true; ev.incomplete = true; ev.codeLabel = legend === 'no-in' ? 'Tidak scan masuk' : 'Tidak scan pulang' }
      else { ev.code = legend; ev.codeLabel = raw }
      out.push(ev)
    }
  }
  warnings.push(`Laporan hanya berisi kode harian (tanpa jam). Sel kosong dibaca "Normal" sesuai legenda. Data tersedia ${start} s/d ${end}.`)
  return out
}

export { parseDateRange }
