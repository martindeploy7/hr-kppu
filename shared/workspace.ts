import type { Employee, MatchDecision, Resolution, SourceFile } from '../src/engine/types.ts'
import { DEFAULT_POLICY, type MealPolicy } from '../src/engine/policy.ts'

export type Workspace = {
  version: 2; files: SourceFile[]; master: Employee[]; overrides: Record<string, Partial<Employee>>
  decisions: MatchDecision[]; resolutions: Resolution[]; policy: MealPolicy; reviewer: string; period: string
}
export const emptyWorkspace = (): Workspace => ({ version: 2, files: [], master: [], overrides: {}, decisions: [], resolutions: [], policy: { ...DEFAULT_POLICY }, reviewer: '', period: '' })
export const roles = ['admin', 'hr', 'reviewer', 'finance', 'viewer'] as const
export type Role = typeof roles[number]
export type User = { id: string; email: string; name: string; role: Role; offices?: string[] | null }
export type WorkspaceResponse = { state: Workspace; revision: number }

/** Stage index is refreshed within the batch, preserving internal IDs and nonempty fields. */
export function upsertEmployees(master: Employee[], roster: Employee[], overrides: Record<string, Partial<Employee>>, rows: Partial<Employee>[], makeId: () => string) {
  const next = [...master], patches = { ...overrides }, candidates = roster.map(e => ({ ...e }))
  let added = 0, updated = 0
  for (const row of rows) {
    if (!row.nama && !row.nip) continue
    const clean = Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== 'id' && v !== '' && v !== undefined && !(Array.isArray(v) && !v.length))) as Partial<Employee>
    const matches = candidates.filter(e => row.nip ? e.nip === row.nip || e.aliases.some(a => a.kind === 'nip' && a.value === row.nip) : row.nika ? e.nika === row.nika : false)
    if (matches.length > 1) throw new Error(`Identifier konflik untuk ${row.nama}; selesaikan pencocokan terlebih dahulu`)
    const existing = matches[0]
    if (existing) { patches[existing.id] = { ...patches[existing.id], ...clean }; Object.assign(existing, clean); updated++ }
    else {
      const e = { ...blank(''), ...clean, id: makeId(), sources: ['Master pegawai'] }
      next.push(e); candidates.push(e); added++
    }
  }
  return { master: next, overrides: patches, added, updated }
}
import { blankEmployee as blank } from '../src/engine/roster.ts'
