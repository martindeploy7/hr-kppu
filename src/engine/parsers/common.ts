import type { Cell, DayCode, Sheet } from '../types.ts'

export const str = (c: Cell | undefined) => (c === null || c === undefined ? '' : String(c)).replace(/[​-‍⁠﻿]/g, '').trim()
export const low = (c: Cell | undefined) => str(c).toLowerCase().replace(/\s+/g, ' ')

export function findHeaderRow(sheet: Sheet, tests: RegExp[], maxRows = 30): number {
  for (let r = 0; r < Math.min(maxRows, sheet.rows.length); r++) {
    const cells = (sheet.rows[r] ?? []).map(low)
    if (tests.every(t => cells.some(c => t.test(c)))) return r
  }
  return -1
}

export function columnIndex(header: Cell[], ...tests: RegExp[]): number {
  const cells = header.map(low)
  for (const t of tests) {
    const idx = cells.findIndex(c => t.test(c))
    if (idx >= 0) return idx
  }
  return -1
}

export function mappedColumns(header: Cell[], mapping: Record<string, RegExp[]>, required: string[] = []) {
  const cells = header.map(low), result: Record<string, number> = {}, used = new Map<number, string>()
  for (const [field, aliases] of Object.entries(mapping)) {
    const indexes = cells.flatMap((cell, index) => aliases.some(alias => { alias.lastIndex = 0; return alias.test(cell) }) ? [index] : [])
    if (indexes.length > 1) throw new Error(`Header ${field} muncul lebih dari sekali (kolom ${indexes.map(i => i + 1).join(', ')}); perbaiki workbook sebelum mengimpor.`)
    if (required.includes(field) && indexes.length === 0) throw new Error(`Kolom wajib ${field} tidak ditemukan pada baris header.`)
    if (indexes.length) {
      const index = indexes[0], previous = used.get(index)
      if (previous) throw new Error(`Kolom ${index + 1} cocok sebagai ${previous} dan ${field}; mapping tidak dapat dipastikan.`)
      used.set(index, field); result[field] = index
    }
  }
  return result
}

export const rowRef = (sheet: Sheet, r: number) => `${sheet.name.trim()} · baris ${r + 1}`

export function sheetText(sheet: Sheet, rows = 12) {
  return sheet.rows.slice(0, rows).flat().map(str).filter(Boolean).join(' ')
}

const CODE_MAP: [RegExp, DayCode][] = [
  [/perjalanan dinas|^pd$|^dinas$|^d$/i, 'PD'],
  [/dinas dalam kota|^dl$|dinas lokal|st-?lokal/i, 'DL'],
  [/^wf[ah]?$|work from|wfa|wfh/i, 'WFA'],
  [/cuti bersalin|^cb$|melahirkan/i, 'CB'],
  [/^cuti$|^c$|cuti tahunan|cuti besar|cuti alasan/i, 'C'],
  [/sakit|^s$/i, 'S'],
  [/izin|ijin|^i$/i, 'I'],
  [/diklat|pelatihan/i, 'DIKLAT'],
  [/konsinyering|^ko$/i, 'KO'],
  [/absen ?eror|absen ?error/i, 'ERR'],
  [/^x$|alpa|alpha|tanpa ket/i, 'X'],
  [/^t$|other|lainnya/i, 'T'],
]

export function toDayCode(raw: string): DayCode | undefined {
  const s = raw.trim()
  if (!s) return undefined
  for (const [re, code] of CODE_MAP) if (re.test(s)) return code
  return 'T'
}

export const DAY_CODE_LABEL: Record<DayCode, string> = {
  PD: 'Perjalanan dinas', DL: 'Dinas dalam kota / ST lokal', WFA: 'WFA / WFH', S: 'Sakit', C: 'Cuti', CB: 'Cuti bersalin',
  I: 'Izin', DIKLAT: 'Diklat', KO: 'Konsinyering', X: 'Tanpa keterangan', ERR: 'Absen error (diisi manual)', T: 'Keterangan lain',
}

export function parseCoord(raw: Cell): [number, number] | undefined {
  const m = str(raw).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return undefined
  const lat = Number(m[1]), lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : undefined
}

let counter = 0
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`
