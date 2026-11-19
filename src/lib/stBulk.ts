import { nameKey, nameTokens } from '../engine/names.ts'

/**
 * Tempel daftar peserta ST: mengurai baris dari lampiran surat (nomor urut, NIP, nama, gelar, keterangan) lalu
 * mencocokkannya ke master pegawai. NIP dicocokkan persis lebih dulu, lalu nama yang dinormalisasi.
 * Hasil ambigu atau tidak ketemu tidak pernah dipilihkan otomatis; pengguna memutuskan di layar konfirmasi.
 */
export type ParsedLine = { index: number; raw: string; nip: string; name: string; note: string }
export type BulkEmployee = { id: string; nama: string; nip: string; kantor: string; unit?: string; jabatan?: string }
export type BulkStatus = 'matched' | 'ambiguous' | 'notfound' | 'duplicate'
export type BulkRow = ParsedLine & { status: BulkStatus; employeeId?: string; candidates: BulkEmployee[]; /** Kandidat hanya mirip (nama tidak persis sama). */ similar?: boolean; warning?: string }

const FRONT_TITLES = new Set(['dr', 'drs', 'dra', 'ir', 'prof', 'h', 'hj', 'kh', 'haji', 'hajjah', 'ns', 'dokter', 'bpk', 'bapak', 'ibu', 'sdr', 'sdri'])
const BACK_TITLES = new Set(['sh', 'se', 'mm', 'msi', 'mh', 'st', 'mt', 'skom', 'mkom', 'ssos', 'mpd', 'spd', 'sip', 'msc', 'mba', 'ak', 'ca', 'mpa', 'mpp', 'mak', 'spsi', 'skm', 'mkes', 'skep', 'ners', 'amd', 'mhum', 'lm', 'ma', 'ba', 'mhk', 'sik', 'mkn', 'spt', 'ssi', 'spi', 'sag', 'mag', 'phd', 'dr', 'drs', 'ir', 'cpa', 'cfe', 'sstp', 'msi', 'mtr', 'sh', 'spdi', 'mpdi', 'sfarm', 'apt', 'drg', 'sp'])
const plain = (token: string) => token.toLowerCase().replace(/[.,]/g, '')
/** Gelar bertitik seperti S.H., M.Si, S.Sos., Ph.D (dua segmen atau lebih). Inisial tunggal seperti "M." bukan gelar. */
const dottedDegree = (token: string) => /^(?:[a-z]{1,4}\.)+[a-z]{1,4}\.?$/i.test(token)
const isBackTitle = (token: string) => dottedDegree(token) || BACK_TITLES.has(plain(token))
const isFrontTitle = (token: string) => FRONT_TITLES.has(plain(token))

/** Buang gelar depan dan belakang dari nama, selalu menyisakan minimal satu kata. */
export function stripTitles(name: string): string {
  const tokens = name.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  while (tokens.length > 1 && isFrontTitle(tokens[0])) tokens.shift()
  while (tokens.length > 1 && isBackTitle(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ').replace(/[,;:\s]+$/, '')
}
const titleOnly = (text: string) => { const tokens = text.split(/[\s,]+/).filter(Boolean); return tokens.length > 0 && tokens.every(token => isBackTitle(token) || isFrontTitle(token)) }

const NIP_FORMATTED = /(?<!\d)'?(\d{8})[ .]?(\d{6})[ .]?(\d)[ .]?(\d{3})(?!\d)/
const NIP_PLAIN = /(?<!\d)\d{15,20}(?!\d)/

export function parseParticipantLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = []
  text.split(/\r?\n/).forEach((rawLine, i) => {
    let line = rawLine.replace(/[ ​-‍﻿]/g, ' ').trim()
    if (!line) return
    // Nomor urut di awal baris: "1.", "12)", "3 " (sebelum huruf), atau kolom tab pertama.
    line = line.replace(/^\(?\d{1,3}\s*[.)]\s*/, '').replace(/^\d{1,3}\t+/, '').replace(/^\d{1,3}\s+(?=[A-Za-z])/, '').trim()
    let nip = ''
    const formatted = line.match(NIP_FORMATTED)
    if (formatted) { nip = formatted.slice(1).join(''); line = line.replace(formatted[0], ' ') }
    else { const plainMatch = line.match(NIP_PLAIN); if (plainMatch) { nip = plainMatch[0]; line = line.replace(plainMatch[0], ' ') } }
    line = line.replace(/\b(?:NIP|NI\s*PPPK|NIPPPK|NIK)\s*[:.]?/gi, ' ').replace(/[ ]{2,}/g, ' ').trim()
    // Kolom dipisah tab, tanda hubung berspasi, atau garis tegak; koma memisahkan nama dari gelar/keterangan.
    const columns = line.split(/\t+|\s+[-–—]\s+|\s*[|;]\s*/).map(part => part.trim()).filter(Boolean)
    const pieces = columns.flatMap(column => column.split(',').map(part => part.trim()).filter(Boolean))
    let name = '', notes: string[] = []
    for (const piece of pieces) {
      if (!name) { name = stripTitles(piece.replace(/^[.\s]+/, '')); continue }
      if (titleOnly(piece) || /^[\d\s.,/-]+$/.test(piece)) continue
      notes.push(piece)
    }
    name = name.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim()
    if (!name && !nip) return
    out.push({ index: i + 1, raw: rawLine.trim(), nip, name, note: notes.join(', ') })
  })
  return out
}

const digitsOf = (value: string) => value.replace(/\D/g, '')

export function matchParticipants(lines: ParsedLine[], employees: BulkEmployee[], alreadySelected: ReadonlySet<string> = new Set()): BulkRow[] {
  const byNip = new Map<string, BulkEmployee[]>(), byName = new Map<string, BulkEmployee[]>()
  const tokensOf = new Map<string, string[]>()
  for (const employee of employees) {
    const nip = digitsOf(employee.nip)
    if (nip) byNip.set(nip, [...(byNip.get(nip) ?? []), employee])
    const key = nameKey(stripTitles(employee.nama))
    if (key) byName.set(key, [...(byName.get(key) ?? []), employee])
    tokensOf.set(employee.id, nameTokens(stripTitles(employee.nama)))
  }
  const taken = new Set<string>(alreadySelected)
  return lines.map<BulkRow>(line => {
    const queryTokens = nameTokens(line.name)
    const row = (status: BulkStatus, extra: Partial<BulkRow> = {}): BulkRow => ({ ...line, status, candidates: [], ...extra })
    const claim = (employee: BulkEmployee, warning?: string): BulkRow => {
      if (taken.has(employee.id)) return row('duplicate', { employeeId: employee.id, candidates: [employee], warning: alreadySelected.has(employee.id) ? 'Sudah ada di daftar peserta' : 'Muncul lebih dari sekali di daftar tempelan' })
      taken.add(employee.id)
      return row('matched', { employeeId: employee.id, candidates: [employee], warning })
    }
    let nipMissing = false
    if (line.nip) {
      const found = byNip.get(line.nip) ?? []
      if (found.length === 1) {
        const tokens = tokensOf.get(found[0].id) ?? []
        const overlaps = !queryTokens.length || queryTokens.some(token => tokens.includes(token))
        return claim(found[0], overlaps ? undefined : `Nama di daftar ("${line.name}") berbeda dengan master`)
      }
      if (found.length > 1) return row('ambiguous', { candidates: found.slice(0, 5) })
      nipMissing = true
    }
    if (!queryTokens.length) return row('notfound', { warning: 'NIP tidak ditemukan di master' })
    const exact = byName.get(nameKey(line.name)) ?? []
    if (exact.length === 1) return claim(exact[0], nipMissing ? 'NIP di daftar tidak ada di master; dicocokkan lewat nama' : undefined)
    if (exact.length > 1) return row('ambiguous', { candidates: exact.slice(0, 5), warning: 'Beberapa pegawai bernama sama' })
    if (queryTokens.length >= 2) {
      // Tidak ada yang persis sama: tawarkan nama yang memuat semua kata (atau termuat seluruhnya), tanpa memilihkan.
      const similar = employees.map(employee => ({ employee, tokens: tokensOf.get(employee.id) ?? [] }))
        .filter(({ tokens }) => tokens.length >= 2 && (queryTokens.every(token => tokens.includes(token)) || tokens.every(token => queryTokens.includes(token))))
        .sort((a, b) => Math.abs(a.tokens.length - queryTokens.length) - Math.abs(b.tokens.length - queryTokens.length))
        .slice(0, 5).map(item => item.employee)
      if (similar.length) return row('ambiguous', { candidates: similar, similar: true, warning: nipMissing ? 'NIP di daftar tidak ada di master' : undefined })
    }
    return row('notfound', { warning: nipMissing ? 'NIP di daftar tidak ada di master' : undefined })
  })
}
