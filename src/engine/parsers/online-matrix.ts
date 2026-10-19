import type { Evidence, Sheet } from '../types.ts'
import { validDate, iso, monthFromWord } from '../dates.ts'
import { officeFromUnit } from '../ids.ts'
import { columnIndex, findHeaderRow, rowRef, str } from './common.ts'
export const isOnlineMatrix = (s: Sheet) => findHeaderRow(s, [/^nip$/, /^nama pegawai$/, /^0?1\s/]) >= 0
export function parseOnlineMatrix(sheet: Sheet, fileId: string, warnings: string[]): Evidence[] {
 const h = findHeaderRow(sheet, [/^nip$/, /^nama pegawai$/, /^0?1\s/]), header = sheet.rows[h]
 const title = sheet.rows.slice(0, h).flat().map(str).join(' ')
 const period = title.match(/([a-z]+)\s+(20\d{2})/i), month = period ? monthFromWord(period[1]) : undefined
 if (!period || !month) throw new Error('Periode matriks online tidak terbaca dari judul')
 const year = Number(period[2]), nameCol = columnIndex(header, /^nama pegawai$/), nipCol = columnIndex(header, /^nip$/), unitCol = columnIndex(header, /unit/)
 const out: Evidence[] = [], unknown = new Set<string>()
 const codes: Record<string, Evidence['code']> = { DLK: 'PD', DDK: 'DL', DLT: 'PD', CTI: 'C', SKT: 'S' }
 for (let r = h + 1; r < sheet.rows.length; r++) {
  const row = sheet.rows[r], name = str(row[nameCol]); if (!name) continue
  const risk = sheet.identifierRisks?.some(x => x.row === r && x.col === nipCol)
  const nip = str(row[nipCol]), unit = str(row[unitCol])
  for (let c = 0; c < header.length; c++) {
   const day = str(header[c]).match(/^(\d{2})\s/); if (!day || !validDate(year, month, Number(day[1]))) continue
   const raw = str(row[c]).toUpperCase(); if (!raw) continue
   const known = ['WFO', 'WFA', ...Object.keys(codes)].includes(raw)
   if (!known) unknown.add(raw)
   out.push({ id: `${fileId}:${sheet.name}:${r}:${c}`, fileId, kind: 'daring', office: officeFromUnit(unit) ?? 'Pusat', name, ids: /^\d{18}$/.test(nip) && !risk ? { nip } : {}, identityPending: !!risk, date: iso(year, month, Number(day[1])), present: raw === 'WFO' || raw === 'WFA', mode: raw === 'WFA' ? 'WFA' : raw === 'WFO' ? 'WFO' : undefined, code: codes[raw] ?? (known ? undefined : 'T'), codeLabel: raw, unit, ref: rowRef(sheet, r), notes: ['tanpa-jam'] })
  }
 }
 warnings.push('Matriks online adalah bukti status tanpa jam; tidak membuktikan pasangan scan atau ketepatan waktu. DLK/DDK/DLT diperlakukan konservatif sebagai dinas; perlu konfirmasi kamus resmi.')
 if (unknown.size) warnings.push(`Kode belum dikenal: ${[...unknown].join(', ')}`)
 return out
}
