import type { ISODate } from './types.ts'

export type GolGroup = 'I' | 'II' | 'III' | 'IV'

export type MealPolicy = {
  parametersApproved?: boolean
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

/** Nilai acuan awal — tarif & PPh mengikuti pola SBM uang makan ASN; WAJIB dikonfirmasi Bagian Keuangan/SDM KPPU. */
export const DEFAULT_POLICY: MealPolicy = {
  requireComplete: true,
  requireOnTime: true,
  lateToleranceMin: 0,
  requireNoEarlyLeave: true,
  countWfa: true,
  countLocalDuty: false,
  parametersApproved: false,
  holdOnIssues: true,
  includeNonAsn: false,
  rates: { I: 35000, II: 35000, III: 37000, IV: 41000 },
  pph: { I: 0, II: 0, III: 5, IV: 15 },
  defaultGroup: 'III',
  holidays: [
    '2026-01-01', '2026-01-16', '2026-02-17', '2026-03-19', '2026-03-20', '2026-03-21', '2026-04-03', '2026-05-01',
    '2026-05-14', '2026-05-27', '2026-05-31', '2026-06-01', '2026-06-16', '2026-08-17', '2026-08-25', '2026-12-25',
  ],
  ramadan: { start: '2026-02-18', end: '2026-03-19' },
  wfoRadiusKm: 1,
}

export const POLICY_PRESETS: { id: string; label: string; detail: string; patch: Partial<MealPolicy> }[] = [
  { id: 'brief', label: 'Sesuai brief: tepat waktu & lengkap', detail: 'Masuk ≤ 08:00, scan masuk & pulang, tidak pulang cepat.', patch: { requireComplete: true, requireOnTime: true, lateToleranceMin: 0, requireNoEarlyLeave: true } },
]

/** Golongan PNS (I–IV, "III/b") atau PPPK (I–XVII) → kelompok tarif uang makan. PPPK I–IV≈I, V–VIII≈II, IX–XII≈III, XIII–XVII≈IV. */
export function golGroup(golongan: string, status: string, fallback: GolGroup): { group: GolGroup; assumed: boolean } {
  const raw = golongan.trim().toUpperCase()
  const g = raw.split('/')[0].trim()
  const roman: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17 }
  const n = roman[g] ?? (Number(g) || 0)
  if (!n) return { group: fallback, assumed: true }
  const pns = raw.includes('/') || status === 'PNS' || (status !== 'PPPK' && n <= 4)
  if (pns) return { group: (['I', 'II', 'III', 'IV'] as GolGroup[])[Math.min(n, 4) - 1], assumed: false }
  return { group: n <= 4 ? 'I' : n <= 8 ? 'II' : n <= 12 ? 'III' : 'IV', assumed: false }
}

/** Aturan wajib berlaku juga untuk backup lama dan request API. */
export function enforcePolicy(policy: MealPolicy): MealPolicy {
  return { ...policy, requireComplete: true, requireOnTime: true, lateToleranceMin: 0, countLocalDuty: false, holdOnIssues: true }
}
