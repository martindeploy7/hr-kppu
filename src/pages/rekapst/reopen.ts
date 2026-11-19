import { monthBounds } from '../../engine/dates.ts'

type Declaration = { start: string; end: string; status: string }
type StSource = { kind: string; active?: boolean; coverageDeclarations?: Declaration[] }

/**
 * Bulan yang konfirmasi kelengkapan ST-nya (lengkap atau nihil) akan dibuka kembali bila sebuah ST ditambahkan.
 * Syaratnya sama dengan server (POST /api/rekap-st): konfirmasi berlaku untuk seluruh KPPU, jadi semua sumber ST
 * aktif dari kantor mana pun ikut diperiksa, bukan hanya register kantor yang dipilih.
 */
export function reopenedConfirmationMonths(sources: StSource[], months: string[]): string[] {
  return months.filter(month => {
    const range = monthBounds(month)
    return sources.some(source => source.kind === 'surat-tugas' && source.active !== false
      && !!source.coverageDeclarations?.some(item => (item.status === 'complete' || item.status === 'nil') && item.start <= range.end && item.end >= range.start))
  })
}

export type StShape = { letterNo: string; letterDate: string; destination: string; /** Kunci peserta: `emp:<id>` atau `ext:<nama>`. */ keys: string[]; dates: string[] }
const norm = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('id-ID').replace(/\s+/g, ' ').trim()
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i])
/**
 * Bulan yang terdampak koreksi ST (gabungan tanggal lama dan baru) bila isi yang memengaruhi perhitungan berubah:
 * nomor, tanggal, tujuan, peserta, atau tanggal tugas. Hanya catatan berubah: tidak ada bulan terdampak (sama dengan server).
 */
export function editAffectedMonths(before: StShape, after: StShape): string[] {
  const changed = before.letterNo.trim() !== after.letterNo.trim() || before.letterDate !== after.letterDate || before.destination.trim() !== after.destination.trim()
    || !sameSet(before.keys, after.keys) || !sameSet(before.dates, after.dates)
  return changed ? [...new Set([...before.dates, ...after.dates].map(date => date.slice(0, 7)))].sort() : []
}
