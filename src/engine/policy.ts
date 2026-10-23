import type { ISODate } from './types.ts'

export type GolGroup = 'I' | 'II' | 'III' | 'IV'

export type MealPolicy = {
  parametersApproved?: boolean
  taxParametersApproved?: boolean
  /** Meaning of the exact 08:00:00 boundary; absent means boundary cases stay held. */
  arrivalBoundary?: 'exclusive' | 'inclusive'
  requireComplete: boolean
  requireOnTime: boolean
  lateToleranceMin: number
  requireNoEarlyLeave: boolean
  countWfa: boolean
  countLocalDuty: boolean
  holdOnIssues: boolean
  includeNonAsn: boolean
  rates: Record<GolGroup, number>
  pph: Record<GolGroup, number>
  defaultGroup: GolGroup
  holidays: ISODate[]
  ramadan: { start: ISODate; end: ISODate }
  wfoRadiusKm: number
}

/** Tarif bruto mengikuti angka yang ditetapkan pengguna; parameter operasional dan PPh tetap perlu pengesahan. */
export const DEFAULT_POLICY: MealPolicy = {
  requireComplete: true,
  requireOnTime: true,
  lateToleranceMin: 0,
  requireNoEarlyLeave: true,
  countWfa: true,
  countLocalDuty: false,
  parametersApproved: false,
  taxParametersApproved: false,
  holdOnIssues: true,
  includeNonAsn: false,
  rates: { I: 35000, II: 35000, III: 37000, IV: 41000 },
  // Tax rates were not set by the product rules; keep zero drafts until Finance enters and approves them.
  pph: { I: 0, II: 0, III: 0, IV: 0 },
  defaultGroup: 'III',
  holidays: [
    '2026-01-01', '2026-01-16', '2026-02-17', '2026-03-19', '2026-03-20', '2026-03-21', '2026-04-03', '2026-05-01',
    '2026-05-14', '2026-05-27', '2026-05-31', '2026-06-01', '2026-06-16', '2026-08-17', '2026-08-25', '2026-12-25',
  ],
  ramadan: { start: '2026-02-18', end: '2026-03-19' },
  wfoRadiusKm: 1,
}

export const POLICY_PRESETS: { id: string; label: string; detail: string; patch: Partial<MealPolicy> }[] = [
  { id: 'brief', label: 'Aturan wajib UM (draf)', detail: 'Masuk sebelum 08:00, scan masuk & pulang. Tepat 08:00 ditahan sampai operator batas disahkan.', patch: { requireComplete: true, requireOnTime: true, lateToleranceMin: 0, requireNoEarlyLeave: true } },
]

/** Golongan PNS (I–IV, "III/b") atau PPPK (I–XVII) → kelompok tarif sesuai tabel yang ditetapkan pengguna. */
export function golGroup(golongan: string, status: string, fallback: GolGroup): { group: GolGroup; assumed: boolean } {
  const raw = golongan.trim().toUpperCase()
  const roman: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17 }
  const pnsGrade = /^(I|II|III|IV)(\/[A-E])?$/.test(raw) ? roman[raw.split('/')[0]] : /^[1-4]$/.test(raw) ? Number(raw) : 0
  if (status === 'PNS' && pnsGrade) return { group: (['I', 'II', 'III', 'IV'] as GolGroup[])[pnsGrade - 1], assumed: false }
  const pppkGrade = roman[raw] ?? (/^(?:[1-9]|1[0-7])$/.test(raw) ? Number(raw) : 0)
  if (status === 'PPPK' && pppkGrade && pppkGrade <= 17) {
    const n = pppkGrade
    return { group: n <= 4 ? 'I' : n <= 8 ? 'II' : n <= 12 ? 'III' : 'IV', assumed: false }
  }
  return { group: fallback, assumed: true }
}

/** Aturan wajib berlaku juga untuk backup lama dan request API. */
export function enforcePolicy(policy: MealPolicy): MealPolicy {
  return {
    ...policy,
    parametersApproved: policy.parametersApproved === true && !!policy.arrivalBoundary,
    taxParametersApproved: policy.taxParametersApproved === true,
    requireComplete: true,
    requireOnTime: true,
    lateToleranceMin: 0,
    countWfa: true,
    countLocalDuty: false,
    holdOnIssues: true,
  }
}
