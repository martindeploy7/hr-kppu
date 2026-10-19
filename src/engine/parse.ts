import type { Employee, Assignment, Evidence, ReportSummary, Sheet, SourceFile, SourceKind } from './types.ts'
import { officeFromText } from './ids.ts'
import { isMachineExport, parseMachine } from './parsers/machine.ts'
import { isOnlineExport, parseOnline } from './parsers/online.ts'
import { isCheckingReport, isScheduleWorkbook, isTransactionMatrix, parseCheckingReport, parseScheduleSheet, parseTransactionMatrix } from './parsers/kanwil.ts'
import { findAssignmentHeader, parseAssignmentSheet } from './parsers/assignments.ts'
import { sheetText } from './parsers/common.ts'
import { isOnlineMatrix, parseOnlineMatrix } from './parsers/online-matrix.ts'
import { parseMasterSheet } from './parsers/master.ts'
import { columnIndex, findHeaderRow, rowRef, str } from './parsers/common.ts'
import { formatID, weekday } from './dates.ts'

/** Tanggal di akhir ekspor yang hampir tanpa scan lengkap, atau tanggal yang mayoritas hanya punya scan masuk. */
function detectPartialDates(evidence: Evidence[]): string[] {
  const byDate = new Map<string, { n: number; both: number; inOnly: number }>()
  for (const e of evidence) {
    if (e.code && e.code !== 'X') continue
    const s = byDate.get(e.date) ?? { n: 0, both: 0, inOnly: 0 }
    s.n++
    if (e.clockIn && e.clockOut) s.both++
    else if (e.clockIn) s.inOnly++
    byDate.set(e.date, s)
  }
  const dates = [...byDate.keys()].sort()
  const flagged = new Set<string>()
  for (const d of dates) { const s = byDate.get(d)!; if (s.n >= 10 && s.inOnly / s.n > 0.3) flagged.add(d) }
  for (let i = dates.length - 1; i >= 0; i--) {
    const s = byDate.get(dates[i])!
    if (weekday(dates[i]) !== 5 && s.n >= 10 && s.both / s.n < 0.05) flagged.add(dates[i]); else if (!flagged.has(dates[i])) break
  }
  return [...flagged].sort()
}

export const KIND_LABEL: Record<SourceKind, string> = {
  mesin: 'Mesin absensi (ekspor harian)',
  daring: 'Presensi daring (aplikasi HP)',
  'matriks-kanwil': 'Transaksi mesin Kanwil (matriks)',
  'jadwal-kanwil': 'Jadwal absen manual Kanwil',
  'laporan-kanwil': 'Laporan kode harian Kanwil',
  'surat-tugas': 'Rekap surat tugas sekretaris',
}

export class UnknownFormatError extends Error {}

export function parseWorkbook(fileName: string, sheets: Sheet[], fileId: string, options: { dateOrder?: 'MDY' | 'DMY' } = {}): SourceFile {
  const warnings: string[] = []
  const evidence: Evidence[] = []
  const assignments: Assignment[] = []
  const summaries: ReportSummary[] = []
  const quarantined: {ref:string;reason:string;raw:string}[] = []
  const master: Partial<Employee>[] = []
  const nameText = fileName.replace(/\.(xlsx?|csv|dbf)/gi, ' ')
  const guessOffice = (fallback = 'Pusat') => officeFromText(nameText) ?? officeFromText(sheets.map(s => `${s.name} ${sheetText(s, 4)}`).join(' ')) ?? fallback
  let kind: SourceKind
  let office: string

  const onlineMatrix = sheets.find(isOnlineMatrix)
  const online = sheets.find(isOnlineExport)
  const machine = sheets.find(isMachineExport)
  const matrix = sheets.find(isTransactionMatrix)
  const report = sheets.find(isCheckingReport)
  if (onlineMatrix) {
    kind = 'daring'; office = 'Semua kantor'
    for (const sheet of sheets.filter(isOnlineMatrix)) evidence.push(...parseOnlineMatrix(sheet, fileId, warnings))
  } else if (online) {
    kind = 'daring'; office = 'Semua kantor'
    for (const sheet of sheets.filter(isOnlineExport)) evidence.push(...parseOnline(sheet, fileId, warnings))
  } else if (machine) {
    kind = 'mesin'; office = guessOffice('Belum ditentukan')
    if (office === 'Belum ditentukan') warnings.push('Kantor asal tidak terbaca dari nama file — pilih kantor secara manual.')
    for (const sheet of sheets.filter(isMachineExport)) evidence.push(...parseMachine(sheet, fileId, office, warnings, options.dateOrder))
  } else if (matrix) {
    kind = 'matriks-kanwil'; office = guessOffice('Belum ditentukan')
    for (const sheet of sheets.filter(isTransactionMatrix)) evidence.push(...parseTransactionMatrix(sheet, fileId, office, warnings))
  } else if (report) {
    kind = 'laporan-kanwil'; office = guessOffice('Belum ditentukan')
    for (const sheet of sheets.filter(isCheckingReport)) evidence.push(...parseCheckingReport(sheet, fileId, office, warnings, summaries))
  } else if (isScheduleWorkbook(sheets)) {
    kind = 'jadwal-kanwil'; office = guessOffice('Belum ditentukan')
    for (const s of sheets) evidence.push(...parseScheduleSheet(s, fileId, office, warnings))
    warnings.unshift('Nama file menyebut "Penomoran ST", tetapi isinya jadwal absen harian — dibaca sebagai sumber kehadiran.')
  } else if (sheets.some(s => findAssignmentHeader(s) >= 0)) {
    kind = 'surat-tugas'; office = guessOffice()
    const multi = sheets.filter(s => findAssignmentHeader(s) >= 0)
    const unitFromFile = /kesekjenan/i.test(fileName) ? 'Kesekjenan' : undefined
    for (const s of multi) assignments.push(...parseAssignmentSheet(s, fileId, office, multi.length > 1 ? s.name.trim() : unitFromFile, warnings, quarantined))
  } else {
    throw new UnknownFormatError(`Format "${fileName}" belum dikenali. Pastikan file adalah ekspor absensi atau rekap surat tugas.`)
  }

  for (const sheet of sheets) {
    master.push(...parseMasterSheet(sheet, office, quarantined))
    for (const risk of sheet.identifierRisks ?? []) {
      quarantined.push({ ref: rowRef(sheet, risk.row), reason: 'IDENTIFIER_PRECISION_RISK: identifier numerik harus diverifikasi terhadap master teks', raw: risk.raw })
      for (const e of evidence.filter(e => e.ref === rowRef(sheet, risk.row))) { e.identityPending = true; delete e.ids.nip }
    }
  }
  // Account independently for named source rows, including adapter skips.
  const parsedRefs = new Set([...evidence.map(e => e.ref.split(', kolom')[0]), ...assignments.map(a => a.ref), ...quarantined.map(q => q.ref)])
  const masterNames = new Set(master.map(e => e.nama))
  for (const sheet of sheets) {
    const h = findHeaderRow(sheet, [/^(?:nama(?: pegawai| pelaksana)?|name)$/])
    if (h < 0) {
      if (sheet.rows.some(r => r.some(c => str(c)))) quarantined.push({ ref: sheet.name, reason: 'Sheet tidak memiliki header pegawai yang dikenali; perlu pemeriksaan struktur', raw: `${sheet.rows.filter(r => r.some(c => str(c))).length} baris berisi data` })
      continue
    }
    const nameCol = columnIndex(sheet.rows[h], /^(?:nama(?: pegawai| pelaksana)?|name)$/)
    for (let r = h + 1; r < sheet.rows.length; r++) {
      const name = str(sheet.rows[r][nameCol]), ref = rowRef(sheet, r)
      if (!name || /^(?:nama(?: pegawai| pelaksana)?|name)$/i.test(name)) continue
      const accounted = parsedRefs.has(ref) || (/data pegawai|nip pppk/i.test(sheet.name) && masterNames.has(name))
      if (!accounted) quarantined.push({ ref, reason: 'Baris pegawai belum menghasilkan bukti/master yang sah; periksa tanggal, identitas atau status sumber', raw: name })
    }
  }
  if (!evidence.length && !assignments.length) warnings.push('Tidak ada baris data yang terbaca.')
  const partialDates = kind === 'mesin' || kind === 'matriks-kanwil' ? detectPartialDates(evidence) : []
  if (partialDates.length) warnings.unshift(`Data tanggal ${partialDates.map(d => formatID(d, { short: true })).join(', ')} tampak belum lengkap (jam pulang/scan belum tersinkron saat diekspor). Hari tersebut tidak dihitung "tanpa keterangan" dan uang makannya ditahan sampai file diekspor ulang.`)
  const dates = [...evidence.map(e => e.date), ...assignments.flatMap(a => [a.start, a.end])].sort()
  const people = new Set([...evidence.map(e => e.ids.nip ?? e.ids.nika ?? `${e.office}|${e.name}`), ...assignments.map(a => a.name.toLowerCase())])
  return {
    id: fileId, fileName, kind, label: KIND_LABEL[kind], office,
    importedAt: new Date().toISOString(),
    period: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
    evidence, assignments, master: master.length ? master : undefined, quarantined, summaries: summaries.length ? summaries : undefined, partialDates: partialDates.length ? partialDates : undefined, warnings,
    stats: { rows: evidence.length + assignments.length, people: people.size },
  }
}

/** Mengganti kantor sebuah file (mis. ekspor mesin yang nama filenya tidak menyebut kantor). */
export function withOffice(file: SourceFile, office: string): SourceFile {
  return {
    ...file, office,
    evidence: file.kind === 'daring' ? file.evidence : file.evidence.map(e => ({ ...e, office })),
    assignments: file.assignments.map(a => ({ ...a, office })),
    warnings: file.warnings.filter(w => !w.startsWith('Kantor asal tidak terbaca')),
  }
}
