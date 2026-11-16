import { useMemo } from 'react'
import { formatID, weeksInMonth, type WeekSlice } from '../engine/dates.ts'
import { useHr } from '../state/HrData.tsx'

const short = (date: string) => formatID(date, { short: true, year: false })

/** "30 Mar–5 Apr" atau "1–5 Apr" (bulan disebut sekali bila sama). */
function span(start: string, end: string) {
  const [da, ma] = short(start).split(' '), [db, mb] = short(end).split(' ')
  return ma === mb ? `${da}–${db} ${mb}` : `${short(start)}–${short(end)}`
}

/** Label ringkas; pekan yang melintasi bulan hanya menampilkan bagian di bulan ini plus catatan singkat batas aslinya. */
export function weekOptionLabel(slice: WeekSlice) {
  if (!slice.crossesMonth) return `Pekan ${slice.index} · ${span(slice.weekStart, slice.weekEnd)}`
  const note = slice.weekStart < slice.displayStart ? `mulai ${short(slice.weekStart)}` : `sampai ${short(slice.weekEnd)}`
  return `Pekan ${slice.index} · ${span(slice.displayStart, slice.displayEnd)} (${note})`
}

export function WeekPicker() {
  const hr = useHr()
  const slices = useMemo(() => weeksInMonth(hr.activePeriod), [hr.activePeriod])
  return <label className="select-label week-picker">Pekan aktif
    <select className="select" value={hr.weekSlice.weekStart} onChange={event => hr.selectWeek(event.target.value)} aria-label="Pilih pekan aktif">
      {slices.map(slice => <option key={slice.weekStart} value={slice.weekStart}>{weekOptionLabel(slice)}</option>)}
    </select>
  </label>
}
