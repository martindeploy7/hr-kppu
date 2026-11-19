/**
 * Daftar wilayah (provinsi, kabupaten/kota) beserta pencarian dan format nilai "Tujuan" pada rekap ST.
 * Data mentah dan sumbernya ada di wilayah-data.ts (idn-area-data v4.0.1, kode Kemendagri).
 *
 * Format nilai yang disimpan (teks biasa, kompatibel dengan kolom `destination`):
 *   - kabupaten/kota : "Kota Bogor, Jawa Barat"
 *   - hanya provinsi : "Jawa Barat"
 *   - lainnya        : teks bebas apa adanya (mis. "Kuala Lumpur, Malaysia")
 */
import { PROVINCE_DATA, REGENCY_DATA } from './wilayah-data.ts'

export type RegencyKind = 'kabupaten' | 'kota'

export type Province = {
  code: string
  /** Nama persis seperti di sumber data (mis. "Daerah Khusus Ibukota Jakarta"). */
  name: string
  /** Nama yang ditulis pada nilai tujuan dan ditampilkan (mis. "DKI Jakarta"). */
  label: string
}

export type Regency = {
  /** Kode Kemendagri "PP.KK", mis. "32.71". */
  code: string
  provinceCode: string
  /** Nama resmi, mis. "Kota Bogor". */
  name: string
  kind: RegencyKind
  /** Nilai tujuan lengkap, mis. "Kota Bogor, Jawa Barat". */
  label: string
}

/** Nama tampilan yang lebih lazim dipakai di surat tugas. Nama asli dari sumber tetap dikenali saat mencari/membaca. */
const PROVINCE_LABEL: Record<string, string> = { '31': 'DKI Jakarta' }

/** Singkatan yang lazim diketik operator. Hanya untuk pencarian, tidak pernah tersimpan di nilai. */
const PROVINCE_ALIASES: Record<string, string[]> = {
  '11': ['nad'], '12': ['sumut'], '13': ['sumbar'], '16': ['sumsel'], '19': ['babel', 'bangka belitung'], '21': ['kepri'],
  '31': ['dki', 'dkj'], '32': ['jabar'], '33': ['jateng'], '34': ['diy', 'di yogyakarta', 'jogja', 'yogya'], '35': ['jatim'],
  '52': ['ntb'], '53': ['ntt'], '61': ['kalbar'], '62': ['kalteng'], '63': ['kalsel'], '64': ['kaltim'], '65': ['kaltara'],
  '71': ['sulut'], '72': ['sulteng'], '73': ['sulsel'], '74': ['sultra'], '76': ['sulbar'],
  '92': ['pabar'], '93': ['papsel'], '94': ['papteng'], '95': ['paspeg'], '96': ['pbd'],
}

const rows = (data: string) => data.trim().split('\n').map(line => { const i = line.indexOf('|'); return [line.slice(0, i), line.slice(i + 1)] as const })

export const PROVINCES: readonly Province[] = rows(PROVINCE_DATA).map(([code, name]) => ({ code, name, label: PROVINCE_LABEL[code] ?? name }))
const PROVINCE_BY_CODE = new Map(PROVINCES.map(p => [p.code, p]))

export const REGENCIES: readonly Regency[] = rows(REGENCY_DATA).map(([code, name]) => {
  const provinceCode = code.slice(0, code.indexOf('.'))
  const province = PROVINCE_BY_CODE.get(provinceCode)
  if (!province) throw new Error(`Kode provinsi tidak dikenal untuk ${code}`)
  return { code, provinceCode, name, kind: name.startsWith('Kota ') ? 'kota' : 'kabupaten', label: `${name}, ${province.label}` } as Regency
})
const REGENCY_BY_CODE = new Map(REGENCIES.map(r => [r.code, r]))

export const getProvince = (code: string): Province | undefined => PROVINCE_BY_CODE.get(code)
export const getRegency = (code: string): Regency | undefined => REGENCY_BY_CODE.get(code)
export const regenciesOf = (provinceCode: string): Regency[] => REGENCIES.filter(r => r.provinceCode === provinceCode)

/** Huruf kecil, tanpa diakritik, tanda baca jadi spasi, spasi ganda dirapikan. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Nama tanpa awalan jenis wilayah: "Kota Administrasi Jakarta Pusat" jadi "jakarta pusat" (sudah dinormalkan). */
const bareName = (name: string) => normalizeText(name).replace(/^(kabupaten administrasi|kota administrasi|kabupaten|kota) /, '')

type IndexEntry = {
  option: DestinationOption
  /** Nama sendiri (tanpa provinsi), dinormalkan. */
  own: string
  ownWords: string[]
  bare: string
  /** Nama sendiri + provinsi + singkatan, dinormalkan. */
  all: string
  allWords: string[]
  rank: number
}

export type DestinationOption =
  | { type: 'regency'; code: string; kind: RegencyKind; /** Nama resmi, mis. "Kota Bogor". */ primary: string; /** Provinsi tampilan. */ secondary: string; /** Nilai yang disimpan. */ value: string }
  | { type: 'province'; code: string; primary: string; value: string }

const words = (s: string) => s.split(' ').filter(Boolean)
const provinceNames = (p: Province) => [p.label, p.name, ...(PROVINCE_ALIASES[p.code] ?? [])]

const INDEX: IndexEntry[] = [
  ...PROVINCES.map((p): IndexEntry => {
    const own = normalizeText(provinceNames(p).join(' '))
    return { option: { type: 'province', code: p.code, primary: p.label, value: p.label }, own, ownWords: words(own), bare: normalizeText(p.label), all: own, allWords: words(own), rank: 2 }
  }),
  ...REGENCIES.map((r): IndexEntry => {
    const p = PROVINCE_BY_CODE.get(r.provinceCode)!
    const own = normalizeText(r.name), all = normalizeText(`${r.name} ${provinceNames(p).join(' ')}`)
    return { option: { type: 'regency', code: r.code, kind: r.kind, primary: r.name, secondary: p.label, value: r.label }, own, ownWords: words(own), bare: bareName(r.name), all, allWords: words(all), rank: r.kind === 'kota' ? 0 : 1 }
  }),
]

/** Alias nama provinsi yang dipakai sebagai kunci tepat (mis. "jabar") ikut dihitung sebagai kecocokan penuh. */
const PROVINCE_EXACT = new Map(PROVINCES.map(p => [p.code, new Set(provinceNames(p).map(normalizeText))]))

const startsWithWord = (ws: string[], token: string) => ws.some(w => w.startsWith(token))

function score(entry: IndexEntry, query: string, tokens: string[]): number {
  const isProvince = entry.option.type === 'province'
  const exact = isProvince ? PROVINCE_EXACT.get(entry.option.code)!.has(query) : entry.bare === query || entry.own === query
  if (exact) return 100
  const ownHit = tokens.every(t => startsWithWord(entry.ownWords, t))
  if (ownHit) return (isProvince ? [...PROVINCE_EXACT.get(entry.option.code)!].some(n => n.startsWith(query)) : entry.bare.startsWith(query) || entry.own.startsWith(query)) ? 80 : 60
  if (tokens.every(t => startsWithWord(entry.allWords, t))) return 40
  if (tokens.every(t => entry.all.includes(t))) return 20
  return 0
}

export const SEARCH_LIMIT = 50

/**
 * Cari kabupaten/kota dan provinsi. Tanpa kata kunci: seluruh provinsi (untuk dijelajahi).
 * Urutan: kecocokan tepat, awalan nama, awalan kata, lalu sisanya; imbang: Kota, Kabupaten, Provinsi, lalu abjad.
 */
export function searchWilayah(query: string, limit = SEARCH_LIMIT): DestinationOption[] {
  const q = normalizeText(query)
  if (!q) return INDEX.filter(e => e.option.type === 'province').slice(0, limit).map(e => e.option)
  const tokens = words(q)
  const hits: { entry: IndexEntry; score: number }[] = []
  for (const entry of INDEX) { const s = score(entry, q, tokens); if (s > 0) hits.push({ entry, score: s }) }
  hits.sort((a, b) => b.score - a.score || a.entry.rank - b.entry.rank || a.entry.option.value.localeCompare(b.entry.option.value, 'id'))
  return hits.slice(0, limit).map(h => h.entry.option)
}

export type ParsedDestination =
  | { kind: 'empty' }
  | { kind: 'regency'; regency: Regency; province: Province; /** Bentuk baku yang disimpan. */ value: string }
  | { kind: 'province'; province: Province; value: string }
  | { kind: 'custom'; text: string }

/** Kunci pencocokan nilai tersimpan: bentuk baku, plus nama provinsi asli dari sumber (mis. data lama). */
const PARSE_KEYS = new Map<string, ParsedDestination>()
for (const p of PROVINCES) {
  for (const n of [p.label, p.name]) PARSE_KEYS.set(normalizeText(n), { kind: 'province', province: p, value: p.label })
}
for (const r of REGENCIES) {
  const p = PROVINCE_BY_CODE.get(r.provinceCode)!
  for (const n of [p.label, p.name]) PARSE_KEYS.set(normalizeText(`${r.name} ${n}`), { kind: 'regency', regency: r, province: p, value: r.label })
}

/**
 * Baca nilai tujuan tersimpan. Cocok persis (tanpa memandang huruf besar/kecil dan aksen) dengan bentuk baku jadi
 * kabupaten/kota atau provinsi; selain itu `custom` dengan teks apa adanya (kompatibel dengan data lama).
 * Perhatian: "Bogor, Jawa Barat" bukan bentuk baku, jadi dibaca sebagai teks bebas.
 */
export function parseDestination(value: string): ParsedDestination {
  if (!value.trim()) return { kind: 'empty' }
  return PARSE_KEYS.get(normalizeText(value)) ?? { kind: 'custom', text: value }
}

/** Nilai tersimpan untuk kabupaten/kota dengan kode "PP.KK" (mis. "32.71"), atau provinsi dengan kode 2 digit. */
export function destinationValue(code: string): string | undefined {
  return REGENCY_BY_CODE.get(code)?.label ?? PROVINCE_BY_CODE.get(code)?.label
}
