import { describe, expect, test } from 'vitest'
import { addDays, monthBounds, weekRange, weeksInMonth } from '../src/engine/dates.ts'

describe('rentang setoran mingguan', () => {
  test('menampilkan enam potongan pekan dan setiap tanggal bulan tepat satu kali', () => {
    const month = '2026-08'
    const slices = weeksInMonth(month)
    const { start, end } = monthBounds(month)
    const dates = slices.flatMap(slice => {
      const values: string[] = []
      for (let date = slice.displayStart; date <= slice.displayEnd; date = addDays(date, 1)) values.push(date)
      return values
    })
    expect(slices).toHaveLength(6)
    expect(dates).toHaveLength(31)
    expect(new Set(dates).size).toBe(31)
    expect(dates[0]).toBe(start)
    expect(dates.at(-1)).toBe(end)
  })

  test('pekan 26 Okt–1 Nov punya key sama dengan subtotal bulan yang terpisah', () => {
    const october = weeksInMonth('2026-10').find(week => week.weekStart === '2026-10-26')!
    const november = weeksInMonth('2026-11').find(week => week.weekStart === '2026-10-26')!
    expect(weekRange(october.weekStart)).toEqual({ start: '2026-10-26', end: '2026-11-01' })
    expect(october.weekStart).toBe(november.weekStart)
    expect([october.displayStart, october.displayEnd]).toEqual(['2026-10-26', '2026-10-31'])
    expect([november.displayStart, november.displayEnd]).toEqual(['2026-11-01', '2026-11-01'])
  })

  test('menangani pergantian tahun dan Februari tahun kabisat', () => {
    const december = weeksInMonth('2026-12')
    expect(december.at(-1)).toMatchObject({ weekStart: '2026-12-28', weekEnd: '2027-01-03', displayStart: '2026-12-28', displayEnd: '2026-12-31', crossesMonth: true })
    const february = weeksInMonth('2028-02')
    expect(february.flatMap(week => [week.displayStart, week.displayEnd])).toContain('2028-02-29')
    expect(february.reduce((days, week) => days + Number(week.displayEnd.slice(8)) - Number(week.displayStart.slice(8)) + 1, 0)).toBe(29)
  })

  test('menolak weekStart yang bukan hari Senin', () => {
    expect(() => weekRange('2026-10-27')).toThrow('weekStart harus tanggal Senin')
  })
})
