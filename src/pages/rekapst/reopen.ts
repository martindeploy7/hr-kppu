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
