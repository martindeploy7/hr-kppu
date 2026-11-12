import { describe, expect, test } from 'vitest'
import { demoEmployees, demoScenarios, demoSourceFiles, freshDemoWorkspace } from '../demo/demoData.ts'
import { dayReviewProblem } from '../src/engine/dayReview.ts'
import { createCoverageLookup, inspectMonthlyPackage } from '../src/engine/monthlyFlow.ts'
import { ISSUE_LABEL, reconcile } from '../src/engine/reconcile.ts'
import { buildRoster } from '../src/engine/roster.ts'
import type { DayReview, ValidatedDayStatus } from '../src/engine/types.ts'

function scenarioWorkspace() {
  const state = freshDemoWorkspace()
  state.files = (['offline', 'online', 'st'] as const).flatMap(demoSourceFiles)
  const roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
  const coverage = createCoverageLookup(state.files)
  const analyze = (reviews: DayReview[] = []) => reconcile(state.files, roster, { start: '2026-09-01', end: '2026-09-30' }, state.policy, [], '2026-10-01', reviews, coverage)
  return { state, roster, analyze }
}

describe('Data rekonsiliasi demo ringkas', () => {
  test('mencakup semua jenis isu dalam 8 pegawai dan paket lengkap seluruh kantor', () => {
    const { state, roster, analyze } = scenarioWorkspace()
    const result = analyze()
    expect(roster.employees).toHaveLength(8)
    expect(roster.conflicts).toHaveLength(0)
    expect(inspectMonthlyPackage(state.files, state.period).ready).toBe(true)
    expect(result.workdays).toHaveLength(22)
    expect(new Set(result.issues.map(issue => issue.type))).toEqual(new Set(Object.keys(ISSUE_LABEL)))
    expect(result.months.flatMap(month => month.days).filter(day => day.issues.length)).toHaveLength(14)
    for (const scenario of demoScenarios) {
      const employee = demoEmployees[scenario.employeeIndex]
      const day = result.months.find(month => month.employee.id === employee.id)?.days.find(day => day.date === scenario.date)
      expect(day, scenario.id).toBeDefined()
      for (const type of scenario.issues) expect(day?.issues.some(issue => issue.type === type), `${scenario.id}: ${type}`).toBe(true)
    }
    const triple = result.months.find(month => month.employee.id === demoEmployees[5].id)!.days.find(day => day.date === '2026-09-09')!
    expect(triple.evidence.map(row => row.kind).sort()).toEqual(['daring', 'mesin'])
    expect(triple.assignments).toHaveLength(1)
    expect(triple.meal.state).toBe('held')
  })

  test('UM membedakan hari valid, telat, pulang awal, WFA, dan status tanpa UM', () => {
    const { analyze } = scenarioWorkspace()
    const before = analyze()
    const reviews: DayReview[] = []
    for (const month of before.months) for (const day of month.days) {
      if (!day.workday || day.issues.length || ['tidak-ada-data', 'tidak-lengkap'].includes(day.status)) continue
      const review: DayReview = { employeeId: month.employee.id, date: day.date, status: day.status as ValidatedDayStatus, evidenceIds: day.evidence.map(row => row.id), assignmentIds: day.assignments.map(row => row.id), note: 'Keputusan admin untuk contoh', reviewer: 'Admin Demo', actorId: 'demo', at: '2026-10-01T00:00:00Z', signature: day.reviewSignature }
      expect(dayReviewProblem(review, day.evidence, day.assignments)).toBeUndefined()
      reviews.push(review)
    }
    const after = analyze(reviews)
    const find = (index: number, date: string) => after.months.find(month => month.employee.id === demoEmployees[index].id)!.days.find(day => day.date === date)!
    expect(find(1, '2026-09-03')).toMatchObject({ reviewState: 'valid', lateMin: 20, meal: { state: 'excluded', amount: 0 } })
    expect(find(1, '2026-09-24')).toMatchObject({ reviewState: 'valid', clockIn: '08:00', meal: { state: 'excluded' } })
    expect(find(2, '2026-09-25')).toMatchObject({ reviewState: 'valid', earlyMin: 60, meal: { state: 'excluded' } })
    expect(find(5, '2026-09-03')).toMatchObject({ reviewState: 'valid', status: 'hadir-wfa', meal: { state: 'eligible', amount: 41000 } })
    expect(find(3, '2026-09-28')).toMatchObject({ status: 'sakit', meal: { state: 'excluded' } })
    expect(find(4, '2026-09-29')).toMatchObject({ status: 'izin', meal: { state: 'excluded' } })
    expect(find(7, '2026-09-30')).toMatchObject({ status: 'tanpa-keterangan', meal: { state: 'excluded' } })
    expect(find(6, '2026-09-28')).toMatchObject({ status: 'diklat', meal: { state: 'excluded' } })
    expect(find(7, '2026-09-29')).toMatchObject({ status: 'dinas-lokal', meal: { state: 'excluded' } })
    expect(find(0, '2026-09-23')).toMatchObject({ reviewState: 'not-found', status: 'tidak-ada-data', meal: { state: 'excluded' } })
    for (const [index, date] of [[2, '2026-09-04'], [3, '2026-09-07']] as const) {
      const day = find(index, date)
      const review: DayReview = { employeeId: day.employeeId, date, status: 'hadir', evidenceIds: day.evidence.map(row => row.id), assignmentIds: [], note: 'Menguji validasi bukti', reviewer: 'Admin Demo', actorId: 'demo', at: '2026-10-01T00:00:00Z', signature: day.reviewSignature }
      expect(dayReviewProblem(review, day.evidence, day.assignments)).toContain('jam masuk dan pulang lengkap')
      expect(day.meal.state).toBe('excluded')
    }
    expect(after.months.every(month => month.bruto > 0)).toBe(true)
    expect(after.months.some(month => month.flaggedDays > 0)).toBe(true)
  })

  test('keputusan konflik jam hanya mengubah hari Aditya yang dipilih', () => {
    const { analyze } = scenarioWorkspace()
    const before = analyze()
    const month = before.months.find(month => month.employee.id === demoEmployees[0].id)!
    const day = month.days.find(day => day.date === '2026-09-02')!
    const offline = day.evidence.find(row => row.kind === 'mesin')!
    const review: DayReview = { employeeId: month.employee.id, date: day.date, status: 'hadir', evidenceIds: [offline.id], assignmentIds: [], note: 'Admin memilih scan offline', reviewer: 'Admin Demo', actorId: 'demo', at: '2026-10-01T00:00:00Z', signature: day.reviewSignature }
    expect(dayReviewProblem(review, day.evidence, day.assignments)).toBeUndefined()
    const after = analyze([review])
    expect(after.months.find(month => month.employee.id === demoEmployees[0].id)!.days.find(row => row.date === day.date)).toMatchObject({ reviewState: 'valid', clockIn: '07:50', meal: { state: 'eligible', amount: 37000 } })
    const key = (day: { employeeId: string; date: string }) => `${day.employeeId}|${day.date}`
    const beforeDays = new Map(before.months.flatMap(month => month.days).map(day => [key(day), day]))
    const changed = after.months.flatMap(month => month.days).filter(day => { const old = beforeDays.get(key(day))!; return old.reviewState !== day.reviewState || old.meal.state !== day.meal.state })
    expect(changed.map(key)).toEqual([`${month.employee.id}|${day.date}`])
    expect(after.issues.some(issue => issue.type === 'jam-manual')).toBe(true)
  })
})
