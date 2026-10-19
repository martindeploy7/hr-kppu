import type { Employee } from '../src/engine/types.ts'
import type { MealPolicy } from '../src/engine/policy.ts'
import type { DayRecord } from '../src/engine/reconcile.ts'
export type MealSnapshot = {
  calculationVersion: string; generatedAt: string; period: string; office: string; workspaceRevision: number; policy: MealPolicy
  sources: { id: string; hash?: string; name: string; revision?: number; completeThrough?: string }[]
  months: { employee: Employee; mealDays: number; bruto: number; pph: number; netto: number; days: { date: string; status: string; clockIn?: string; clockOut?: string; meal: DayRecord['meal']; evidenceIds: string[]; assignmentIds: string[] }[] }[]
}
