import type { Evidence, Sheet } from '../types.ts'
import { inferSlashOrder, parseDuration, parseTime, slashToISO, excelSerialToISO } from '../dates.ts'
import { classifyId } from '../ids.ts'
import { cleanText } from '../names.ts'
import { columnIndex, findHeaderRow, rowRef, str, toDayCode } from './common.ts'

/** Ekspor baris-per-hari dari software mesin sidik jari (header Indonesia "Scan Masuk" atau Inggris "Clock In"). */
export function isMachineExport(sheet: Sheet) {
  return findHeaderRow(sheet, [/^(scan masuk|clock in)$/, /^(tanggal|date)$/]) >= 0
}

export function parseMachine(sheet: Sheet, fileId: string, office: string, warnings: string[], dateOrder?: 'MDY' | 'DMY'): Evidence[] {
  const h = findHeaderRow(sheet, [/^(scan masuk|clock in)$/, /^(tanggal|date)$/])
  const header = sheet.rows[h]
  const col = {
    id: columnIndex(header, /^nik$/, /^no\.$/, /^nip$/),
    mesin: columnIndex(header, /^no\. id$/, /^ac-no\.?$/),
    name: columnIndex(header, /^nama$/, /^name$/),
    date: columnIndex(header, /^tanggal$/, /^date$/),
    table: columnIndex(header, /^jam kerja$/, /^timetable$/),
    on: columnIndex(header, /^jam masuk$/, /^on duty$/),
    off: columnIndex(header, /^jam pulang$/, /^off duty$/),
    in: columnIndex(header, /^scan masuk$/, /^clock in$/),
    out: columnIndex(header, /^scan pulang$/, /^clock out$/),
    late: columnIndex(header, /^terlambat$/, /^late$/),
    early: columnIndex(header, /^plg\. cepat$/, /^early$/),
    absent: columnIndex(header, /^absent$/),
    ot: columnIndex(header, /^lembur$/, /^ot time$/),
    exc: columnIndex(header, /^pengecualian$/, /^exception$/),
    dept: columnIndex(header, /^departemen$/, /^department$/),
  }
  const rowIdx: number[] = []
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    if (str(row[col.name]) && (str(row[col.date]) || typeof row[col.date] === 'number')) rowIdx.push(r)
  }
  const slashDates = rowIdx.map(r => str(sheet.rows[r][col.date])).filter(v => v.includes('/'))
  const disambiguated = slashDates.some(v => v.split('/').slice(0, 2).some(p => Number(p) > 12))
  if (slashDates.length && !disambiguated && !dateOrder) throw new Error('Tanggal sumber ambigu (DD/MM atau MM/DD). Pilih format tanggal mesin pada Impor Sumber, lalu unggah ulang. Tidak ada data yang di-commit.')
  const order = dateOrder ?? inferSlashOrder(slashDates)
  const out: Evidence[] = []
  let missingId = 0
  for (const ri of rowIdx) {
    const r = sheet.rows[ri]
    const rawDate = r[col.date]
    const date = typeof rawDate === 'number' ? excelSerialToISO(rawDate) : slashToISO(str(rawDate), order)
    if (!date) continue
    const ids = classifyId(r[col.id])
    const machineNo = str(r[col.mesin])
    if (!ids.nip && !ids.nika && machineNo) ids.mesin = machineNo
    if (!str(r[col.id])) missingId++
    const tableLabel = str(r[col.table])
    const on = parseTime(r[col.on]), off = parseTime(r[col.off])
    const exc = str(r[col.exc])
    const absent = /true/i.test(str(r[col.absent]))
    const ev: Evidence = {
      id: `${fileId}:${sheet.name}:${ri}`,
      fileId, kind: 'mesin', office,
      name: cleanText(r[col.name]),
      ids, date,
      schedule: on && off ? { start: on, end: off, label: tableLabel } : undefined,
      clockIn: parseTime(r[col.in]),
      clockOut: parseTime(r[col.out]),
      lateMin: parseDuration(r[col.late]),
      earlyMin: parseDuration(r[col.early]),
      overtimeMin: parseDuration(r[col.ot]),
      unit: str(r[col.dept]) || undefined,
      ref: rowRef(sheet, ri),
    }
    if (exc) { ev.code = toDayCode(exc); ev.codeLabel = exc }
    else if (absent && !ev.clockIn && !ev.clockOut) { ev.code = 'X'; ev.codeLabel = 'Absent (mesin)' }
    if (/puasa/i.test(tableLabel)) ev.notes = ['jadwal-puasa']
    out.push(ev)
  }
  if (missingId) warnings.push(`${missingId} baris tanpa NIP/NIKA — dicocokkan lewat nama dan nomor mesin.`)
  return out
}
