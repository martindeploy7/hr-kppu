import type { Evidence, Sheet, SourceFile } from '../types.ts'
import { validDate, iso, monthFromWord } from '../dates.ts'
import { classifyId, officeFromText, officeFromUnit } from '../ids.ts'
import { mappedColumns, findHeaderRow, rowRef, str } from './common.ts'

export const isOnlineMatrix = (sheet: Sheet) => findHeaderRow(sheet, [/^nip$/, /^nama pegawai$/, /^0?1\s/], 100) >= 0

export function parseOnlineMatrix(sheet: Sheet, fileId: string, warnings: string[], quarantined?: NonNullable<SourceFile['quarantined']>, officeCandidate?: string): Evidence[] {
  const h = findHeaderRow(sheet, [/^nip$/, /^nama pegawai$/, /^0?1\s/], 100), header = sheet.rows[h]
  const cols = mappedColumns(header, { nip: [/^nip$/], name: [/^nama pegawai$/], office: [/^kantor$/, /^office$/, /^nama kantor$/], unit: [/^unit$/] }, ['nip', 'name'])
  const title = sheet.rows.slice(0, h).flat().map(str).join(' ')
  const period = title.match(/([a-z]+)\s+(20\d{2})/i), month = period ? monthFromWord(period[1]) : undefined
  if (!period || !month) throw new Error('Periode matriks online tidak terbaca dari judul')
  const year = Number(period[2]), dateCols: [number, number, string][] = []
  for (let c = 0; c < header.length; c++) {
    const day = str(header[c]).match(/^(\d{1,2})\s/)
    if (day && validDate(year, month, Number(day[1]))) dateCols.push([c, Number(day[1]), str(header[c])])
  }
  const duplicateDays = dateCols.filter(([, day], i) => dateCols.findIndex(([, other]) => other === day) !== i)
  if (duplicateDays.length) throw new Error(`Header tanggal matriks berulang untuk hari ${[...new Set(duplicateDays.map(([, day]) => day))].join(', ')}; perbaiki workbook sebelum mengimpor.`)
  const out: Evidence[] = [], unknown = new Set<string>(), officePendingRows = new Set<number>()
  const codes: Record<string, Evidence['code']> = { DLK: 'PD', DDK: 'DL', DLT: 'PD', CTI: 'C', SKT: 'S' }
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r], rawName = str(row[cols.name]), rawNip = str(row[cols.nip]), unit = cols.unit === undefined ? '' : str(row[cols.unit])
    if (!rawName) {
      if (dateCols.some(([c]) => str(row[c]))) quarantined?.push({ ref: rowRef(sheet, r), reason: 'Ada status harian tetapi nama pegawai kosong; baris ditahan.', raw: 'nama kosong' })
      continue
    }
    const risk = sheet.identifierRisks?.some(x => x.row === r && x.col === cols.nip)
    const ids = classifyId(rawNip) as Evidence['ids']
    const explicit = cols.office === undefined ? undefined : officeFromText(str(row[cols.office]))
    const fromUnit = officeFromUnit(unit)
    const officeCandidates = [...new Set([explicit, fromUnit].filter((value): value is string => !!value))]
    const officeConflict = officeCandidates.length > 1
    const rowOffice = officeConflict ? undefined : officeCandidates[0]
    for (const [c, day, rawHeader] of dateCols) {
      const raw = str(row[c]).toLocaleUpperCase('id-ID').trim()
      if (!raw) continue
      const known = ['WFO', 'WFA', ...Object.keys(codes)].includes(raw)
      if (!known) unknown.add(raw)
      const date = iso(year, month, day), office = rowOffice ?? 'Belum ditentukan'
      out.push({
        id: `${fileId}:${sheet.name}:${r}:${c}`, fileId, kind: 'daring', office,
        officePending: !rowOffice, ...(officeConflict ? { officeConflict: true, officeCandidates } : {}), ...(!rowOffice && officeCandidate ? { officeCandidate } : {}),
        name: rawName, ids: risk ? {} : ids, identityPending: !!risk, date,
        present: raw === 'WFO' || raw === 'WFA', mode: raw === 'WFA' ? 'WFA' : raw === 'WFO' ? 'WFO' : undefined,
        approvalStatus: 'not-reported', code: codes[raw] ?? (known ? undefined : 'T'), codeLabel: raw, unit: unit || undefined,
        ref: `${rowRef(sheet, r)}, kolom ${c + 1} (${rawHeader.replace(/\s+/g, ' ')})`, notes: ['tanpa-jam'],
        sourceValues: { name: rawName, identifier: rawNip || undefined, date: rawHeader, mode: raw, office: cols.office === undefined ? undefined : str(row[cols.office]) || undefined, unit: unit || undefined },
      })
      if (!rowOffice) officePendingRows.add(r)
    }
  }
  warnings.push('Matriks online berisi status tanpa jam; tidak membuktikan pasangan scan atau ketepatan waktu. Approved sumber tidak tersedia pada laporan ini.')
  if (unknown.size) warnings.push(`Kode belum dikenal: ${[...unknown].join(', ')}`)
  if (officePendingRows.size) warnings.push(`${officePendingRows.size} baris pegawai belum mendapat kantor dari kolom Kantor atau mapping Unit; konfirmasi scope atau mapping sebelum impor.`)
  if (out.some(e => e.officeCandidates?.length)) warnings.push('Ada konflik kantor pada matriks; baris tersebut tidak dapat diproses sebelum mapping diperbaiki.')
  return out
}
