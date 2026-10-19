import type { Cell, ISODate } from './types.ts'

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, pebruari: 2, february: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  ags: 8, agt: 8, agu: 8, agus: 8, agust: 8, agustus: 8, agustuss: 8, agustua: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, ooktober: 10, oct: 10, october: 10,
  nov: 11, nop: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
}

export const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`

export function validDate(y: number, m: number, d: number) {
  if (!y || m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function monthFromWord(word: string): number | undefined {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (MONTHS[w]) return MONTHS[w]
  if (w.length >= 3) return MONTHS[w.slice(0, 3)]
  return undefined
}

export function excelSerialToParts(serial: number): [number, number, number] {
  const ms = Math.round((serial - 25569) * 86400000)
  const d = new Date(ms)
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
}

export function excelSerialToISO(serial: number): ISODate {
  const [y, m, d] = excelSerialToParts(serial)
  return iso(y, m, d)
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

export function weekday(date: ISODate) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export const isWeekend = (date: ISODate) => { const w = weekday(date); return w === 0 || w === 6 }

export function monthBounds(month: string): { start: ISODate; end: ISODate } {
  const [y, m] = month.split('-').map(Number)
  return { start: iso(y, m, 1), end: iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate()) }
}

type Partial3 = { d: number; m?: number; y?: number }

function parsePart(text: string): Partial3 | null {
  const m = text.trim().match(/^(\d{1,2})\s*([A-Za-z]+)?\.?\s*(\d{4})?$/)
  if (!m) return null
  const month = m[2] ? monthFromWord(m[2]) : undefined
  if (m[2] && !month) return null
  return { d: Number(m[1]), m: month, y: m[3] ? Number(m[3]) : undefined }
}

/** Parses Indonesian free-text dates and ranges: "31 Ags-2 Sep 2026", "13 - 15 September 2026", "Tanggal Tugas 08 September 2026", Excel serials. */
export function parseDateRange(value: Cell, fallbackYear?: number): { start: ISODate; end: ISODate } | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return null
    const d = excelSerialToISO(value)
    return { start: d, end: d }
  }
  let text = String(value).replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim()
  const numeric = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (numeric && !/[A-Za-z]{3,}/.test(text)) {
    const d = iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))
    return { start: d, end: d }
  }
  text = text.replace(/^[^\d]*?(?=\d)/, '').replace(/[,]/g, ' ').trim()
  const parts = text.split(/\s*(?:–|—|-|s\.?\s?d\.?|sampai(?: dengan)?)\s*/i).filter(Boolean)
  if (parts.length === 0 || parts.length > 2) return null
  const right = parsePart(parts[parts.length - 1])
  if (!right) return null
  const year = right.y ?? fallbackYear
  if (!right.m || !year) return null
  const end = { d: right.d, m: right.m, y: year }
  let start = end
  if (parts.length === 2) {
    const left = parsePart(parts[0])
    if (!left) return null
    start = { d: left.d, m: left.m ?? end.m, y: left.y ?? (left.m && left.m > end.m ? end.y - 1 : end.y) }
  }
  if (!validDate(start.y, start.m, start.d) || !validDate(end.y, end.m, end.d)) return null
  const s = iso(start.y, start.m, start.d), e = iso(end.y, end.m, end.d)
  return s <= e ? { start: s, end: e } : null
}

export function parseSingleDate(value: Cell, fallbackYear?: number): ISODate | null {
  const r = parseDateRange(value, fallbackYear)
  return r ? r.start : null
}

/** Decides whether slash dates in a file are M/D/Y or D/M/Y by checking which reading keeps them in the fewest months. */
export function inferSlashOrder(values: string[]): 'MDY' | 'DMY' {
  const parts = values.map(v => v.split(/[/.-]/).map(Number)).filter(p => p.length === 3)
  if (parts.some(p => p[0] > 12)) return 'DMY'
  if (parts.some(p => p[1] > 12)) return 'MDY'
  const monthsMDY = new Set(parts.map(p => p[0])).size
  const monthsDMY = new Set(parts.map(p => p[1])).size
  return monthsMDY <= monthsDMY ? 'MDY' : 'DMY'
}

export function slashToISO(value: string, order: 'MDY' | 'DMY'): ISODate | null {
  const p = value.split(/[/.-]/).map(Number)
  if (p.length !== 3) return null
  const [m, d] = order === 'MDY' ? [p[0], p[1]] : [p[1], p[0]]
  return validDate(p[2], m, d) ? iso(p[2], m, d) : null
}

/** "07:41", "07.29", "09:01:00", Excel fraction → "HH:MM". */
export function parseTime(value: Cell): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') {
    const frac = value % 1
    if (frac === 0 && value !== 0) return undefined
    const seconds = Math.round(frac * 86400)
    const h = Math.floor(seconds / 3600) % 24, min = Math.floor(seconds / 60) % 60, sec = seconds % 60
    return `${pad(h)}:${pad(min)}${sec ? `:${pad(sec)}` : ''}`
  }
  const m = String(value).trim().match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/)
  if (!m) return undefined
  const h = Number(m[1]), min = Number(m[2]), sec = Number(m[3] ?? 0)
  return h < 24 && min < 60 && sec < 60 ? `${pad(h)}:${pad(min)}${sec ? `:${pad(sec)}` : ''}` : undefined
}

export const toMinutes = (t?: string) => { if (!t) return undefined; const [h, m, s = 0] = t.split(':').map(Number); return h * 60 + m + s / 60 }

/** "1 Jam 44 Menit", "38 Menit", "02:18:59", "00:04" → minutes */
export function parseDuration(value: Cell): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return Math.round((value % 1) * 1440) || undefined
  const s = String(value).trim()
  const clock = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) || undefined
  const h = s.match(/(\d+)\s*jam/i), m = s.match(/(\d+)\s*menit/i)
  if (!h && !m) return undefined
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) || undefined
}

const ID_MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const ID_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
export function formatID(date: ISODate, opts: { day?: boolean; short?: boolean; year?: boolean } = {}) {
  if (!date) return '—'
  const [y, m, d] = date.split('-').map(Number)
  const month = opts.short ? ID_MONTHS[m - 1].slice(0, 3) : ID_MONTHS[m - 1]
  const base = `${d} ${month}${opts.year === false ? '' : ` ${y}`}`
  return opts.day ? `${ID_DAYS[weekday(date)]}, ${base}` : base
}
export const dayName = (date: ISODate, short = false) => short ? ID_DAYS[weekday(date)].slice(0, 3) : ID_DAYS[weekday(date)]
export const monthLabel = (month: string) => { const [y, m] = month.split('-').map(Number); return `${ID_MONTHS[m - 1]} ${y}` }
