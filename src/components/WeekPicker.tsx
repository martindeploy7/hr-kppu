import { useMemo } from 'react'
import { formatID, weeksInMonth } from '../engine/dates.ts'
import { useHr } from '../state/HrData.tsx'

export function WeekPicker() {
  const hr = useHr()
  const slices = useMemo(() => weeksInMonth(hr.activePeriod), [hr.activePeriod])
  return <label className="select-label week-picker">Pekan aktif
    <select className="select" value={hr.weekSlice.weekStart} onChange={event => hr.selectWeek(event.target.value)} aria-label="Pilih pekan aktif">
      {slices.map(slice => <option key={slice.weekStart} value={slice.weekStart}>
        Pekan {slice.index} · {formatID(slice.weekStart, { short: true })}–{formatID(slice.weekEnd, { short: true })}{slice.crossesMonth ? ` · bagian ${formatID(slice.displayStart, { short: true })}–${formatID(slice.displayEnd, { short: true })}` : ''}
      </option>)}
    </select>
  </label>
}
