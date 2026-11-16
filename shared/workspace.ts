import type { DayReview, Employee, MatchDecision, Resolution, SourceFile } from '../src/engine/types.ts'
import { DEFAULT_POLICY, type MealPolicy } from '../src/engine/policy.ts'

export type Workspace = {
  version: 2; files: SourceFile[]; master: Employee[]; overrides: Record<string, Partial<Employee>>
  decisions: MatchDecision[]; resolutions: Resolution[]; dayReviews: DayReview[]; policy: MealPolicy; reviewer: string; period: string
}
export const emptyWorkspace = (): Workspace => ({ version: 2, files: [], master: [], overrides: {}, decisions: [], resolutions: [], dayReviews: [], policy: { ...DEFAULT_POLICY }, reviewer: '', period: '' })
export const roles = ['superadmin', 'admin', 'operator_st'] as const
export type Role = typeof roles[number]
export const ROLE_LABEL: Record<Role, string> = { superadmin: 'Superadmin', admin: 'Admin · rekonsiliasi', operator_st: 'Operator Rekap ST' }
export const isRole = (value: string | null | undefined): value is Role => (roles as readonly string[]).includes(value ?? '')
/** Display-only mapping for account lists. Legacy roles (hr, viewer, reviewer, …) cannot sign in
 *  until a superadmin assigns a current role; see the session gate in server/app.ts. */
export function canonicalRole(value: string | null | undefined): Role {
  return isRole(value) ? value : 'admin'
}
export type User = { id: string; email: string; name: string; role: Role; offices?: string[] | null }
export type WorkspaceResponse = { state: Workspace; revision: number }

/** Every supplied strong identifier must refer to the same person. Names never merge records. */
export function matchEmployeeIdentifiers(roster: Employee[], row: Partial<Employee>) {
  const matches = roster.filter(e => (row.nip && (e.nip === row.nip || e.aliases.some(a => a.kind === 'nip' && a.value === row.nip))) || (row.nika && (e.nika === row.nika || e.aliases.some(a => a.kind === 'nika' && a.value === row.nika))))
  if (matches.length > 1 || matches.some(e => (row.nip && e.nip && e.nip !== row.nip && !e.aliases.some(a => a.kind === 'nip' && a.value === row.nip)) || (row.nika && e.nika && e.nika !== row.nika && !e.aliases.some(a => a.kind === 'nika' && a.value === row.nika)))) throw new Error('NIP dan NIKA menunjuk identitas berbeda; selesaikan pencocokan terlebih dahulu')
  return matches[0]
}

/** Stage index is refreshed within the batch, preserving internal IDs and nonempty fields. */
export function upsertEmployees(master: Employee[], roster: Employee[], overrides: Record<string, Partial<Employee>>, rows: Partial<Employee>[], makeId: () => string) {
  const next = [...master], patches = { ...overrides }, candidates = roster.map(e => ({ ...e }))
  let added = 0, updated = 0
  for (const row of rows) {
    if (!row.nama && !row.nip) continue
    const clean = Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== 'id' && v !== '' && v !== undefined && !(Array.isArray(v) && !v.length))) as Partial<Employee>
    const existing = matchEmployeeIdentifiers(candidates, row)
    if (existing) { patches[existing.id] = { ...patches[existing.id], ...clean }; Object.assign(existing, clean); updated++ }
    else {
      if (!row.nama) throw new Error('Nama wajib diisi untuk pegawai baru')
      const e = { ...blank(''), ...clean, id: makeId(), sources: ['Master pegawai'] }
      next.push(e); candidates.push(e); added++
    }
  }
  return { master: next, overrides: patches, added, updated }
}
import { blankEmployee as blank } from '../src/engine/roster.ts'
