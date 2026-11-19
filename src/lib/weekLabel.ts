import { formatID, monthName, splitByMonth, weekOtherPart, type WeekSlice } from '../engine/dates.ts'

const short = (date: string) => formatID(date, { short: true, year: false })

/** "30 Mar–5 Apr" atau "1–5 Apr" (bulan disebut sekali bila sama). */
export function dateSpan(start: string, end: string) {
  if (start === end) return short(start)
  const [da, ma] = short(start).split(' '), [db, mb] = short(end).split(' ')
  return ma === mb ? `${da}–${db} ${mb}` : `${short(start)}–${short(end)}`
}

/**
 * Label ringkas. Pekan lintas bulan menampilkan bagian bulan aktif, lalu rentang setor penuh dan bagian bulan tetangga:
 * "Pekan 5 · 27–31 Jul (setor 27 Jul–2 Agu, termasuk 1–2 Agu)". Unggahan satu pekan mencakup kedua bulan.
 */
export function weekOptionLabel(slice: WeekSlice) {
  if (!slice.crossesMonth) return `Pekan ${slice.index} · ${dateSpan(slice.weekStart, slice.weekEnd)}`
  const other = weekOtherPart(slice).map(part => dateSpan(part.start, part.end)).join(' dan ')
  return `Pekan ${slice.index} · ${dateSpan(slice.displayStart, slice.displayEnd)} (setor ${dateSpan(slice.weekStart, slice.weekEnd)}, termasuk ${other})`
}

/**
 * Setoran satu pekan penuh (Senin–Minggu). Bila pekan melintasi bulan, konfirmasi cakupan juga berlaku untuk tanggal bulan tetangga;
 * kalimat ini menyebut tanggalnya secara eksplisit. Tanggal sesudah hari ini belum dinyatakan.
 */
export function neighbourCoverage(range: { start: string; end: string }, activePeriod: string, today: string) {
  const end = range.end < today ? range.end : today
  if (end < range.start) return ''
  const others = splitByMonth(range.start, end).filter(part => part.month !== activePeriod)
  return others.length ? `Konfirmasi ini juga berlaku untuk ${others.map(part => `${dateSpan(part.start, part.end)} (${monthName(part.month)})`).join(' dan ')}.` : ''
}
