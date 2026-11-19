import { useMemo } from 'react'
import { weeksInMonth } from '../engine/dates.ts'
import { weekOptionLabel } from '../lib/weekLabel.ts'
import { useHr } from '../state/HrData.tsx'

export function WeekPicker() {
  const hr = useHr()
  const slices = useMemo(() => weeksInMonth(hr.activePeriod), [hr.activePeriod])
  return <label className="select-label week-picker">Pekan aktif
    <select className="select" value={hr.weekSlice.weekStart} onChange={event => hr.selectWeek(event.target.value)} aria-label="Pilih pekan aktif">
      {slices.map(slice => <option key={slice.weekStart} value={slice.weekStart}>{weekOptionLabel(slice)}</option>)}
    </select>
  </label>
}
