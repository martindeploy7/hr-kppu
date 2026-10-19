import type { Employee } from '../src/engine/types.ts'
import type { MealPolicy } from '../src/engine/policy.ts'
import type { DayRecord } from '../src/engine/reconcile.ts'
export type MealSnapshot = {
  calculationVersion: string; generatedAt: string; period: string; office: string; workspaceRevision: number; policy: MealPolicy
  sources: { id: string; hash?: string; name: string; revision?: number; completeThrough?: string }[]
  months: { employee: Employee; mealDays: number; bruto: number; pph: number; netto: number; days: { date: string; status: string; clockIn?: string; clockOut?: string; meal: DayRecord['meal']; evidenceIds: string[]; assignmentIds: string[] }[] }[]
  correction?: { parentId: string; parentChecksum: string; reason: string; delta: MealDelta[] }
}

export type MealDelta = { key: string; name: string; date: string; before: { days: number; bruto: number; pph: number; netto: number }; after: { days: number; bruto: number; pph: number; netto: number } }
export function mealDelta(before: MealSnapshot, after: MealSnapshot): MealDelta[] {
  const rows = (snapshot: MealSnapshot) => new Map(snapshot.months.flatMap(m => {
    let accruedTax = 0
    return [...m.days].sort((a, b) => a.date.localeCompare(b.date)).map(d => {
      const eligible = d.meal.state === 'eligible', bruto = eligible ? d.meal.amount : 0, previousTax = Math.round(accruedTax)
      accruedTax += bruto * (d.meal.taxPct ?? 0) / 100
      const pph = Math.round(accruedTax) - previousTax
      return [`${m.employee.nip || m.employee.nika || m.employee.id}|${d.date}`, { name: m.employee.nama, date: d.date, money: { days: eligible ? 1 : 0, bruto, pph, netto: bruto - pph } }] as const
    })
  }))
  const previous = rows(before), current = rows(after), empty = { days: 0, bruto: 0, pph: 0, netto: 0 }
  return [...new Set([...previous.keys(), ...current.keys()])].sort().flatMap(key => {
    const b = previous.get(key), a = current.get(key), old = b?.money ?? empty, next = a?.money ?? empty
    return JSON.stringify(old) === JSON.stringify(next) ? [] : [{ key, name: a?.name ?? b!.name, date: a?.date ?? b!.date, before: old, after: next }]
  })
}
