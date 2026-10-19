import type { StatusKepegawaian } from './types.ts'
import { iso, validDate } from './dates.ts'

export const isNIP = (v: string) => /^\d{18}$/.test(v)
export const isNIKA = (v: string) => /^\d\.\d{2}\.\d{4}$/.test(v)

export function classifyId(raw: unknown): { nip?: string; nika?: string; mesin?: string } {
  const v = String(raw ?? '').replace(/\s/g, '')
  if (!v) return {}
  if (isNIP(v)) return /^0+\d{1,4}$/.test(v) ? { mesin: v.replace(/^0+/, '') } : { nip: v }
  if (isNIKA(v)) return { nika: v }
  return { mesin: v }
}

/**
 * NIP ASN: 8 digit tanggal lahir + 6 digit TMT/tahun pengangkatan + 1 digit jenis kelamin + 3 digit urut.
 * Pola "YYYY21" pada digit 9-14 dipakai NIP PPPK (tahun + kode 21), sedangkan PNS memakai YYYYMM.
 */
export function decodeNIP(nip: string): { tanggalLahir?: string; jenisKelamin?: 'Laki-laki' | 'Perempuan'; status: StatusKepegawaian; tahunPengangkatan?: number } {
  if (!isNIP(nip)) return { status: 'Belum diketahui' }
  const y = Number(nip.slice(0, 4)), m = Number(nip.slice(4, 6)), d = Number(nip.slice(6, 8))
  const tanggalLahir = validDate(y, m, d) && y > 1940 ? iso(y, m, d) : undefined
  const g = nip[14]
  const jenisKelamin = g === '1' ? 'Laki-laki' : g === '2' ? 'Perempuan' : undefined
  const code = Number(nip.slice(12, 14))
  const tahunPengangkatan = Number(nip.slice(8, 12))
  const status: StatusKepegawaian = code === 21 ? 'PPPK' : code >= 1 && code <= 12 ? 'PNS' : 'Belum diketahui'
  return { tanggalLahir, jenisKelamin, status, tahunPengangkatan }
}

/** Satuan Pelaksana (unit di presensi daring) → Kantor Wilayah. */
const SATPEL: Record<string, string> = {
  medan: 'Kanwil I', lampung: 'Kanwil II', bandung: 'Kanwil III', surabaya: 'Kanwil IV',
  samarinda: 'Kanwil V', balikpapan: 'Kanwil V', makassar: 'Kanwil VI', yogyakarta: 'Kanwil VII',
}
export function officeFromUnit(unit?: string): string | undefined {
  if (!unit) return undefined
  const m = unit.toLowerCase().match(/satuan pelaksana\s+([a-z]+)/)
  if (m) return SATPEL[m[1]]
  return undefined
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
export function officeFromText(text: string): string | undefined {
  const s = text.replace(/[_]/g, ' ')
  const roman = s.match(/kanw?il?\s*(VII|VI|IV|V|III|II|I)\b/i) ?? s.match(/wil\.?\s*(VII|VI|IV|V|III|II|I)\b/i)
  if (roman) return `Kanwil ${roman[1].toUpperCase()}`
  const arabic = s.match(/kanwil\s*(\d)\b/i)
  if (arabic && Number(arabic[1]) >= 1 && Number(arabic[1]) <= 7) return `Kanwil ${ROMAN[Number(arabic[1]) - 1]}`
  for (const [city, office] of Object.entries(SATPEL)) if (new RegExp(`\\b${city}\\b`, 'i').test(s)) return office
  if (/pusat|kesekjenan|kedeputian|sekretariat jenderal/i.test(s)) return 'Pusat'
  return undefined
}

export const OFFICES = ['Pusat', 'Kanwil I', 'Kanwil II', 'Kanwil III', 'Kanwil IV', 'Kanwil V', 'Kanwil VI', 'Kanwil VII']
export const OFFICE_CITY: Record<string, string> = {
  Pusat: 'Jakarta', 'Kanwil I': 'Medan', 'Kanwil II': 'Lampung', 'Kanwil III': 'Bandung', 'Kanwil IV': 'Surabaya',
  'Kanwil V': 'Balikpapan/Samarinda', 'Kanwil VI': 'Makassar', 'Kanwil VII': 'Yogyakarta',
}
