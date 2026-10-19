import { expect, test } from 'vitest'
import { mealDelta, type MealSnapshot } from '../shared/submissions.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import { blankEmployee } from '../src/engine/roster.ts'
const snapshot = (days: { date: string; eligible: boolean }[]): MealSnapshot => {
  const mealDays = days.filter(d => d.eligible).length, pph = Math.round(mealDays * 0.5)
  return { calculationVersion: 'test', generatedAt: '2026-10-20T00:00:00Z', period: '2026-09', office: 'Pusat', workspaceRevision: 1, policy: DEFAULT_POLICY, sources: [], months: [{ employee: { ...blankEmployee('test-person'), nama: 'Uji', nip: '000012345678901234' }, mealDays, bruto: mealDays, pph, netto: mealDays - pph, days: days.map(d => ({ date: d.date, status: 'hadir', evidenceIds: [], assignmentIds: [], meal: { state: d.eligible ? 'eligible' : 'excluded', amount: d.eligible ? 1 : 0, taxPct: 50, reason: 'Test rounding boundary' } })) }] }
}
test('correction delta preserves employee-month tax rounding across removed days', () => {
  const before = snapshot([{ date: '2026-09-01', eligible: true }, { date: '2026-09-02', eligible: true }])
  const after = snapshot([{ date: '2026-09-01', eligible: false }, { date: '2026-09-02', eligible: true }])
  const delta = mealDelta(before, after)
  expect(delta).toHaveLength(2)
  expect(delta.reduce((s, d) => s + d.after.pph - d.before.pph, 0)).toBe(after.months[0].pph - before.months[0].pph)
  expect(delta.reduce((s, d) => s + d.after.netto - d.before.netto, 0)).toBe(-1)
  expect(mealDelta(after, after)).toHaveLength(0)
})
test('correction includes employee removal and replacement without losing negative amounts', () => {
  const before = snapshot([{ date: '2026-09-01', eligible: true }, { date: '2026-09-02', eligible: true }]), after = { ...before, months: [] }
  const delta = mealDelta(before, after)
  expect(delta.reduce((s, d) => s + d.after.days - d.before.days, 0)).toBe(-2)
  expect(delta.reduce((s, d) => s + d.after.bruto - d.before.bruto, 0)).toBe(-2)
  expect(delta.reduce((s, d) => s + d.after.netto - d.before.netto, 0)).toBe(-1)
})
