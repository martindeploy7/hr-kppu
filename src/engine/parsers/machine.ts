import type { Evidence, Sheet, SourceFile } from '../types.ts'
import { parseAttendanceDate, parseDuration, parseTime } from '../dates.ts'
import { classifyId } from '../ids.ts'
import { cleanText } from '../names.ts'
import { findHeaderRow, mappedColumns, rowRef, str, toDayCode } from './common.ts'

/** Ekspor harian mesin sidik jari KPPU dan variasi Kanwil yang memiliki pasangan kolom scan. */
export function isMachineExport(sheet: Sheet) {
  return findHeaderRow(sheet, [/^(scan masuk|clock in)$/, /^(tanggal|date)$/]) >= 0
}

export function parseMachine(sheet: Sheet, fileId: string, office: string, warnings: string[], dateOrder?: 'MDY' | 'DMY', quarantined?: NonNullable<SourceFile['quarantined']>): Evidence[] {
  const h = findHeaderRow(sheet, [/^(scan masuk|clock in)$/, /^(tanggal|date)$/])
  const header = sheet.rows[h]
  const col = mappedColumns(header, {
    id: [/^nik$/, /^nip$/], nika: [/^nika$/], numberId: [/^no\.$/], employeeNumber: [/^emp no\.?$/], machine: [/^no\. id$/, /^ac-no\.?$/],
    name: [/^nama$/, /^name$/], date: [/^tanggal$/, /^date$/], table: [/^jam kerja$/, /^timetable$/], on: [/^jam masuk$/, /^on duty$/], off: [/^jam pulang$/, /^off duty$/],
    in: [/^scan masuk$/, /^clock in$/], out: [/^scan pulang$/, /^clock out$/], duration: [/^jml jam kerja$/, /^work time$/], late: [/^terlambat$/, /^late$/],
    early: [/^plg\.? cepat$/, /^early$/], absent: [/^absent$/], ot: [/^lembur$/, /^ot time$/], exc: [/^pengecualian$/, /^exception$/], dept: [/^departemen$/, /^department$/],
  }, ['name', 'date', 'in'])

  const rowIdx: number[] = []
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    if (str(row[col.name]) && (str(row[col.date]) || typeof row[col.date] === 'number')) rowIdx.push(r)
  }
  const slashDates = rowIdx.map(r => str(sheet.rows[r][col.date])).filter(v => /\d{1,2}[/.]\d{1,2}[/.]\d{4}/.test(v))
  const dateOrderSignals = new Set<'MDY' | 'DMY'>()
  for (const value of slashDates) {
    const match = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/)
    if (!match) continue
    const [, first, second] = match.map(Number)
    // Even an impossible date such as 31/02 establishes DMY field order;
    // parseAttendanceDate still quarantines that individual invalid date.
    if (first > 12 && first <= 31 && second >= 1 && second <= 12) dateOrderSignals.add('DMY')
    if (second > 12 && second <= 31 && first >= 1 && first <= 12) dateOrderSignals.add('MDY')
  }
  const activeHeaders = header.map(str).filter(Boolean).map(value => value.toLocaleLowerCase('id-ID'))
  const standardDmyHeaders = [
    ['nik', 'nama', 'tanggal', 'jam kerja', 'jam masuk', 'jam pulang', 'scan masuk', 'scan pulang', 'jml jam kerja', 'pengecualian', 'departemen'],
    ['nik', 'no. id', 'nama', 'tanggal', 'jam kerja', 'jam masuk', 'jam pulang', 'scan masuk', 'scan pulang', 'pengecualian', 'departemen'],
  ]
  const knownDmy = standardDmyHeaders.some(expected => expected.length === activeHeaders.length && expected.every((value, index) => value === activeHeaders[index]))
  if (dateOrderSignals.size > 1 && !dateOrder) throw new Error('Tanggal sumber mencampur pola DD/MM dan MM/DD. Pilih profil tanggal secara eksplisit dan tinjau baris yang tidak valid; tidak ada data yang di-commit.')
  if (knownDmy && dateOrderSignals.has('MDY') && !dateOrder) throw new Error('Header ekspor Offline KPPU mengharapkan DD/MM/YYYY, tetapi nilai tanggal menunjukkan MM/DD/YYYY. Pilih profil tanggal secara eksplisit sebelum impor.')
  if (slashDates.length && !dateOrder && !knownDmy && dateOrderSignals.size === 0) throw new Error('Tanggal sumber ambigu (DD/MM atau MM/DD). Pilih format tanggal mesin pada Impor Sumber, lalu unggah ulang. Tidak ada data yang di-commit.')
  const inferredOrder = dateOrderSignals.size === 1 ? [...dateOrderSignals][0] : undefined
  const order = dateOrder ?? (knownDmy ? 'DMY' : inferredOrder)
  if (knownDmy && !dateOrder) warnings.push('Format tanggal DD/MM/YYYY dipakai untuk ekspor mesin KPPU berdasarkan struktur header sumber.')
  else if (inferredOrder && !dateOrder) warnings.push(`Format tanggal ${inferredOrder === 'DMY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'} teridentifikasi dari baris sumber dengan nilai hari/bulan yang tidak ambigu.`)

  const noColumnLooksLikeNika = col.numberId !== undefined && rowIdx.slice(0, 40).map(r => str(sheet.rows[r][col.numberId])).filter(Boolean).length > 0 && rowIdx.slice(0, 40).map(r => str(sheet.rows[r][col.numberId])).filter(Boolean).every(v => /^\d\.\d{2}\.\d{4}$/.test(v))
  const identifierColumn = col.id ?? col.nika ?? (noColumnLooksLikeNika ? col.numberId : undefined)
  const out: Evidence[] = []
  let missingId = 0, noSchedule = false
  for (const ri of rowIdx) {
    const r = sheet.rows[ri], rawDate = r[col.date], date = parseAttendanceDate(rawDate, order)
    if (!date) {
      quarantined?.push({ ref: `${rowRef(sheet, ri)}, kolom ${col.date + 1}`, reason: 'Tanggal tidak dapat dipastikan; periksa format dan nilai tanggal sumber.', raw: str(rawDate).slice(0, 200) })
      continue
    }
    const rawId = identifierColumn === undefined ? '' : str(r[identifierColumn])
    const ids = classifyId(rawId) as Evidence['ids']
    const machineNo = col.machine === undefined ? '' : str(r[col.machine])
    if (machineNo) ids.mesin = machineNo
    if (!rawId && !machineNo) missingId++
    const tableLabel = str(r[col.table]), on = parseTime(r[col.on]), off = parseTime(r[col.off]), exc = str(r[col.exc])
    if (!on || !off) noSchedule = true
    const code = toDayCode(exc)
    const ev: Evidence = {
      id: `${fileId}:${sheet.name}:${ri}`, fileId, kind: 'mesin', office, name: cleanText(r[col.name]), ids, date,
      schedule: on && off ? { start: on, end: off, label: tableLabel } : undefined,
      clockIn: parseTime(r[col.in]), clockOut: parseTime(r[col.out]), lateMin: parseDuration(r[col.late]), earlyMin: parseDuration(r[col.early]),
      overtimeMin: parseDuration(r[col.ot]), unit: str(r[col.dept]) || undefined, ref: rowRef(sheet, ri),
      sourceDurationMin: col.duration === undefined ? undefined : parseDuration(r[col.duration]),
      sourceValues: {
        name: str(r[col.name]) || undefined, identifier: rawId || undefined, employeeNumber: col.employeeNumber === undefined ? undefined : str(r[col.employeeNumber]) || undefined,
        machineId: machineNo || undefined, date: str(rawDate) || undefined, schedule: tableLabel || undefined,
        scheduleStart: str(r[col.on]) || undefined, scheduleEnd: str(r[col.off]) || undefined,
        duration: col.duration === undefined ? undefined : str(r[col.duration]) || undefined, exception: exc || undefined,
        unit: str(r[col.dept]) || undefined,
      },
    }
    if (exc) {
      ev.code = code; ev.codeLabel = exc
      if (code === 'WFA') ev.mode = 'WFA'
    } else if (/true/i.test(str(r[col.absent])) && !ev.clockIn && !ev.clockOut) { ev.code = 'X'; ev.codeLabel = 'Absent (mesin)' }
    if (/puasa/i.test(tableLabel)) ev.notes = ['jadwal-puasa']
    out.push(ev)
  }
  if (missingId) warnings.push(`${missingId} baris tanpa identifier pegawai atau nomor mesin; nama tidak dipakai sebagai pemadanan otomatis.`)
  if (noSchedule) warnings.push('Sebagian baris tidak memuat Jam Masuk/Jam Pulang terjadwal. Nilai Jml Jam Kerja tidak dipakai untuk menebak jadwal; periksa jadwal resmi sebelum menetapkan aturan waktu.')
  return out
}
